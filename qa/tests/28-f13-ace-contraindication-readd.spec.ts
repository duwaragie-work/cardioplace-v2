import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'

/**
 * F13 — ACE/ARB contraindication is load-bearing on med re-add.
 *
 * Bug: after a B4 angioedema resolution sets PatientProfile.aceContraindicatedAt,
 * the patient could silently re-add Lisinopril/Cozaar etc. — no modal, no
 * admin alert, no hold.
 *
 * Fix:
 *  - patient intake gates the ACE/ARB re-add behind a contraindication modal;
 *  - on confirm the backend stores the med AWAITING_PROVIDER (held);
 *  - the backend notifies the patient's primary provider.
 *
 * REQUIRES the backend built from this branch (createMedications enforcement).
 * The contraindication flag is set via test-control (aceContraindicatedAt).
 */

test.describe('F13 — contraindicated ACE/ARB re-add is gated + held', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('contraindicated patient adding an ACE inhibitor sees the warning modal', async ({
    page,
  }) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const patient = await tc.findUser(PATIENTS.aisha.email)

    // Set the ACE/ARB contraindication flag (as a B4 angioedema resolution would).
    await tc.setAceContraindicated(patient.id, true)

    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    // Open the medication-edit intake step.
    await page.goto(`${page.url().replace(/\/dashboard.*$/, '')}/clinical-intake?step=A5`)
    await page.waitForLoadState('networkidle').catch(() => {})

    // Select an ACE inhibitor (Lisinopril / Prinivil is a CORE ACE med).
    const aceTile = page
      .locator('[data-testid^="intake-med-tile-"]', { hasText: /Lisinopril|Prinivil/i })
      .first()
    await aceTile.click({ timeout: 15_000 }).catch(() => {})

    // The contraindication modal must appear.
    const modal = page.locator('[data-testid="readd-contraindicated-modal"]')
    await expect(modal).toBeVisible({ timeout: 15_000 })
    await expect(modal).toContainText(/provider review/i)

    await page.screenshot({ path: 'reports/screenshots/f13-contraindication-modal.png', fullPage: true })

    await tc.dispose()
  })
})
