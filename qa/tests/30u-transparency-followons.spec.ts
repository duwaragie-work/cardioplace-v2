import { test, expect } from '@playwright/test'
import { signInAdmin, signInPatient, authedApi } from '../helpers/auth.js'
import { postSessionWithTwoReadings } from '../helpers/api.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

const DAY = 24 * 60 * 60 * 1000

/**
 * NIVA_HR Part B — display-only transparency follow-ons. No engine changes.
 *   B1 — PERSONALIZED +20 band shown on the admin threshold editor + patient goal card
 *   B3 — STANDARD / PERSONALIZED mode badge on the admin AlertCard
 * (B2 grouping + B4 intake auto-expand live in their own specs.)
 *
 * All seed + mutate the seed patient, so gated behind RUN_WRITE_TESTS.
 */

const MOBILE = { width: 390, height: 844 }

test.describe('B1 — PERSONALIZED +20 tolerance band visibility', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Gated behind RUN_WRITE_TESTS=1 (seeds a threshold)')

  test('admin threshold editor shows "high alerts fire at target + 20"', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.setPatientThreshold(aisha.id, { sbpUpperTarget: 140 })
    await tc.dispose()

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('thresholds'))).click()

    const helper = page.locator(byTestId(T.admin.thresholdSbpBandHelper))
    await expect(helper).toBeVisible({ timeout: 20_000 })
    await expect(helper).toContainText('160') // 140 + 20
  })

  test('patient goal card explains the tolerance band (mobile)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    // Personalization (and its +20 band on the goal card) only applies once
    // the patient is past pre-Day-3: personalizedEligible = threshold != null
    // && >=7 readings (Dr. Singal Q3). A lingering condition flag would also
    // claim the sbp-high axis and zero the tolerance. Reset + clear conditions
    // + seed >=7 readings so the personalized 135 (not the STANDARD 140) drives
    // the goal card. Mirrors the B3 PERSONALIZED setup below.
    await tc.resetUser(aisha.id)
    for (const c of ['hasCAD', 'hasHeartFailure', 'hasHCM', 'hasDCM', 'hasAorticStenosis', 'isPregnant'] as const) {
      await tc.setUserCondition(aisha.id, c, false)
    }
    await seedEstablishedHistory(tc, aisha.id)
    await tc.setPatientThreshold(aisha.id, { sbpUpperTarget: 135 })
    await tc.dispose()

    await page.setViewportSize(MOBILE)
    await signInPatient(page, PATIENTS.aisha.email)
    const tol = page.locator(byTestId(T.dashboard.goalTolerance))
    await expect(tol).toBeVisible({ timeout: 20_000 })
    await expect(tol).toContainText('155') // 135 + 20
  })
})

async function seedEstablishedHistory(tc: any, userId: string) {
  const now = Date.now()
  await tc.seedReadingsAtTime(
    userId,
    Array.from({ length: 7 }, (_, i) => ({
      measuredAt: new Date(now - (i + 1) * DAY).toISOString(),
      systolicBP: 120,
      diastolicBP: 78,
      pulse: 72,
    })),
  )
}

test.describe('B3 — STANDARD / PERSONALIZED mode badge on the admin AlertCard', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Gated behind RUN_WRITE_TESTS=1 (fires a real alert)')

  test('STANDARD alert shows a "Standard" mode badge', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id) // pre-Day-3 → single 165/100 fires STANDARD L1 high
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await api.post('daily-journal', {
      data: { measuredAt: new Date().toISOString(), systolicBP: 165, diastolicBP: 100, pulse: 78, position: 'SITTING' },
    })
    await new Promise((r) => setTimeout(r, 1000))
    const open = (await tc.listAlerts(aisha.id)).filter((a: any) => a.status === 'OPEN')
    const alertId = open[0]?.id
    expect(alertId, 'expected an OPEN alert').toBeTruthy()
    await api.dispose()
    await tc.dispose()

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
    const badge = page.locator(byTestId(T.admin.alertModeBadge(alertId)))
    await expect(badge).toBeVisible({ timeout: 20_000 })
    await expect(badge).toContainText(/standard/i)
  })

  test('PERSONALIZED alert shows a "Personalized" mode badge', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    // resetUser wipes readings/alerts but NOT PatientProfile condition flags.
    // Condition rules (CAD/HF/HCM/DCM/AS/pregnancy) claim the sbp-high axis
    // BEFORE personalizedHighRule (alert-engine axisRules order), firing a
    // STANDARD-mode alert that suppresses PERSONALIZED. Aisha's seed baseline
    // is a clean hypertensive (no condition flags), so clearing any left by a
    // prior spec just restores baseline and lets the personalized rule be the
    // sole sbp-high claimant.
    for (const c of ['hasCAD', 'hasHeartFailure', 'hasHCM', 'hasDCM', 'hasAorticStenosis', 'isPregnant'] as const) {
      await tc.setUserCondition(aisha.id, c, false)
    }
    await seedEstablishedHistory(tc, aisha.id) // ≥7 readings → personalized-eligible
    await tc.setUserCondition(aisha.id, 'diagnosedHypertension', true)
    await tc.setPatientThreshold(aisha.id, { sbpUpperTarget: 130 })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    // 155 ≥ 130 + 20 band → RULE_PERSONALIZED_HIGH (mode PERSONALIZED). Aisha is
    // post-Day-3 (≥7 readings), so a LONE reading won't fire — the single-reading
    // gate requires a 2-reading session (or finalization). Post two so the alert
    // actually fires. (Confirmed via engine scenario 12b.)
    await postSessionWithTwoReadings(api, {
      systolicBP: 155,
      diastolicBP: 92,
      pulse: 76,
    })
    await new Promise((r) => setTimeout(r, 1000))
    const open = (await tc.listAlerts(aisha.id)).filter((a: any) => a.status === 'OPEN')
    const personalized = open.find((a: any) => a.mode === 'PERSONALIZED')
    expect(personalized, 'expected a PERSONALIZED alert').toBeTruthy()
    await api.dispose()
    try {
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
      await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
      const badge = page.locator(byTestId(T.admin.alertModeBadge(personalized!.id)))
      await expect(badge).toBeVisible({ timeout: 20_000 })
      await expect(badge).toContainText(/personalized/i)
    } finally {
      await tc.setUserCondition(aisha.id, 'diagnosedHypertension', false)
      await tc.dispose()
    }
  })
})

