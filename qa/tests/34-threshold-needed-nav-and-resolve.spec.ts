import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { waitForAlerts, editThresholdViaUI, resolveAlertViaModal } from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Manisha 2026-06-12 follow-up — with the "Threshold needed" banner showing
 * (auto-un-enrolled, threshold-pending patient with a dispatched emergency),
 * verify the admin is NOT locked out:
 *   1. Other sub-tabs (Readings, Medications) stay navigable.
 *   2. The alert's Resolve button stays enabled (resolution has no enrollment
 *      gate — the faded look in earlier screenshots was the fade-in animation).
 *   3. Close-off flow: set the threshold (auto-re-enroll, banner clears) → the
 *      alert resolves to RESOLVED.
 *
 * Subject: PATIENTS.aisha, restored to the seeded ENROLLED baseline in finally.
 */

test.describe('Threshold-needed: navigation + resolvability + close-off (admin UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 180_000 })

  test('34 — banner present: other tabs navigable, Resolve enabled, set-threshold then close-off resolves the alert', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    try {
      // ── Baseline → add serious condition → un-enroll → dispatched emergency ──
      await tc.resetUser(aisha.id)
      await tc.clearProfileVerificationLogs(aisha.id)
      await tc.clearPatientThreshold(aisha.id)
      await tc.setUserCondition(aisha.id, 'hasDCM', false)
      await tc.setUserCondition(aisha.id, 'hasHCM', false)
      await tc.setUserCondition(aisha.id, 'hasHeartFailure', false, 'NOT_APPLICABLE')
      await tc.setEnrollment(aisha.id, 'ENROLLED')

      const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
      const add = await patientApi.post('intake/profile', { data: { hasHCM: true } })
      expect(add.ok(), `add HCM: ${await add.text()}`).toBeTruthy()
      await expect
        .poll(async () => (await tc.findUser(PATIENTS.aisha.email)).enrollmentStatus, { timeout: 15_000 })
        .toBe('NOT_ENROLLED')
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
      expect(reading.status()).toBe(202)
      await patientApi.dispose()
      const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
      )
      const alert = alerts.find((a) => a.tier === 'BP_LEVEL_2')!
      await tc.fireEscalationT0(alert.id)

      // ── Admin opens the patient; banner is present ──
      await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
      await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 30_000 })
      await expect(page.locator(byTestId(T.admin.thresholdNeededBanner))).toBeVisible({ timeout: 20_000 })

      // ── 1. Other sub-tabs stay navigable (no lock) while the banner shows ──
      for (const tabKey of ['readings', 'medications'] as const) {
        await page.locator(byTestId(T.admin.detailTab(tabKey))).click()
        await expect(
          page.locator(byTestId(T.admin.detailTab(tabKey))),
          `${tabKey} tab navigable with banner present`,
        ).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 })
        // Banner persists across these tabs too.
        await expect(page.locator(byTestId(T.admin.thresholdNeededBanner))).toBeVisible()
      }

      // ── 2. Resolve stays enabled on the Alerts tab while threshold-needed ──
      await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
      const resolveBtn = page.locator(byTestId(T.admin.alertResolveBtnFor(alert.id)))
      await expect(resolveBtn, 'Resolve visible while threshold-needed').toBeVisible({ timeout: 20_000 })
      await expect(resolveBtn, 'Resolve enabled while threshold-needed').toBeEnabled()

      // ── 3. Close-off: set the threshold → auto-re-enroll → banner clears ──
      await editThresholdViaUI(page, aisha.id, { sbpLowerTarget: 100 })
      await expect
        .poll(async () => (await tc.findUser(PATIENTS.aisha.email)).enrollmentStatus, { timeout: 20_000 })
        .toBe('ENROLLED')
      await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
      await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
      await expect(page.locator(byTestId(T.admin.thresholdNeededBanner))).toBeHidden({ timeout: 15_000 })

      // …and the alert resolves cleanly.
      await resolveAlertViaModal(page, alert.id, {
        resolutionAction: 'BP_L2_CONTACTED_MED_ADJUSTED',
        rationale: 'QA: contacted patient, medication adjusted',
      })
      const after = await tc.listAlerts(aisha.id)
      expect(after.find((a) => a.id === alert.id)?.status, 'alert closed').toBe('RESOLVED')
    } finally {
      await tc.setUserCondition(aisha.id, 'hasHCM', false)
      await tc.clearPatientThreshold(aisha.id)
      await tc.clearProfileVerificationLogs(aisha.id)
      await tc.resetUser(aisha.id)
      await tc.setEnrollment(aisha.id, 'ENROLLED')
      await tc.dispose()
    }
  })
})
