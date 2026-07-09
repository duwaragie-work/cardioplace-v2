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
    // N7 audit-exception scan can take 30–60s on a real DB (150-row seed +
    // 6 detector queries + upserts). Default 30s Playwright API timeout was
    // sufficient for the other cron drivers; bump for the audit-exception one.
    const res = await this.ctx.post(path, { data: body, timeout: 120_000 })
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
    // NestJS returns an empty body when the handler returns null — tolerate
    // this by treating empty responses as `null`. Otherwise res.json() throws
    // SyntaxError on empty input.
    const text = await res.text()
    if (!text) return null as T
    return JSON.parse(text) as T
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

  /**
   * Deterministically fire T+0 for one alert. Unlike runEscalationScan (which
   * only advances overdue ladders + fires queued events), this awaits the real
   * fireT0 dispatch for a fresh alert, so the T+0 Notification rows are
   * guaranteed written before the caller asserts. Idempotent.
   */
  async fireEscalationT0(alertId: string): Promise<void> {
    await this.post('test-control/escalation/fire-t0', { alertId })
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

  /**
   * F33 — run the medication-hold escalation scanner once. Pass `now` to
   * simulate a future time so a backdated hold crosses a rung (day 7/14/30/45)
   * without waiting for the daily 15:00 UTC cron.
   */
  async runMedicationHoldEscalationScan(
    now?: Date,
  ): Promise<{ scanned: number; rungsFired: number }> {
    return this.post('test-control/cron/medication-hold-escalation/run', {
      now: (now ?? new Date()).toISOString(),
    })
  }

  /**
   * N7 — run the audit-exception-report scanner once. Iterates every detector
   * over the past 24h of audit data, upserts AuditException rows per candidate.
   * Bypasses the 03:00 UTC schedule so Playwright can seed a pattern → trigger
   * → assert in one test.
   */
  async runAuditExceptionReportScan(now?: Date): Promise<{
    scanned: number
    created: number
    updated: number
    stickySkipped: number
    failedDetectors: number
  }> {
    return this.post('test-control/cron/audit-exception-report/run', {
      now: (now ?? new Date()).toISOString(),
    })
  }

  // ─── N4/N5/N6/N7 audit-read + seed helpers ─────────────────────────────
  async findUserByEmail(email: string): Promise<{ id: string } | null> {
    return this.get(`test-control/audit/user-by-email?email=${encodeURIComponent(email)}`)
  }

  async countAccessLog(filter: {
    actorId?: string
    modelName?: string
    sinceIso?: string
  }): Promise<{ count: number }> {
    const q = new URLSearchParams()
    if (filter.actorId) q.set('actorId', filter.actorId)
    if (filter.modelName) q.set('modelName', filter.modelName)
    if (filter.sinceIso) q.set('sinceIso', filter.sinceIso)
    return this.get(`test-control/audit/access-log/count?${q.toString()}`)
  }

  async latestEmailDisclosure(recipientEmail: string): Promise<{
    id: string
    template: string
    purpose: string
    recipientCategory: string
    briefDescription: string
    bodyHash: string
    sentAt: string
  } | null> {
    return this.get(
      `test-control/audit/email-disclosure-log/latest?recipientEmail=${encodeURIComponent(recipientEmail)}`,
    )
  }

  async latestProfileVerificationLog(filter: {
    userId: string
    changeType: string
  }): Promise<{
    id: string
    previousValue: unknown
    newValue: unknown
    changedBy: string
    changedByRole: string
  } | null> {
    return this.get(
      `test-control/audit/profile-verification-log/latest?userId=${encodeURIComponent(filter.userId)}&changeType=${filter.changeType}`,
    )
  }

  async findAuditExceptionByActor(actorId: string): Promise<{
    id: string
    detectorId: string
    severity: string
    status: string
    idempotencyKey: string
    evidence: unknown
  } | null> {
    return this.get(
      `test-control/audit/audit-exception/by-actor?actorId=${encodeURIComponent(actorId)}`,
    )
  }

  async seedAccessLogBatch(input: {
    actorId: string
    actorType: 'USER' | 'SYSTEM_ACTOR'
    action: 'READ' | 'WRITE' | 'DELETE'
    modelName: string
    count: number
    spreadMinutes: number
  }): Promise<{ inserted: number }> {
    return this.post('test-control/seed/access-log-batch', input)
  }

  async clearAccessLogForActor(actorId: string): Promise<{ deleted: number }> {
    return this.post('test-control/audit/access-log/clear-actor', { actorId })
  }

  async clearAuditExceptionsByPrefix(prefix: string): Promise<{ deleted: number }> {
    return this.post('test-control/audit/audit-exception/clear-by-prefix', { prefix })
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

  /**
   * June 2026 — Phase 2 idle-timeout driver. Backdate every active
   * AuthSession.lastActivityAt for a user so the next /refresh crosses
   * the 15-min (web) / 5-min (mobile) idle gate without sleeping.
   */
  async backdateAuthSessions(
    userId: string,
    deltaSeconds: number,
  ): Promise<{ updated: number }> {
    return this.post('test-control/auth-session/backdate', { userId, deltaSeconds })
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
   * Cluster 8 — backdate User.enrolledAt for Q2 CAD-ramp + Q3 first-month
   * nudge personas. Lets tests simulate "enrolled N days ago" without
   * waiting; prod-equivalent of EnrollmentService stamping enrolledAt at
   * ENROLLED transition.
   */
  async backdateEnrolledAt(userId: string, deltaSeconds: number): Promise<void> {
    await this.post('test-control/user/backdate-enrolled-at', { userId, deltaSeconds })
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

  /**
   * F17 — place an existing medication (matched by drugName) on HOLD with a
   * given reason (default PROVIDER_DIRECTED_HOLD), mirroring an admin hold.
   */
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
    return this.post('test-control/user/set-medication-hold', {
      userId,
      drugName,
      holdReason,
    })
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
   * phase/27 MFA — wipe a user's TOTP secret + recovery codes + WebAuthn
   * credentials so an MFA spec starts from a clean "never enrolled" baseline.
   * Without this, enrolling on a shared seed account leaves it permanently
   * MFA-required and breaks the plain OTP→dashboard auth specs. Idempotent.
   */
  async resetUserMfa(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user-mfa', { userId })
  }

  /**
   * Cluster 8 §D — wipe ALL of a user's PatientMedication rows. Use before
   * `setUserMedication` when the test needs an exact roster (e.g., ARB-only
   * angioedema variant on Aisha, who ships with Lisinopril+Amlodipine —
   * setUserMedication dedupes by drugName so ACE meds linger otherwise).
   */
  async clearUserMedications(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user-medications', { userId })
  }

  /**
   * Delete a user's DeviationAlert rows (+ child escalations + alert-linked
   * notifications) WITHOUT wiping reading history — for tests that need an
   * established history but a clean alert slate before triggering (30u B2).
   */
  async deleteAlertsForUser(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user-alerts', { userId })
  }

  /**
   * THR-REVIEW / IVR-04 — delete a user's PatientThreshold so the "no
   * threshold" branches (enrollment revert + missing-threshold lock) are
   * deterministically reachable. Idempotent.
   */
  async clearPatientThreshold(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user-threshold', { userId })
  }

  /**
   * THR-REVIEW — wipe a user's ProfileVerificationLog rows so the Timeline +
   * the stale-condition lock detector start clean across re-runs. Idempotent.
   */
  async clearProfileVerificationLogs(userId: string): Promise<{ rowsDeleted: number }> {
    return this.post('test-control/reset/user-profile-logs', { userId })
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

  /** F13 — set/clear PatientProfile.aceContraindicatedAt so the ACE/ARB
   *  re-add gate (modal + provider-review hold) can be exercised directly. */
  async setAceContraindicated(userId: string, value: boolean): Promise<void> {
    await this.post('test-control/user/set-ace-contraindicated', { userId, value })
  }

  /**
   * Phase 4 §C — flip a user's onboardingStatus. Seed personas are all
   * COMPLETED; spec 20a rolls one back to NOT_COMPLETED to exercise the
   * new-user → /onboarding redirect.
   */
  async setOnboardingStatus(
    userId: string,
    status: 'NOT_COMPLETED' | 'COMPLETED',
  ): Promise<void> {
    await this.post('test-control/user/set-onboarding-status', { userId, status })
  }

  /** Force a user's `profileVerificationStatus` (UNVERIFIED/VERIFIED/CORRECTED). */
  async setProfileVerificationStatus(
    userId: string,
    status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED',
  ): Promise<void> {
    await this.post('test-control/user/set-profile-verification', { userId, status })
  }

  /**
   * Phase 4 §B.2 — set a user's dateOfBirth. Used by the age-bucket boundary
   * test (spec 20g.1): AGE_65_LOW must fire the day the patient turns 65 and
   * NOT one day earlier, proving the cutoff is evaluated at reading time.
   */
  async setUserDateOfBirth(userId: string, dob: Date): Promise<void> {
    await this.post('test-control/user/set-date-of-birth', {
      userId,
      dob: dob.toISOString(),
    })
  }

  /**
   * Phase 4 §B.2 — upsert a PatientThreshold for personalized-mode tests
   * (spec 20g.21–22). `setByProviderId` is resolved server-side from the
   * patient's assignment, so callers only pass the target overrides.
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
    return this.post('test-control/user/set-threshold', { userId, override })
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

  // ─── Invite + magic-link token minting (specs 36/37/40) ───────────────────
  /**
   * Mint a UserInvite and get back the RAW activation token. The token is
   * what the e-mail carries; in CI the Resend key is a dummy, so this is the
   * only way a spec can recover it. Drive activation with
   * `${BASE}/activate/${token}` (patient or admin app) or POST it to
   * `/api/v2/auth/invite/${token}/accept`. Pass a negative `expiresInSeconds`
   * to forge an already-expired invite for the error-path test.
   */
  async createInvite(args: {
    email: string
    name: string
    role:
      | 'PATIENT'
      | 'PROVIDER'
      | 'MEDICAL_DIRECTOR'
      | 'COORDINATOR'
      | 'HEALPLACE_OPS'
      | 'SUPER_ADMIN'
    practiceId?: string
    expiresInSeconds?: number
  }): Promise<{ inviteId: string; token: string }> {
    return this.post('test-control/invite/create', args)
  }

  /**
   * Mint a MagicLink for `email` and get back the raw token. Drive the real
   * verify endpoint via `GET /api/v2/auth/magic-link/verify?token=…`. Pass a
   * negative `expiresInSeconds` for the expired-link test, or `markUsed:true`
   * for the already-used test.
   */
  async issueMagicLink(args: {
    email: string
    expiresInSeconds?: number
    markUsed?: boolean
  }): Promise<{ token: string }> {
    return this.post('test-control/magic-link/issue', args)
  }

  // ─── Captured emails (spec 4Z — email-no-PHI) ─────────────────────────────
  /**
   * Read the backend's in-memory captured emails. CI SMTP is a dummy that
   * never delivers, so EmailService captures the rendered mail in a non-prod
   * buffer; this is the only way a spec can inspect what WOULD be sent.
   */
  async getCapturedEmails(
    to?: string,
  ): Promise<Array<{ to: string; subject: string; html: string; sentAt: string }>> {
    const q = to ? `?to=${encodeURIComponent(to)}` : ''
    return this.get(`test-control/emails${q}`)
  }

  /** Clear the captured-email buffer (call before triggering a send). */
  async clearCapturedEmails(): Promise<{ ok: true }> {
    return this.post('test-control/emails/clear')
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
