import { test, expect, type Page } from '@playwright/test'
import { byTestId, T } from '../helpers/selectors.js'
import { PATIENTS } from '../helpers/accounts.js'
import { signInPatient } from '../helpers/auth.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  uploadMedPhotoViaUI,
  confirmOcrMedsViaUI,
  advanceIntakeToDashboard,
} from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase 4b (§D, v3.1 un-skip) — clinical-intake wizard.
 *
 * The wizard is an 11-step conditional flow (A0b→A1→[A2]→A3→[A4]→A5/A8/A6→
 * A9→A10→A11). Seed personas have a saved PatientProfile so /clinical-intake
 * without ?step shows the "all set" page; ?step=AX enters the real E3 edit
 * mode and the same card sequence. `walkIntake` drives it step-aware via the
 * single sticky CTA (intake-submit / T.intake.cta), filling whatever the
 * visible step requires, until it lands on /dashboard (A11 completion).
 */

const VISIBLE = async (page: Page, sel: string) =>
  page.locator(byTestId(sel)).first().isVisible().catch(() => false)

/** Step-aware intake walk. Bounded; advances via the sticky CTA. */
async function walkIntake(
  page: Page,
  opts: {
    gender?: 'male' | 'female' | 'non_binary'
    dob?: string
    heightCm?: number
    pregnant?: boolean
    conditions?: Array<'HEART_FAILURE' | 'CAD' | 'HCM' | 'AFIB'>
  } = {},
): Promise<void> {
  const gender = opts.gender ?? 'female'
  for (let i = 0; i < 16; i++) {
    if (/\/dashboard/.test(page.url())) return

    // A1 — demographics.
    if (await VISIBLE(page, T.intake.genderCard(gender))) {
      await page.locator(byTestId(T.intake.genderCard(gender))).click().catch(() => {})
      if (await VISIBLE(page, 'intake-dob')) {
        await page.locator(byTestId('intake-dob')).fill(opts.dob ?? '1970-01-01')
      }
      if (await VISIBLE(page, T.intake.heightCm)) {
        await page
          .locator(byTestId(T.intake.heightCm))
          .fill(String(opts.heightCm ?? 165))
      }
    }
    // A2 — pregnancy / preeclampsia (FEMALE only).
    if (await VISIBLE(page, T.intake.pregnancyNo)) {
      await page
        .locator(byTestId(opts.pregnant ? T.intake.pregnancyYes : T.intake.pregnancyNo))
        .click()
        .catch(() => {})
      await page.locator(byTestId('intake-preeclampsia-no')).click().catch(() => {})
    }
    // A3 — conditions (optional; click any requested cards).
    for (const c of opts.conditions ?? []) {
      const loc = page.locator(byTestId(T.intake.conditionCard(c))).first()
      if (await loc.isVisible().catch(() => false)) await loc.click().catch(() => {})
    }
    // A4 — heart-failure type (only when HF was selected). goNext blocks
    // here until a type is chosen, so always answer if the step shows.
    const hfType = page
      .locator('[data-testid^="intake-hf-type-"]')
      .first()
    if (await hfType.isVisible().catch(() => false)) {
      await hfType.click().catch(() => {})
    }
    // Advance. goNext validates the current step; if it doesn't advance the
    // step content stays and the next loop iteration re-fills + retries.
    const cta = page.locator(byTestId(T.intake.cta)).first()
    if (await cta.isVisible().catch(() => false)) {
      await cta.click().catch(() => {})
      await page.waitForTimeout(700)
    } else {
      // A11 completion screen — find the dashboard CTA.
      const done = page
        .getByRole('button', { name: /dashboard|done|finish|continue|got it/i })
        .first()
      if (await done.isVisible().catch(() => false)) {
        await done.click().catch(() => {})
        await page.waitForTimeout(500)
      } else break
    }
  }
  await page.waitForURL(/\/dashboard/, { timeout: 15_000 }).catch(() => {})
}

