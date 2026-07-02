import { test, expect } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Spec 68b — patient self-service permanent-close, UI confirm gate.
 *
 * Companion to spec 68 (which is API-only). Covers the phase/28 change that put
 * a two-step Cancel/Confirm gate in front of the "Close permanently" button on
 * /settings, mirroring Deactivate, so a single tap can no longer fire the
 * closure email.
 *
 * NON-DESTRUCTIVE: requesting closure only signs a 1-hour token and emails a
 * confirmation link — it does NOT change account state (the account is closed
 * only when the emailed link is confirmed, which this spec never does). So the
 * persona stays ACTIVE for the rest of the suite.
 *
 * MFA is reset first so sign-in is plain OTP (no biometric challenge) and lands
 * straight on /settings.
 */
test.describe('Spec 68b — patient close confirm gate', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'signs a patient in + sends a closure email')

  const PATIENT = PATIENTS.olive

  async function resetMfaFor(email: string): Promise<void> {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { id } = await tc.findUser(email)
      await tc.resetUserMfa(id)
    } finally {
      await tc.dispose()
    }
  }

  test.beforeEach(async () => {
    await resetMfaFor(PATIENT.email)
  })

  test.afterEach(async () => {
    await resetMfaFor(PATIENT.email)
  })

  test('68b.1 — Close permanently gates behind a confirm step; Cancel backs out; Confirm requests the email', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInPatient(page, PATIENT.email)
    await page.goto('/settings')

    const requestBtn = page.getByTestId('settings-close-request')
    const confirmBtn = page.getByTestId('settings-close-confirm')

    // Initial state: only the entry button, no confirm affordance yet.
    await expect(requestBtn).toBeVisible()
    await expect(confirmBtn).toHaveCount(0)

    // Click → the Cancel/Confirm gate appears (no email sent yet).
    await requestBtn.click()
    await expect(page.getByText(/permanently close your account\?/i)).toBeVisible()
    await expect(confirmBtn).toBeVisible()
    const cancelBtn = page.getByRole('button', { name: /^cancel$/i })
    await expect(cancelBtn).toBeVisible()

    // Cancel backs out to the initial state — still nothing sent.
    await cancelBtn.click()
    await expect(confirmBtn).toHaveCount(0)
    await expect(requestBtn).toBeVisible()

    // Re-open and confirm → the closure email is requested and the success copy
    // shows. Assert the copy no longer contains an em dash (phase/28 cleanup).
    await requestBtn.click()
    await confirmBtn.click()
    const success = page.getByText(/check your email\./i)
    await expect(success).toBeVisible({ timeout: 15_000 })
    expect(await success.innerText()).not.toContain('—')
  })
})
