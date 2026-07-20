import { test, expect, type Page, type Browser } from '@playwright/test'
import { POLICY_VERSION } from '@cardioplace/shared'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { byTestId, T } from '../helpers/selectors.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Onboarding fixes A1–A5, end-to-end against the running stack. Guards the
 * fixes proven live in qa/reports/onboarding-fix-proof-*: identity-gated
 * completion (A1), the cross-device re-ask that shows identity only (A2),
 * the removal of the reminders Skip (A3), the route guard (A4), and
 * consent-asked-once (A5).
 *
 * State is reset over HTTP via test-control (NOT `docker exec psql`) so this
 * runs in CI. The subject is the dedicated un-onboarded seed patient
 * (`e2e-onboarding@cardioplace.test`) — every other persona is COMPLETED.
 * "Another device" is a fresh browser context (empty localStorage), which is
 * exactly what the A2/A5 re-ask exercises.
 */

const EMAIL = PATIENTS.e2eOnboarding.email
const TC_SECRET = process.env.TEST_CONTROL_SECRET

// Not serial: each test resets the e2e patient in beforeEach, so they're
// independent. A plain describe lets each guard fail on its own (a serial
// describe would skip the rest after the first failure and mask regressions).
// The suite still runs sequentially — playwright.config sets fullyParallel:
// false and CI runs --workers=1, so there's no same-patient collision.
test.describe('Onboarding A1–A5', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates the e2e-onboarding patient)',
  )

  let tc: TestControl
  let userId: string

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, TC_SECRET)
  })
  test.afterAll(async () => {
    await tc.dispose()
  })

  // Cold un-onboarded state before every test — clears identity, reminder
  // preference, consent, and the policy_acknowledged audit rows.
  test.beforeEach(async () => {
    const res = await tc.resetOnboarding(EMAIL)
    userId = res.userId
  })

  /** Terms/Privacy step → identity step. */
  async function passPrivacy(page: Page): Promise<void> {
    // A decorative <span> overlays the checkbox and intercepts pointer events.
    await page.locator(byTestId(T.onboarding.agreeTerms)).check({ force: true })
    await page.locator(byTestId(T.onboarding.privacyContinueBtn)).click()
    await expect(page.locator(byTestId(T.onboarding.nameInput))).toBeVisible()
  }

  /** Fresh-context sign-in (a "new device"). Caller closes the context. */
  async function signInFreshDevice(browser: Browser) {
    const ctx = await browser.newContext({ timezoneId: 'America/New_York' })
    const page = await ctx.newPage()
    await signInPatient(page, EMAIL)
    return { ctx, page }
  }

  test('A1 — skip identity + Continue reminders stays NOT_COMPLETED', async ({ page }) => {
    await signInPatient(page, EMAIL)
    await expect(page).toHaveURL(/\/onboarding/)
    await passPrivacy(page)

    await page.locator(byTestId(T.onboarding.skipBtn)).click()
    await expect(page.locator(byTestId(T.onboarding.reminderTime))).toBeVisible()
    await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // The regression: a reminder-only pass must NOT complete onboarding.
    const user = await tc.findUser(EMAIL)
    expect(user.onboardingStatus).toBe('NOT_COMPLETED')
  })

  test('A2 — re-ask on a fresh device shows identity only → COMPLETED', async ({ browser }) => {
    // Device 1: consent + reminders, identity skipped → NOT_COMPLETED.
    {
      const { ctx, page } = await signInFreshDevice(browser)
      await passPrivacy(page)
      await page.locator(byTestId(T.onboarding.skipBtn)).click()
      await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
      await ctx.close()
    }
    expect((await tc.findUser(EMAIL)).onboardingStatus).toBe('NOT_COMPLETED')

    // Device 2: reminders already set on device 1, so the reminders step must
    // not reappear — identity only, and completing it onboards the patient.
    const { ctx, page } = await signInFreshDevice(browser)
    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.locator(byTestId(T.onboarding.nameInput))).toBeVisible()
    await expect(page.locator(byTestId(T.onboarding.stepIndicator))).toHaveText(/1 of 1/i)

    await page.locator(byTestId(T.onboarding.nameInput)).fill('E2E Reask')
    await page.locator(byTestId(T.onboarding.submitBtn)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    // Reminders step must not have appeared on the way out.
    await expect(page.locator(byTestId(T.onboarding.reminderTime))).toHaveCount(0)

    expect((await tc.findUser(EMAIL)).onboardingStatus).toBe('COMPLETED')
    await ctx.close()
  })

  test('A3 — reminders step has no Skip (Continue/Back only)', async ({ page }) => {
    await signInPatient(page, EMAIL)
    await passPrivacy(page)
    await page.locator(byTestId(T.onboarding.skipBtn)).click()
    await expect(page.locator(byTestId(T.onboarding.reminderTime))).toBeVisible()

    // Continue + Back present; no Skip on the reminders step.
    await expect(page.locator(byTestId(T.onboarding.remindersSubmitBtn))).toBeVisible()
    await expect(page.locator(byTestId(T.onboarding.remindersBackBtn))).toBeVisible()
    await expect(page.locator(byTestId('onboarding-reminders-skip-btn'))).toHaveCount(0)
  })

  test('A4 — protected routes redirect an un-onboarded patient to /onboarding', async ({ page }) => {
    await signInPatient(page, EMAIL)
    await expect(page).toHaveURL(/\/onboarding/)

    for (const route of ['/dashboard', '/check-in', '/readings']) {
      await page.goto(route)
      await expect(page, `${route} should be gated`).toHaveURL(/\/onboarding/, {
        timeout: 15_000,
      })
    }
    // State unchanged — a pure UX gate, not a mutation.
    expect((await tc.findUser(EMAIL)).onboardingStatus).toBe('NOT_COMPLETED')
  })

  test('A4 — device-skipped patient reaches the dashboard (no redirect loop)', async ({ page }) => {
    await signInPatient(page, EMAIL)
    await passPrivacy(page)
    await page.locator(byTestId(T.onboarding.skipBtn)).click()
    await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // Skipping set the device flag → the guard must honour it via the cookie.
    await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
  })

  test('A5 — consent is asked once: no re-ask, no duplicate audit row', async ({ browser }) => {
    expect((await tc.countPolicyAck(userId)).count).toBe(0)

    // Device 1: give consent (privacy step), skip identity, set reminders.
    {
      const { ctx, page } = await signInFreshDevice(browser)
      await passPrivacy(page)
      await page.locator(byTestId(T.onboarding.skipBtn)).click()
      await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
      await ctx.close()
    }
    // Consent recorded exactly once, and the column mirror is set.
    expect((await tc.countPolicyAck(userId)).count).toBe(1)

    // Device 2: consent already given for the current version → NO privacy step.
    const { ctx, page } = await signInFreshDevice(browser)
    await expect(page.locator(byTestId(T.onboarding.nameInput))).toBeVisible()
    await expect(page.locator(byTestId(T.onboarding.agreeTerms))).toHaveCount(0)

    await page.locator(byTestId(T.onboarding.nameInput)).fill('E2E Consented')
    await page.locator(byTestId(T.onboarding.submitBtn)).click()
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await ctx.close()

    // The whole point of A5: the re-ask wrote no second consent row.
    expect((await tc.countPolicyAck(userId)).count).toBe(1)
  })

  test('A5 — a stale acknowledged version re-shows the privacy step', async ({ browser }) => {
    // Consent to the CURRENT version on device 1.
    {
      const { ctx, page } = await signInFreshDevice(browser)
      await passPrivacy(page)
      await page.locator(byTestId(T.onboarding.skipBtn)).click()
      await page.locator(byTestId(T.onboarding.remindersSubmitBtn)).click()
      await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
      await ctx.close()
    }

    // Control: a fresh device with the CURRENT stored version skips privacy.
    {
      const { ctx, page } = await signInFreshDevice(browser)
      await expect(page.locator(byTestId(T.onboarding.nameInput))).toBeVisible()
      await expect(page.locator(byTestId(T.onboarding.agreeTerms))).toHaveCount(0)
      await ctx.close()
    }

    // Version-aware: simulate a POLICY_VERSION bump by rolling the stored
    // acknowledged version back to a stale (non-null) value. A fresh device
    // must now re-show the privacy step because stored !== current.
    expect(POLICY_VERSION).not.toBe('2000-01-01')
    await tc.setPolicyAckVersion(EMAIL, '2000-01-01')
    const { ctx, page } = await signInFreshDevice(browser)
    await expect(page).toHaveURL(/\/onboarding/)
    await expect(page.locator(byTestId(T.onboarding.agreeTerms))).toBeVisible()
    await ctx.close()
  })
})

/**
 * Layer A journaling gate — a patient with a PatientProfile can POST a reading
 * (control case). Kept as the orthogonal clinical-intake gate check; the
 * onboarding fixes above are identity-only and do not touch it.
 */
test.describe('Layer A journaling gate', () => {
  test('seed patient with profile can POST /daily-journal (control case)', async () => {
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
      },
    })
    expect(res.status(), `aisha control reading: ${await res.text()}`).toBe(202)
    await api.dispose()
  })
})
