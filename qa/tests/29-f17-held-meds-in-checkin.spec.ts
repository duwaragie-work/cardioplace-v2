import { test, expect } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { dismissCheckinGate } from '../helpers/api.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * F17 — provider-directed held meds must surface in the daily check-in.
 *
 * Bug: the patient-side `listMyMedications` filtered out every HOLD med, so a
 * medication the care team paused silently vanished from the check-in flow —
 * the patient could forget it was on hold and resume it.
 *
 * Fix: the check-in opts into HOLD meds and renders them as informational,
 * NON-actionable rows ("ON HOLD — your care team has paused this. Do not
 * take.") with no Took/Missed buttons.
 *
 * REQUIRES the backend built from this branch (the new test-control
 * `set-medication-hold` endpoint) + the frontend from this branch.
 */

test.describe('F17 — held meds appear as ON HOLD in daily check-in', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('a PROVIDER_DIRECTED_HOLD med is shown non-actionable in the MEDICATION step', async ({
    page,
  }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const patient = await tc.findUser(PATIENTS.aisha.email)

    // Clean journal/session state so the wizard starts fresh, then attach a med
    // and place it on a provider-directed hold (as an admin hold would).
    await tc.resetUser(patient.id)
    await tc.setUserMedication(patient.id, {
      drugName: 'Cozaar',
      drugClass: 'ARB',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    await tc.setMedicationHold(patient.id, 'Cozaar', 'PROVIDER_DIRECTED_HOLD')

    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')

    // /check-in may open on a resume/open-session gate instead of step 1.
    // Poll past whichever gate is shown.
    await dismissCheckinGate(page)

    // B1 checklist → Continue.
    await expect(page.locator(byTestId(T.checkin.step(1)))).toBeVisible({ timeout: 15_000 })
    await page.locator(byTestId(T.checkin.next)).click()

    // B2 BP entry → fill a benign reading → Continue. NOTE: validateStep('B2')
    // requires a position selection — without it, Continue silently no-ops and
    // the wizard never advances to the MEDICATION step (the real cause of the
    // step-4 timeout: step 1 rendered fine, but B2 never validated).
    await expect(page.locator(byTestId(T.checkin.systolic))).toBeVisible({ timeout: 10_000 })
    await page.locator(byTestId(T.checkin.systolic)).fill('124')
    await page.locator(byTestId(T.checkin.diastolic)).fill('78')
    await page.locator(byTestId(T.checkin.pulse)).fill('72')
    await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
    await page.locator(byTestId(T.checkin.next)).click()

    // WEIGHT (optional) → Continue without entering a weight.
    await page.locator(byTestId(T.checkin.next)).click()

    // MEDICATION step (step 4): the held med must be present + non-actionable.
    await expect(page.locator(byTestId(T.checkin.step(4)))).toBeVisible({ timeout: 10_000 })
    const heldRow = page.locator('[data-testid="checkin-held-med"]', { hasText: /Cozaar/i })
    await expect(heldRow).toBeVisible({ timeout: 10_000 })
    await expect(heldRow).toContainText(/on hold/i)
    await expect(heldRow).toContainText(/do not take/i)
    // No Took/Missed controls inside the held row.
    await expect(heldRow.locator(byTestId(T.checkin.medicationYes))).toHaveCount(0)
    await expect(heldRow.locator(byTestId(T.checkin.medicationNo))).toHaveCount(0)

    await page.screenshot({ path: 'reports/screenshots/f17-held-med-checkin.png', fullPage: true })

    await tc.dispose()
  })
})
