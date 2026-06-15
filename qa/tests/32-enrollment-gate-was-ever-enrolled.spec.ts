import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { waitForAlerts } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Manisha sign-off 2026-06-12 — was-ever-enrolled emergency-dispatch bypass.
 *
 * P0 safety gap: fireT0 deferred ALL dispatch for NOT_ENROLLED patients,
 * including emergencies. Combined with auto-un-enroll on a serious-condition add
 * (HFrEF/HCM/DCM), a previously-monitored patient could submit an emergency
 * reading and have nobody paged.
 *
 * Fix: a NOT_ENROLLED patient who was EVER enrolled (audit row proving it)
 * dispatches normally — care team + routing are already in place, only the
 * personalized threshold is pending. A truly never-enrolled patient still
 * defers. The catch-up on re-enroll must NOT re-dispatch an alert that already
 * fired via the bypass (Manisha's explicit concern).
 *
 * API-level E2E against the real backend + DB. Asserts the backend
 * EscalationEvent rows directly — the ground truth for "did dispatch fire?".
 *
 * Subject: PATIENTS.aisha. Her seeded profile reliably produces a BP_LEVEL_2 on
 * a single emergency reading (see spec 27). We only flip her enrollment +
 * seed/clear the audit row, never her clinical profile, and restore her to
 * ENROLLED in finally so sibling specs (e.g. 22) keep their expected baseline.
 */

const ADMIN = ADMINS.support // SUPER_ADMIN — reads patient summary + manual enroll.
const ENROLLMENT_REVERT_ROW = {
  changeType: 'ADMIN_CORRECT',
  fieldPath: 'user.enrollmentStatus',
  previousValue: 'ENROLLED',
  newValue: 'NOT_ENROLLED',
  changedByRole: 'ADMIN' as const,
  rationale: 'QA seed: prior auto-revert (previously enrolled)',
}

/**
 * Put the patient in the un-enrolled window. `previouslyEnrolled` seeds the
 * `user.enrollmentStatus` revert audit row that wasEverEnrolled keys off; the
 * never-enrolled case clears all audit rows so no enrollment history remains.
 */
async function stageUnenrolled(
  tc: TestControl,
  userId: string,
  opts: { previouslyEnrolled: boolean },
): Promise<void> {
  await tc.resetUser(userId)
  await tc.clearProfileVerificationLogs(userId)
  await tc.setEnrollment(userId, 'NOT_ENROLLED')
  if (opts.previouslyEnrolled) {
    await tc.seedAuditTrail(userId, [{ ...ENROLLMENT_REVERT_ROW, changedBy: userId }])
  }
}

async function restore(tc: TestControl, userId: string): Promise<void> {
  await tc.resetUser(userId)
  await tc.clearProfileVerificationLogs(userId)
  await tc.setEnrollment(userId, 'ENROLLED')
}

async function fireEmergencyAndGetAlert(
  tc: TestControl,
  email: string,
  userId: string,
): Promise<{ id: string }> {
  const api = await authedApi(API_BASE_URL, email, 'patient')
  const res = await api.post('daily-journal', {
    data: {
      measuredAt: new Date().toISOString(),
      systolicBP: 220,
      diastolicBP: 120,
      pulse: 80,
      position: 'SITTING',
      sessionId: randomUUID(),
    },
  })
  expect(res.status(), `reading post: ${await res.text()}`).toBe(202)
  await api.dispose()
  const alerts = await waitForAlerts(tc, userId, (xs) =>
    xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
  )
  const found = alerts.find((a) => a.tier === 'BP_LEVEL_2')
  if (!found) {
    throw new Error(
      `no BP_LEVEL_2 alert; got ${JSON.stringify(alerts.map((a) => a.tier))}`,
    )
  }
  return found
}

test.describe('Was-ever-enrolled emergency dispatch (API E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('32.1 — previously-enrolled NOT_ENROLLED patient: emergency DISPATCHES + summary flags it', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    try {
      await stageUnenrolled(tc, aisha.id, { previouslyEnrolled: true })

      const alert = await fireEmergencyAndGetAlert(tc, PATIENTS.aisha.email, aisha.id)
      await tc.fireEscalationT0(alert.id)

      const events = await tc.listEscalationEvents(alert.id)
      expect(
        events.length,
        'previously-enrolled → dispatch fired (>=1 EscalationEvent)',
      ).toBeGreaterThan(0)

      // The admin patient-summary surfaces previouslyEnrolled so the alert card
      // shows the "threshold pending" badge instead of "no dispatch".
      const adminApi = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
      const summary = await (
        await adminApi.get(`provider/patients/${aisha.id}/summary`)
      ).json()
      expect(summary?.data?.patient?.previouslyEnrolled).toBe(true)
      await adminApi.dispose()
    } finally {
      await restore(tc, aisha.id)
      await tc.dispose()
    }
  })

  test('32.2 — never-enrolled NOT_ENROLLED patient: emergency DEFERS (gate preserved)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    try {
      await stageUnenrolled(tc, aisha.id, { previouslyEnrolled: false })

      const alert = await fireEmergencyAndGetAlert(tc, PATIENTS.aisha.email, aisha.id)
      await tc.fireEscalationT0(alert.id)

      const events = await tc.listEscalationEvents(alert.id)
      expect(events.length, 'never-enrolled → deferred (0 EscalationEvents)').toBe(0)

      const adminApi = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
      const summary = await (
        await adminApi.get(`provider/patients/${aisha.id}/summary`)
      ).json()
      expect(summary?.data?.patient?.previouslyEnrolled).toBe(false)
      await adminApi.dispose()
    } finally {
      await restore(tc, aisha.id)
      await tc.dispose()
    }
  })

  test('32.3 — re-enroll catch-up does NOT double-dispatch the already-dispatched alert', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    try {
      await stageUnenrolled(tc, aisha.id, { previouslyEnrolled: true })

      const alert = await fireEmergencyAndGetAlert(tc, PATIENTS.aisha.email, aisha.id)
      await tc.fireEscalationT0(alert.id)
      const before = (await tc.listEscalationEvents(alert.id)).length
      expect(before, 'bypass dispatched at T+0').toBeGreaterThan(0)

      // Run the REAL manual enroll — which fires the catch-up
      // (dispatchDeferredForUser). The already-dispatched alert HAS
      // EscalationEvents, so the catch-up (escalationEvents: { none: {} })
      // excludes it -> count is unchanged. No double-dispatch.
      const adminApi = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
      const enroll = await adminApi.post(`admin/patients/${aisha.id}/complete-enrollment`)
      expect(enroll.ok(), `complete-enrollment: ${await enroll.text()}`).toBeTruthy()
      await adminApi.dispose()

      const after = (await tc.listEscalationEvents(alert.id)).length
      expect(after, 'catch-up must not re-dispatch the already-dispatched alert').toBe(before)
    } finally {
      await restore(tc, aisha.id)
      await tc.dispose()
    }
  })
})
