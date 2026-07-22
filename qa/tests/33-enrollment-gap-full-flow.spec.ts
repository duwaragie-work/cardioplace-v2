import { test, expect, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { waitForAlerts, editThresholdViaUI, gotoPatientDetailById,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Manisha 2026-06-12 — full REAL-FLOW smoke for the was-ever-enrolled dispatch
 * fix. No shortcuts (no seeded enrollment audit rows): an ENROLLED patient adds
 * a serious condition through the patient intake API, which auto-un-enrolls them
 * AND raises the "Threshold needed" banner across every tab. While un-enrolled
 * they submit an emergency reading, which must STILL dispatch (bypass). The admin
 * Alerts tab must show BOTH the threshold banner and the threshold-pending badge.
 * Setting the threshold auto-re-enrolls and runs the catch-up — which must NOT
 * duplicate the already-dispatched escalation or the enrollment audit trail.
 *
 * Subject: PATIENTS.aisha (reliably fires alerts). Restored to the seeded
 * ENROLLED baseline in finally.
 */

async function enrollmentAuditRows(
  adminApi: APIRequestContext,
  userId: string,
): Promise<Array<{ newValue: unknown; previousValue: unknown }>> {
  const res = await adminApi.get(`admin/users/${userId}/verification-logs`)
  const body = await res.json()
  const logs = (body?.data ?? body) as Array<{
    fieldPath: string
    newValue: unknown
    previousValue: unknown
  }>
  return logs.filter((l) => l.fieldPath === 'user.enrollmentStatus')
}

test.describe('Enrollment-gap full flow (real serious-condition path)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 180_000 })

  test('33 — serious condition un-enrolls → banner + badge on Alerts tab → set threshold re-enrolls without duplicating catch-up/audit', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const adminApi = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    try {
      // ── Baseline: ENROLLED, non-mandatory, no threshold, clean audit ──
      await tc.resetUser(aisha.id)
      await tc.clearProfileVerificationLogs(aisha.id)
      await tc.clearPatientThreshold(aisha.id)
      await tc.setUserCondition(aisha.id, 'hasDCM', false)
      await tc.setUserCondition(aisha.id, 'hasHCM', false)
      await tc.setUserCondition(aisha.id, 'hasHeartFailure', false, 'NOT_APPLICABLE')
      await tc.setEnrollment(aisha.id, 'ENROLLED')

      // ── Patient adds a serious condition (HCM) via the REAL intake path ──
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
      const add = await patientApi.post('intake/profile', { data: { hasHCM: true } })
      expect(add.ok(), `add HCM: ${add.status()} ${await add.text()}`).toBeTruthy()

      // Auto-un-enroll fired (threshold-mandatory condition, no threshold on file).
      await expect
        .poll(async () => (await tc.findUser(PATIENTS.aisha.email)).enrollmentStatus, {
          timeout: 15_000,
        })
        .toBe('NOT_ENROLLED')

      // ── Emergency reading submitted WHILE un-enrolled ──
      const reading = await patientApi.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 220,
          diastolicBP: 120,
          pulse: 80,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(reading.status(), `reading: ${await reading.text()}`).toBe(202)
      await patientApi.dispose()

      const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
      )
      const alert = alerts.find((a) => a.tier === 'BP_LEVEL_2')!
      await tc.fireEscalationT0(alert.id)

      // The was-ever-enrolled bypass dispatched it despite NOT_ENROLLED.
      expect(
        (await tc.listEscalationEvents(alert.id)).length,
        'bypass dispatched the emergency',
      ).toBeGreaterThan(0)

      // ── Admin UI: threshold banner on EVERY tab + threshold-pending badge ──
      await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
      await gotoPatientDetailById(page, ADMIN_BASE_URL, aisha.id)
      await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 30_000 })
      // Banner on the default tab…
      await expect(
        page.locator(byTestId('admin-threshold-needed-banner')),
        'threshold banner on default tab',
      ).toBeVisible({ timeout: 20_000 })
      // …AND on the Alerts tab (the specific gap to verify).
      await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
      await expect(
        page.locator(byTestId('admin-threshold-needed-banner')),
        'threshold banner on Alerts tab',
      ).toBeVisible({ timeout: 20_000 })
      // Threshold-pending badge on the alert card.
      await expect(
        page.locator(byTestId(`admin-alert-threshold-pending-badge-${alert.id}`)),
        'threshold-pending badge on Alerts tab',
      ).toBeVisible({ timeout: 20_000 })
      await page.screenshot({
        path: 'reports/screenshots/enrollment-gap-alerts-tab.png',
        fullPage: true,
      })

      // ── Snapshot before re-enroll ──
      const eventCountBefore = (await tc.listEscalationEvents(alert.id)).length

      // ── Set the threshold via the REAL admin UI → auto-re-enroll + catch-up ──
      await editThresholdViaUI(page, aisha.id, { sbpLowerTarget: 100 })
      await expect
        .poll(async () => (await tc.findUser(PATIENTS.aisha.email)).enrollmentStatus, {
          timeout: 20_000,
        })
        .toBe('ENROLLED')

      // ── No double-dispatch: the already-dispatched alert keeps its events ──
      expect(
        (await tc.listEscalationEvents(alert.id)).length,
        'catch-up did not duplicate EscalationEvents',
      ).toBe(eventCountBefore)

      // ── No duplicate audit rows: exactly 1 revert + 1 re-enroll ──
      const enrollLogs = await enrollmentAuditRows(adminApi, aisha.id)
      const reverts = enrollLogs.filter((l) => l.newValue === 'NOT_ENROLLED').length
      const reenrolls = enrollLogs.filter((l) => l.newValue === 'ENROLLED').length
      expect(reverts, 'exactly one auto-revert audit row').toBe(1)
      expect(reenrolls, 'exactly one auto-re-enroll audit row').toBe(1)
      expect(enrollLogs.length, 'no duplicate enrollment audit rows').toBe(2)
    } finally {
      // Restore Aisha to the seeded ENROLLED baseline.
      await tc.setUserCondition(aisha.id, 'hasHCM', false)
      await tc.clearPatientThreshold(aisha.id)
      await tc.clearProfileVerificationLogs(aisha.id)
      await tc.resetUser(aisha.id)
      await tc.setEnrollment(aisha.id, 'ENROLLED')
      await adminApi.dispose()
      await tc.dispose()
    }
  })
})
