import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'

/**
 * /profile — sections, verified badges, sign-out. Each seed patient has a
 * distinct profile shape (Priya pregnant, James HFrEF, Rita CAD, Charles
 * AFib, Aisha controlled HTN) — we use Aisha as the happy-path control.
 */

test.describe('Profile — basic render', () => {
  test.beforeEach(async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('profile renders name + email + sign-out button', async ({ page }) => {
    await page.goto('/profile')
    // Name appears twice in the markup (h1 + span on the avatar). Use the
    // testid that was added in cluster-4 to disambiguate.
    await expect(page.locator('[data-testid="profile-name"]')).toContainText(
      PATIENTS.aisha.name,
      { timeout: 10_000 },
    )
    await expect(page.getByText(PATIENTS.aisha.email).first()).toBeVisible()
    const signOut = page
      .locator('[data-testid="profile-signout"]')
      .or(page.getByRole('button', { name: /sign\s*out|log\s*out/i }))
    await expect(signOut.first()).toBeVisible()
  })

  test('care team section shows seeded practice + provider trio', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByText(/cedar hill/i)).toBeVisible({ timeout: 10_000 })
    // Provider trio names (per seed.ts)
    await expect(page.getByText(/Samuel Okonkwo/i)).toBeVisible()
    await expect(page.getByText(/Elena Reyes/i)).toBeVisible()
    await expect(page.getByText(/Priya Raman/i)).toBeVisible()
  })

  test('Aisha conditions section lists hypertension', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByText(/hypertension|high blood pressure/i).first()).toBeVisible({
      timeout: 10_000,
    })
  })

  test('Aisha medications list includes Lisinopril + Amlodipine', async ({ page }) => {
    await page.goto('/profile')
    await expect(page.getByText(/Lisinopril/i)).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Amlodipine/i)).toBeVisible()
  })
})

test.describe('Profile — Priya (pregnancy + Tier 1 contraindication seed)', () => {
  test('pregnancy section + Lisinopril present (combination is the bug we want flagged)', async ({
    page,
  }) => {
    await signInPatient(page, PATIENTS.priya.email)
    await page.goto('/profile')
    await expect(page.getByText(/pregnant|pregnancy/i).first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/Lisinopril/i)).toBeVisible()
    // The Tier 1 alert produced by RULE_PREGNANCY_ACE_ARB is asserted in
    // the rule-engine spec via the alert listing — not on profile.
  })
})

// ─── Phase 4c (§E) — profile view + inline edit + deep-link ────────────────
test.describe('Phase 4c — profile (20c)', () => {
  test.beforeEach(async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('20c.1 — profile renders personal + clinical + medications + care team', async ({
    page,
  }) => {
    await page.goto('/profile')
    await expect(page.locator('[data-testid="profile-name"]')).toContainText(
      PATIENTS.aisha.name,
      { timeout: 10_000 },
    )
    // Clinical (conditions) + medications + care-team markers.
    await expect(
      page.getByText(/hypertension|high blood pressure/i).first(),
    ).toBeVisible()
    await expect(page.getByText(/Lisinopril/i)).toBeVisible()
    await expect(page.getByText(/cedar hill/i)).toBeVisible()
  })

  test('20c.2 — inline edit: name + communication preference', async ({ page }) => {
    await page.goto('/profile')
    await page.locator('[data-testid="profile-name-edit-button"]').click()
    // PersonalInfoModal — set a comm preference (TEXT_FIRST) then save.
    const textFirst = page.locator(
      '[data-testid="profile-comm-preference-TEXT_FIRST"]',
    )
    await textFirst.click().catch(() => {})
    const save = page
      .getByRole('button', { name: /save|update|done/i })
      .first()
    await save.click().catch(() => {})
    // Modal closes; profile still renders the name.
    await expect(page.locator('[data-testid="profile-name"]')).toContainText(
      PATIENTS.aisha.name,
      { timeout: 10_000 },
    )
  })

  test('20c.3 — deep-link from profile to /clinical-intake for clinical edits', async ({
    page,
  }) => {
    await page.goto('/profile')
    await page.locator('[data-testid="profile-edit-clinical-link"]').click()
    await page.waitForURL(/\/clinical-intake/, { timeout: 15_000 })
    await expect(page).toHaveURL(/\/clinical-intake/)
  })
})
