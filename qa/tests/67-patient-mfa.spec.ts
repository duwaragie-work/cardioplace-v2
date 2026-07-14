import { test, expect } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { signInPatient, signOutPatient } from '../helpers/auth.js'
import {
  addVirtualAuthenticator,
  patientOtpExpectingBiometric,
} from '../helpers/mfa.js'
import { byTestId, T } from '../helpers/selectors.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Spec 67 — patient MFA (WebAuthn biometric + recovery codes).
 * phase/27, Manisha 2026-06-12 Access Control §6.
 *
 * The patient second factor is Face ID / fingerprint (WebAuthn). We drive it
 * with Chromium's CDP virtual authenticator (helpers/mfa.ts), which answers the
 * register + authenticate ceremonies with user-verification pre-satisfied —
 * so these are Chromium-only and skip on firefox/webkit.
 *
 * State hygiene: each test resets the patient's MFA footprint (WebAuthn
 * credentials + recovery codes) before and after, so a registered passkey never
 * leaks into the plain OTP auth specs that share this seed patient.
 *
 * Gated behind RUN_WRITE_TESTS — these register passkeys + sign accounts in.
 */
test.describe('Spec 67 — patient MFA (WebAuthn)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'registers passkeys + signs patients in')

  const PATIENT = PATIENTS.jane

  test.beforeEach(async ({ browserName }) => {
    test.skip(
      browserName !== 'chromium',
      'WebAuthn virtual authenticator is Chromium-only',
    )
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { id } = await tc.findUser(PATIENT.email)
      await tc.resetUserMfa(id)
    } finally {
      await tc.dispose()
    }
  })

  test.afterEach(async ({ browserName }) => {
    if (browserName !== 'chromium') return
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { id } = await tc.findUser(PATIENT.email)
      await tc.resetUserMfa(id)
    } finally {
      await tc.dispose()
    }
  })

  /** Register a passkey from Settings; returns the one-time recovery codes the
   *  first-device flow reveals. Leaves a real WebAuthn credential in the DB. */
  async function registerBiometricFromSettings(page: import('@playwright/test').Page): Promise<string[]> {
    await page.goto('/settings')
    await page.locator('[data-testid="settings-enable-biometric"]').click()
    const list = page.locator(byTestId(T.mfa.recoveryCodesList))
    await expect(list).toBeVisible({ timeout: 20_000 })
    const codes = (await list.locator('li').allInnerTexts()).map((c) => c.trim())
    expect(codes.length).toBe(10)
    await page.locator(byTestId(T.mfa.recoveryCodesAck)).check()
    await page.locator(byTestId(T.mfa.recoveryCodesContinue)).click()
    return codes
  }

  test('67.1 — registering Face ID / fingerprint reveals 10 recovery codes', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      const codes = await registerBiometricFromSettings(page)
      expect(codes.every((c) => c.length >= 8)).toBeTruthy()
      // Panel dismisses once acknowledged.
      await expect(page.locator(byTestId(T.mfa.recoveryCodesList))).toBeHidden({
        timeout: 10_000,
      })
    } finally {
      await auth.remove()
    }
  })

  test('67.2 — an enrolled patient signs in with the biometric prompt', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerBiometricFromSettings(page)

      // Fresh sign-in: OTP first factor now routes to the biometric page,
      // which auto-prompts and the virtual authenticator answers.
      await signOutPatient(page)
      await patientOtpExpectingBiometric(page, PATIENT.email)
      await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 })
    } finally {
      await auth.remove()
    }
  })

  test('67.3 — recovery code is the fallback when biometric can’t run', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    let auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      const codes = await registerBiometricFromSettings(page)

      // Swap in a fresh, EMPTY authenticator — it can't satisfy the assertion
      // (the registered credential isn't on it), so the ceremony fails and the
      // page falls back to the recovery-code path (the "desktop without the
      // passkey" case).
      await auth.remove()
      auth = await addVirtualAuthenticator(page)

      await signOutPatient(page)
      await patientOtpExpectingBiometric(page, PATIENT.email)

      // Auto-prompt fails → the recovery-code fallback button appears.
      await page.locator(byTestId(T.mfa.biometricUseRecoveryBtn)).click({ timeout: 30_000 })
      await page.locator(byTestId(T.mfa.biometricRecoveryInput)).fill(codes[0])
      await page.locator(byTestId(T.mfa.biometricRecoverySubmit)).click()

      // Lands on the "used a recovery code / you're signed in" confirmation.
      await expect(
        page.getByRole('heading', { name: /you.?re signed in/i }),
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await auth.remove()
    }
  })
})
