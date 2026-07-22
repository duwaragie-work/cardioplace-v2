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

  /**
   * Onboarding opens on a privacy/trust step (V2-E Gap 7) that gates the
   * profile form behind a Terms+Privacy consent. Click through it so the
   * `#onboarding-name` field becomes reachable. No-ops when the privacy step is
   * skipped (A5: an already-consented patient lands straight on identity).
   */
  async function advancePastPrivacyStep(page: Page): Promise<void> {
    const cont = page.locator(byTestId(T.onboarding.privacyContinueBtn))
    const name = page.locator('#onboarding-name')
    // A5 added a brief loading spinner (the page fetches reminder + consent
    // flags before deciding which step to show), so the privacy step renders
    // asynchronously. Wait for the page to settle onto EITHER step before
    // deciding — a plain isVisible() check races the spinner and no-ops.
    await expect(cont.or(name).first()).toBeVisible({ timeout: 20_000 })
    if (await cont.isVisible()) {
      // The consent checkbox (16px) sits under an absolutely-positioned 44px
      // tap-target <span> overlay, which intercepts a normal check()'s click at
      // the input's center → the box never toggles and Continue stays disabled.
      // Force the check so the click lands on the real <input> and fires its
      // onChange (agreedToTerms=true), then wait for Continue to enable.
      await page.locator(byTestId(T.onboarding.agreeTerms)).check({ force: true })
      await expect(cont).toBeEnabled({ timeout: 10_000 })
      await cont.click()
      await expect(name).toBeVisible({ timeout: 10_000 })
    }
  }

  test('20a.1 — new user (onboardingStatus≠COMPLETED) lands on /onboarding', async ({
    page,
  }) => {
    // Full cold reset (not just setOnboardingStatus): under A2/A5 the reminder
    // + consent columns also drive step routing, and the seed's `update:{}`
    // never resets them on the shared Taylor persona. resetOnboarding clears
    // them (name too — 20g uses Taylor by email/profile, not name).
    await tc.resetOnboarding(PATIENTS.taylor.email)
    await otpSignIn(page, PATIENTS.taylor.email)
    // Fresh browser context → no `healplace_onboarding_skipped_*` flag, so
    // shouldShowOnboardingForUser() returns true for a NOT_COMPLETED user.
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })
    await expect(page).toHaveURL(/\/onboarding/)
    await advancePastPrivacyStep(page)
    await expect(page.locator('#onboarding-name')).toBeVisible({ timeout: 10_000 })
  })

  test('20a.2 — onboarding completion leaves /onboarding + flips status', async ({
    page,
  }) => {
    await tc.resetOnboarding(PATIENTS.taylor.email)
    await otpSignIn(page, PATIENTS.taylor.email)
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })
    await advancePastPrivacyStep(page)
    await page.locator('#onboarding-name').fill('Taylor Brown')
    // Onboarding is now two steps. Step 1 Continue advances to the reminders
    // step (it must NOT reach the dashboard yet) — assert we land there, then
    // finish via the reminders-step Continue.
    await page.locator(byTestId(T.onboarding.submitBtn)).click()
    await expect(
      page.locator(byTestId(T.onboarding.remindersSubmitBtn)),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page).toHaveURL(/\/onboarding/)
    await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
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

  // ─── Privacy-trust consent step (commit b7ccc8b, V2-E Gap 7) ──────────────
  test('20a.6 — privacy-trust step shows FIRST and gates the name form', async ({
    page,
  }) => {
    // Full cold reset: A5 skips the privacy step for a consented patient, so
    // reset clears consent (and reminder state) to keep this idempotent.
    await tc.resetOnboarding(PATIENTS.taylor.email)
    await otpSignIn(page, PATIENTS.taylor.email)
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 })

    // The consent step renders before the profile form: the agree-terms
    // control + Continue button are present, the name field is NOT yet.
    const agree = page.locator(byTestId(T.onboarding.agreeTerms))
    const cont = page.locator(byTestId(T.onboarding.privacyContinueBtn))
    await expect(agree).toBeVisible({ timeout: 15_000 })
    await expect(cont).toBeVisible()
    await expect(page.locator('#onboarding-name')).toHaveCount(0)

    // Continue is disabled until terms are accepted (the 16px box hides under a
    // 44px tap overlay → force the check; see advancePastPrivacyStep).
    await expect(cont).toBeDisabled()
    await agree.check({ force: true })
    await expect(cont).toBeEnabled({ timeout: 10_000 })
    await cont.click()

    // Accepting advances to the profile (name) form.
    await expect(page.locator('#onboarding-name')).toBeVisible({ timeout: 10_000 })
  })

  // ─── Two-step onboarding: identity (step 1) → reminders (step 2) ──────────

  // 20a.7 (skip-both leaves NOT_COMPLETED, via a reminders Skip) and 20a.8
  // (reminder-only → COMPLETED) were removed: both asserted the pre-fix
  // behavior (the reminders Skip is gone per A3, and reminder-only no longer
  // completes onboarding per A1). Their replacements — identity-gated
  // completion, the no-Skip reminders step, the re-ask, and the route guard —
  // live in 03-onboarding-and-layer-a-gate.spec.ts (A1–A5), which drives the
  // dedicated un-onboarded `e2e-onboarding` patient and resets it over HTTP so
  // it stays idempotent (unlike mutating the shared Taylor persona here).
})
