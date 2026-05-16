import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { GapAlertService } from '../crons/gap-alert.service.js'
import { MonthlyReaskService } from '../crons/monthly-reask.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { ladderForTier } from '../daily_journal/escalation/ladder-defs.js'
import type { LadderStep as LadderStepEnum } from '../generated/prisma/client.js'

/**
 * Helpers backing the /test-control HTTP endpoints. Pure delegation —
 * the controller layer handles auth/secret + DTO shape.
 */
@Injectable()
export class TestControlService {
  private readonly logger = new Logger(TestControlService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly gapAlerts: GapAlertService,
    private readonly monthlyReask: MonthlyReaskService,
    private readonly escalation: EscalationService,
  ) {}

  // ─── Cron drivers ───────────────────────────────────────────────────────
  async runEscalationScan(now: Date): Promise<{ scanned: number; dispatched: number }> {
    const before = await this.prisma.escalationEvent.count()
    await this.escalation.runScan(now)
    const after = await this.prisma.escalationEvent.count()
    return { scanned: 1, dispatched: Math.max(0, after - before) }
  }

  async runGapAlertScan(now: Date): Promise<{ scanned: number; nudged: number }> {
    const sent = await this.gapAlerts.runScan(now)
    return { scanned: 1, nudged: sent }
  }

  async runMonthlyReaskScan(now: Date): Promise<{ scanned: number; reasked: number }> {
    const sent = await this.monthlyReask.runScan(now)
    return { scanned: 1, reasked: sent }
  }

  // ─── Time advancement ───────────────────────────────────────────────────
  async backdateAlertAnchor(alertId: string, deltaSeconds: number): Promise<void> {
    // Backdate the T+0 anchor row so subsequent runScan calls see ladder
    // steps as overdue.
    //
    // Two complications this helper has to handle:
    //
    //   1. Tier 1 has TWO T+0 rows when the alert fires after-hours: a
    //      QUEUED primary (notificationSentAt=null, scheduledFor=next-business
    //      -open) AND a courtesy backup row that fires immediately. The
    //      ladder anchor is the PRIMARY one — pick it explicitly via
    //      recipientRoles filter, otherwise we'd backdate the wrong row and
    //      advance never triggers.
    //
    //   2. After-hours queueing leaves notificationSentAt=null. The advance
    //      logic only treats a T+0 as "completed" when notificationSentAt is
    //      non-null, so we have to FORCE-SET it to the backdated anchor time.
    //      This effectively simulates "the T+0 dispatch happened
    //      deltaSeconds ago" — what tests need to fast-forward through the
    //      after-hours window.
    const ms = deltaSeconds * 1000
    const primary = await this.prisma.escalationEvent.findFirst({
      where: {
        alertId,
        ladderStep: 'T0',
        recipientRoles: { has: 'PRIMARY_PROVIDER' },
      },
      orderBy: { triggeredAt: 'asc' },
    })
    const t0 =
      primary ??
      (await this.prisma.escalationEvent.findFirst({
        where: { alertId, ladderStep: 'T0' },
        orderBy: { triggeredAt: 'asc' },
      }))
    if (!t0) {
      throw new Error(`No T0 event found for alert ${alertId}`)
    }
    const triggeredAt = new Date(t0.triggeredAt.getTime() - ms)
    // Force-set notificationSentAt — even if row was queued (null), tests
    // need the anchor calc to find a non-null value so the deadline math
    // works regardless of business-hours.
    const notificationSentAt = t0.notificationSentAt
      ? new Date(t0.notificationSentAt.getTime() - ms)
      : triggeredAt
    const scheduledFor = t0.scheduledFor
      ? new Date(t0.scheduledFor.getTime() - ms)
      : null
    await this.prisma.escalationEvent.update({
      where: { id: t0.id },
      data: { triggeredAt, notificationSentAt, scheduledFor },
    })
  }

  /**
   * Backdate a `triggeredByResolution: true` event (BP L2 retry path) so the
   * scheduled retry's `scheduledFor` is in the past — lets tests verify the
   * retry actually dispatches via firePendingScheduled without sleeping 4h.
   */
  async backdateRetryEvent(alertId: string, deltaSeconds: number): Promise<void> {
    const retry = await this.prisma.escalationEvent.findFirst({
      where: { alertId, triggeredByResolution: true, notificationSentAt: null },
      orderBy: { triggeredAt: 'desc' },
    })
    if (!retry) {
      throw new Error(`No pending retry event found for alert ${alertId}`)
    }
    const ms = deltaSeconds * 1000
    const scheduledFor = retry.scheduledFor
      ? new Date(retry.scheduledFor.getTime() - ms)
      : new Date(Date.now() - ms)
    const triggeredAt = new Date(retry.triggeredAt.getTime() - ms)
    await this.prisma.escalationEvent.update({
      where: { id: retry.id },
      data: { scheduledFor, triggeredAt },
    })
  }

