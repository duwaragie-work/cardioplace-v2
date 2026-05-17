import { test, expect } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { DEMO_OTP, PATIENTS, ADMINS } from '../helpers/accounts.js'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { ADMIN_BASE_URL, PATIENT_BASE_URL } from '../playwright.config.js'

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

test.describe('Cookie pollution (app-scoped cookie names)', () => {
  // Same-browser localhost:3000 (patient) + localhost:3001 (admin) shared the
  // `localhost` cookie host (browsers don't scope by port) so signing into
  // one app contaminated the other. Fix: app-scoped names cp_patient_* /
  // cp_admin_* (backend deriveCookieScope/scopeForRoles + per-app
  // cookie-names.ts). These spin up real sessions → gated behind
  // RUN_WRITE_TESTS like other state-mutating specs.

  test('admin sign-in does NOT pollute the patient session in the same browser', async ({ browser }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write test — gated behind RUN_WRITE_TESTS')
    const context = await browser.newContext()
    try {
      const adminPage = await context.newPage()
      await signInAdmin(adminPage, ADMINS.manisha.email, ADMIN_BASE_URL)
      await expect(adminPage).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), {
        timeout: 30_000,
      })

      // Admin-scoped cookies set; patient-scoped cookies must be absent.
      const names = (await context.cookies()).map((c) => c.name)
      expect(names, 'cp_admin_refresh_token set').toContain('cp_admin_refresh_token')
      expect(
        names.includes('cp_admin_auth_marker'),
        'cp_admin_auth_marker set',
      ).toBe(true)
      expect(
        names.includes('cp_patient_auth_marker'),
        'cp_patient_auth_marker NOT set',
      ).toBe(false)
      expect(
        names.includes('cp_patient_refresh_token'),
        'cp_patient_refresh_token NOT set',
      ).toBe(false)

      // A patient tab in the same context must NOT inherit the admin session:
      // proxy.ts sees no cp_patient_auth_marker → /sign-in, and the mount-time
      // rehydrate finds no cp_patient_refresh_token so it can't borrow admin's.
      const patientPage = await context.newPage()
      await patientPage.goto(`${PATIENT_BASE_URL}/dashboard`)
      await patientPage.waitForURL(/\/sign-in/, { timeout: 15_000 })
      await expect(
        patientPage.locator(byTestId(T.signIn.emailInput)),
      ).toBeVisible({ timeout: 10_000 })
    } finally {
      await context.close()
    }
  })

  test('patient sign-out leaves a concurrent admin session intact', async ({ browser }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write test — gated behind RUN_WRITE_TESTS')
    const context = await browser.newContext()
    try {
      // Admin signs in (tab A).
      const adminPage = await context.newPage()
      await signInAdmin(adminPage, ADMINS.manisha.email, ADMIN_BASE_URL)
      await expect(adminPage).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), {
        timeout: 30_000,
      })

      // Patient signs in (tab B) — pure-patient account, no admin bridge.
      const patientPage = await context.newPage()
      await signInPatient(patientPage, PATIENTS.aisha.email)

      // Patient signs out — backend logout derives 'patient' scope from the
      // Origin and clears ONLY cp_patient_* (+ legacy), never cp_admin_*.
      await patientPage.goto('/profile')
      const signOutBtn = patientPage
        .locator(byTestId(T.profile.signOut))
        .or(patientPage.getByRole('button', { name: /sign\s*out|log\s*out/i }))
      await expect(signOutBtn.first()).toBeVisible({ timeout: 10_000 })
      await signOutBtn.first().click()
      await patientPage.waitForURL(/\/(sign-in|$)/, { timeout: 15_000 })

      // Admin session survives: reloading the admin dashboard stays put
      // (rehydrate still finds cp_admin_refresh_token, not revoked).
      await adminPage.goto(`${ADMIN_BASE_URL}/dashboard`)
      await expect(adminPage).toHaveURL(
        new RegExp(`${ADMIN_BASE_URL}/dashboard`),
        { timeout: 20_000 },
      )
      const names = (await context.cookies()).map((c) => c.name)
      expect(
        names.includes('cp_admin_auth_marker'),
        'admin marker survived patient logout',
      ).toBe(true)
    } finally {
      await context.close()
    }
  })
})

test.describe('Sign-in keyboard a11y (WCAG 2.1.1)', () => {
  // Sign-in forms previously responded only to mouse clicks. Enter on the
  // email / OTP fields now submits the active flow (onKeyDown handlers in
  // patient + admin sign-in pages). The pilot cohort skews older and many
  // navigate by keyboard.

  test('Enter on patient email field triggers Send OTP', async ({ page }) => {
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.emailInput)).press('Enter')
    // OTP field renders only after a successful send — i18n-independent.
    await expect(page.locator(byTestId(T.signIn.otpInput))).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Enter on admin email field triggers Send OTP', async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/sign-in`)
    await page.locator(byTestId(T.admin.signInEmail)).fill(ADMINS.manisha.email)
    await page.locator(byTestId(T.admin.signInEmail)).press('Enter')
    await expect(page.locator(byTestId(T.admin.signInOtp))).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Enter on patient OTP field triggers Continue', async ({ page }) => {
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
    await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
    await page.locator(byTestId(T.signIn.otpInput)).press('Enter')
    await page.waitForURL(/\/(dashboard|onboarding|clinical-intake)(\?.*)?$/, {
      timeout: 30_000,
    })
  })

  test('Enter on admin OTP field triggers Continue', async ({ page }) => {
    await page.goto(`${ADMIN_BASE_URL}/sign-in`)
    await page.locator(byTestId(T.admin.signInEmail)).fill(ADMINS.manisha.email)
    await page.locator(byTestId(T.admin.signInSendOtp)).click()
    await page.locator(byTestId(T.admin.signInOtp)).fill(DEMO_OTP)
    await page.locator(byTestId(T.admin.signInOtp)).press('Enter')
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
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
