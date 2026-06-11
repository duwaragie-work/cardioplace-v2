import { test, expect } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Spec 40 — magic-link sign-in (patient app).
 *
 * Covers the auth-context fix (commit 3e91159). The backend verify endpoint
 * (`GET /api/v2/auth/magic-link/verify?token=…`) 302-redirects to the patient
 * app with the session tokens on success, or to an `?error=…` page when the
 * link is expired / already used.
 *
 * NOTE: the admin app is OTP-only by design (magic-link is patient-only — see
 * the admin sign-in page comment + ADMIN_ROLE_ACCESS), so there is no admin
 * magic-link success path to test.
 *
 * MagicLink rows are minted via test-control (CI has no real mailbox), then we
 * drive the REAL verify endpoint in the browser. Gated — it writes rows + logs
 * a seed persona in.
 */
test.describe('Spec 40 — magic-link sign-in', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'mints magic links + signs in')

  const verifyUrl = (token: string) =>
    `${API_BASE_URL}/api/v2/auth/magic-link/verify?token=${token}`

  test('40.1 — a valid magic link signs the patient in', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { token } = await tc.issueMagicLink({ email: PATIENTS.aisha.email })
    await tc.dispose()

    await page.goto(verifyUrl(token))
    // Backend 302 → patient app magic-link handler → /dashboard.
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await expect(page).toHaveURL(/\/dashboard/)
  })

  test('40.2 — an expired magic link shows an error, not a session', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { token } = await tc.issueMagicLink({
      email: PATIENTS.aisha.email,
      expiresInSeconds: -60, // already expired
    })
    await tc.dispose()

    await page.goto(verifyUrl(token))
    // Redirected to the error page; never reaches the dashboard.
    await expect(page).toHaveURL(/error=/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  test('40.3 — an already-used magic link shows an error', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { token } = await tc.issueMagicLink({
      email: PATIENTS.aisha.email,
      markUsed: true,
    })
    await tc.dispose()

    await page.goto(verifyUrl(token))
    await expect(page).toHaveURL(/error=/, { timeout: 30_000 })
    await expect(page).not.toHaveURL(/\/dashboard/)
  })
})
