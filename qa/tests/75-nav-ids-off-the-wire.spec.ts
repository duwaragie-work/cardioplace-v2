import { test, expect } from '@playwright/test'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'

/**
 * F1 (static export) — patient/alert ids must NOT reach the host on in-app
 * navigation. In-app clicks stash the id in sessionStorage and navigate to the
 * BARE route; the id only rides the URL for external email/push deep-links
 * (kept as a fallback). This proves:
 *   1. after an in-app click the URL carries no id/alert query, and
 *   2. NO network request during the nav carries the ULID (the real check —
 *      that's what would otherwise land in the CDN access log), and
 *   3. the detail still renders (the sessionStorage hand-off worked), and
 *   4. an external deep-link `?id=<ULID>` still resolves (fallback intact).
 */

test.describe('F1 — ids off the wire on in-app navigation', () => {
  let tc: TestControl

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  test('admin: patients list → detail leaks no id (URL + network)', async ({ page }) => {
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)

    // Capture every request URL from the click onward.
    const requestUrls: string[] = []
    page.on('request', (r) => requestUrls.push(r.url()))

    await page.locator(byTestId(`admin-patient-list-row-${aisha.id}`)).first().click()

    // 1. Lands on the BARE detail route — no id/alert in the URL.
    await page.waitForURL(/\/patients\/detail(?!.*\bid=)/, { timeout: 20_000 })
    expect(page.url()).not.toContain(`id=${aisha.id}`)
    expect(page.url()).not.toContain('alert=')

    // 2. The real check: the ULID appears in NO request URL (nothing the CDN
    //    would log — including the RSC `.txt` payload fetch).
    for (const u of requestUrls) {
      expect(u, `patient ULID leaked in a request: ${u}`).not.toContain(aisha.id)
    }

    // 3. The detail still rendered → the sessionStorage hand-off worked.
    await expect(page.getByTestId('admin-patient-detail-header')).toBeVisible({
      timeout: 20_000,
    })
  })

  test('admin: external deep-link ?id= still resolves (fallback)', async ({ page }) => {
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)

    await page.goto(`${ADMIN_BASE_URL}/patients/detail?id=${aisha.id}`)
    await expect(page.getByTestId('admin-patient-detail-header')).toBeVisible({
      timeout: 20_000,
    })
  })

  test.describe('patient alerts', () => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')

    test('notifications → alert detail leaks no id (URL + network)', async ({ page }) => {
      const u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
      const { alertIds } = await tc.seedAlerts(u.id, [
        { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
      ])
      const alertId = alertIds[0]

      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/notifications?tab=alerts')

      const requestUrls: string[] = []
      page.on('request', (r) => requestUrls.push(r.url()))

      await page.getByTestId(`notification-row-detail-${alertId}`).first().click()

      await page.waitForURL(/\/alerts(?!.*\bid=)/, { timeout: 20_000 })
      expect(page.url()).not.toContain(`id=${alertId}`)
      for (const url of requestUrls) {
        expect(url, `alert ULID leaked in a request: ${url}`).not.toContain(alertId)
      }
      await expect(page.locator(byTestId(T.alertDetail.messagePatient))).toBeVisible({
        timeout: 15_000,
      })
      await tc.resetUser(u.id)
    })

    test('deep-link /alerts?id= still resolves (fallback)', async ({ page }) => {
      const u = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(u.id)
      const { alertIds } = await tc.seedAlerts(u.id, [
        { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
      ])
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto(`/alerts?id=${alertIds[0]}`)
      await expect(page.locator(byTestId(T.alertDetail.messagePatient))).toBeVisible({
        timeout: 15_000,
      })
      await tc.resetUser(u.id)
    })
  })
})
