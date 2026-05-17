import { request as pwRequest, type APIRequestContext } from '@playwright/test'

/**
 * Thin client for the dev-only `/test-control/*` endpoints exposed by the
 * backend when ENABLE_TEST_CONTROL=true. Used by escalation + cron specs to
 * drive runScan(now) deterministically.
 *
 * If the backend isn't running with the flag set, every method throws with
 * a useful message — first failed test gives the right error instead of a
 * cryptic 404.
 */
export class TestControl {
  private readonly ctx: APIRequestContext
  private readonly secret?: string

  private constructor(ctx: APIRequestContext, secret?: string) {
    this.ctx = ctx
    this.secret = secret
  }

  static async create(apiBase: string, secret?: string): Promise<TestControl> {
    // Backend mounts a global /api prefix in main.ts; embed it in baseURL.
    // Trailing slash matters: `new URL('test-control/x', 'http://h/api')` →
    // `http://h/test-control/x` (drops /api), whereas `'http://h/api/'` →
    // `http://h/api/test-control/x`.
    const root = apiBase.replace(/\/api\/?$/, '').replace(/\/$/, '')
    const ctx = await pwRequest.newContext({
      baseURL: `${root}/api/`,
      extraHTTPHeaders: secret ? { 'X-Test-Control-Secret': secret } : {},
    })
    return new TestControl(ctx, secret)
  }

  private async post<T = unknown>(path: string, body: unknown = {}): Promise<T> {
    const res = await this.ctx.post(path, { data: body })
    if (!res.ok()) {
      throw new Error(
        `[test-control] POST ${path} failed ${res.status()}: ${await res.text()}`,
      )
    }
    return res.json() as Promise<T>
  }

  private async get<T = unknown>(path: string): Promise<T> {
    const res = await this.ctx.get(path)
    if (!res.ok()) {
      throw new Error(
        `[test-control] GET ${path} failed ${res.status()}: ${await res.text()}`,
      )
    }
    return res.json() as Promise<T>
  }

  // ─── Health ─────────────────────────────────────────────────────────────
  async health(): Promise<{ ok: true; enableTestControl: boolean; nodeEnv: string }> {
    return this.get('test-control/health')
  }

  // ─── Cron drivers ───────────────────────────────────────────────────────
  /**
   * Run the escalation scanner once. Pass `now` to simulate a future time.
   * Mirrors EscalationService.runScan(now) — fires queued T+0 events whose
   * scheduledFor ≤ now AND advances overdue ladders for unacknowledged alerts.
   */
  async runEscalationScan(now?: Date): Promise<{ scanned: number; dispatched: number }> {
    return this.post('test-control/cron/escalation/run', {
      now: (now ?? new Date()).toISOString(),
    })
  }

  /** Run the gap-alert scanner. 48h trigger, 24h idempotency. */
  async runGapAlertScan(now?: Date): Promise<{ scanned: number; nudged: number }> {
    return this.post('test-control/cron/gap-alert/run', {
      now: (now ?? new Date()).toISOString(),
    })
  }

  /** Run the monthly-reask scanner. 30d trigger, 28d idempotency. */
  async runMonthlyReaskScan(now?: Date): Promise<{ scanned: number; reasked: number }> {
    return this.post('test-control/cron/monthly-reask/run', {
      now: (now ?? new Date()).toISOString(),
    })
  }

  // ─── Time advancement ───────────────────────────────────────────────────
  /**
   * Backdate an alert's T+0 EscalationEvent.notificationSentAt. Equivalent to
   * "the alert was actually dispatched X seconds ago" — used to fast-forward
   * past T+4h without sleeping.
   */
  async backdateAlertAnchor(alertId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/anchor/backdate', { alertId, deltaSeconds })
  }

  /**
   * Backdate a `triggeredByResolution: true` event (BP L2 retry) so its
   * `scheduledFor` is in the past — lets tests verify the retry actually
   * dispatches without sleeping 4h.
   */
  async backdateRetryEvent(alertId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/retry-event/backdate', { alertId, deltaSeconds })
  }