  async backdateLastJournalEntry(userId: string, deltaSeconds: number): Promise<void> {
    const latest = await this.prisma.journalEntry.findFirst({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
    })
    if (!latest) return
    await this.prisma.journalEntry.update({
      where: { id: latest.id },
      data: { measuredAt: new Date(latest.measuredAt.getTime() - deltaSeconds * 1000) },
    })
  }

  async backdateMedicationVerified(medId: string, deltaSeconds: number): Promise<void> {
    const med = await this.prisma.patientMedication.findUnique({ where: { id: medId } })
    if (!med) throw new Error(`Medication ${medId} not found`)
    const reportedAt = med.reportedAt
      ? new Date(med.reportedAt.getTime() - deltaSeconds * 1000)
      : null
    const verifiedAt = med.verifiedAt
      ? new Date(med.verifiedAt.getTime() - deltaSeconds * 1000)
      : null
    await this.prisma.patientMedication.update({
      where: { id: medId },
      data: { reportedAt: reportedAt ?? med.reportedAt, verifiedAt },
    })
  }

  /**
   * Backdate every non-discontinued PatientMedication for a user. Drops the
   * dependence on `me/medications` (which filters by verificationStatus, so a
   * REJECTED med set up by an earlier test never gets touched) — the cron's
   * latestTouch over patientMedications.where(discontinuedAt: null) needs all
   * rows pushed past the cutoff for the test to be meaningful.
   */
  async backdateAllUserMedications(
    userId: string,
    deltaSeconds: number,
  ): Promise<{ updated: number }> {
    const meds = await this.prisma.patientMedication.findMany({
      where: { userId, discontinuedAt: null },
    })
    let updated = 0
    for (const m of meds) {
      const reportedAt = m.reportedAt
        ? new Date(m.reportedAt.getTime() - deltaSeconds * 1000)
        : null
      const verifiedAt = m.verifiedAt
        ? new Date(m.verifiedAt.getTime() - deltaSeconds * 1000)
        : null
      await this.prisma.patientMedication.update({
        where: { id: m.id },
        data: { reportedAt: reportedAt ?? m.reportedAt, verifiedAt },
      })
      updated++
    }
    return { updated }
  }

  /**
   * Backdate a User's `updatedAt`. The gap-alert cron uses
   * `User.updatedAt <= cutoff` as the "enrollment completed ≥48h ago" proxy
   * (see backend/src/crons/gap-alert.service.ts:51); resetUser doesn't touch
   * the user row so without this helper the candidate filter never matches a
   * just-seeded patient. Raw SQL is required because Prisma's `@updatedAt`
   * decorator overrides any value passed via `update()`.
   */
  async backdateUserUpdatedAt(userId: string, deltaSeconds: number): Promise<void> {
    const newUpdatedAt = new Date(Date.now() - deltaSeconds * 1000)
    await this.prisma.$executeRaw`
      UPDATE "User"
      SET "updatedAt" = ${newUpdatedAt}
      WHERE id = ${userId}
    `
  }

