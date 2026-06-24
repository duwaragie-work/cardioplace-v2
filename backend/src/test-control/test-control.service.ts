import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { GapAlertService } from '../crons/gap-alert.service.js'
import { MedicationHoldEscalationService } from '../crons/medication-hold-escalation.service.js'
import { MonthlyReaskService } from '../crons/monthly-reask.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { ladderForTier } from '../daily_journal/escalation/ladder-defs.js'
import { retroUpgradeAceArbHoldsForContraindication } from '../intake/ace-contraindication.js'
import { VerifierRole } from '../generated/prisma/client.js'
import type { LadderStep as LadderStepEnum } from '../generated/prisma/client.js'
import type { UserRole } from '../generated/prisma/enums.js'
import { createHash, randomBytes } from 'node:crypto'

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
    private readonly medicationHoldEscalation: MedicationHoldEscalationService,
  ) {}

  // ─── Cron drivers ───────────────────────────────────────────────────────
  async runEscalationScan(now: Date): Promise<{ scanned: number; dispatched: number }> {
    const before = await this.prisma.escalationEvent.count()
    await this.escalation.runScan(now)
    const after = await this.prisma.escalationEvent.count()
    return { scanned: 1, dispatched: Math.max(0, after - before) }
  }

  /**
   * Deterministically fire T+0 for a specific alert (spec 22 G.4). Awaits the
   * real fireT0 path so the T+0 Notification rows exist before the spec polls —
   * unlike runEscalationScan, which does not dispatch a fresh alert's T+0.
   * Idempotent + error-propagating (see EscalationService.dispatchT0ForAlert).
   */
  async fireEscalationT0(alertId: string): Promise<{ ok: true }> {
    await this.escalation.dispatchT0ForAlert(alertId)
    return { ok: true }
  }

  async runGapAlertScan(now: Date): Promise<{ scanned: number; nudged: number }> {
    const sent = await this.gapAlerts.runScan(now)
    return { scanned: 1, nudged: sent }
  }

  async runMonthlyReaskScan(now: Date): Promise<{ scanned: number; reasked: number }> {
    const sent = await this.monthlyReask.runScan(now)
    return { scanned: 1, reasked: sent }
  }

  async runMedicationHoldEscalationScan(
    now: Date,
  ): Promise<{ scanned: number; rungsFired: number }> {
    const fired = await this.medicationHoldEscalation.runScan(now)
    return { scanned: 1, rungsFired: fired }
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

  /**
   * June 2026 — Phase 2 idle-timeout test driver. Backdate every active
   * AuthSession.lastActivityAt for a user so the next refresh crosses the
   * 15-min (web) / 5-min (mobile) idle gate without sleeping. Returns
   * the number of sessions touched. Uses a raw UPDATE because
   * lastActivityAt is mapped to `@updatedAt` and Prisma would otherwise
   * stamp it back to now() on an `update`.
   */
  async backdateAuthSessions(
    userId: string,
    deltaSeconds: number,
  ): Promise<{ updated: number }> {
    const cutoff = new Date(Date.now() - deltaSeconds * 1000)
    const result = await this.prisma.$executeRaw`
      UPDATE "AuthSession"
      SET "lastActivityAt" = ${cutoff}
      WHERE "userId" = ${userId}
        AND "expiresAt" > NOW()
    `
    return { updated: Number(result) }
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

  /**
   * Cluster 8 — backdate User.enrolledAt so the Q2 CAD-ramp + Q3 first-month
   * adherence-nudge personas can simulate "enrolled N days ago" without
   * waiting. Prisma's @updatedAt would clobber a plain update(); raw SQL
   * keeps the value. Pass deltaSeconds to push enrolledAt into the past.
   */
  async backdateEnrolledAt(userId: string, deltaSeconds: number): Promise<void> {
    const newEnrolledAt = new Date(Date.now() - deltaSeconds * 1000)
    await this.prisma.$executeRaw`
      UPDATE "User"
      SET "enrolledAt" = ${newEnrolledAt}
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

  /**
   * Cluster 8 §D — wipe ALL PatientMedication rows for a user. Niva's
   * setUserMedication dedupes by drugName, so swapping a test's med roster
   * (e.g., ACE → ARB-only for the angioedema ARB-variant test) requires
   * clearing first. Test-control only; no production caller.
   */
  async clearUserMedications(userId: string): Promise<{ rowsDeleted: number }> {
    const result = await this.prisma.patientMedication.deleteMany({ where: { userId } })
    return { rowsDeleted: result.count }
  }

  /**
   * Delete a user's DeviationAlert rows (plus their child EscalationEvent rows
   * and alert-linked Notification rows) WITHOUT touching JournalEntry history —
   * unlike resetUser, which also wipes readings. A test that needs an
   * established reading history but a clean alert slate (e.g. 30u B2's co-fire
   * consolidation, which must see exactly the alerts it just fired) uses this
   * right before triggering. Ordered children-first + serializable to mirror
   * resetUser's deadlock-avoidance under CI's shared pgvector DB. (EscalationEvent
   * cascades and Notification.alertId is SetNull, so this is also FK-safe.)
   */
  async deleteAlertsForUser(userId: string): Promise<{ rowsDeleted: number }> {
    const [, , alerts] = await this.prisma.$transaction(
      [
        this.prisma.escalationEvent.deleteMany({ where: { alert: { userId } } }),
        this.prisma.notification.deleteMany({ where: { userId, alertId: { not: null } } }),
        this.prisma.deviationAlert.deleteMany({ where: { userId } }),
      ],
      { isolationLevel: 'Serializable' },
    )
    return { rowsDeleted: alerts.count }
  }

  /**
   * Delete a user's PatientThreshold so a test can assert the "no threshold"
   * branches — IVR-04 enrollment revert + the THR-REVIEW "missing" lock. There
   * is no production threshold-delete (THR-033), so this is test-control only.
   */
  async clearPatientThreshold(userId: string): Promise<{ rowsDeleted: number }> {
    const r = await this.prisma.patientThreshold.deleteMany({ where: { userId } })
    return { rowsDeleted: r.count }
  }

  /**
   * Delete a user's ProfileVerificationLog rows so the Timeline and the
   * threshold-review lock detector (mandatoryConditionChangedAt) start from a
   * clean slate across re-runs. Test-control only.
   */
  async clearProfileVerificationLogs(userId: string): Promise<{ rowsDeleted: number }> {
    const r = await this.prisma.profileVerificationLog.deleteMany({ where: { userId } })
    return { rowsDeleted: r.count }
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
        const e = err as {
          code?: string
          message?: string
          meta?: { code?: string }
          cause?: { code?: string }
        }
        const isDeadlock =
          e?.code === 'P2034' ||
          e?.meta?.code === '40P01' ||
          e?.cause?.code === '40P01' ||
          // @prisma/adapter-pg wraps deadlocks as DriverAdapterError with the
          // 'TransactionWriteConflict' string in the message. Observed against
          // Prisma Cloud dev DB during Cluster 7 verification; the underlying
          // 40P01 doesn't surface to the typed code field through the adapter.
          (typeof e?.message === 'string' && e.message.includes('TransactionWriteConflict'))
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

  /**
   * Wipe a user's entire MFA footprint so the E2E suite starts each MFA spec
   * from a clean "never enrolled" baseline — without this, enrolling TOTP on a
   * seed admin (or registering a passkey on a seed patient) would leave the
   * account permanently "MFA required" and break the plain OTP→dashboard auth
   * specs that share these seed accounts.
   *
   * Clears all three independent MFA tables for the user:
   *   • TotpCredential      — provider/admin authenticator secret (1:1)
   *   • MfaRecoveryCode     — TOTP backup codes (1:many)
   *   • WebAuthnCredential  — patient biometric / passkeys (1:many)
   *
   * Test-infra only — there is no production path that bulk-wipes MFA.
   */
  async resetUserMfa(userId: string): Promise<{ rowsDeleted: number }> {
    const [totp, recovery, webauthn] = await this.prisma.$transaction([
      this.prisma.totpCredential.deleteMany({ where: { userId } }),
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.webAuthnCredential.deleteMany({ where: { userId } }),
    ])
    return { rowsDeleted: totp.count + recovery.count + webauthn.count }
  }

  /**
   * F13 — set/clear PatientProfile.aceContraindicatedAt so specs can exercise
   * the ACE/ARB re-add gate without walking the full B4 angioedema-resolution
   * flow. Test-infra only.
   *
   * #84 — setting the flag also retro-upgrades existing live ACE/ARB holds to
   * PROVIDER_DIRECTED_HOLD ("do not take"), matching the production guarantee
   * (the angioedema-resolution path already discontinues active ACE/ARB). Done
   * atomically with the flag write so the two never diverge.
   */
  async setAceContraindicated(userId: string, value: boolean): Promise<void> {
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.patientProfile.update({
        where: { userId },
        data: { aceContraindicatedAt: value ? now : null },
      })
      if (value) {
        await retroUpgradeAceArbHoldsForContraindication(tx, {
          userId,
          changedBy: 'SYSTEM',
          changedByRole: VerifierRole.ADMIN,
          reason: 'Angioedema ACE/ARB contraindication flag set (#84 retro-upgrade)',
          now,
        })
      }
    })
  }

  async setEnrollment(userId: string, status: 'NOT_ENROLLED' | 'ENROLLED'): Promise<void> {
    // Cluster 8 — mirror production EnrollmentService: stamp enrolledAt on the
    // ENROLLED flip, clear it on NOT_ENROLLED, so the Q2 CAD-ramp + Q3
    // first-month-nudge personas have a real enrollment date to backdate.
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        enrollmentStatus: status,
        enrolledAt: status === 'ENROLLED' ? new Date() : null,
      },
    })
  }

  /**
   * Phase 4 §C — flip a user's onboardingStatus. Seed personas are all
   * COMPLETED; the auth-onboarding spec (20a) needs to roll one back to
   * NOT_COMPLETED to exercise the new-user → /onboarding redirect and the
   * returning-user skip. Mirrors setEnrollment (test-infra only).
   */
  async setOnboardingStatus(
    userId: string,
    status: 'NOT_COMPLETED' | 'COMPLETED',
  ): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingStatus: status },
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
      | 'historyHDP'
      | 'hasHeartFailure'
      | 'hasAFib'
      | 'hasCAD'
      | 'hasHCM'
      | 'hasDCM'
      | 'hasAorticStenosis'
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

    const result = await this.prisma.patientProfile.updateMany({
      where: { userId },
      data,
    })
    // Loud-fail the silent no-op: updateMany affects 0 rows when no
    // PatientProfile exists for the user (seed not run, or the row was
    // cascade-deleted by a prior test). Previously this returned success and
    // the flag never flipped, so the engine evaluated a stale profile.
    if (result.count === 0) {
      throw new Error(
        `setUserCondition: no PatientProfile row for userId=${userId}. Seed must run first.`,
      )
    }

    // Read-back verification replaces the prior fixed 100ms hold. Under full-
    // suite backend load the async alert-evaluation pipeline backlogs (~13s
    // eval observed on CI shard 4 vs ~0.8s isolated); a fixed delay could let
    // a reading post before the flag write was visible, so the engine fired
    // the all-flags-false fallback (RULE_STANDARD_L1_HIGH) instead of the
    // condition rule. Poll until the write is visible, with a 2s ceiling.
    const deadline = Date.now() + 2000
    while (Date.now() < deadline) {
      const profile = await this.prisma.patientProfile.findUnique({
        where: { userId },
      })
      if (profile && (profile as Record<string, unknown>)[flag] === value) {
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(
      `setUserCondition: write did not propagate within 2s (userId=${userId} flag=${flag} value=${value})`,
    )
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

  // F17 — place a user's medication (matched by drugName) on HOLD with a given
  // reason, mirroring an admin provider-directed hold. Lets the daily-check-in
  // "held meds surface as non-actionable" spec set up state deterministically.
  async setMedicationHold(
    userId: string,
    drugName: string,
    holdReason:
      | 'AWAITING_RECORDS'
      | 'UNCLEAR_NAME'
      | 'UNCLEAR_DOSE'
      | 'PROVIDER_DIRECTED_HOLD'
      | 'OTHER' = 'PROVIDER_DIRECTED_HOLD',
  ): Promise<{ id: string }> {
    const existing = await this.prisma.patientMedication.findFirst({
      where: { userId, drugName },
      select: { id: true },
    })
    if (!existing) {
      throw new NotFoundException(
        `No medication "${drugName}" found for user ${userId}`,
      )
    }
    await this.prisma.patientMedication.update({
      where: { id: existing.id },
      data: {
        verificationStatus: 'HOLD',
        holdReason,
        holdSetAt: new Date(),
      },
    })
    return { id: existing.id }
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

  /**
   * Phase 4 §B.2 — set a User.dateOfBirth. Backs the age-bucket boundary
   * tests (spec 20g.1): AGE_65_LOW must fire the day a patient turns 65 and
   * NOT the day before, proving the cutoff is enforced at reading-evaluation
   * time rather than at user-creation time.
   */
  async setUserDateOfBirth(userId: string, dob: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { dateOfBirth: dob },
    })
  }

  /**
   * Phase 4 §B.2 — upsert a PatientThreshold for personalized-mode tests
   * (spec 20g.21–22). `PatientThreshold.setByProviderId` is a required
   * column, so resolve it server-side: prefer the patient's assigned
   * medical director, then primary / backup provider, then any
   * MEDICAL_DIRECTOR / SUPER_ADMIN user. Tests assert only on the threshold
   * targets, never on attribution — but the column must be populated for the
   * create path to succeed.
   */
  async setPatientThreshold(
    userId: string,
    override: {
      sbpUpperTarget?: number
      sbpLowerTarget?: number
      dbpUpperTarget?: number
      dbpLowerTarget?: number
    },
  ): Promise<{ userId: string }> {
    const assignment = await this.prisma.patientProviderAssignment.findUnique({
      where: { userId },
      select: {
        medicalDirectorId: true,
        primaryProviderId: true,
        backupProviderId: true,
      },
    })
    let setByProviderId: string | null =
      assignment?.medicalDirectorId ??
      assignment?.primaryProviderId ??
      assignment?.backupProviderId ??
      null
    if (!setByProviderId) {
      const admin = await this.prisma.user.findFirst({
        where: {
          OR: [
            { roles: { has: 'MEDICAL_DIRECTOR' } },
            { roles: { has: 'SUPER_ADMIN' } },
          ],
        },
        select: { id: true },
      })
      setByProviderId = admin?.id ?? null
    }
    if (!setByProviderId) {
      throw new Error(
        `setPatientThreshold: no provider available to attribute threshold for user ${userId}`,
      )
    }
    await this.prisma.patientThreshold.upsert({
      where: { userId },
      update: { ...override },
      create: { userId, setByProviderId, ...override },
    })
    return { userId }
  }

  // ─── Seed fixtures (Phase 0 §H) ─────────────────────────────────────────
  // Imperative test-only seeders (like seedReadingsAtTime). Not idempotent
  // by design — tests call them to compose a scenario then reset between
  // runs. The 4 endpoints the pre-Phase-0 controller was missing.

  /**
   * Force a User.accountStatus. AccountStatus has NO `INACTIVE` member —
   * valid values are ACTIVE | BLOCKED | SUSPENDED (schema-verified).
   */
  async setAccountStatus(
    email: string,
    status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED',
  ): Promise<{ id: string; email: string; accountStatus: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    })
    if (!user) throw new Error(`User not found: ${email}`)
    await this.prisma.user.update({
      where: { id: user.id },
      data: { accountStatus: status },
    })
    return { id: user.id, email, accountStatus: status }
  }

  /**
   * Seed N alerts in specific states. DeviationAlert.journalEntryId is
   * required, so each alert auto-creates its own backing JournalEntry.
   */
  async seedAlerts(
    userId: string,
    alerts: Array<{
      tier: string
      status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
      ruleId?: string
      createdAtIso?: string
      acknowledgedByUserId?: string
      resolvedBy?: string
      resolutionAction?: string
      resolutionRationale?: string
      patientMessage?: string
      caregiverMessage?: string
      physicianMessage?: string
    }>,
  ): Promise<{ created: number; alertIds: string[] }> {
    const alertIds: string[] = []
    for (const a of alerts) {
      const je = await this.prisma.journalEntry.create({
        data: {
          userId,
          measuredAt: new Date(),
          systolicBP: 150,
          diastolicBP: 95,
          pulse: 80,
          position: 'SITTING',
          source: 'MANUAL',
        },
        select: { id: true },
      })
      const status = a.status ?? 'OPEN'
      const created = await this.prisma.deviationAlert.create({
        data: {
          userId,
          journalEntryId: je.id,
          tier: a.tier as never,
          mode: 'STANDARD',
          ruleId: a.ruleId ?? 'TEST_SEED',
          status,
          dismissible: true,
          createdAt: a.createdAtIso ? new Date(a.createdAtIso) : new Date(),
          acknowledgedAt: status === 'ACKNOWLEDGED' ? new Date() : null,
          acknowledgedByUserId: a.acknowledgedByUserId ?? null,
          resolvedAt: status === 'RESOLVED' ? new Date() : null,
          resolvedBy: a.resolvedBy ?? null,
          resolutionAction: a.resolutionAction ?? null,
          resolutionRationale: a.resolutionRationale ?? null,
          // Three-tier messages: real alerts always carry these (the admin
          // AlertCard only renders a tier card when its message is non-empty),
          // so seeded fixtures must too or the expanded-card 3-tier assertions
          // (spec 13 §G) find nothing. Override-able per spec; default to a
          // descriptive non-empty string per tier.
          patientMessage:
            a.patientMessage ?? 'Seeded alert — patient-facing message.',
          caregiverMessage:
            a.caregiverMessage ?? 'Seeded alert — caregiver-facing message.',
          physicianMessage:
            a.physicianMessage ?? 'Seeded alert — physician-facing message.',
        },
        select: { id: true },
      })
      alertIds.push(created.id)
    }
    return { created: alertIds.length, alertIds }
  }

  /** Seed N notifications for a user (badge / list fixtures). */
  async seedNotifications(
    userId: string,
    count: number,
    channel: 'PUSH' | 'EMAIL' | 'PHONE' | 'DASHBOARD' = 'DASHBOARD',
  ): Promise<{ created: number }> {
    for (let i = 1; i <= count; i++) {
      await this.prisma.notification.create({
        data: {
          userId,
          channel,
          title: `Test notification ${i}`,
          body: `Seeded test notification ${i}.`,
          tips: [],
        },
      })
    }
    return { created: count }
  }

  /**
   * Seed audit events. changeType must be a VerificationChangeType member
   * (PATIENT_REPORT | ADMIN_VERIFY | ADMIN_CORRECT | ADMIN_REJECT |
   * ADMIN_THRESHOLD_UPDATE | ADMIN_ASSIGNMENT_CHANGE) — there are NO
   * ALERT_* members; alert lifecycle audit lives on DeviationAlert.
   */
  async seedAuditTrail(
    userId: string,
    events: Array<{
      changeType: string
      fieldPath: string
      changedBy: string
      changedByRole?: 'PATIENT' | 'ADMIN' | 'PROVIDER'
      previousValue?: unknown
      newValue?: unknown
      rationale?: string
      discrepancyFlag?: boolean
      createdAtIso?: string
    }>,
  ): Promise<{ created: number }> {
    for (const e of events) {
      await this.prisma.profileVerificationLog.create({
        data: {
          userId,
          fieldPath: e.fieldPath,
          changedBy: e.changedBy,
          changedByRole: (e.changedByRole ?? 'ADMIN') as never,
          changeType: e.changeType as never,
          previousValue: (e.previousValue ?? undefined) as never,
          newValue: (e.newValue ?? undefined) as never,
          discrepancyFlag: e.discrepancyFlag ?? false,
          rationale: e.rationale ?? null,
          ...(e.createdAtIso ? { createdAt: new Date(e.createdAtIso) } : {}),
        },
      })
    }
    return { created: events.length }
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
        dispatchedBySystem: true,
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

  // ─── Invite + magic-link token minting (specs 36/37/40) ───────────────────
  //
  // Both UserInvite and MagicLink persist only a SHA-256 hash of the raw
  // token — the raw value is e-mailed and never stored. In CI the Resend key
  // is a dummy, so a Playwright spec can never read the e-mail to recover the
  // token. These two helpers mint a row directly and RETURN the raw token,
  // hashing it exactly the way auth.service.ts does so the real production
  // accept/verify endpoints (which the specs drive) accept it unchanged.

  private sha256(raw: string): string {
    return createHash('sha256').update(raw.trim()).digest('hex')
  }

  /**
   * Mint a UserInvite and return its raw activation token. `expiresInSeconds`
   * defaults to 48h; pass a negative value to forge an already-expired invite
   * for the error-path test. The inviter defaults to the first SUPER_ADMIN
   * seed (the FK to User is Restrict, so it must point at a real row).
   */
  async createInvite(args: {
    email: string
    name: string
    role: UserRole
    practiceId?: string
    expiresInSeconds?: number
  }): Promise<{ inviteId: string; token: string }> {
    const inviter = await this.prisma.user.findFirst({
      where: { roles: { has: 'SUPER_ADMIN' } },
      select: { id: true },
    })
    if (!inviter) throw new Error('createInvite: no SUPER_ADMIN user to attribute the invite to')
    // Drop any prior open invite for this email so re-runs don't trip the
    // "already invited" guard in the accept flow.
    await this.prisma.userInvite.deleteMany({
      where: { email: args.email, acceptedAt: null },
    })
    const token = randomBytes(32).toString('hex')
    const ttl = (args.expiresInSeconds ?? 48 * 3600) * 1000
    const invite = await this.prisma.userInvite.create({
      data: {
        email: args.email,
        name: args.name,
        role: args.role,
        practiceId: args.practiceId ?? null,
        tokenHash: this.sha256(token),
        invitedById: inviter.id,
        expiresAt: new Date(Date.now() + ttl),
      },
      select: { id: true },
    })
    return { inviteId: invite.id, token }
  }

  /**
   * Mint a MagicLink for `email` and return the raw token. `expiresInSeconds`
   * defaults to 30 min (matching auth.service); pass a negative value for the
   * expired-link test. `markUsed: true` stamps `usedAt` so the already-used
   * error path is reachable.
   */
  async issueMagicLink(args: {
    email: string
    expiresInSeconds?: number
    markUsed?: boolean
  }): Promise<{ token: string }> {
    const token = randomBytes(32).toString('hex')
    const ttl = (args.expiresInSeconds ?? 30 * 60) * 1000
    await this.prisma.magicLink.create({
      data: {
        email: args.email,
        tokenHash: this.sha256(token),
        expiresAt: new Date(Date.now() + ttl),
        usedAt: args.markUsed ? new Date() : null,
      },
    })
    return { token }
  }
}
