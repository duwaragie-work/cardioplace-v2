import { test, expect } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { signInAdmin, authedApi, clearSession } from '../helpers/auth.js'
import {
  enrollAdminTotp,
  totpCode,
  adminOtpExpectingMfaChallenge,
} from '../helpers/mfa.js'
import { byTestId, T } from '../helpers/selectors.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Spec 66b — admin MFA edge / negative paths (companion to spec 66).
 * phase/27, Manisha 2026-06-12 Access Control §6.
 *
 * Covers: forced-enrollment + re-enroll UI, the challenge mode toggle,
 * invalid / already-used recovery codes, the 5-fails soft lockout, and the
 * SUPER_ADMIN MFA reset. `resetUserMfa` (test-control) clears the failed-attempt
 * AuthLog rows too, so the lockout test is deterministic + self-cleaning.
 *
 * Gated behind RUN_WRITE_TESTS.
 */
test.describe('Spec 66b — admin MFA edges', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'enrolls MFA + signs admins in')

  const ADMIN = ADMINS.manisha

  async function resetMfaFor(email: string): Promise<string> {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { id } = await tc.findUser(email)
      await tc.resetUserMfa(id)
      return id
    } finally {
      await tc.dispose()
    }
  }

  test.beforeEach(async () => {
    await resetMfaFor(ADMIN.email)
  })

  test.afterEach(async () => {
    await resetMfaFor(ADMIN.email)
  })

  test('66b.1 — forced enrollment (?required=1) shows the mandatory banner', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/sign-in/mfa-enroll?required=1`)
    await expect(page.getByText(/two-factor authentication is now required/i)).toBeVisible({
      timeout: 15_000,
    })
    // Forced flow offers only a deliberate exit, not "maybe later".
    await expect(
      page.getByRole('button', { name: /cancel and sign out/i }),
    ).toBeVisible()
  })

  test('66b.2 — re-enroll (?reEnroll=1) explains the recovery-code reset', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/sign-in/mfa-enroll?reEnroll=1`)
    await expect(
      page.getByText(/signed in with a recovery code/i),
    ).toBeVisible({ timeout: 15_000 })
  })

  test('66b.3 — challenge toggles between authenticator and recovery modes', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await enrollAdminTotp(API_BASE_URL, ADMIN.email)
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)

    await expect(page.locator(byTestId(T.mfa.adminChallengeCode))).toBeVisible()
    await page.getByRole('button', { name: /use a recovery code instead/i }).click()
    await expect(page.locator(byTestId(T.mfa.adminChallengeRecovery))).toBeVisible()
    await page.getByRole('button', { name: /back to authenticator code/i }).click()
    await expect(page.locator(byTestId(T.mfa.adminChallengeCode))).toBeVisible()
  })

  test('66b.4 — an invalid recovery code is rejected', async ({ page }) => {
    test.setTimeout(90_000)
    await enrollAdminTotp(API_BASE_URL, ADMIN.email)
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)

    await page.getByRole('button', { name: /use a recovery code instead/i }).click()
    await page.locator(byTestId(T.mfa.adminChallengeRecovery)).fill('ZZZZZ-ZZZZZ')
    await page.locator(byTestId(T.mfa.adminChallengeRecoveryVerify)).click()

    await expect(
      // Exclude Next's route announcer (also role="alert") so this resolves to
      // the single real error/lock banner — otherwise strict mode trips on 2.
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/sign-in\/mfa-challenge/)
  })

  test('66b.5 — a recovery code cannot be reused', async ({ page }) => {
    test.setTimeout(120_000)
    const { recoveryCodes } = await enrollAdminTotp(API_BASE_URL, ADMIN.email)
    const code = recoveryCodes[0]

    // First use — signs in.
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    await page.getByRole('button', { name: /use a recovery code instead/i }).click()
    await page.locator(byTestId(T.mfa.adminChallengeRecovery)).fill(code)
    await page.locator(byTestId(T.mfa.adminChallengeRecoveryVerify)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // The first sign-in left an active admin session, so /sign-in would bounce
    // straight to /dashboard. Clear it so the second sign-in re-runs the OTP +
    // MFA challenge (where the burned code must now be rejected).
    await clearSession(page.context())

    // Second use of the SAME code — the authenticator is untouched, so a new
    // sign-in still hits the challenge, but the burned code is now rejected.
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)
    await page.getByRole('button', { name: /use a recovery code instead/i }).click()
    await page.locator(byTestId(T.mfa.adminChallengeRecovery)).fill(code)
    await page.locator(byTestId(T.mfa.adminChallengeRecoveryVerify)).click()

    await expect(
      // Exclude Next's route announcer (also role="alert") so this resolves to
      // the single real error/lock banner — otherwise strict mode trips on 2.
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/sign-in\/mfa-challenge/)
  })

  test('66b.6 — five wrong codes soft-lock the account', async ({ page }) => {
    test.setTimeout(120_000)
    await enrollAdminTotp(API_BASE_URL, ADMIN.email)
    await adminOtpExpectingMfaChallenge(page, ADMIN.email, ADMIN_BASE_URL)

    // 5 fails arm the soft lock; the 6th attempt is refused with the lock
    // message. Loop up to 6, asserting the lockout copy appears.
    const lockMsg = page.getByText(/too many attempts/i)
    for (let i = 0; i < 6; i++) {
      await page.locator(byTestId(T.mfa.adminChallengeCode)).fill('000000')
      await page.locator(byTestId(T.mfa.adminChallengeVerify)).click()
      await expect(
      // Exclude Next's route announcer (also role="alert") so this resolves to
      // the single real error/lock banner — otherwise strict mode trips on 2.
      page.locator('[role="alert"]:not(#__next-route-announcer__)'),
    ).toBeVisible({ timeout: 15_000 })
      if (await lockMsg.isVisible().catch(() => false)) break
    }
    await expect(lockMsg).toBeVisible({ timeout: 15_000 })
  })

  test('66b.7 — a SUPER_ADMIN can reset another admin’s MFA', async ({ page }) => {
    test.setTimeout(120_000)
    // Enroll the target, then have a (clean) SUPER_ADMIN reset it via the real
    // admin endpoint. Afterwards the target signs in with OTP only — no challenge.
    const targetId = await resetMfaFor(ADMIN.email)
    await enrollAdminTotp(API_BASE_URL, ADMIN.email)

    const adminId = await resetMfaFor(ADMINS.support.email)
    expect(adminId).not.toBe(targetId) // backend forbids self-reset
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    try {
      const res = await api.post(`v2/auth/admin/mfa/reset/${targetId}`, {
        data: { reason: 'qa e2e — verify admin MFA reset' },
      })
      expect(
        res.ok(),
        `admin/mfa/reset failed: ${res.status()} ${await res.text()}`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
    }

    // MFA is gone → plain OTP lands straight on the dashboard.
    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
  })
})
