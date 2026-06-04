import { test, expect } from '@playwright/test'
import { byTestId } from '../helpers/selectors.js'
import { PATIENTS } from '../helpers/accounts.js'
import { signInPatient } from '../helpers/auth.js'

/**
 * Handoff 5 Wave C — smoke coverage for Handoff 4 patient-facing copy that
 * previously had NO assertion (existing intake specs click stable testIds and
 * never asserted the changed wording, so the H4 copy shipped uncovered).
 *
 * Asserts the t()-resolved English strings on the surfaces they appear on, plus
 * the two Cross-Handoff-Addendum decisions that are patient-visible:
 *   • Decision 1 — emergency number hardcoded to 911 (sign-in disclaimer)
 *   • Decision 2 — caregivers are email-only (no SMS channel option)
 *
 * Public surfaces (sign-in) need no auth; the caregiver check signs in as a
 * seed patient and opens the add-caregiver form on the profile page.
 */

test.describe('H4 — sign-in disclaimer + privacy (A1/A2, Decision 1)', () => {
  test('medical disclaimer is visible and hardcodes 911', async ({ page }) => {
    await page.goto('/sign-in')
    // A1 — register.medicalDisclaimer
    await expect(
      page.getByText(/not a substitute for medical advice, diagnosis, or treatment/i),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/In an emergency, call 911/i)).toBeVisible()
  })

  test('privacy assurance is visible', async ({ page }) => {
    await page.goto('/sign-in')
    // A2 — register.privacyAssurance
    await expect(
      page.getByText(/Only your care team can see your health data/i),
    ).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('H4 — caregivers are email-only (Decision 2)', () => {
  test('add-caregiver channel select offers no SMS/text option', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/profile')
    const addBtn = page.locator(byTestId('profile-caregiver-add-button'))
    await expect(addBtn).toBeVisible({ timeout: 15_000 })
    await addBtn.click()

    const select = page.locator(byTestId('profile-caregiver-channel-select'))
    await expect(select).toBeVisible()
    // Only Email + "don't notify" — never an SMS/text channel for MVP.
    const optionText = (await select.locator('option').allInnerTexts()).join(' | ')
    expect(optionText).not.toMatch(/SMS|text message/i)
    await expect(select.locator('option')).toHaveCount(2)
  })
})
