import { test, expect } from '@playwright/test'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'

/**
 * F1 + Group A addendum (2026-07-21) — the patient USER ID must NEVER reach the
 * host in a URL. Two nav mechanisms, one guarantee:
 *   • patients-list / care-team click → id stashed in sessionStorage, navigate
 *     to the BARE route (no id, no alert on the URL).
 *   • alert click / email deep-link → ONLY the alert id rides the URL
 *     (`?alert=<alertId>`); the admin detail page resolves the patient
 *     server-side. An alert id is an opaque ULID and reveals nothing without an
 *     authenticated, practice-scoped API call — so it is allowed in the URL; a
 *     patient id is not.
 *
 * There is deliberately NO admin `?id=<patientUserId>` path any more. This proves:
 *   1. after a patients-list click the URL carries no id/alert query, and
 *   2. after an alert click the URL carries `?alert=` but NEVER the patient id, and
 *   3. NO network request during either nav carries the patient ULID (the real
 *      check — that's what would otherwise land in the CDN access log), and
 *   4. the detail still renders in both cases (stash hand-off / alert-resolve worked).
 *
 * The patient app's `/alerts?id=<alertId>` deep-link is unchanged — an alert id
 * in the URL is fine; that path is covered below as before.
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

  test('admin: bare /patients/detail with no stash redirects to the list', async ({
    page,
  }) => {
    // The old `?id=<patientUserId>` deep-link is gone. Hitting the detail route
    // cold (no `?alert=`, no sessionStorage) must NOT render an empty detail —
    // it bounces back to the patients list.
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/detail`)
    await page.waitForURL(/\/patients(?!\/detail)/, { timeout: 20_000 })
  })

  test.describe('admin alert nav (write-gated)', () => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')

    test('alert click → ?alert= only, patient id never on the wire', async ({ page }) => {
      const aisha = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(aisha.id)
      const { alertIds } = await tc.seedAlerts(aisha.id, [
        { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
      ])
      const alertId = alertIds[0]

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/notifications`)

      const requestUrls: string[] = []
      page.on('request', (r) => requestUrls.push(r.url()))

      await page.getByTestId(`admin-alert-row-${alertId}`).first().click()

      // 1. URL deep-links the alert but NEVER the patient id.
      await page.waitForURL(/\/patients\/detail\?alert=/, { timeout: 20_000 })
      expect(page.url()).toContain(`alert=${alertId}`)
      expect(page.url()).not.toContain(aisha.id)

      // 2. The real check: the patient ULID is in NO request URL (the alert id
      //    is allowed; the patient id is not).
      for (const u of requestUrls) {
        expect(u, `patient ULID leaked in a request: ${u}`).not.toContain(aisha.id)
      }

      // 3. The detail resolved server-side from the alert and rendered.
      await expect(page.getByTestId('admin-patient-detail-header')).toBeVisible({
        timeout: 20_000,
      })
      await tc.resetUser(aisha.id)
    })

    test('email-style deep-link /patients/detail?alert= resolves the patient', async ({
      page,
    }) => {
      const aisha = await tc.findUser(PATIENTS.aisha.email)
      await tc.resetUser(aisha.id)
      const { alertIds } = await tc.seedAlerts(aisha.id, [
        { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
      ])
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)

      await page.goto(`${ADMIN_BASE_URL}/patients/detail?alert=${alertIds[0]}`)
      await expect(page.getByTestId('admin-patient-detail-header')).toBeVisible({
        timeout: 20_000,
      })
      expect(page.url()).not.toContain(aisha.id)
      await tc.resetUser(aisha.id)
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
