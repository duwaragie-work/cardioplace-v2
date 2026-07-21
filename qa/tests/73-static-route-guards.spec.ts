import { test, expect, type Page } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { DEMO_OTP, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * B2 — route-guard behaviour.
 *
 * proxy.ts (server-side, standalone) and the new client-side RouteGuard
 * (static export) must enforce the SAME gates. This suite asserts the
 * behaviour, so it holds whichever layer runs it — and specifically covers the
 * `cp_patient_onboarded` gate that B2 had to preserve when moving client-side.
 */

test.describe('B2 — auth + onboarding route guards', () => {
  test('unauthenticated navigation to a protected route → /sign-in', async ({
    page,
  }) => {
    // Fresh context, no session cookies. Typing a protected URL must bounce.
    await page.goto('/dashboard')
    await page.waitForURL(/\/sign-in/, { timeout: 20_000 })
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('unauthenticated navigation to /readings → /sign-in', async ({ page }) => {
    await page.goto('/readings')
    await page.waitForURL(/\/sign-in/, { timeout: 20_000 })
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test.describe('un-onboarded patient is held on /onboarding', () => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')

    let tc: TestControl
    let taylorId: string

    test.beforeAll(async () => {
      tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      taylorId = (await tc.findUser(PATIENTS.taylor.email)).id
    })
    test.afterAll(async () => {
      // Restore the shared baseline for other specs.
      await tc?.setOnboardingStatus(taylorId, 'COMPLETED').catch(() => {})
      await tc?.dispose()
    })

    async function otpSignIn(page: Page, email: string): Promise<void> {
      await page.goto('/sign-in')
      await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
      await page.locator(byTestId(T.signIn.emailInput)).fill(email)
      await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
      await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP, { timeout: 60_000 })
      await page.locator(byTestId(T.signIn.verifyBtn)).click()
    }

    test('typing a gated route while un-onboarded → /onboarding', async ({ page }) => {
      await tc.setOnboardingStatus(taylorId, 'NOT_COMPLETED')
      await otpSignIn(page, PATIENTS.taylor.email)
      // Lands on /onboarding after sign-in.
      await page.waitForURL(/\/onboarding/, { timeout: 60_000 })

      // The gate must also hold when the patient tries to jump straight to a
      // gated surface — the guard bounces them back to /onboarding, never into
      // the app (this is the cp_patient_onboarded check B2 preserved).
      await page.goto('/check-in')
      await page.waitForURL(/\/onboarding/, { timeout: 20_000 })
      await expect(page).toHaveURL(/\/onboarding/)
    })
  })
})
