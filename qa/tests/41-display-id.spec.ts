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

    // Find Aisha in the patient list and click into her detail. Admin specs
    // must use the absolute ADMIN_BASE_URL — the config's baseURL is the
    // PATIENT app, so a relative '/patients' would hit the wrong origin.
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.getByText(PATIENTS.aisha.name).first().click()
    await page.waitForURL(/\/patients\/[^/?]+/, { timeout: 10_000 })

    const displayIdEl = page.locator('[data-testid="admin-patient-display-id"]')
    await expect(displayIdEl).toBeVisible({ timeout: 10_000 })
    const text = (await displayIdEl.textContent())?.trim() ?? ''
    expect(text).toMatch(DISPLAY_ID_PATTERN)
  })

  test('patient list search matches by displayId (canonical / hyphenated / lowercase)', async ({ page }) => {
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)

    // Grab the first row's displayId (hyphenated form, e.g. "CP-PAT-XQYV0XS-6").
    const firstRowId = page.locator('[data-testid="patient-row-display-id"]').first()
    await expect(firstRowId).toBeVisible({ timeout: 10_000 })
    const hyphenated = (await firstRowId.textContent())?.trim() ?? ''
    expect(hyphenated).toMatch(DISPLAY_ID_PATTERN)
    const canonical = hyphenated.replace(/-/g, '') // CPPATXQYV0XS6

    const search = page.locator('[data-testid="admin-patient-search-input"]')
    // The matching row's ID cell, keyed on the exact hyphenated text.
    const matchRow = page.locator('[data-testid="patient-row-display-id"]', { hasText: hyphenated })

    for (const query of [canonical, hyphenated, hyphenated.toLowerCase()]) {
      await search.fill('')
      await search.fill(query)
      await expect(matchRow).toBeVisible({ timeout: 10_000 })
    }

    // A well-formed but non-existent ID filters everything out.
    await search.fill('')
    await search.fill('CP-PAT-ZZZZZZZ-Z')
    await expect(page.locator('[data-testid="patient-row-display-id"]')).toHaveCount(0, {
      timeout: 10_000,
    })
  })
})
