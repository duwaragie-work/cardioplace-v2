import { test, expect, type Page } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { DEMO_OTP, PATIENTS } from '../helpers/accounts.js'
import { signInPatient, signOutPatient } from '../helpers/auth.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase 4a (§C) — auth + onboarding + Layer A gate.
 *
 * Seed personas are all onboardingStatus=COMPLETED + ENROLLED, so the
 * new-user paths use the Phase 4 `tc.setOnboardingStatus` endpoint to roll
 * Taylor back to NOT_COMPLETED, then restore COMPLETED in afterAll so the
 * shared baseline stays intact for other specs.
 *
 * Selector note (§B report): the doc's idealised testids don't match the
 * codebase; we use the real `selectors.ts` T registry. The /onboarding page
 * has no data-testids, so it's asserted via its `#onboarding-name` field +
 * URL transitions.
 */

test.describe('Phase 4a — patient auth + onboarding', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')

  let tc: TestControl
  let taylorId: string

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    taylorId = (await tc.findUser(PATIENTS.taylor.email)).id
  })

  test.afterAll(async () => {
    // Restore the shared baseline.
    await tc?.setOnboardingStatus(taylorId, 'COMPLETED').catch(() => {})
    await tc?.dispose()
  })

  /** Inline OTP sign-in (mirrors spec 02) so we can assert the exact landing. */
  async function otpSignIn(page: Page, email: string): Promise<void> {
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(email)
    await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
    await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
    await page.locator(byTestId(T.signIn.verifyBtn)).click()
  }

  test('20a.1 — new user (onboardingStatus≠COMPLETED) lands on /onboarding', async ({
    page,
  }) => {
    await tc.setOnboardingStatus(taylorId, 'NOT_COMPLETED')
    await otpSignIn(page, PATIENTS.taylor.email)
    // Fresh browser context → no `healplace_onboarding_skipped_*` flag, so
    // shouldShowOnboardingForUser() returns true for a NOT_COMPLETED user.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })
    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.locator('#onboarding-name')).toBeVisible({ timeout: 10_000 })
  })

  test('20a.2 — onboarding completion leaves /onboarding + flips status', async ({
    page,
  }) => {
    await tc.setOnboardingStatus(taylorId, 'NOT_COMPLETED')
    await otpSignIn(page, PATIENTS.taylor.email)
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })
    await page.locator('#onboarding-name').fill('Taylor Brown')
    // Use the real submit testid (v3.1) — the prior getByRole name-regex was
    // i18n/CI-fragile. handleContinue → submitProfile → router.push.
    await page.locator(byTestId(T.onboarding.submitBtn)).click()
    // Contract of "onboarding completion": (a) the patient leaves the
    // /onboarding page into the authenticated app, and (b) onboardingStatus
    // is COMPLETED server-side. The exact landing differs by build/gate
    // (CI prod `next start` may route /dashboard → an enrollment/intake
    // interstitial); asserting "off /onboarding into the app + status
    // flipped" is the robust, meaningful invariant.
    await page.waitForURL(
      /\/(dashboard|clinical-intake|welcome|home)(\?.*)?$/,
      { timeout: 30_000 },
    )
    await expect(page).not.toHaveURL(/\/onboarding/)
    await expect
      .poll(
        async () =>
          (await tc.findUser(PATIENTS.taylor.email)).onboardingStatus,
        { timeout: 12_000 },
      )
      .toBe('COMPLETED')
  })

  test('20a.3 — Layer A gate: incomplete onboarding blocks /check-in', async ({
    page,
  }) => {
    await tc.setOnboardingStatus(taylorId, 'NOT_COMPLETED')
    await otpSignIn(page, PATIENTS.taylor.email)
    await page.waitForURL(/\/(onboarding|dashboard|clinical-intake)/, {
      timeout: 30_000,
    })
    // Direct-navigate to the journaling surface. The Layer A gate must keep
    // a not-yet-onboarded patient out of a usable check-in: either redirect
    // away or render the "complete clinical intake" interstitial (no BP
    // input). Assert the functional reading input is NOT reachable.
    await page.goto('/check-in')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(1500)
    const onCheckinForm =
      /\/check-in/.test(page.url()) &&
      (await page
        .locator(byTestId(T.checkin.systolic))
        .isVisible()
        .catch(() => false))
    expect(
      onCheckinForm,
      'incomplete-onboarding user must not reach a usable /check-in form',
    ).toBe(false)
  })

  test('20a.4 — sign-out clears patient session cookies + returns to landing', async ({
    page,
    context,
  }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await expect(page).toHaveURL(/\/(dashboard|onboarding|clinical-intake)/)
    await signOutPatient(page)
    await expect(page).toHaveURL(/\/(sign-in|$)|\/$/, { timeout: 15_000 })
    const cookieNames = (await context.cookies()).map((c) => c.name)
    expect(
      cookieNames.includes('cp_patient_refresh_token'),
      'cp_patient_refresh_token cleared',
    ).toBe(false)
    expect(
      cookieNames.includes('cp_patient_auth_marker'),
      'cp_patient_auth_marker cleared',
    ).toBe(false)
  })

  test('20a.5 — returning user (onboardingStatus=COMPLETED) skips onboarding', async ({
    page,
  }) => {
    // Aisha is a baseline COMPLETED + ENROLLED + intake-done persona.
    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(page).not.toHaveURL(/\/onboarding/)
  })
})