  /**
   * Cluster 7 C.1 — drive `n` ladder rungs forward without sleeping. Inserts
   * already-dispatched EscalationEvent rows for steps[1..n] anchored to the
   * alert's createdAt. Returns the step IDs that were inserted (idempotent —
   * pre-existing steps are skipped).
   */
  async advanceLadderSteps(
    alertId: string,
    n: number,
  ): Promise<{ advanced: number; steps: string[] }> {
    return this.post('test-control/escalation/advance-ladder-steps', {
      alertId,
      n,
    })
  }

  /** Backdate the latest JournalEntry for a user (for gap-alert + monthly-reask). */
  async backdateLastJournalEntry(userId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/journal/backdate-latest', { userId, deltaSeconds })
  }

  /** Backdate a medication's `verifiedAt` / `reportedAt` (monthly-reask). */
  async backdateMedicationVerified(medId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/medication/backdate-verified', { medId, deltaSeconds })
  }

  /**
   * Backdate every non-discontinued PatientMedication for a user. Use this
   * instead of looping `me/medications` when the test depends on the cron's
   * latestTouch over ALL active rows — `me/medications` filters out REJECTED
   * meds, leaving them with their original recent verifiedAt and the cron
   * never reaches the cutoff.
   */
  async backdateAllUserMedications(
    userId: string,
    deltaSeconds: number,
  ): Promise<{ updated: number }> {
    return this.post('test-control/medications/backdate-all-for-user', {
      userId,
      deltaSeconds,
    })
  }

  /**
   * Backdate a User's `updatedAt`. Required for gap-alert tests because the
   * cron pre-filter is `User.updatedAt <= cutoff` (enrollment-completed
   * proxy) — resetUser doesn't touch the user row, so without this the
   * candidate set never includes the seeded patient.
   */
  async backdateUserUpdatedAt(userId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/user/backdate-updated-at', { userId, deltaSeconds })
  }

  /**
   * Insert journal entries at exact timestamps. Bypasses the alert engine
   * (raw fixture insertion only) — use this for tests that need a specific
   * session window or reading count without triggering alerts mid-setup.
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
    return this.post('test-control/journal/seed-at-time', { userId, readings })
  }

  /**
   * Flip a single PatientProfile boolean condition flag. Used to compose
   * persona × condition scenarios in tests without reseeding.
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
    await this.post('test-control/user/set-condition', {
      userId,
      flag,
      value,
      heartFailureType,
    })
  }

  /**
   * Attach a medication inline (bypasses admin verification). Default
   * `verificationStatus=VERIFIED`; pass `UNVERIFIED` for safety-net tests.
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
    return this.post('test-control/user/set-medication', { userId, med })
  }

  // ─── State reset ────────────────────────────────────────────────────────
  /**
   * Wipe journal/alert/escalation/notification rows for ALL *.cardioplace.test
   * patient seeds. Idempotent. Does NOT touch the user, profile, medication,
   * practice, or assignment rows — those are seed-stable.
   */
  async resetTestPatients(): Promise<{ usersTouched: number; rowsDeleted: number }> {
    return this.post('test-control/reset/test-patients')
  }

  /** Wipe journal/alert/escalation/notification rows for one user. */
  async resetUser(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user', { userId })
  }

  /**
   * Replace this user's `enrollmentStatus`. Used by tests that need a
   * deterministic state without driving the full 4-piece enrollment gate.
   */
  async setEnrollment(
    userId: string,
    status: 'NOT_ENROLLED' | 'ENROLLED',
  ): Promise<void> {
    await this.post('test-control/user/set-enrollment', { userId, status })
  }

  /** Force a user's `profileVerificationStatus` (UNVERIFIED/VERIFIED/CORRECTED). */
  async setProfileVerificationStatus(
    userId: string,
    status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED',
  ): Promise<void> {
    await this.post('test-control/user/set-profile-verification', { userId, status })
  }

