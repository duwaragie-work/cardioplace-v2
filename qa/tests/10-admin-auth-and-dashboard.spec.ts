import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Admin app sign-in + dashboard. The admin app is OTP-only (no magic link).
 * Per-role smoke confirms each of the five admin roles can land on
 * /dashboard. PROVIDER restrictions are exercised in the verification specs.
 */

test.describe('Admin app — per-role sign-in', () => {
  for (const [key, account] of Object.entries(ADMINS)) {
    test(`${key} (${account.roles.join(',')}) signs in and lands on /dashboard`, async ({ page }) => {
      await signInAdmin(page, account.email, ADMIN_BASE_URL)
      await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), { timeout: 30_000 })
      // Dashboard always renders the user's name somewhere (greeting / nav)
      await expect(page.locator('body')).toContainText(account.name.split(' ').slice(-1)[0], {
        timeout: 10_000,
      })
    })
  }
})

test.describe('Admin app — patient list', () => {
  test('manisha sees the patient list with seeded archetypes', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    // The 5 seed patients should all surface
    for (const p of Object.values(PATIENTS)) {
      await expect(
        page.getByText(p.name),
        `expected ${p.name} in patient list`,
      ).toBeVisible({ timeout: 15_000 })
    }
  })
})
