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

    // ── Per-tier aggregation ─────────────────────────────────────────────
    const byTier: TierBreakdownRow[] = ALL_TIERS.map((tier) => {
      const inTier = alerts.filter((a) => a.tier === tier)
      const slaCutoffMs = TIER_SLA_MINUTES[tier] * 60_000
      const ackedInWindow = inTier.filter(
        (a) =>
          a.acknowledgedAt !== null &&
          a.acknowledgedAt.getTime() - a.createdAt.getTime() <= slaCutoffMs,
      ).length
      const escalated = inTier.filter((a) =>
        a.escalationEvents.some((e) => isEscalatedStep(e.ladderStep)),
      ).length
      const resolved = inTier.filter((a) => a.resolvedAt !== null).length

      return {
        tier,
        total: inTier.length,
        acknowledgedInWindow: ackedInWindow,
        escalated,
        resolved,
        meanAckSeconds: meanSecondsBetween(
          inTier.map((a) => ({ from: a.createdAt, to: a.acknowledgedAt })),
        ),
        meanResolveSeconds: meanSecondsBetween(
          inTier.map((a) => ({ from: a.createdAt, to: a.resolvedAt })),
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
    const overall: MonthlyReportOverall = {
      totalAlerts,
      acknowledgedInWindow,
      acknowledgedInWindowPct: pct(acknowledgedInWindow, totalAlerts),
      escalated,
      escalatedPct: pct(escalated, totalAlerts),
      resolved,
      resolvedPct: pct(resolved, totalAlerts),
      meanAckSeconds: meanSecondsBetween(
        alerts.map((a) => ({ from: a.createdAt, to: a.acknowledgedAt })),
      ),
      meanResolveSeconds: meanSecondsBetween(
        alerts.map((a) => ({ from: a.createdAt, to: a.resolvedAt })),
      ),
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

    // Resolve display names in one round-trip.
    const providerIds = Array.from(buckets.values())
      .map((b) => b.providerId)
      .filter((id): id is string => !!id)
    const users = providerIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: providerIds } },
          select: { id: true, name: true, email: true },
        })
      : []
    const userById = new Map(users.map((u) => [u.id, u]))

    const byProvider: ProviderLeaderboardRow[] = Array.from(buckets.values())
      .map((b) => {
        const u = b.providerId ? userById.get(b.providerId) : undefined
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
      .sort((a, b) => b.alertsTouched - a.alertsTouched)

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
        margins: { top: 48, bottom: 48, left: 48, right: 48 },
        info: {
          Title: `Cardioplace — ${report.practiceName} — ${report.monthYear}`,
          Author: 'Cardioplace',
          Subject: 'Monthly Practice Analytics Report',
        },
      })

      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)

      // Colors borrowed from the brand tokens used in the email.
      const PURPLE = '#7B00E0'
      const TEXT = '#1F2937'
      const MUTED = '#6B7280'
      const TILE_BG = '#F3F0FF'
      const BORDER = '#E5E7EB'

      const pageWidth =
        doc.page.width - doc.page.margins.left - doc.page.margins.right

      // ── Header ────────────────────────────────────────────────────────
      doc
        .fillColor(PURPLE)
        .fontSize(22)
        .text('Cardioplace', { align: 'left' })
      doc
        .fillColor(TEXT)
        .fontSize(16)
        .text(`${report.practiceName} — ${report.monthYear}`)
      doc
        .fillColor(MUTED)
        .fontSize(10)
        .text(
          `Window: ${report.windowStart}  →  ${report.windowEnd}  (${report.practiceTimezone})`,
        )
        .text(
          `Generated: ${report.generatedAt}${report.cached ? '  •  cached snapshot' : '  •  fresh compute'}`,
        )
      doc.moveDown(1.2)

      // ── KPI tiles (2x2 grid) ─────────────────────────────────────────
      const drawTile = (
        x: number,
        y: number,
        w: number,
        h: number,
        label: string,
        value: string,
      ) => {
        doc.save()
        doc.roundedRect(x, y, w, h, 8).fillAndStroke(TILE_BG, TILE_BG)
        doc
          .fillColor(PURPLE)
          .fontSize(9)
          .text(label.toUpperCase(), x + 12, y + 10, {
            width: w - 24,
            characterSpacing: 0.5,
          })
        doc
          .fillColor(TEXT)
          .fontSize(20)
          .text(value, x + 12, y + 28, { width: w - 24 })
        doc.restore()
      }
      const tileW = (pageWidth - 12) / 2
      const tileH = 60
      const tileTop = doc.y
      const meanResolveLabel =
        report.overall.meanResolveSeconds === null
          ? '—'
          : `${Math.round(report.overall.meanResolveSeconds / 60)} min`
      const meanAckLabel =
        report.overall.meanAckSeconds === null
          ? '—'
          : `${Math.round(report.overall.meanAckSeconds / 60)} min`

      const leftX = doc.page.margins.left
      drawTile(leftX, tileTop, tileW, tileH, 'Total alerts', String(report.overall.totalAlerts))
      drawTile(leftX + tileW + 12, tileTop, tileW, tileH, 'Acked in SLA', `${report.overall.acknowledgedInWindowPct}%`)
      drawTile(leftX, tileTop + tileH + 12, tileW, tileH, 'Escalated', `${report.overall.escalatedPct}%`)
      drawTile(leftX + tileW + 12, tileTop + tileH + 12, tileW, tileH, 'Mean resolve', meanResolveLabel)
      doc.y = tileTop + tileH * 2 + 12 + 24
      doc.x = leftX

      // ── By Tier table ────────────────────────────────────────────────
      const drawSectionTitle = (title: string) => {
        doc
          .fillColor(MUTED)
          .fontSize(11)
          .text(title.toUpperCase(), { characterSpacing: 1 })
        doc.moveDown(0.3)
      }
      const drawRule = () => {
        const y = doc.y
        doc.save()
        doc
          .strokeColor(BORDER)
          .lineWidth(0.5)
          .moveTo(leftX, y)
          .lineTo(leftX + pageWidth, y)
          .stroke()
        doc.restore()
        doc.moveDown(0.4)
      }

      drawSectionTitle('By tier')
      const tierCols = [
        { key: 'tier', label: 'Tier', width: 0.30 },
        { key: 'total', label: 'Total', width: 0.10 },
        { key: 'acked', label: 'Acked SLA', width: 0.12 },
        { key: 'escalated', label: 'Escalated', width: 0.12 },
        { key: 'resolved', label: 'Resolved', width: 0.12 },
        { key: 'ack', label: 'Mean ack', width: 0.12 },
        { key: 'resolve', label: 'Mean resolve', width: 0.12 },
      ]
      const drawTableRow = (
        cols: Array<{ label: string; width: number }>,
        cells: string[],
        bold: boolean,
      ) => {
        const rowY = doc.y
        let cx = leftX
        doc.fillColor(bold ? MUTED : TEXT).fontSize(bold ? 9 : 10)
        for (let i = 0; i < cols.length; i++) {
          const w = cols[i].width * pageWidth
          doc.text(cells[i], cx + 2, rowY, { width: w - 4 })
          cx += w
        }
        doc.y = rowY + (bold ? 14 : 16)
      }
      drawTableRow(tierCols, tierCols.map((c) => c.label), true)
      drawRule()
      const secLabel = (n: number | null) =>
        n === null ? '—' : `${Math.round(n / 60)} min`
      for (const t of report.byTier) {
        drawTableRow(
          tierCols,
          [
            t.tier.replace(/_/g, ' '),
            String(t.total),
            String(t.acknowledgedInWindow),
            String(t.escalated),
            String(t.resolved),
            secLabel(t.meanAckSeconds),
            secLabel(t.meanResolveSeconds),
          ],
          false,
        )
      }
      doc.moveDown(0.8)

      // ── By Provider table ────────────────────────────────────────────
      drawSectionTitle('By provider')
      const provCols = [
        { key: 'name', label: 'Provider', width: 0.40 },
        { key: 'touched', label: 'Touched', width: 0.15 },
        { key: 'acked', label: 'Acknowledged', width: 0.15 },
        { key: 'resolved', label: 'Resolved', width: 0.15 },
        { key: 'ack', label: 'Mean ack', width: 0.15 },
      ]
      drawTableRow(provCols, provCols.map((c) => c.label), true)
      drawRule()
      if (report.byProvider.length === 0) {
        doc.fillColor(MUTED).fontSize(10).text('(No provider activity in window.)')
      }
      for (const p of report.byProvider) {
        drawTableRow(
          provCols,
          [
            p.name,
            String(p.alertsTouched),
            String(p.acknowledgedCount),
            String(p.resolvedCount),
            secLabel(p.meanAckSeconds),
          ],
          false,
        )
      }

      // ── Footer ──────────────────────────────────────────────────────
      const footerY = doc.page.height - doc.page.margins.bottom + 12
      doc
        .fillColor(MUTED)
        .fontSize(8)
        .text(
          `Mean ack ${meanAckLabel}  •  Resolved ${report.overall.resolved} / ${report.overall.totalAlerts}  •  ${report.byProvider.length} providers`,
          leftX,
          footerY,
          { width: pageWidth, align: 'center' },
        )

      doc.end()
    })
  }
}