  /**
   * Spec 12 — clear businessHours on the practice attached to this user.
   * Returns the prior values; pair with `restorePracticeBusinessHours` in a
   * `finally` block so the seed state stays intact for other tests.
   */
  async clearPracticeBusinessHours(userId: string): Promise<{
    practiceId: string
    prior: {
      businessHoursStart: string
      businessHoursEnd: string
      businessHoursTimezone: string
    }
  }> {
    return this.post('test-control/practice/clear-business-hours', { userId })
  }

  async restorePracticeBusinessHours(
    userId: string,
    prior: {
      businessHoursStart: string
      businessHoursEnd: string
      businessHoursTimezone: string
    },
  ): Promise<void> {
    await this.post('test-control/practice/restore-business-hours', {
      userId,
      ...prior,
    })
  }

  // ─── Seed fixtures (Phase 0 §H) ─────────────────────────────────────────
  /** Force a user's accountStatus (ACTIVE | BLOCKED | SUSPENDED). */
  async setAccountStatus(
    email: string,
    status: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED',
  ): Promise<{ id: string; email: string; accountStatus: string }> {
    return this.post('test-control/user/set-account-status', { email, status })
  }

  /** Seed N alerts in specific states (each auto-creates its JournalEntry). */
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
    }>,
  ): Promise<{ created: number; alertIds: string[] }> {
    return this.post('test-control/seed/alerts', { userId, alerts })
  }

  /** Seed N notifications for a user. */
  async seedNotifications(
    userId: string,
    count: number,
    channel?: 'PUSH' | 'EMAIL' | 'PHONE' | 'DASHBOARD',
  ): Promise<{ created: number }> {
    return this.post('test-control/seed/notifications', { userId, count, channel })
  }

  /** Seed audit events (ProfileVerificationLog rows). */
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
    return this.post('test-control/seed/audit-trail', { userId, events })
  }

  // ─── Inspection ─────────────────────────────────────────────────────────
  /** List DeviationAlert rows for a user. */
  async listAlerts(userId: string): Promise<
    Array<{
      id: string
      tier: string
      ruleId: string
      mode: string
      status: string
      dismissible: boolean
      patientMessage: string
      physicianMessage: string
      createdAt: string
      acknowledgedAt: string | null
      acknowledgedByUserId: string | null
      resolvedAt: string | null
      resolvedBy: string | null
      resolutionAction: string | null
    }>
  > {
    return this.get(`test-control/alerts?userId=${encodeURIComponent(userId)}`)
  }

  /** List EscalationEvent rows for an alert (ladder progression inspection). */
  async listEscalationEvents(alertId: string): Promise<
    Array<{
      id: string
      ladderStep: string
      recipientRoles: string[]
      notificationChannel: string[]
      afterHours: boolean
      scheduledFor: string | null
      notificationSentAt: string | null
      acknowledgedAt: string | null
      acknowledgedBy: string | null
      resolvedAt: string | null
      resolvedBy: string | null
      triggeredByResolution: boolean
      reason: string | null
    }>
  > {
    return this.get(`test-control/escalation-events?alertId=${encodeURIComponent(alertId)}`)
  }

  /** List Notification rows fanned out for a user. */
  async listNotifications(userId: string): Promise<
    Array<{
      id: string
      title: string
      body: string
      channel: string
      sentAt: string
      readAt: string | null
      alertId: string | null
      escalationEventId: string | null
    }>
  > {
    return this.get(`test-control/notifications?userId=${encodeURIComponent(userId)}`)
  }

  /** Look up a user by email — returns id + status. */
  async findUser(email: string): Promise<{
    id: string
    email: string
    enrollmentStatus: string
    onboardingStatus: string
    profileVerificationStatus: string | null
  }> {
    return this.get(`test-control/user/find?email=${encodeURIComponent(email)}`)
  }

  async dispose(): Promise<void> {
    await this.ctx.dispose()
  }
}

/** Shorthand for one-off uses inside a test. Caller must dispose. */
export async function newTestControl(
  apiBase: string,
  secret?: string,
): Promise<TestControl> {
  return TestControl.create(apiBase, secret)
}