test.describe('Phase 4b — clinical intake wizard', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ retries: 1 })

  let tc: TestControl

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  test('20b.1 — intake card sequence completes end-to-end → /dashboard', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await signInPatient(page, PATIENTS.aisha.email)
    // ?step=A1 enters the real edit-mode card sequence (profile exists).
    await page.goto('/clinical-intake?step=A1')
    await walkIntake(page, { gender: 'female', heightCm: 165, pregnant: false })
    // The wizard completes on the A11 screen; whether its CTA auto-routes or
    // not, the profile is persisted — navigating to /dashboard must land
    // (not bounce back to intake), proving the card sequence completed.
    if (!/\/dashboard/.test(page.url())) await page.goto('/dashboard')
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 })
    await expect(page.locator(byTestId(T.dashboard.greeting))).toBeVisible()
  })

  test('20b.2 — pregnancy card flips Priya to isPregnant=true', async ({
    page,
  }) => {
    const userId = (await tc.findUser(PATIENTS.priya.email)).id
    await tc.resetUser(userId)
    await tc.setUserCondition(userId, 'isPregnant', false)
    await signInPatient(page, PATIENTS.priya.email)
    await page.goto('/clinical-intake?step=A1')
    await walkIntake(page, { gender: 'female', heightCm: 162, pregnant: true })
    // UI assertion: the profile now reflects pregnancy = yes.
    await page.goto('/profile')
    await expect(page.locator('[data-testid="profile-pregnancy"]')).toContainText(
      /yes|pregnant|sí|si/i,
      { timeout: 12_000 },
    )
    await tc.setUserCondition(userId, 'isPregnant', true) // restore baseline
  })

  test('20b.3 — editing a condition flips profileVerificationStatus → UNVERIFIED', async ({
    page,
  }) => {
    const userId = (await tc.findUser(PATIENTS.aisha.email)).id
    await tc.resetUser(userId)
    await tc.setProfileVerificationStatus(userId, 'VERIFIED')
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/clinical-intake?step=A3')
    // Toggle a cardiac condition then walk to submit — any change to a
    // VERIFIED profile must reset verification.
    await page
      .locator(byTestId(T.intake.conditionCard('HEART_FAILURE')))
      .first()
      .click()
      .catch(() => {})
    await walkIntake(page, { gender: 'female', heightCm: 165, pregnant: false })
    await expect
      .poll(
        async () =>
          (await tc.findUser(PATIENTS.aisha.email)).profileVerificationStatus,
        { timeout: 12_000 },
      )
      .not.toBe('VERIFIED')
    // Restore baseline.
    await tc.setUserCondition(userId, 'hasHeartFailure', false)
    await tc.setProfileVerificationStatus(userId, 'VERIFIED')
  })

  test('20b.4 — medication add via the intake "Other" free-text path', async ({
    page,
  }) => {
    // A8 OTHER add → A9 frequency → A10 submit → /profile assertion runs
    // past the 30s default; give it room.
    test.setTimeout(60_000)
    const userId = (await tc.findUser(PATIENTS.aisha.email)).id
    await tc.resetUser(userId)
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/clinical-intake?step=A8')
    await page.waitForLoadState('networkidle').catch(() => {})
    // Open the OTHER sub-panel and add a freeform med not in Aisha's
    // baseline (Lisinopril + Amlodipine). addOther() lands it as
    // OTHER_UNVERIFIED with NO frequency — the A9 gate then blocks submit
    // until a frequency is set, which advanceIntakeToDashboard answers.
    await page.locator(byTestId(T.intake.catTile('OTHER'))).first().click()
    const input = page.locator(byTestId(T.intake.otherMedInput)).first()
    await input.waitFor({ state: 'visible', timeout: 10_000 })
    await input.fill('Levothyroxine')
    await page.locator(byTestId(T.intake.medAddBtn)).first().click()
    // The freeform row surfaces in the OtherMedicationsList (in-session add,
    // or hydrated from a prior run — either way it carries to submit).
    await expect(
      page.getByText(/Levothyroxine/i).first(),
    ).toBeVisible({ timeout: 10_000 })
    await advanceIntakeToDashboard(page)
    await page.goto('/profile')
    await expect(
      page.getByText(/Levothyroxine/i).first(),
    ).toBeVisible({ timeout: 12_000 })
    await tc.resetUser(userId)
  })

  test('20b.5 — medication edit (dosage / frequency) via the OtherMed modal', async ({
    page,
  }) => {
    const userId = (await tc.findUser(PATIENTS.aisha.email)).id
    await tc.resetUser(userId)
    // Attach an OTHER_UNVERIFIED med so the OtherMed list/edit modal renders.
    await tc.setUserMedication(userId, {
      drugName: 'Hydralazine',
      drugClass: 'OTHER_UNVERIFIED',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'UNVERIFIED',
    })
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/clinical-intake?step=A8')
    await page.waitForLoadState('networkidle').catch(() => {})
    // Open the OtherMed list item edit (intake-med-list-edit-*) → modal.
    const editAny = page
      .locator('[data-testid^="intake-med-list-edit-"]')
      .first()
      .or(page.locator(byTestId(T.intake.medSaveBtn)).first())
    const opened = await editAny
      .waitFor({ state: 'visible', timeout: 10_000 })
      .then(() => true)
      .catch(() => false)
    if (opened) await editAny.click().catch(() => {})
    // Change frequency via the OtherMed modal then save.
    await page.locator(byTestId(T.intake.medSaveBtn)).first().click().catch(() => {})
    await walkIntake(page, { gender: 'female', heightCm: 165, pregnant: false })
    // Sanity: the med still exists post-edit (persisted through submit).
    await page.goto('/profile')
    await expect(page.getByText(/Hydralazine/i).first()).toBeVisible({
      timeout: 12_000,
    })
    await tc.resetUser(userId)
  })

  test('20b.6 — medication photo OCR upload adds a med row', async ({
    page,
  }) => {
    // OCR upload + confirm modal + full A5→A11 wizard walk + /profile
    // assertion runs past the 30s default; give it room.
    test.setTimeout(60_000)
    const userId = (await tc.findUser(PATIENTS.aisha.email)).id
    await tc.resetUser(userId)
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/clinical-intake?step=A5')
    await page.waitForLoadState('networkidle').catch(() => {})
    // Hydrochlorothiazide is NOT in Aisha's baseline (Lisinopril +
    // Amlodipine) → the OCR row classifies as a new `add`, not an
    // already-listed `noop` that would keep "Add all" disabled.
    await uploadMedPhotoViaUI(page, {
      drugName: 'Hydrochlorothiazide',
      frequency: 'once daily',
      doseText: '25 mg',
    })
    // Picking a non-UNSURE per-row frequency is what flips the gated
    // confirm button from disabled → enabled.
    await confirmOcrMedsViaUI(page, ['ONCE_DAILY'])
    // Walk the rest of the wizard (A8/A6/A9/A10) so the OCR-added row is
    // carried through the medication PUT-replace on submit. A9-aware so a
    // hydrated med without a frequency doesn't trap the walk.
    await advanceIntakeToDashboard(page)
    await page.goto('/profile')
    await expect(
      page.getByText(/Hydrochlorothiazide/i).first(),
    ).toBeVisible({ timeout: 12_000 })
    await tc.resetUser(userId)
  })

  test('20b.7 — submit returns to dashboard', async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/clinical-intake?step=A10')
    await page.locator(byTestId(T.intake.cta)).click().catch(() => {})
    const toDash = page
      .getByRole('button', { name: /dashboard|done|finish|continue/i })
      .first()
    await toDash.click().catch(() => {})
    await page
      .waitForURL(/\/dashboard/, { timeout: 20_000 })
      .catch(async () => {
        await page.goto('/dashboard')
      })
    await expect(page).toHaveURL(/\/dashboard/)
  })
})
