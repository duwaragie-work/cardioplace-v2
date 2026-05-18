import { test, expect } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { DEMO_OTP, PATIENTS } from '../helpers/accounts.js'

/**
 * Phase 4l (§L) — localization. LanguageSelector lives in LandingHeader on
 * `/` (§B report: real path is components/cardio/LanguageSelector.tsx, not
 * the doc's intake/ path). Locale persists to localStorage `healplace_locale`.
 */

test.describe('Phase 4l — localization (20l)', () => {
  test('20l.1 — switch to Spanish translates landing copy + persists', async ({
    page,
  }) => {
    await page.goto('/welcome')
    // English baseline (welcome.headline).
    await expect(
      page.getByText(/Your Heart Health, Monitored Between Every Visit/i),
    ).toBeVisible({ timeout: 12_000 })

    await page.locator(byTestId(T.language.button)).first().click()
    await page.locator(byTestId(T.language.option('es'))).first().click()

    // Spanish headline now renders.
    await expect(
      page.getByText(/Tu Salud Cardíaca, Monitoreada Entre Cada Visita/i),
    ).toBeVisible({ timeout: 12_000 })

    // Persisted to localStorage and survives reload.
    const stored = await page.evaluate(() =>
      localStorage.getItem('healplace_locale'),
    )
    expect(stored).toBe('es')
    await page.reload()
    await expect(
      page.getByText(/Tu Salud Cardíaca, Monitoreada Entre Cada Visita/i),
    ).toBeVisible({ timeout: 12_000 })
  })

  test('20l.2 — Amharic locale: OTP sign-in flow still completes', async ({
    page,
  }) => {
    await page.goto('/')
    await page.locator(byTestId(T.language.button)).first().click()
    await page.locator(byTestId(T.language.option('am'))).first().click()
    const stored = await page.evaluate(() =>
      localStorage.getItem('healplace_locale'),
    )
    expect(stored).toBe('am')

    // OTP sign-in must still work despite the non-Latin locale.
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(PATIENTS.aisha.email)
    await page.locator(byTestId(T.signIn.sendOtpBtn)).click()
    await page.locator(byTestId(T.signIn.otpInput)).fill(DEMO_OTP)
    await page.locator(byTestId(T.signIn.verifyBtn)).click()
    await page.waitForURL(/\/(dashboard|onboarding|clinical-intake)/, {
      timeout: 30_000,
    })
  })
})
