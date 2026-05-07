import { test, expect } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { DEMO_OTP, PATIENTS, ADMINS } from '../helpers/accounts.js'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Auth flows — patient OTP sign-in, admin OTP sign-in, wrong-OTP error,
 * and the cross-app redirects (admin role on patient app → bridges to /admin
 * URL; PATIENT-only role on admin app → 403 + friendly message).
 */

test.describe('Patient sign-in', () => {
  test('seed patient OTP flow lands on /dashboard', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 30_000 })
  })

  test('wrong OTP shows inline error', async ({ page }) => {
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
    await page.locator(byTestId(T.signIn.otpInput)).fill('000000')
    await page.locator(byTestId(T.signIn.verifyBtn)).click()
    await expect(page.locator(byTestId(T.signIn.errorMsg))).toBeVisible({ timeout: 10_000 })
    await expect(page).not.toHaveURL(/\/dashboard/)
  })

  test('email is preserved when toggling OTP <-> Magic Link tab', async ({ page }) => {
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.magicTab)).click()
    await expect(page.locator(byTestId(T.signIn.emailInput))).toHaveValue(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.otpTab)).click()
    await expect(page.locator(byTestId(T.signIn.emailInput))).toHaveValue(PATIENTS.aisha.email)
  })
})

test.describe('Admin sign-in', () => {
  test('SUPER_ADMIN OTP flow lands on /dashboard on admin app', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`))
  })

  test('PATIENT-only email is rejected by admin gate', async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/sign-in`)
    await page.locator(byTestId(T.admin.signInEmail)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.admin.signInSendOtp)).click()
    // Backend admin gate (auth.service assertAdminAccessAllowed) rejects with
    // either an unknown-account or unauthorized-role message — both collapse
    // to one friendly UI message ("admin access denied" tier).
    await expect(page.locator('output, [role="status"]')).toContainText(
      /admin|denied|not authorized|no admin/i,
      { timeout: 10_000 },
    )
  })
})

test.describe('Cross-app role redirects', () => {
  test('admin-role token signs in on patient app then bridges to admin URL', async ({ page }) => {
    // Sign in via the patient app with an email that has admin roles. The
    // patient app's effect handler should detect admin role on the JWT and
    // redirect to NEXT_PUBLIC_ADMIN_URL. The bridge happens client-side.
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(ADMINS.manisha.email)
    await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
    await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
    await page.locator(byTestId(T.signIn.verifyBtn)).click()
    // Lands somewhere on the admin app (regardless of subpath)
    await page.waitForURL(new RegExp(ADMIN_BASE_URL.replace(/[/]/g, '\\/')), { timeout: 30_000 })
  })
})

test.describe('Sign-out', () => {
  test('sign-out clears session and redirects to /sign-in or marketing', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/profile')
    // Profile sign-out testid is added in the profile page edit; until then,
    // fall back to an accessible button name.
    const signOutBtn = page.locator(byTestId(T.profile.signOut))
      .or(page.getByRole('button', { name: /sign\s*out|log\s*out/i }))
    await expect(signOutBtn.first()).toBeVisible({ timeout: 10_000 })
    await signOutBtn.first().click()
    await page.waitForURL(/\/(sign-in|$)/, { timeout: 10_000 })
    // Cookies + localStorage should be cleared
    const ls = await page.evaluate(() => Object.keys(localStorage))
    const refreshLeak = ls.find((k) => /refresh/i.test(k))
    expect(refreshLeak, `refresh token leaked in localStorage: ${refreshLeak}`).toBeFalsy()
  })
})
