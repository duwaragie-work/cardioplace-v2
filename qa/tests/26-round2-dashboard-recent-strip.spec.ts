import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { postSessionWithTwoReadings, waitForAlerts } from '../helpers/api.js'

/**
 * P2 — the patient dashboard "Recent Alerts" strip was removed (Duwaragie's
 * call): the headline ACTIVE ALERT banner + the navbar notification bell
 * already surface alerts, so a third dashboard surface was redundant noise.
 *
 * This spec proves the strip is gone EVEN WHEN the patient has open alerts
 * (the only state in which it used to render). It fires an alert on Carol,
 * lands on /dashboard, and asserts none of the strip's elements exist.
 */

test.describe('P2 — dashboard recent-alerts strip removed', () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('no "Recent Alerts" strip renders even with open alerts', async ({ page }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const carol = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(carol.id)
    await new Promise((r) => setTimeout(r, 1500))
    const api = await authedApi(apiBase, PATIENTS.carol.email, 'patient')

    // Fire one BP_LEVEL_1_HIGH alert so the dashboard has an open alert.
    await postSessionWithTwoReadings(api, { systolicBP: 165, diastolicBP: 85, pulse: 72 })
    await waitForAlerts(tc, carol.id, (rows) =>
      rows.some((a) => a.tier === 'BP_LEVEL_1_HIGH'),
    )

    await signInPatient(page, PATIENTS.carol.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-01-dashboard.png`,
      fullPage: true,
    })

    // The headline banner still surfaces the alert (sanity: alerts exist).
    // The recent-alerts strip and all its controls must be gone.
    await expect(page.locator('[data-testid="dashboard-recent-alerts"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="dashboard-recent-alerts-see-all"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="dashboard-recent-alerts-filter-OPEN"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="dashboard-recent-alert-"]')).toHaveCount(0)
    await expect(page.getByText('Recent Alerts', { exact: false })).toHaveCount(0)

    await tc.dispose()
  })
})
