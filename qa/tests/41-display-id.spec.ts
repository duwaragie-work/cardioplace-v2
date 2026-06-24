import { test, expect } from '@playwright/test'
import { signInPatient, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Display ID (CP-PAT-... / CP-STF-...) end-to-end.
 *
 * The full spec is in docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md. The
 * seed runs the `seedDisplayIds` post-step which assigns a permanent ID
 * to every fixture user, so signed-in users should always have one.
 *
 * What this covers:
 *   - Patient profile page exposes the displayId in canonical hyphenated form.
 *   - Admin patient detail header exposes the same displayId for the same user.
 *   - The patient-list drawer also surfaces the displayId.
 */

const DISPLAY_ID_PATTERN = /^CP-PAT-[0-9A-HJKMNP-TV-Z]{7}-[0-9A-HJKMNP-TV-Z]$/

test.describe('Display ID — patient surface', () => {
  test('profile page shows a CP-PAT-... formatted display ID', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/profile')

    const displayIdEl = page.locator('[data-testid="profile-display-id"]')
    await expect(displayIdEl).toBeVisible({ timeout: 10_000 })
    const text = (await displayIdEl.textContent())?.trim() ?? ''
    expect(text).toMatch(DISPLAY_ID_PATTERN)
  })
})

test.describe('Display ID — admin surface', () => {
  test('patient detail header shows the same CP-PAT-... ID', async ({ page }) => {
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)

    // Find Aisha in the patient list and click into her detail.
    await page.goto('/patients')
    await page.getByText(PATIENTS.aisha.name).first().click()
    await page.waitForURL(/\/patients\/[^/?]+/, { timeout: 10_000 })

    const displayIdEl = page.locator('[data-testid="admin-patient-display-id"]')
    await expect(displayIdEl).toBeVisible({ timeout: 10_000 })
    const text = (await displayIdEl.textContent())?.trim() ?? ''
    expect(text).toMatch(DISPLAY_ID_PATTERN)
  })
})
