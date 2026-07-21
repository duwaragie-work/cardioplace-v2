import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Part A (PHI audit §1 / V-11) — credentials + PII must never appear in a URL
 * (they land in CloudFront/S3 access logs, browser history, and Referer once the
 * app is static-hosted). This walks a real patient session and asserts no
 * access/refresh token, email, or name shows up in any navigated URL — plus the
 * A4 "Need help?" prefill carries the email via sessionStorage, not `?email=`.
 */

// Substrings that must never appear in a URL. `@` catches an email address in
// any param; the token names catch the old magic-link/callback query handoff.
const FORBIDDEN_URL_SUBSTRINGS = [
  'access_token',
  'refresh_token',
  'accessToken',
  'refreshToken',
  '&email=',
  '?email=',
  '&name=',
  '?name=',
  '@', // any raw email address in the URL
]

test.describe('Part A — no credentials/PII in URLs', () => {
  test('no token/email/name in any URL across a patient session', async ({ page }) => {
    const urls: string[] = []
    page.on('framenavigated', (f) => {
      if (f === page.mainFrame()) urls.push(f.url())
    })

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/dashboard')
    await page.goto('/readings')
    await page.goto('/notifications')
    await page.goto('/profile')

    expect(urls.length, 'captured at least one navigation').toBeGreaterThan(0)
    for (const u of urls) {
      const path = u.replace(/^https?:\/\/[^/]+/, '') // strip origin (host is fine)
      for (const bad of FORBIDDEN_URL_SUBSTRINGS) {
        expect(
          path.includes(bad),
          `credential/PII "${bad}" found in URL: ${path}`,
        ).toBe(false)
      }
    }
  })

  test('A4 — "Need help?" prefill uses sessionStorage, not ?email=', async ({ page }) => {
    const email = PATIENTS.aisha.email
    await page.goto('/sign-in')
    await page.locator(byTestId(T.signIn.otpTab)).click().catch(() => {})
    await page.locator(byTestId(T.signIn.emailInput)).fill(email)

    // The support/"Need help?" link must NOT carry the email in the URL.
    await page.getByTestId('signin-need-help').click()
    await page.waitForURL(/\/support\/locked-out/, { timeout: 20_000 })
    expect(page.url(), 'email must not be in the URL').not.toContain('email=')
    expect(page.url()).not.toContain('@')

    // …but the email IS still prefilled on the target page (via sessionStorage).
    await expect(page.getByTestId('locked-out-email')).toHaveValue(email, {
      timeout: 10_000,
    })
  })
})