  // ─── State reset ────────────────────────────────────────────────────────
  /**
   * Wipe journal/alert/escalation/notification rows for every *.cardioplace.test
   * patient seed. User row + profile + medications + practice/assignment are
   * preserved — those are seed-stable.
   */
  async resetTestPatients(): Promise<{ usersTouched: number; rowsDeleted: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        email: { endsWith: '.cardioplace.test' },
        roles: { has: 'PATIENT' },
      },
      select: { id: true, email: true },
    })
    let rowsDeleted = 0
    for (const u of users) {
      const r = await this.resetUser(u.id)
      rowsDeleted += r.rowsDeleted
    }
    return { usersTouched: users.length, rowsDeleted }
  }

  async resetUser(userId: string): Promise<{ rowsDeleted: number }> {
    // Niva's co-fire pipeline ~doubles alert volume per scenario, which
    // multiplies the queued escalation/notification/email-retry transactions
    // running concurrently with the next test's reset. The original
    // Promise.all of four deleteManys ran them as four separate auto-commit
    // transactions, opening cyclic-lock-order deadlocks (Postgres 40P01)
    // against in-flight dispatch writes on EscalationEvent / Notification.
    //
    // Fix: serialize all four deletes into a single $transaction with
    // SERIALIZABLE isolation, ordered child-tables-first to acquire locks
    // in a single direction, and retry on either P2034 (Prisma transaction
    // conflict) or 40P01 (Postgres deadlock) up to three attempts with a
    // 100ms backoff between each. Test-infra only — no production path
    // resets users.
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const [escalations, notifications, alerts, entries] =
          await this.prisma.$transaction(
            [
              // Children of DeviationAlert first so the alerts row delete
              // can't be blocked by an FK reference still in flight.
              this.prisma.escalationEvent.deleteMany({ where: { alert: { userId } } }),
              this.prisma.notification.deleteMany({ where: { userId } }),
              this.prisma.deviationAlert.deleteMany({ where: { userId } }),
              this.prisma.journalEntry.deleteMany({ where: { userId } }),
            ],
            { isolationLevel: 'Serializable' },
          )
        return {
          rowsDeleted:
            notifications.count + escalations.count + alerts.count + entries.count,
        }
      } catch (err: unknown) {
        const e = err as { code?: string; meta?: { code?: string }; cause?: { code?: string } }
        const isDeadlock =
          e?.code === 'P2034' || e?.meta?.code === '40P01' || e?.cause?.code === '40P01'
        if (!isDeadlock || attempt === MAX_ATTEMPTS) throw err
        this.logger.warn(
          `resetUser deadlock (attempt ${attempt}/${MAX_ATTEMPTS}) for ${userId} — retrying in 100ms`,
        )
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    // Unreachable — the loop either returns or rethrows on the final attempt.
    return { rowsDeleted: 0 }
  }

  async setEnrollment(userId: string, status: 'NOT_ENROLLED' | 'ENROLLED'): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { enrollmentStatus: status },
    })
  }

  /**
   * Insert journal entries at exact timestamps. Used by tests that depend
   * on session windows (e.g. tachycardia 8h cross-session, AFib ≥3-reading
   * gate) — driving them via API + backdate is brittle when the tests
   * also assert reading count / order. Skips the alert engine: this is
   * raw fixture insertion, not a clinical event.
   */
  async seedReadingsAtTime(
    userId: string,
    readings: Array<{
      measuredAt: string
      systolicBP: number
      diastolicBP: number
      pulse: number
      sessionId?: string
    }>,
  ): Promise<{ created: number }> {
    let created = 0
    for (const r of readings) {
      await this.prisma.journalEntry.upsert({
        where: {
          userId_measuredAt: { userId, measuredAt: new Date(r.measuredAt) },
        },
        update: {
          systolicBP: r.systolicBP,
          diastolicBP: r.diastolicBP,
          pulse: r.pulse,
          sessionId: r.sessionId,
        },
        create: {
          userId,
          measuredAt: new Date(r.measuredAt),
          systolicBP: r.systolicBP,
          diastolicBP: r.diastolicBP,
          pulse: r.pulse,
          sessionId: r.sessionId,
          position: 'SITTING',
          source: 'MANUAL',
        },
      })
      created++
    }
    return { created }
  }

  /**
   * Flip a single PatientProfile boolean condition flag. Lets tests
   * compose persona × condition combinations without reseeding (e.g. test
   * the same patient with hasHCM toggled on and off).
   *
   * `heartFailureType` is honored only when `flag` is `hasHeartFailure`
   * AND `value` is true — keeps the call site explicit about which type.
   */
  async setUserCondition(
    userId: string,
    flag:
      | 'isPregnant'
      | 'historyPreeclampsia'
      | 'hasHeartFailure'
      | 'hasAFib'
      | 'hasCAD'
      | 'hasHCM'
      | 'hasDCM'
      | 'hasBradycardia'
      | 'hasTachycardia'
      | 'diagnosedHypertension',
    value: boolean,
    heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE',
  ): Promise<void> {
    const data: Record<string, unknown> = { [flag]: value }
    if (flag === 'hasHeartFailure') {
      data.heartFailureType = value ? heartFailureType ?? 'UNKNOWN' : 'NOT_APPLICABLE'
    }
    await this.prisma.patientProfile.updateMany({ where: { userId }, data })
    // ProfileResolverService doesn't cache today (one fresh user.findUnique
    // per resolve), so this delay is defensive: if Cluster 6 introduces a
    // profile cache for performance, tests that flip a flag immediately
    // before submitting a reading would race the cache invalidation. A
    // small post-write hold keeps those tests stable across the refactor.
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  /**
   * Attach a medication inline, bypassing admin verification. Tests can
   * use this to compose med × condition scenarios without scripting the
   * full /admin/medications/:id/verify flow.
   *
   * Default verificationStatus=VERIFIED so the alert engine's pre-gate
   * rules (which check verifiedAt / verificationStatus) treat the row as
   * actionable. Pass `UNVERIFIED` explicitly for tests that exercise the
   * unverified-medication safety-net path.
   */
  async setUserMedication(
    userId: string,
    med: {
      drugName: string
      drugClass: string
      frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'AS_NEEDED' | 'UNSURE'
      verificationStatus?: 'VERIFIED' | 'UNVERIFIED'
    },
  ): Promise<{ id: string }> {
    const status = med.verificationStatus ?? 'VERIFIED'

    // Dedup on (userId, drugName): if a row already exists with the same
    // name for this user, update it in place rather than inserting another
    // duplicate. Prevents test-control from accumulating multiple "active"
    // copies of the same medication across repeated calls (bug #19, observed
    // 2026-05-15 — spec 19's sequential tests piled up Metoprolol/Lisinopril
    // rows on Aisha). PatientMedication's only unique constraint is on `id`,
    // so this is a findFirst → update|create rather than a native upsert;
    // a composite unique index would need a migration and isn't worth it for
    // a test-control-only path.
    const existing = await this.prisma.patientMedication.findFirst({
      where: { userId, drugName: med.drugName },
      select: { id: true },
    })

    if (existing) {
      await this.prisma.patientMedication.update({
        where: { id: existing.id },
        data: {
          drugClass: med.drugClass as never,
          frequency: med.frequency,
          verificationStatus: status,
          verifiedAt: status === 'VERIFIED' ? new Date() : null,
        },
      })
      return { id: existing.id }
    }

    const created = await this.prisma.patientMedication.create({
      data: {
        userId,
        drugName: med.drugName,
        drugClass: med.drugClass as never,
        frequency: med.frequency,
        source: 'PATIENT_SELF_REPORT',
        verificationStatus: status,
        verifiedAt: status === 'VERIFIED' ? new Date() : null,
      },
      select: { id: true },
    })
    return { id: created.id }
  }

  async setProfileVerificationStatus(
    userId: string,
    status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED',
  ): Promise<void> {
    await this.prisma.patientProfile.updateMany({
      where: { userId },
      data: { profileVerificationStatus: status },
    })
  }

  // ─── Inspection ─────────────────────────────────────────────────────────
  async listAlerts(userId: string) {
    return this.prisma.deviationAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tier: true,
        ruleId: true,
        mode: true,
        status: true,
        dismissible: true,
        patientMessage: true,
        physicianMessage: true,
        createdAt: true,
        acknowledgedAt: true,
        acknowledgedByUserId: true,
        resolvedAt: true,
        resolvedBy: true,
        resolutionAction: true,
      },
    })
  }

  async listEscalationEvents(alertId: string) {
    return this.prisma.escalationEvent.findMany({
      where: { alertId },
      orderBy: { triggeredAt: 'asc' },
      select: {
        id: true,
        ladderStep: true,
        recipientRoles: true,
        notificationChannel: true,
        afterHours: true,
        scheduledFor: true,
        notificationSentAt: true,
        acknowledgedAt: true,
        acknowledgedBy: true,
        resolvedAt: true,
        resolvedBy: true,
        triggeredByResolution: true,
        reason: true,
      },
    })
  }

  /**
   * Cluster 7 C.1 — walk N ladder rungs without sleeping. Writes
   * `EscalationEvent` rows directly with `notificationSentAt = anchor + offset`
   * and `afterHours = false` so the events look "already dispatched". Tests
   * use this to drive the Tier 1 T+0 → T+4h → T+8h → T+24h → T+48h progression
   * in a single tick without waiting for the cron + business-hours guard.
   *
   * Skips T+0 because it's written when the alert is created. Walks
   * `steps[1..1+n]` in order. Idempotent: re-running with the same `n` is a
   * no-op if those steps already exist (unique on alertId+ladderStep elsewhere
   * is not enforced, so this helper checks before inserting).
   */
  async advanceLadderSteps(
    alertId: string,
    n: number,
  ): Promise<{ advanced: number; steps: string[] }> {
    if (n <= 0) return { advanced: 0, steps: [] }

    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
    })
    if (!alert) {
      throw new Error(`Alert ${alertId} not found`)
    }
    const ladder = ladderForTier(alert.tier)
    if (!ladder) {
      throw new Error(`Alert ${alertId} tier=${alert.tier} has no ladder`)
    }

    const existing = await this.prisma.escalationEvent.findMany({
      where: { alertId },
      select: { ladderStep: true },
    })
    const existingSteps = new Set(
      existing.map((e) => e.ladderStep).filter((s): s is LadderStepEnum => s != null),
    )

    const anchor = alert.createdAt
    const advanced: string[] = []

    for (let i = 1; i <= n && i < ladder.steps.length; i++) {
      const step = ladder.steps[i]
      if (!step) continue
      if (existingSteps.has(step.step as LadderStepEnum)) continue

      const firedAt = new Date(anchor.getTime() + step.offsetMs)
      await this.prisma.escalationEvent.create({
        data: {
          alertId,
          userId: alert.userId,
          escalationLevel: ladder.kind === 'TIER_2' || ladder.kind === 'BP_LEVEL_1'
            ? 'LEVEL_1'
            : 'LEVEL_2',
          ladderStep: step.step as LadderStepEnum,
          recipientIds: [],
          recipientRoles: step.recipientRoles,
          notificationChannel: step.channels[0] ?? null,
          triggeredAt: firedAt,
          notificationSentAt: firedAt,
          scheduledFor: firedAt,
          afterHours: false,
          triggeredByResolution: false,
          reason: 'test-control.advanceLadderSteps',
        },
      })
      advanced.push(step.step)
    }

    return { advanced: advanced.length, steps: advanced }
  }

  async listNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        title: true,
        body: true,
        channel: true,
        sentAt: true,
        readAt: true,
        alertId: true,
        escalationEventId: true,
      },
    })
  }

  async findUser(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        enrollmentStatus: true,
        onboardingStatus: true,
        patientProfile: {
          select: { profileVerificationStatus: true },
        },
      },
    })
    if (!user) throw new Error(`User not found: ${email}`)
    return {
      id: user.id,
      email: user.email,
      enrollmentStatus: user.enrollmentStatus,
      onboardingStatus: user.onboardingStatus,
      profileVerificationStatus: user.patientProfile?.profileVerificationStatus ?? null,
    }
  }

  // Spec 12 — clear the three businessHours fields on the practice attached
  // to this user via PatientProviderAssignment. Practice columns are
  // non-nullable strings, so we set to empty strings — the enrollment-gate
  // truthiness check (`!p.businessHoursStart || …`) treats empty as missing.
  // Returns the prior values so the test can restore them in a finally block.
  async clearPracticeBusinessHours(userId: string): Promise<{
    practiceId: string
    prior: {
      businessHoursStart: string
      businessHoursEnd: string
      businessHoursTimezone: string
    }
  }> {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId },
      include: { practice: true },
    })
    if (!assignment?.practice) {
      throw new Error(`No practice assignment found for user ${userId}`)
    }
    const prior = {
      businessHoursStart: assignment.practice.businessHoursStart,
      businessHoursEnd: assignment.practice.businessHoursEnd,
      businessHoursTimezone: assignment.practice.businessHoursTimezone,
    }
    await this.prisma.practice.update({
      where: { id: assignment.practice.id },
      data: {
        businessHoursStart: '',
        businessHoursEnd: '',
        businessHoursTimezone: '',
      },
    })
    return { practiceId: assignment.practice.id, prior }
  }

  async restorePracticeBusinessHours(args: {
    userId: string
    businessHoursStart: string
    businessHoursEnd: string
    businessHoursTimezone: string
  }): Promise<{ ok: true }> {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId: args.userId },
    })
    if (!assignment) {
      throw new Error(`No practice assignment found for user ${args.userId}`)
    }
    await this.prisma.practice.update({
      where: { id: assignment.practiceId },
      data: {
        businessHoursStart: args.businessHoursStart,
        businessHoursEnd: args.businessHoursEnd,
        businessHoursTimezone: args.businessHoursTimezone,
      },
    })
    return { ok: true }
  }
}
