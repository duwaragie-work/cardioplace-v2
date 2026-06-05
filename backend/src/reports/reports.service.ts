import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  isEscalatedStep,
  TIER_SLA_MINUTES,
  type AlertTierValue,
  type MonthlyReport,
  type MonthlyReportOverall,
  type ProviderLeaderboardRow,
  type TierBreakdownRow,
} from '@cardioplace/shared'
import PDFDocument from 'pdfkit'
import type { Prisma } from '../generated/prisma/client.js'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

// ─── Types ────────────────────────────────────────────────────────────────

export interface ReportsActor {
  id: string
  email: string | null
  roles: UserRole[]
}

export interface PracticeRow {
  id: string
  name: string
  businessHoursTimezone: string
}

const ALL_TIERS: AlertTierValue[] = [
  'BP_LEVEL_2',
  'BP_LEVEL_2_SYMPTOM_OVERRIDE',
  'TIER_1_CONTRAINDICATION',
  'TIER_1_ANGIOEDEMA',
  'TIER_2_DISCREPANCY',
  'BP_LEVEL_1_HIGH',
  'BP_LEVEL_1_LOW',
  'TIER_3_INFO',
]

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Resolve the [start, end) UTC window for a YYYY-MM identifier interpreted
 * in the given IANA timezone. End is the first instant of the next month
 * in the same timezone (half-open). Works without a date library.
 */
export function monthWindowInTz(
  monthYear: string,
  timezone: string,
): { start: Date; end: Date } {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(monthYear)
  if (!match) {
    throw new BadRequestException(`Invalid month: ${monthYear}`)
  }
  const year = Number(match[1])
  const month = Number(match[2]) // 1-12

  const start = utcInstantForLocalMidnight(year, month, 1, timezone)
  const nextYear = month === 12 ? year + 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const end = utcInstantForLocalMidnight(nextYear, nextMonth, 1, timezone)
  return { start, end }
}

/**
 * Convert (year, month, day) at local midnight in `timezone` to the UTC
 * instant. Uses Intl to learn the timezone's offset at that wall-clock,
 * which handles DST transitions correctly within ~1 minute (good enough
 * for monthly windows that start at midnight, well clear of any 02:00 DST
 * shift). Throws on invalid timezone.
 */
function utcInstantForLocalMidnight(
  year: number,
  month: number,
  day: number,
  timezone: string,
): Date {
  // First guess: treat the wall-clock as if it were UTC.
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0))
  // Discover the timezone's offset (minutes from UTC) at that guess.
  const offsetMin = tzOffsetMinutes(guess, timezone)
  // Subtract the offset to get the true UTC instant for local midnight.
  return new Date(guess.getTime() - offsetMin * 60_000)
}

function tzOffsetMinutes(at: Date, timezone: string): number {
  // Parts in the target tz at the given UTC instant.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(at)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  )
  return Math.round((asUtc - at.getTime()) / 60_000)
}

/**
 * Default month = the calendar month immediately before "now", interpreted
 * in the practice's timezone. e.g. on 2026-06-03 in NYC → "2026-05".
 */
export function previousMonthInTz(now: Date, timezone: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
  })
  const parts: Record<string, string> = {}
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== 'literal') parts[p.type] = p.value
  }
  const y = Number(parts.year)
  const m = Number(parts.month)
  const py = m === 1 ? y - 1 : y
  const pm = m === 1 ? 12 : m - 1
  return `${py}-${String(pm).padStart(2, '0')}`
}

function meanSecondsBetween(
  rows: Array<{ from: Date | null; to: Date | null }>,
): number | null {
  const deltas: number[] = []
  for (const r of rows) {
    if (!r.from || !r.to) continue
    const dt = (r.to.getTime() - r.from.getTime()) / 1000
    if (dt >= 0 && Number.isFinite(dt)) deltas.push(dt)
  }
  if (deltas.length === 0) return null
  const sum = deltas.reduce((s, x) => s + x, 0)
  return Math.round(sum / deltas.length)
}

function pct(part: number, whole: number): number {
  if (whole === 0) return 0
  return Math.round((part / whole) * 10000) / 100 // two decimals
}