test.describe('B2 — co-fired alert rows grouped by reading', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Gated behind RUN_WRITE_TESTS=1 (fires a co-fire)')

  // A CAD patient at 165/65 co-fires CAD_HIGH (bp-high) + CAD_DBP_CRITICAL
  // (dbp-low) — two DeviationAlert rows sharing one journalEntry.
  async function fireCadCoFire(tc: any) {
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id) // pre-Day-3 → single reading fires
    // Clear competing condition flags left on the shared persona by earlier
    // specs (resetUser doesn't touch PatientProfile). Otherwise HF/HCM/DCM/AS
    // rules also co-fire on 165/65 and the raw patient list balloons. Keep
    // hasCAD — this is the CAD co-fire under test.
    for (const c of ['hasHeartFailure', 'hasHCM', 'hasDCM', 'hasAorticStenosis', 'isPregnant'] as const) {
      await tc.setUserCondition(aisha.id, c, false)
    }
    await tc.setUserCondition(aisha.id, 'hasCAD', true)
    // Guarantee a clean alert slate IMMEDIATELY before the trigger so the only
    // OPEN alerts the patient view sees are this co-fire's (consolidating to one
    // card). resetUser above clears alerts too, but a sibling spec's async
    // escalation/dispatch can land alerts between reset and now under CI's
    // shared DB; this targeted delete (no reading-history wipe) closes that race.
    await tc.deleteAlertsForUser(aisha.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await api.post('daily-journal', {
      data: { measuredAt: new Date().toISOString(), systolicBP: 165, diastolicBP: 65, pulse: 74, position: 'SITTING' },
    })
    await new Promise((r) => setTimeout(r, 1000))
    const open = (await tc.listAlerts(aisha.id)).filter((a: any) => a.status === 'OPEN')
    await api.dispose()
    return { aisha, open }
  }

  test('admin AlertsTab shows a "same reading" group header for the co-fire', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { aisha, open } = await fireCadCoFire(tc)
    expect(open.length, 'expected ≥2 co-fired alerts').toBeGreaterThanOrEqual(2)
    try {
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
      await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
      await expect(page.locator(byTestId(T.admin.alertGroupHeader)).first()).toBeVisible({ timeout: 20_000 })
    } finally {
      await tc.setUserCondition(aisha.id, 'hasCAD', false)
      await tc.dispose()
    }
  })

  test('patient alerts tab consolidates the co-fire into a single card (mobile)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { open } = await fireCadCoFire(tc)
    expect(open.length).toBeGreaterThanOrEqual(2)
    try {
      await page.setViewportSize(MOBILE)
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/notifications?tab=alerts')
      // The 2 co-fired alerts merge into ONE consolidated card (same
      // journalEntry). Count CARD CONTAINERS only: PatientAlertCard emits
      // `notification-row-<uuid>` for the card AND `notification-row-<part>-<uuid>`
      // for title/severity/mode/message/reading/date/status/ack/detail, so a
      // broad ^= match resolves to ~9 elements PER card. Match the card's bare
      // UUID suffix so we count one element per card.
      const cards = page.getByTestId(
        /^notification-row-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )
      await expect(cards).toHaveCount(1, { timeout: 20_000 })
    } finally {
      const aisha = await tc.findUser(PATIENTS.aisha.email)
      await tc.setUserCondition(aisha.id, 'hasCAD', false)
      await tc.dispose()
    }
  })
})

test.describe('B4 — intake category card auto-expands when a scan pre-selects a med', () => {
  // The trigger is a prescription SCAN (addOcrMedications) that fans matched
  // meds into state.selectedMedications AFTER the A8Categories step mounts. The
  // fix is a reactive useEffect ([state.selectedMedications]) that unions the
  // matched category into `activeCategories` (add-only) so the card expands.
  //
  // Driving real OCR (photo upload + model match) in Playwright is non-
  // deterministic, so this is documented as a MANUAL procedure rather than a
  // fake-passing automated test (per the doc's "no fake skips" rule). The
  // user-visible target is asserted via the `intake-cat-expanded-WATER_PILL`
  // testid added on the expanded category content.
  test.skip('MANUAL: scan a Furosemide prescription on A8 → water-pill card auto-expands with the item checked', async () => {
    // 1. Sign in as a patient mid clinical-intake; reach the A8 "other
    //    medicines" step with all category cards collapsed.
    // 2. Use the prescription scan / photo-confirm flow to add a Furosemide
    //    (a CATEGORY_MEDS water-pill entry).
    // 3. EXPECT: the WATER_PILL category card auto-expands (no manual tap) —
    //    `byTestId(T.intake.catExpanded('WATER_PILL'))` becomes visible — and
    //    Furosemide shows checked inside it.
    // 4. Collapse WATER_PILL manually, then add another scanned water-pill med;
    //    EXPECT the card does NOT force itself back open (add-only union).
    // Mobile viewport (patient surface).
  })
})
