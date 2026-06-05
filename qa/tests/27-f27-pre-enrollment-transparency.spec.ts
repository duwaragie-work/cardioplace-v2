import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { waitForAlerts } from '../helpers/api.js'

/**
 * F27 — pre-enrollment dispatch transparency.
 *
 * Bug: while a patient is NOT_ENROLLED the escalation pipeline DEFERS all
 * dispatch, but the alert detail page still told the patient "Your care team
 * has been notified" — false reassurance on a potential emergency.
 *
 * Fix: the alert detail surfaces read the patient's enrollmentStatus (now
 * exposed on GET /api/v2/auth/profile) and, when pre-enrollment, swap the
 * reassurance for a self-escalation notice.
 *
 * REQUIRES the backend built from this branch — the auth profile endpoint must
 * return `enrollmentStatus`. Against an older backend isPreEnrollment stays
 * false and this spec will (correctly) fail.
 */

test.describe('F27 — pre-enrollment patient sees truthful messaging', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('pre-enrollment alert detail shows "enrollment pending", NOT "care team notified"', async ({
    page,
  }) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const patient = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(patient.id)
    // Put the patient in the pre-enrollment window — dispatch is deferred.
    await tc.setEnrollment(patient.id, 'NOT_ENROLLED')

    const api = await authedApi(apiBase, PATIENTS.aisha.email, 'patient')
    // Fire an emergency reading (185/120) — single reading bypasses the gate.
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 185,
        diastolicBP: 120,
        pulse: 78,
        position: 'SITTING',
        sessionId: randomUUID(),
      },
    })
    expect(res.status()).toBe(202)

    const alerts = await waitForAlerts(tc, patient.id, (xs) =>
      xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
    )
    const emergency = alerts.find((a) => a.tier === 'BP_LEVEL_2')!
    expect(emergency, 'BP Level 2 alert exists').toBeDefined()

    // Open the alert detail page directly. (The dashboard's "Recent Alerts"
    // strip + the old `dashboard-active-alert` banner testid were removed in
    // 25e3296; the active-alert surface is now a button, not an <a href>. This
    // test asserts the ALERT-DETAIL page content, so navigate straight there.)
    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.goto(`/alerts/${emergency.id}`)
    await page.waitForURL(new RegExp(`/alerts/${emergency.id}`), { timeout: 30_000 }).catch(() => {})
    await page.waitForLoadState('networkidle').catch(() => {})

    const bodyText = await page.locator('body').innerText()
    // The emergency 911 CTA still shows; the FALSE reassurance must not.
    expect(bodyText, 'pre-enrollment notice present').toMatch(/enrollment is pending|enrollment pending/i)
    expect(bodyText, 'no false "care team has been notified"').not.toMatch(
      /care team has been notified/i,
    )

    await page.screenshot({
      path: `reports/screenshots/f27-pre-enrollment.png`,
      fullPage: true,
    })

    await tc.dispose()
  })
})
