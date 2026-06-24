import { test, expect, type Page } from '@playwright/test'
import { newTestControl } from '../helpers/test-control.js'
import { signInPatient, signOutPatient, authedApi } from '../helpers/auth.js'
import {
  addVirtualAuthenticator,
  patientOtpExpectingBiometric,
} from '../helpers/mfa.js'
import { byTestId, T } from '../helpers/selectors.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Spec 67b — patient MFA edge / device-management paths (companion to spec 67).
 * phase/27, Manisha 2026-06-12 Access Control §6.
 *
 * Covers: invalid recovery code, the "X of 10 left" + "set up on this device"
 * confirmation, rename / remove / add-a-second device, regenerating recovery
 * codes from settings, the SUPER_ADMIN biometric reset, and the expired
 * challenge zero-state.
 *
 * Chromium-only (CDP virtual authenticator) + gated behind RUN_WRITE_TESTS.
 */
test.describe('Spec 67b — patient MFA edges & device management', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'registers passkeys + signs patients in')

  const PATIENT = PATIENTS.jane

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

  test.beforeEach(async ({ browserName }) => {
    test.skip(browserName !== 'chromium', 'WebAuthn virtual authenticator is Chromium-only')
    await resetMfaFor(PATIENT.email)
  })

  test.afterEach(async ({ browserName }) => {
    if (browserName !== 'chromium') return
    await resetMfaFor(PATIENT.email)
  })

  /** Register a passkey from Settings; returns the one-time recovery codes. */
  async function registerFromSettings(page: Page): Promise<string[]> {
    await page.goto('/settings')
    await page.locator(byTestId(T.mfa.settingsEnableBiometric)).click()
    const list = page.locator(byTestId(T.mfa.recoveryCodesList))
    await expect(list).toBeVisible({ timeout: 20_000 })
    const codes = (await list.locator('li').allInnerTexts()).map((c) => c.trim())
    expect(codes.length).toBe(10)
    await page.locator(byTestId(T.mfa.recoveryCodesAck)).check()
    await page.locator(byTestId(T.mfa.recoveryCodesContinue)).click()
    await expect(list).toBeHidden({ timeout: 10_000 })
    return codes
  }

  test('67b.1 — an invalid recovery code is rejected', async ({ page }) => {
    test.setTimeout(120_000)
    let auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)
      await auth.remove()
      auth = await addVirtualAuthenticator(page) // empty → ceremony fails

      await signOutPatient(page)
      await patientOtpExpectingBiometric(page, PATIENT.email)
      await page.locator(byTestId(T.mfa.biometricUseRecoveryBtn)).click({ timeout: 30_000 })
      await page.locator(byTestId(T.mfa.biometricRecoveryInput)).fill('ZZZZZ-ZZZZZ')
      await page.locator(byTestId(T.mfa.biometricRecoverySubmit)).click()

      await expect(page.locator('[role="alert"]')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('heading', { name: /enter a recovery code/i })).toBeVisible()
    } finally {
      await auth.remove()
    }
  })

  test('67b.2 — recovery sign-in shows remaining count + "set up this device"', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    let auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      const codes = await registerFromSettings(page)
      await auth.remove()
      auth = await addVirtualAuthenticator(page) // platform, but no credential

      await signOutPatient(page)
      await patientOtpExpectingBiometric(page, PATIENT.email)
      await page.locator(byTestId(T.mfa.biometricUseRecoveryBtn)).click({ timeout: 30_000 })
      await page.locator(byTestId(T.mfa.biometricRecoveryInput)).fill(codes[0])
      await page.locator(byTestId(T.mfa.biometricRecoverySubmit)).click()

      await expect(page.getByRole('heading', { name: /you.?re signed in/i })).toBeVisible({
        timeout: 30_000,
      })
      // One code consumed → 9 remain; device supports biometric → offer setup.
      await expect(page.getByText(/9 of 10 left/i)).toBeVisible()
      await expect(page.locator(byTestId(T.mfa.biometricSetupHere))).toBeVisible()
    } finally {
      await auth.remove()
    }
  })

  test('67b.3 — a registered device can be renamed', async ({ page }) => {
    test.setTimeout(90_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)

      await page.getByRole('button', { name: /rename device/i }).first().click()
      await page.locator(byTestId(T.mfa.settingsRenameInput)).fill('My Test Phone')
      await page.getByRole('button', { name: /save name/i }).click()
      await expect(page.getByText('My Test Phone')).toBeVisible({ timeout: 15_000 })
    } finally {
      await auth.remove()
    }
  })

  test('67b.4 — a registered device can be removed', async ({ page }) => {
    test.setTimeout(90_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)

      await page.getByRole('button', { name: /remove device/i }).first().click()
      // List empties → the first-time setup CTA returns.
      await expect(
        page.getByRole('button', { name: /set up face id \/ fingerprint/i }),
      ).toBeVisible({ timeout: 15_000 })
      await expect(page.getByRole('button', { name: /remove device/i })).toHaveCount(0)
    } finally {
      await auth.remove()
    }
  })

  test('67b.5 — recovery codes can be regenerated from settings', async ({ page }) => {
    test.setTimeout(90_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)

      await page.locator(byTestId(T.mfa.settingsRegenerateCodes)).click()
      const list = page.locator(byTestId(T.mfa.recoveryCodesList))
      await expect(list).toBeVisible({ timeout: 15_000 })
      await expect(list.locator('li')).toHaveCount(10)
    } finally {
      await auth.remove()
    }
  })

  test('67b.6 — a second device can be added (cross-platform)', async ({ page }) => {
    test.setTimeout(120_000)
    const platform = await addVirtualAuthenticator(page)
    let roaming: Awaited<ReturnType<typeof addVirtualAuthenticator>> | null = null
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)
      await expect(page.getByRole('button', { name: /remove device/i })).toHaveCount(1)

      // A roaming authenticator answers the cross-platform ("add another") flow.
      roaming = await addVirtualAuthenticator(page, { transport: 'usb' })
      await page.locator(byTestId(T.mfa.settingsAddAnotherDevice)).click()
      await expect(page.getByRole('button', { name: /remove device/i })).toHaveCount(2, {
        timeout: 30_000,
      })
    } finally {
      if (roaming) await roaming.remove()
      await platform.remove()
    }
  })

  test('67b.7 — a SUPER_ADMIN can reset a patient’s biometric', async ({ page }) => {
    test.setTimeout(120_000)
    const auth = await addVirtualAuthenticator(page)
    try {
      await signInPatient(page, PATIENT.email)
      await registerFromSettings(page)
      const patientId = await (async () => {
        const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
        try {
          return (await tc.findUser(PATIENT.email)).id
        } finally {
          await tc.dispose()
        }
      })()

      await resetMfaFor(ADMINS.support.email)
      const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
      try {
        const res = await api.post(`v2/auth/admin/webauthn/reset/${patientId}`, {
          data: { reason: 'qa e2e — verify biometric reset' },
        })
        expect(
          res.ok(),
          `admin/webauthn/reset failed: ${res.status()} ${await res.text()}`,
        ).toBeTruthy()
      } finally {
        await api.dispose()
      }

      // Biometric gone → plain OTP sign-in lands without a challenge.
      await signOutPatient(page)
      await signInPatient(page, PATIENT.email)
      await expect(page).toHaveURL(/\/(dashboard|onboarding)/, { timeout: 30_000 })
    } finally {
      await auth.remove()
    }
  })

  test('67b.8 — the biometric page with no token shows the expired state', async ({
    page,
  }) => {
    await page.goto('/sign-in/biometric')
    await expect(
      page.getByRole('heading', { name: /your sign-in expired/i }),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible()
  })
})