// ─── Service ──────────────────────────────────────────────────────────────

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Authorize a caller to read reports for the given practice.
   *   SUPER_ADMIN, HEALPLACE_OPS  → any practice.
   *   MEDICAL_DIRECTOR            → only practices they head (joined via
   *                                 PracticeMedicalDirector).
   *   PROVIDER, COORDINATOR, PATIENT → no access.
   */
  async assertCanRead(caller: ReportsActor, practiceId: string): Promise<void> {
    if (
      caller.roles.includes(UserRole.SUPER_ADMIN) ||
      caller.roles.includes(UserRole.HEALPLACE_OPS)
    ) {
      return
    }
    if (caller.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      const row = await this.prisma.practiceMedicalDirector.findFirst({
        where: { userId: caller.id, practiceId },
        select: { id: true },
      })
      if (!row) {
        throw new ForbiddenException(
          'You are not the medical director for that practice',
        )
      }
      return
    }
    throw new ForbiddenException('You are not allowed to read reports')
  }

  /**
   * Resolve the set of practices the caller can choose from when they omit
   * `practiceId`. SUPER / OPS see every active practice; MED_DIR sees only
   * practices they head.
   */
  async listAccessiblePractices(caller: ReportsActor): Promise<PracticeRow[]> {
    if (
      caller.roles.includes(UserRole.SUPER_ADMIN) ||
      caller.roles.includes(UserRole.HEALPLACE_OPS)
    ) {
      return this.prisma.practice.findMany({
        select: { id: true, name: true, businessHoursTimezone: true },
        orderBy: { name: 'asc' },
      })
    }
    if (caller.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      const rows = await this.prisma.practiceMedicalDirector.findMany({
        where: { userId: caller.id },
        select: {
          practice: {
            select: { id: true, name: true, businessHoursTimezone: true },
          },
        },
      })
      return rows.map((r) => r.practice)
    }
    return []
  }

  /**
   * Generate a monthly report for a single practice. Reads from
   * MonthlyReportSnapshot when present (past months only — the current
   * month is always recomputed because alerts can still close inside it).
   * `fresh` forces a recompute regardless and overwrites the snapshot.
   */
  async getMonthly(params: {
    caller: ReportsActor
    practiceId: string
    monthYear?: string
    fresh?: boolean
  }): Promise<MonthlyReport> {
    await this.assertCanRead(params.caller, params.practiceId)

    const practice = await this.prisma.practice.findUnique({
      where: { id: params.practiceId },
      select: { id: true, name: true, businessHoursTimezone: true },
    })
    if (!practice) throw new NotFoundException('Practice not found')

    const month =
      params.monthYear ??
      previousMonthInTz(new Date(), practice.businessHoursTimezone)
    const { start, end } = monthWindowInTz(month, practice.businessHoursTimezone)

    const isCurrentOrFuture = end > new Date()

    // Cache lookup — only for past, closed months and when not forced fresh.
    if (!params.fresh && !isCurrentOrFuture) {
      const cached = await this.prisma.monthlyReportSnapshot.findUnique({
        where: {
          practiceId_monthYear: { practiceId: practice.id, monthYear: month },
        },
      })
      if (cached) {
        // Mark cached=true on the way out so the UI can show a freshness
        // indicator + a "Recompute" affordance.
        const payload = cached.payload as unknown as MonthlyReport
        return { ...payload, cached: true }
      }
    }

    const report = await this.compute(practice, month, start, end)

    // Persist past-month snapshots (not the current month — that one
    // changes as more alerts close). Upsert so manual `?fresh=1` re-writes
    // the cache.
    if (!isCurrentOrFuture) {
      await this.prisma.monthlyReportSnapshot.upsert({
        where: {
          practiceId_monthYear: { practiceId: practice.id, monthYear: month },
        },
        create: {
          practiceId: practice.id,
          monthYear: month,
          payload: report as unknown as Prisma.InputJsonValue,
        },
        update: {
          payload: report as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
      })
    }

    return report
  }

  /**
   * Pure compute — no auth, no cache. Exposed so the cron can call it
   * directly without re-running authz. Returns a fresh `cached: false`
   * payload.
   */
  async compute(
    practice: PracticeRow,
    monthYear: string,
    start: Date,
    end: Date,
  ): Promise<MonthlyReport> {
    // Scope: alerts created in the window for any patient whose practice
    // link points at this practice. Mirror of the OR used in the user list
    // — a patient might have either the full clinical assignment or just
    // the invite back-reference.
    const alerts = await this.prisma.deviationAlert.findMany({
      where: {
        createdAt: { gte: start, lt: end },
        user: {
          OR: [
            {
              providerAssignmentAsPatient: {
                is: { practiceId: practice.id },
              },
            },
            { userInviteCreated: { is: { practiceId: practice.id } } },
          ],
        },
      },
      select: {
        id: true,
        tier: true,
        createdAt: true,
        acknowledgedAt: true,
        acknowledgedByUserId: true,
        resolvedAt: true,
        resolvedBy: true,
        escalationEvents: {
          select: { ladderStep: true },
        },
      },
    })

    // ── Resolve actor roles up front ─────────────────────────────────────
    // Both the tier aggregation and the provider leaderboard need to know
    // whether an `acknowledgedByUserId` / `resolvedBy` belongs to a valid
    // clinical resolver (PROVIDER / MED_DIR / SUPER_ADMIN). Patient
    // self-acks (e.g. a patient dismissing their own Tier 3 info) must
    // not count as practice responsiveness — they pollute the SLA % and
    // the provider table both. Fetch every actor's roles in one batch.
    const VALID_RESOLVER_ROLES: ReadonlySet<UserRole> = new Set([
      UserRole.SUPER_ADMIN,
      UserRole.MEDICAL_DIRECTOR,
      UserRole.PROVIDER,
    ])
    const actorIds = new Set<string>()
    for (const a of alerts) {
      if (a.acknowledgedByUserId) actorIds.add(a.acknowledgedByUserId)
      if (a.resolvedBy) actorIds.add(a.resolvedBy)
    }
    const actorUsers = actorIds.size
      ? await this.prisma.user.findMany({
          where: { id: { in: Array.from(actorIds) } },
          select: { id: true, name: true, email: true, roles: true },
        })
      : []
    const actorById = new Map(actorUsers.map((u) => [u.id, u]))
    const isValidActor = (id: string | null | undefined): boolean => {
      if (!id) return false
      const u = actorById.get(id)
      return !!u && u.roles.some((r) => VALID_RESOLVER_ROLES.has(r))
    }
    // A resolution "counts" if the resolver was a clinical actor OR if
    // there was no actor at all (auto-resolution by the escalation
    // scheduler — `resolvedBy` is null but `resolvedAt` is set).
    const isCountedResolve = (
      a: { resolvedAt: Date | null; resolvedBy: string | null },
    ): boolean =>
      a.resolvedAt !== null && (a.resolvedBy === null || isValidActor(a.resolvedBy))

    // ── Per-tier aggregation ─────────────────────────────────────────────
    const byTier: TierBreakdownRow[] = ALL_TIERS.map((tier) => {
      const inTier = alerts.filter((a) => a.tier === tier)
      const slaCutoffMs = TIER_SLA_MINUTES[tier] * 60_000
      // Only valid-actor acks count toward SLA — patient self-acks are
      // not clinical responsiveness.
      const ackedInWindow = inTier.filter(
        (a) =>
          a.acknowledgedAt !== null &&
          isValidActor(a.acknowledgedByUserId) &&
          a.acknowledgedAt.getTime() - a.createdAt.getTime() <= slaCutoffMs,
      ).length
      const escalated = inTier.filter((a) =>
        a.escalationEvents.some((e) => isEscalatedStep(e.ladderStep)),
      ).length
      const resolved = inTier.filter(isCountedResolve).length

      return {
        tier,
        total: inTier.length,
        acknowledgedInWindow: ackedInWindow,
        escalated,
        resolved,
        meanAckSeconds: meanSecondsBetween(
          inTier.map((a) => ({
            from: a.createdAt,
            // Ignore acks from non-clinical actors when averaging.
            to: isValidActor(a.acknowledgedByUserId) ? a.acknowledgedAt : null,
          })),
        ),
        meanResolveSeconds: meanSecondsBetween(
          inTier.map((a) => ({
            from: a.createdAt,
            to: isCountedResolve(a) ? a.resolvedAt : null,
          })),
        ),
      }
    })

    // ── Overall ──────────────────────────────────────────────────────────
    const totalAlerts = alerts.length
    const acknowledgedInWindow = byTier.reduce(
      (s, t) => s + t.acknowledgedInWindow,
      0,
    )
    const escalated = byTier.reduce((s, t) => s + t.escalated, 0)
    const resolved = byTier.reduce((s, t) => s + t.resolved, 0)
    // Practice roster size — snapshotted now, not at window end. Used in the
    // report header / summary tile so a reader can sanity-check alert volume
    // against the size of the patient population.
    const totalPatients = await this.prisma.patientProviderAssignment.count({
      where: { practiceId: practice.id },
    })
    const overall: MonthlyReportOverall = {
      totalAlerts,
      acknowledgedInWindow,
      acknowledgedInWindowPct: pct(acknowledgedInWindow, totalAlerts),
      escalated,
      escalatedPct: pct(escalated, totalAlerts),
      resolved,
      resolvedPct: pct(resolved, totalAlerts),
      // Same valid-actor filter for the overall row.
      meanAckSeconds: meanSecondsBetween(
        alerts.map((a) => ({
          from: a.createdAt,
          to: isValidActor(a.acknowledgedByUserId) ? a.acknowledgedAt : null,
        })),
      ),
      meanResolveSeconds: meanSecondsBetween(
        alerts.map((a) => ({
          from: a.createdAt,
          to: isCountedResolve(a) ? a.resolvedAt : null,
        })),
      ),
      totalPatients,
    }

    // ── Provider leaderboard ────────────────────────────────────────────
    // Collect every actor id that appears as an acknowledger or resolver,
    // then group by it. Same alert can appear under two providers (one
    // ack'd, another resolved); that's intentional — both "touched" it.
    type Bucket = {
      providerId: string | null
      ackedIds: Set<string>
      resolvedIds: Set<string>
      ackDeltas: number[]
    }
    const buckets = new Map<string, Bucket>()
    const bucketKeyFor = (id: string | null) => id ?? '__system__'
    const ensure = (id: string | null): Bucket => {
      const key = bucketKeyFor(id)
      const existing = buckets.get(key)
      if (existing) return existing
      const fresh: Bucket = {
        providerId: id,
        ackedIds: new Set(),
        resolvedIds: new Set(),
        ackDeltas: [],
      }
      buckets.set(key, fresh)
      return fresh
    }
    for (const a of alerts) {
      if (a.acknowledgedByUserId) {
        const b = ensure(a.acknowledgedByUserId)
        b.ackedIds.add(a.id)
        if (a.acknowledgedAt) {
          b.ackDeltas.push(
            (a.acknowledgedAt.getTime() - a.createdAt.getTime()) / 1000,
          )
        }
      }
      if (a.resolvedBy) {
        const b = ensure(a.resolvedBy)
        b.resolvedIds.add(a.id)
      }
    }

    // Seed empty buckets for every PROVIDER + MEDICAL_DIRECTOR on the
    // practice's roster — so the leaderboard shows the full clinical
    // team, not just whoever happened to touch an alert this month.
    // Zero-activity rows sort to the bottom (alphabetized) and signal
    // "this person was on the team but did nothing" — actionable for
    // the MD. SUPER_ADMIN is intentionally NOT seeded: they're a
    // cross-cutting role, not part of any one practice's roster.
    const [practiceProviders, practiceMDs] = await Promise.all([
      this.prisma.practiceProvider.findMany({
        where: { practiceId: practice.id },
        select: { userId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { practiceId: practice.id },
        select: { userId: true },
      }),
    ])
    const rosterIds = new Set<string>([
      ...practiceProviders.map((p) => p.userId),
      ...practiceMDs.map((m) => m.userId),
    ])
    const missingRosterIds = Array.from(rosterIds).filter(
      (id) => !actorById.has(id),
    )
    if (missingRosterIds.length > 0) {
      const extras = await this.prisma.user.findMany({
        where: { id: { in: missingRosterIds } },
        select: { id: true, name: true, email: true, roles: true },
      })
      for (const u of extras) actorById.set(u.id, u)
    }
    for (const id of rosterIds) ensure(id)

    // Leaderboard uses the same actor-role map + valid-resolver set built
    // before the tier aggregation, so the two surfaces stay in lock-step
    // (a patient self-ack is excluded from both the SLA % and this list).
    const byProvider: ProviderLeaderboardRow[] = Array.from(buckets.values())
      .filter((b) => {
        // Always keep the system bucket (providerId === null) — that's
        // the "Auto-escalation" row for alerts the cron closed without
        // any human actor.
        if (b.providerId === null) return true
        const u = actorById.get(b.providerId)
        // Unknown user (deleted / orphan id) — drop rather than render
        // a meaningless "(unknown)" row.
        if (!u) return false
        return u.roles.some((r) => VALID_RESOLVER_ROLES.has(r))
      })
      .map((b) => {
        const u = b.providerId ? actorById.get(b.providerId) : undefined
        const touched = new Set<string>([...b.ackedIds, ...b.resolvedIds])
        const meanAck =
          b.ackDeltas.length === 0
            ? null
            : Math.round(
                b.ackDeltas.reduce((s, x) => s + x, 0) / b.ackDeltas.length,
              )
        return {
          providerId: b.providerId,
          name:
            u?.name ??
            u?.email ??
            (b.providerId === null ? 'Auto-escalation' : '(unknown)'),
          alertsTouched: touched.size,
          acknowledgedCount: b.ackedIds.size,
          resolvedCount: b.resolvedIds.size,
          meanAckSeconds: meanAck,
        }
      })
      .sort((a, b) => {
        // Primary: most active first.
        if (b.alertsTouched !== a.alertsTouched) {
          return b.alertsTouched - a.alertsTouched
        }
        // Secondary: keep the system bucket at the very bottom (so the
        // human roster reads cleanly even when no one touched anything).
        if (a.providerId === null) return 1
        if (b.providerId === null) return -1
        // Tertiary: alphabetical by name — keeps zero-activity rows tidy.
        return a.name.localeCompare(b.name)
      })

    return {
      practiceId: practice.id,
      practiceName: practice.name,
      monthYear,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      practiceTimezone: practice.businessHoursTimezone,
      generatedAt: new Date().toISOString(),
      cached: false,
      overall,
      byTier,
      byProvider,
    }
  }

  // ─── CSV serialization ──────────────────────────────────────────────────
  /**
   * Render a `MonthlyReport` as a CSV blob. Three stacked sections —
   * Summary, By Tier, By Provider — separated by blank rows. Excel-friendly
   * (UTF-8 BOM prepended at the controller, not here).
   */
  toCsv(report: MonthlyReport): string {
    const lines: string[] = []
    const esc = (v: string | number | null) => {
      if (v === null || v === undefined) return ''
      const s = String(v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const row = (...cells: Array<string | number | null>) =>
      lines.push(cells.map(esc).join(','))

    row('Practice', report.practiceName)
    row('Month', report.monthYear)
    row('Window', `${report.windowStart} → ${report.windowEnd}`)
    row('Timezone', report.practiceTimezone)
    row('Generated', report.generatedAt)
    row('Cached', report.cached ? 'yes' : 'no')
    row('')

    row('SUMMARY')
    row('Metric', 'Value')
    row('Patients in practice', report.overall.totalPatients)
    row('Total alerts', report.overall.totalAlerts)
    row(
      'Acknowledged in SLA window',
      `${report.overall.acknowledgedInWindow} (${report.overall.acknowledgedInWindowPct}%)`,
    )
    row(
      'Escalated',
      `${report.overall.escalated} (${report.overall.escalatedPct}%)`,
    )
    row(
      'Resolved',
      `${report.overall.resolved} (${report.overall.resolvedPct}%)`,
    )
    row(
      'Mean time to acknowledge (s)',
      report.overall.meanAckSeconds ?? '',
    )
    row(
      'Mean time to resolve (s)',
      report.overall.meanResolveSeconds ?? '',
    )
    row('')

    row('BY TIER')
    row(
      'Tier',
      'Total',
      'Acked in window',
      'Escalated',
      'Resolved',
      'Mean ack (s)',
      'Mean resolve (s)',
    )
    for (const t of report.byTier) {
      row(
        t.tier,
        t.total,
        t.acknowledgedInWindow,
        t.escalated,
        t.resolved,
        t.meanAckSeconds ?? '',
        t.meanResolveSeconds ?? '',
      )
    }
    row('')

    row('BY PROVIDER')
    row(
      'Provider',
      'Alerts touched',
      'Acknowledged',
      'Resolved',
      'Mean ack (s)',
    )
    for (const p of report.byProvider) {
      row(
        p.name,
        p.alertsTouched,
        p.acknowledgedCount,
        p.resolvedCount,
        p.meanAckSeconds ?? '',
      )
    }

    return lines.join('\n') + '\n'
  }

  // ─── PDF serialization ──────────────────────────────────────────────────
  /**
   * Render a `MonthlyReport` as a PDF Buffer. Single-page tabular layout
   * (Summary tiles, Per-tier table, Per-provider table) intended to be
   * printed by an MD or filed in a Joint Commission compliance archive.
   *
   * Uses pdfkit (pure JS, no headless browser) so the cron and on-demand
   * requests both stay cheap. Streams into a buffer because pdfkit's
   * write API is event-based — we resolve once `end` fires.
   */
  toPdf(report: MonthlyReport): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'LETTER',
        margins: { top: 44, bottom: 56, left: 44, right: 44 },
        // Buffer pages so we can paint the footer onto every page after
        // all body content is laid down (otherwise pdfkit auto-paginates
        // when we write at a Y past the bottom margin and the footer
        // ends up alone on a new page).
        bufferPages: true,
        info: {
          Title: `Monthly Practice Report — ${report.practiceName} — ${report.monthYear}`,
          Author: 'Cardioplace',
          Subject: 'Monthly Practice Analytics Report',
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Brand-aligned palette (same tokens used by the admin app + email).
      const PURPLE = '#7B00E0'
      const TEXT = '#1F2937'
      const TEXT_SOFT = '#374151'
      const MUTED = '#6B7280'
      const TILE_BG = '#F3F0FF'
      const HEADER_BG = '#F8FAFC'
      const BORDER = '#E5E7EB'
      const ZEBRA = '#FAFBFF'

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right
      const leftX = doc.page.margins.left

      // ── Helpers ──────────────────────────────────────────────────────
      const secLabel = (n: number | null) =>
        n === null ? '—' : `${Math.round(n / 60)} min`

      // Format an ISO date string as a short, human-readable label so the
      // window line in the header doesn't look like a log timestamp.
      const fmtDate = (iso: string): string => {
        try {
          return new Date(iso).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
          })
        } catch {
          return iso
        }
      }

      const drawSectionTitle = (title: string) => {
        doc
          .font('Helvetica-Bold')
          .fillColor(TEXT)
          .fontSize(11)
          .text(title.toUpperCase(), leftX, doc.y, {
            characterSpacing: 0.6,
            width: pageWidth,
          })
        doc.font('Helvetica')
        doc.moveDown(0.7)
      }

      // Footer text band + clear gap above. Reserved at the bottom of every
      // page so tables stop short of the footer and never overlap it.
      const FOOTER_RESERVE = 28

      type Col = {
        label: string
        width: number
        align?: 'left' | 'right'
        /** Per-column body cell font size (header stays at 8.5). Use a
         *  smaller value for columns whose row text otherwise wraps badly
         *  — e.g. tier names like "BP LEVEL 2 SYMPTOM OVERRIDE". */
        cellFontSize?: number
      }

      /**
       * Render a table with automatic pagination. If a row would extend
       * past the page's footer-reserved bottom, the current segment closes
       * with borders, a new page is added, the column header repeats at
       * the top, and the next row continues from there. Zebra striping
       * uses the original row index so the alternating tint stays stable
       * across the break. Row heights are dynamic — long content wraps
       * and the row grows to fit.
       */
      const drawTable = (cols: Col[], cells: string[][]): void => {
        const HEADER_H = 24
        const MIN_ROW_H = 22
        const ROW_PAD_Y = 6
        const CELL_PAD_X = 8
        const DEFAULT_BODY_FS = 9.5

        // Pre-measure each row's needed height — per-column font respected.
        doc.font('Helvetica')
        const rowHeights = cells.map((row) => {
          let max = 0
          for (let j = 0; j < cols.length; j++) {
            doc.fontSize(cols[j].cellFontSize ?? DEFAULT_BODY_FS)
            const w = cols[j].width * pageWidth - CELL_PAD_X * 2
            const h = doc.heightOfString(row[j] ?? '', {
              width: w,
              align: cols[j].align ?? 'left',
            })
            if (h > max) max = h
          }
          return Math.max(MIN_ROW_H, Math.ceil(max + ROW_PAD_Y * 2))
        })

        // ── Per-segment helpers (one segment per page) ──────────────────
        const drawHeader = (top: number) => {
          doc.save()
          doc.fillColor(HEADER_BG).rect(leftX, top, pageWidth, HEADER_H).fill()
          doc.restore()
          let cx = leftX
          doc.font('Helvetica-Bold').fillColor(TEXT).fontSize(8.5)
          for (const c of cols) {
            const w = c.width * pageWidth
            doc.text(c.label.toUpperCase(), cx + CELL_PAD_X, top + 8, {
              width: w - CELL_PAD_X * 2,
              align: c.align ?? 'left',
              lineBreak: false,
              ellipsis: true,
            })
            cx += w
          }
        }

        const drawSegmentBorders = (
          top: number,
          height: number,
          segmentRowHeights: number[],
        ) => {
          doc.save()
          doc.strokeColor(BORDER).lineWidth(0.5)
          // Outer border
          doc.rect(leftX, top, pageWidth, height).stroke()
          // Vertical column dividers
          let cx = leftX
          for (let j = 0; j < cols.length - 1; j++) {
            cx += cols[j].width * pageWidth
            doc.moveTo(cx, top).lineTo(cx, top + height).stroke()
          }
          // Header / body divider
          doc
            .moveTo(leftX, top + HEADER_H)
            .lineTo(leftX + pageWidth, top + HEADER_H)
            .stroke()
          // Inter-row dividers within this segment
          let rowOff = HEADER_H
          for (let k = 0; k < segmentRowHeights.length - 1; k++) {
            rowOff += segmentRowHeights[k]
            doc
              .moveTo(leftX, top + rowOff)
              .lineTo(leftX + pageWidth, top + rowOff)
              .stroke()
          }
          doc.restore()
        }

        // Y past which no row may extend. Computed once — page height is
        // constant (LETTER) so this value is the same on every page.
        const bottomLimit =
          doc.page.height - doc.page.margins.bottom - FOOTER_RESERVE

        let segmentTop = doc.y
        let segmentY = HEADER_H
        let segmentRowHeights: number[] = []
        drawHeader(segmentTop)

        for (let i = 0; i < cells.length; i++) {
          const rowH = rowHeights[i]

          // Overflow → finish this segment, jump to a fresh page, repeat
          // the column header, and continue with this row at the top.
          if (segmentTop + segmentY + rowH > bottomLimit) {
            drawSegmentBorders(segmentTop, segmentY, segmentRowHeights)
            doc.addPage()
            segmentTop = doc.y
            segmentY = HEADER_H
            segmentRowHeights = []
            drawHeader(segmentTop)
          }

          // Zebra background uses the *original* row index so the stripe
          // pattern stays consistent visually across a page break.
          if (i % 2 === 1) {
            doc.save()
            doc
              .fillColor(ZEBRA)
              .rect(leftX, segmentTop + segmentY, pageWidth, rowH)
              .fill()
            doc.restore()
          }

          // Row text — per-column font respected.
          const rowY = segmentTop + segmentY + ROW_PAD_Y
          let cx = leftX
          doc.font('Helvetica').fillColor(TEXT_SOFT)
          for (let j = 0; j < cols.length; j++) {
            const w = cols[j].width * pageWidth
            doc.fontSize(cols[j].cellFontSize ?? DEFAULT_BODY_FS)
            doc.text(cells[i][j], cx + CELL_PAD_X, rowY, {
              width: w - CELL_PAD_X * 2,
              align: cols[j].align ?? 'left',
            })
            cx += w
          }

          segmentRowHeights.push(rowH)
          segmentY += rowH
        }

        // Close the final segment.
        drawSegmentBorders(segmentTop, segmentY, segmentRowHeights)
        doc.y = segmentTop + segmentY
      }

      // ── Header ───────────────────────────────────────────────────────
      // Document title is the page heading (the brand sits as a subtag
      // on the right side / via the email + sidebar). Big black "Monthly
      // Practice Report" reads as the document, then practice + month
      // below.
      doc
        .font('Helvetica-Bold')
        .fillColor(TEXT)
        .fontSize(20)
        .text('Monthly Practice Report', leftX, doc.y, {
          characterSpacing: 0.2,
        })
      doc.font('Helvetica')
      doc.moveDown(0.2)
      doc
        .fillColor(PURPLE)
        .fontSize(13)
        .text(`${report.practiceName} | ${report.monthYear}`, leftX, doc.y)
      doc.moveDown(0.3)
      doc
        .fillColor(MUTED)
        .fontSize(9)
        .text(
          `Window: ${fmtDate(report.windowStart)} | ${fmtDate(report.windowEnd)}  |  ${report.practiceTimezone}  |  ${report.overall.totalPatients} ${report.overall.totalPatients === 1 ? 'patient' : 'patients'} in practice`,
          leftX,
          doc.y,
        )
      doc
        .fillColor(MUTED)
        .fontSize(9)
        .text(
          `Generated: ${fmtDate(report.generatedAt)}  |  ${report.cached ? 'cached snapshot' : 'fresh compute'}`,
          leftX,
          doc.y,
        )

      // Thin divider under the header for a "letter" feel.
      doc.moveDown(0.8)
      doc.save()
      doc
        .strokeColor(BORDER)
        .lineWidth(0.5)
        .moveTo(leftX, doc.y)
        .lineTo(leftX + pageWidth, doc.y)
        .stroke()
      doc.restore()
      doc.moveDown(1.0)

      // ── KPI tiles (2x2 grid) ─────────────────────────────────────────
      const drawTile = (
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
        value: string,
        caption: string,
      ) => {
        doc.save()
        doc.roundedRect(x, y, w, h, 8).fillAndStroke(TILE_BG, TILE_BG)
        doc
          .fillColor(PURPLE)
          .fontSize(8.5)
          .text(label.toUpperCase(), x + 12, y + 10, {
            width: w - 24,
            characterSpacing: 0.8,
          })
        doc
          .fillColor(TEXT)
          .fontSize(18)
          .text(value, x + 12, y + 24, { width: w - 24 })
        doc
          .fillColor(MUTED)
          .fontSize(8.5)
          .text(caption, x + 12, y + 48, { width: w - 24 })
        doc.restore()
      }
      const tileGap = 12
      const tileW = (pageWidth - tileGap) / 2
      const tileH = 70
      const tileTop = doc.y
      const meanResolveLabel =
        report.overall.meanResolveSeconds === null
          ? '—'
          : `${Math.round(report.overall.meanResolveSeconds / 60)} min`
      const meanAckLabel =
        report.overall.meanAckSeconds === null
          ? '—'
          : `${Math.round(report.overall.meanAckSeconds / 60)} min`

      drawTile(
        leftX,
        tileTop,
        tileW,
        tileH,
        'Total alerts',
        String(report.overall.totalAlerts),
        `${report.overall.resolved} resolved`,
      )
      drawTile(
        leftX + tileW + tileGap,
        tileTop,
        tileW,
        tileH,
        'Acked in SLA',
        `${report.overall.acknowledgedInWindowPct}%`,
        `${report.overall.acknowledgedInWindow} of ${report.overall.totalAlerts}`,
      )
      drawTile(
        leftX,
        tileTop + tileH + tileGap,
        tileW,
        tileH,
        'Escalated',
        `${report.overall.escalatedPct}%`,
        `${report.overall.escalated} alerts`,
      )
      drawTile(
        leftX + tileW + tileGap,
        tileTop + tileH + tileGap,
        tileW,
        tileH,
        'Mean resolve',
        meanResolveLabel,
        `Mean ack ${meanAckLabel}`,
      )
      doc.y = tileTop + tileH * 2 + tileGap
      doc.x = leftX
      doc.moveDown(1.4)

      // ── By Tier ──────────────────────────────────────────────────────
      drawSectionTitle('By tier')
      // Widths tuned so EVERY header label fits on one line at Helvetica-Bold
      // 8.5pt with 8pt cell padding (16pt total per cell). The Tier column
      // gets the extra slack — its body content is the longest in the table
      // and a smaller cellFontSize keeps multi-line wraps tight and readable.
      // Header label widths (approx): TIER 24, TOTAL 33, ACKED SLA 51,
      // ESCALATED 56, RESOLVED 51, MEAN ACK 49, MEAN RESOLVE 71.
      const tierCols: Col[] = [
        { label: 'Tier', width: 0.19, cellFontSize: 8.5 },
        { label: 'Total', width: 0.10, align: 'right' },
        { label: 'Acked SLA', width: 0.13, align: 'right' },
        { label: 'Escalated', width: 0.14, align: 'right' },
        { label: 'Resolved', width: 0.13, align: 'right' },
        { label: 'Mean ack', width: 0.13, align: 'right' },
        { label: 'Mean resolve', width: 0.18, align: 'right' },
      ]
      const tierCells = report.byTier.map((t) => [
        t.tier.replace(/_/g, ' '),
        String(t.total),
        String(t.acknowledgedInWindow),
        String(t.escalated),
        String(t.resolved),
        secLabel(t.meanAckSeconds),
        secLabel(t.meanResolveSeconds),
      ])
      drawTable(tierCols, tierCells)
      doc.moveDown(1.2)

      // ── By Provider ──────────────────────────────────────────────────
      drawSectionTitle('By provider')
      // Widths tuned so "ACKNOWLEDGED" fits the header on one line — the
      // longest label drives the second column's minimum width.
      const provCols: Col[] = [
        { label: 'Provider', width: 0.34 },
        { label: 'Touched', width: 0.14, align: 'right' },
        { label: 'Acknowledged', width: 0.20, align: 'right' },
        { label: 'Resolved', width: 0.14, align: 'right' },
        { label: 'Mean ack', width: 0.18, align: 'right' },
      ]
      if (report.byProvider.length === 0) {
        doc
          .fillColor(MUTED)
          .fontSize(10)
          .text('(No provider activity in window.)', leftX, doc.y, {
            width: pageWidth,
          })
      } else {
        const provCells = report.byProvider.map((p) => [
          p.name,
          String(p.alertsTouched),
          String(p.acknowledgedCount),
          String(p.resolvedCount),
          secLabel(p.meanAckSeconds),
        ])
        drawTable(provCols, provCells)
      }

      // ── Footer (drawn after body, on every buffered page) ────────────
      // Pinning the footer at an absolute Y *inside* the writable area
      // (just above the bottom margin, not in it) so pdfkit can't decide
      // to auto-paginate the footer onto a fresh page 2 when page 1 still
      // has free space below the last body row.
      const footerText = `Resolved ${report.overall.resolved} of ${report.overall.totalAlerts}  ·  ${report.byProvider.length} ${report.byProvider.length === 1 ? 'provider' : 'providers'}  ·  Cardioplace Monthly Report`
      const range = doc.bufferedPageRange()
      for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i)
        // 14pt above the bottom-margin line — text sits comfortably inside
        // the printable area so explicit-Y draws never trip auto-pagination.
        const footerY =
          doc.page.height - doc.page.margins.bottom - 14
        doc
          .font('Helvetica')
          .fillColor(MUTED)
          .fontSize(8)
          .text(footerText, leftX, footerY, {
            width: pageWidth,
            align: 'center',
            lineBreak: false,
          })
      }

      doc.end()
    })
  }
}
