import { test, expect } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { signInAdmin } from '../helpers/auth.js'
import {
  enrollAdminTotp,
  totpCode,
  adminOtpExpectingMfaChallenge,
} from '../helpers/mfa.js'
import { byTestId, T } from '../helpers/selectors.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Spec 66 — admin/provider MFA (TOTP authenticator + recovery codes).
 * phase/27, Manisha 2026-06-12 Access Control §6.
 *
 * Admin's second factor is a TOTP authenticator app. We generate valid codes
 * with the SAME otplib the backend uses (see helpers/mfa.ts), so a code minted
 * here verifies server-side.
 *
 * State hygiene: every test resets the account's MFA footprint via
 * `tc.resetUserMfa` in beforeEach AND afterEach, so enrolling here never leaves
 * the shared seed admin permanently "MFA required" (which would break the plain
 * OTP→dashboard auth specs).
 *
 * Gated behind RUN_WRITE_TESTS — these enroll MFA + sign accounts in.
 */
test.describe('Spec 66 — admin MFA (TOTP)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'enrolls MFA + signs admins in')

  const ADMIN = ADMINS.manisha

  async function resetMfa(): Promise<string> {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { id } = await tc.findUser(ADMIN.email)
      await tc.resetUserMfa(id)
      return id
    } finally {
      await tc.dispose()
    }
  }

  test.beforeEach(async () => {
    await resetMfa()
  })

  test.afterEach(async () => {
    // Leave the seed admin clean for the OTP-only auth specs that share it.
    await resetMfa()
  })

  test('66.1 — enrollment wizard turns on TOTP and reveals recovery codes', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Sign in (no MFA yet) and open the voluntary enrollment wizard.
    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/sign-in/mfa-enroll`)

    // "Begin setup" calls enroll/start — capture the provisioning URI from the
    // response so we can mint the first valid code (the page only renders a QR
    // image + the base32 key, never the raw secret in an easily-read field).
    const startResP = page.waitForResponse(
      (r) => r.url().includes('/mfa/enroll/start') && r.ok(),
    )
    await page.locator(byTestId(T.mfa.adminEnrollBegin)).click()
    const startRes = await startResP
    const { provisioningUri } = (await startRes.json()) as {
      provisioningUri: string
    }
    const secret = new URL(provisioningUri).searchParams.get('secret')!
    expect(secret, 'enroll/start returned a base32 secret').toBeTruthy()

    await page.locator(byTestId(T.mfa.adminEnrollCode)).fill(totpCode(secret))
    await page.locator(byTestId(T.mfa.adminEnrollVerify)).click()

    // Step 3 — the 10 one-time recovery codes are shown once.
    const codes = page.locator(byTestId(T.mfa.adminEnrollRecoveryCodes))
    await expect(codes).toBeVisible({ timeout: 15_000 })
    await expect(codes.locator('li')).toHaveCount(10)

    // Finish is gated on the "I saved them" acknowledgement.
    const finish = page.locator(byTestId(T.mfa.adminEnrollFinish))
    await expect(finish).toBeDisabled()
    await page.locator(byTestId(T.mfa.adminEnrollSavedAck)).check()
    await finish.click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  })

  test('66.2 — an enrolled admin clears the TOTP challenge with a valid code', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const { secret } = await enrollAdminTotp(API_BASE_URL, ADMIN.email)

    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    await page.locator(byTestId(T.mfa.adminChallengeCode)).fill(totpCode(secret))
    await page.locator(byTestId(T.mfa.adminChallengeVerify)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  })

  test('66.3 — a wrong TOTP code is rejected and keeps the user on the challenge', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await enrollAdminTotp(API_BASE_URL, ADMIN.email)

    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    // A deterministically-wrong code (one failed attempt — well under the
    // 5-fail/15-min lockout).
    await page.locator(byTestId(T.mfa.adminChallengeCode)).fill('000000')
    await page.locator(byTestId(T.mfa.adminChallengeVerify)).click()

    // Next.js 16 injects a page-level `<div role="alert" aria-live="assertive"
    // id="__next-route-announcer__">` for route-change screen-reader
    // announcements — a bare `[role="alert"]` selector matches BOTH that
    // hidden announcer AND our error banner and trips Playwright's strict
    // mode. Filter to the visible error text so we hit only the toast.
    await expect(
      page.locator('[role="alert"]').filter({ hasText: /invalid/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/sign-in\/mfa-challenge/)
  })

  test('66.4 — a one-time recovery code signs the admin in', async ({ page }) => {
    test.setTimeout(90_000)
    const { recoveryCodes } = await enrollAdminTotp(API_BASE_URL, ADMIN.email)

    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    // Switch from the authenticator-code mode to the recovery-code mode.
    await page.getByRole('button', { name: /use a recovery code instead/i }).click()
    await page
      .locator(byTestId(T.mfa.adminChallengeRecovery))
      .fill(recoveryCodes[0])
    await page.locator(byTestId(T.mfa.adminChallengeRecoveryVerify)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
  })

  test('66.5 — visiting the challenge page with no token shows the expired state', async ({
    page,
  }) => {
    // No stashed challenge token + no URL param → zero-state, not a session.
    await page.goto(`${ADMIN_BASE_URL}/sign-in/mfa-challenge`)
    await expect(
      page.getByRole('heading', { name: /sign-in session expired/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.getByRole('link', { name: /back to sign in/i }),
    ).toBeVisible()
  })

  test('66.6 — settings lets an enrolled admin regenerate recovery codes', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const { secret } = await enrollAdminTotp(API_BASE_URL, ADMIN.email)

    // Sign in through the TOTP challenge, then open settings.
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    await page.locator(byTestId(T.mfa.adminChallengeCode)).fill(totpCode(secret))
    await page.locator(byTestId(T.mfa.adminChallengeVerify)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    await page.goto(`${ADMIN_BASE_URL}/settings`)
    await page.locator(byTestId(T.mfa.adminSettingsRecoveryCodes)).click()

    const modal = page.locator(byTestId(T.mfa.adminRecoveryModal))
    await expect(modal).toBeVisible({ timeout: 15_000 })
    await page.locator(byTestId(T.mfa.adminRecoveryGenerate)).click()

    const list = page.locator(byTestId(T.mfa.adminRecoveryList))
    await expect(list).toBeVisible({ timeout: 15_000 })
    await expect(list.locator('li')).toHaveCount(10)
    await page.locator(byTestId(T.mfa.adminRecoveryDone)).click()
    await expect(modal).toBeHidden({ timeout: 10_000 })
  })
})
