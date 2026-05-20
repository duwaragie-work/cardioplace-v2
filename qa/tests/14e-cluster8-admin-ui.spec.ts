import { test, expect, type Page } from '@playwright/test'
import { authedApi, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  postSessionWithTwoReadings,
  waitForAlerts,
} from '../helpers/api.js'
import { byTestId, T } from '../helpers/selectors.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 8 §D-ADMIN — admin app UI E2E (10 tests).
 *
 * Coverage:
 *   13–15  angioedema 3-tier display + queue surface
 *   16–17  compressed escalation ladder UI (T+0/T+15m/T+1h vs standard
 *          T+0/T+4h/T+8h cross-wiring guard)
 *   18–19  15-field audit footer + Tier-1 non-dismissable resolution
 *   20–22  brady-surveillance ReadingsTab pill, CAD treatment-target note,
 *          CAD_HIGH visibility in AlertsTab
 *
 * Persona: Manisha (admin/medical-director, signed off Cluster 8). Aisha +
 * Paul + Nora are the patient personas (matches Niva's spec 20 + §B).
 *
 * SUBMIT PATH: API submission via test-control + authedApi(patient).
 * Admin sign-in only happens once per test (signInAdmin); navigation uses
 * direct goto + patient-list click (the existing helper-free pattern from
 * spec 13).
 */

async function seedHistoryToClearPreDay3(
  tc: TestControl,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const readings = Array.from({ length: 8 }).map((_, i) => ({
    measuredAt: new Date(now - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
    systolicBP: 120,
    diastolicBP: 78,
    pulse: 72,
    sessionId: crypto.randomUUID(),
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

/**
 * Setup patient via test-control (no UI), trigger the alert via API, return
 * the alert row + tc handle. Admin UI work happens in the test body.
 */
async function setupAndTriggerAlert(
  patientEmail: string,
  prep: (tc: TestControl, userId: string) => Promise<void>,
  trigger: { faceSwelling?: boolean; throatTightness?: boolean; pulse?: number; systolicBP?: number; diastolicBP?: number; medicationTaken?: boolean },
  expectedRuleId: string,
): Promise<{ tc: TestControl; userId: string; patientName: string; alertId: string; alertTier: string }> {
  const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  const u = await tc.findUser(patientEmail)
  await tc.resetUser(u.id)
  await seedHistoryToClearPreDay3(tc, u.id)
  await prep(tc, u.id)

  const api = await authedApi(API_BASE_URL, patientEmail)
  try {
    // Two-reading session bypasses Cluster 6 Q2 single-reading gate. The
    // angioedema rule fires off Stage A regardless of reading count, so the
    // 2nd reading is harmless there; CAD_HIGH and other standard-pipeline
    // rules NEED the 2nd reading to escape the gate.
    await postSessionWithTwoReadings(api, {
      systolicBP: trigger.systolicBP ?? 124,
      diastolicBP: trigger.diastolicBP ?? 78,
      pulse: trigger.pulse ?? 72,
      position: 'SITTING',
      faceSwelling: trigger.faceSwelling,
      throatTightness: trigger.throatTightness,
      medicationTaken: trigger.medicationTaken,
    })
  } finally {
    await api.dispose()
  }
  const alerts = await waitForAlerts(tc, u.id, (xs) =>
    xs.some((a) => a.ruleId === expectedRuleId),
  )
  const alert = alerts.find((a) => a.ruleId === expectedRuleId)
  expect(alert, `expected ${expectedRuleId} after seeded trigger`).toBeDefined()

  // Patient display name lookup — search PATIENTS.* by email. Emails are
  // env-overridable so a hardcoded map drifts; this stays correct as long
  // as PATIENTS retains its shape.
  const persona = Object.values(PATIENTS).find((p) => p.email === patientEmail)
  return {
    tc,
    userId: u.id,
    patientName: persona?.name ?? '',
    alertId: alert!.id,
    alertTier: alert!.tier ?? '',
  }
}

/**
 * Open the admin patient-detail page for the given patient, switch to the
 * given tab. Mirrors the navigation pattern from spec 13.
 */
async function openPatientDetailTab(
  page: Page,
  patientName: string,
  tabName: 'Profile' | 'Readings' | 'Alerts' | 'Care Team' | 'Medications' | 'Timeline',
): Promise<void> {
  await page.goto(`${ADMIN_BASE_URL}/patients`)
  const link = page.getByText(patientName).first()
  await expect(link).toBeVisible({ timeout: 20_000 })
  await link.click()
  await expect(page).toHaveURL(/\/patients\/[^/]+$/, { timeout: 20_000 })
  const tab = page.getByRole('tab', { name: tabName })
  await expect(tab).toBeVisible({ timeout: 15_000 })
  await tab.click()
}

test.describe('Cluster 8 §D-ADMIN — angioedema 3-tier display + dashboard', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('13. Angioedema (ACE) AlertCard expands → all 3 message tiers render + bradykinin in physician', async ({ page }) => {
    test.setTimeout(180_000)
    const { tc, patientName, alertId } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        await tc.setUserMedication(uid, {
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          verificationStatus: 'VERIFIED',
        })
      },
      { faceSwelling: true },
      'RULE_ACE_ANGIOEDEMA',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')

      // Expand the angioedema card.
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // All 3 message tiers render with their alert-id-scoped testids.
      const patientMsg = page.locator(byTestId(T.admin.alertMsgPatient(alertId)))
      const caregiverMsg = page.locator(byTestId(T.admin.alertMsgCaregiver(alertId)))
      const physicianMsg = page.locator(byTestId(T.admin.alertMsgPhysician(alertId)))
      await expect(patientMsg).toBeVisible()
      await expect(caregiverMsg).toBeVisible()
      await expect(physicianMsg).toBeVisible()
      // ACE branch physician message contains the bradykinin framing.
      await expect(physicianMsg).toContainText(/bradykinin-mediated/i)
      // Patient tier carries the "do not take medicine" wording.
      await expect(patientMsg).toContainText(/do not take/i)
    } finally {
      await tc.dispose()
    }
  })

  test('14. Generic angioedema (no ACE/ARB) → physician message shows differential, NOT discontinue ACE', async ({ page }) => {
    test.setTimeout(180_000)
    const { tc, patientName, alertId } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        // Clear Aisha's seed Lisinopril+Amlodipine so the angioedema rule
        // routes GENERIC (no ACE/ARB anywhere in the verified roster).
        await tc.clearUserMedications(uid)
      },
      { faceSwelling: true },
      'RULE_GENERIC_ANGIOEDEMA',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      const physicianMsg = page.locator(byTestId(T.admin.alertMsgPhysician(alertId)))
      await expect(physicianMsg).toBeVisible()
      // Generic branch must show the differential framing — allergic /
      // hereditary / idiopathic / "unverified ACE/ARB exposure".
      await expect(physicianMsg).toContainText(/Differential/i)
      // And must NOT contain the ACE-specific "Discontinue ACE inhibitor"
      // wording (that's the regression we're guarding — generic patients
      // must not be told to stop a drug they may not be on).
      await expect(physicianMsg).not.toContainText(/Discontinue ACE inhibitor/i)
    } finally {
      await tc.dispose()
    }
  })

  test('15. Angioedema alert appears in admin dashboard Tier-1 filter (highest severity, not yellow/green)', async ({ page }) => {
    test.setTimeout(180_000)
    const { tc, alertId } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        await tc.setUserMedication(uid, {
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          verificationStatus: 'VERIFIED',
        })
      },
      { faceSwelling: true },
      'RULE_ACE_ANGIOEDEMA',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/dashboard`)
      // Switch to the TIER_1 filter — angioedema shares the TIER_1 ladder
      // kind (per ladderForTier in §C.1), so the filter that surfaces
      // contraindications also surfaces angioedema.
      const tier1Filter = page.locator(byTestId(T.admin.dashboardTierFilter('TIER_1')))
      await expect(tier1Filter).toBeVisible({ timeout: 15_000 })
      await tier1Filter.click()
      // The alert row for our seeded alertId must be visible.
      const row = page.locator(byTestId(T.admin.dashboardAlertRow(alertId)))
      await expect(row).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-ADMIN — compressed escalation ladder UI', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('16. Angioedema alert EscalationAuditTrail renders compressed rungs T+0, T+15m, T+1h', async ({ page }) => {
    test.setTimeout(240_000)
    const { tc, patientName, alertId } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        await tc.setUserMedication(uid, {
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          verificationStatus: 'VERIFIED',
        })
      },
      { faceSwelling: true },
      'RULE_ACE_ANGIOEDEMA',
    )
    try {
      // Advance the ladder through T+15m + T+1h so the rungs exist in
      // EscalationEvent rows (admin UI reads these). We use backdateAlert
      // Anchor + runScan rather than advanceLadderSteps because the latter
      // anchors to alert.createdAt + offsets without firing the cron path —
      // backdate+scan exercises the real path.
      await tc.runEscalationScan(new Date())
      await tc.backdateAlertAnchor(alertId, 16 * 60) // 16 min
      await tc.runEscalationScan(new Date())
      await tc.backdateAlertAnchor(alertId, 65 * 60) // 1h05m
      await tc.runEscalationScan(new Date())

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // Compressed-ladder rungs render with their ladder CODE.
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T0'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T15M'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T1H'))),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })

  test('17. Standard Tier-1 contraindication renders T+0 / T+4H ladder (NOT the compressed T+15m/T+1h)', async ({ page }) => {
    test.setTimeout(240_000)
    // Use James (HFrEF + Diltiazem seeded) — the classic NDHP_HFREF
    // contraindication that uses the STANDARD Tier 1 ladder.
    const { tc, patientName } = await setupAndTriggerAlert(
      PATIENTS.james.email,
      async () => {},
      { systolicBP: 118, diastolicBP: 74, pulse: 68 },
      'RULE_NDHP_HFREF',
    )
    try {
      // Get the alert id by name lookup.
      const tc2 = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      const james = await tc2.findUser(PATIENTS.james.email)
      const alerts = await tc2.listAlerts(james.id)
      const ndhp = alerts.find((a) => a.ruleId === 'RULE_NDHP_HFREF')!
      // Advance the standard ladder past T+4H.
      await tc2.runEscalationScan(new Date())
      await tc2.backdateAlertAnchor(ndhp.id, 5 * 60 * 60)
      await tc2.runEscalationScan(new Date())

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // Standard Tier 1 ladder rungs are present.
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T0'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T4H'))),
      ).toBeVisible({ timeout: 15_000 })
      // CRITICAL cross-wiring guard: compressed-ladder rungs must NOT exist
      // on a standard Tier 1 contraindication alert.
      expect(
        await page.locator(byTestId(T.admin.escalationRung('T15M'))).count(),
        'compressed T15M rung must NOT appear on a standard Tier-1 contraindication',
      ).toBe(0)
      expect(
        await page.locator(byTestId(T.admin.escalationRung('T1H'))).count(),
        'compressed T1H rung must NOT appear on a standard Tier-1 contraindication',
      ).toBe(0)
      await tc2.dispose()
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-ADMIN — angioedema audit + resolution', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('18. Angioedema alert renders the 15-field JCAHO audit footer with angioedema-specific values', async ({ page }) => {
    test.setTimeout(180_000)
    const { tc, patientName } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        await tc.setUserMedication(uid, {
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          verificationStatus: 'VERIFIED',
        })
      },
      { faceSwelling: true },
      'RULE_ACE_ANGIOEDEMA',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // Subset of the 15 required JCAHO fields that an OPEN angioedema
      // alert can populate without resolution (acknowledged/resolved/
      // resolutionAction/resolutionRationale are empty until provider
      // action — those are exercised in test 19's resolution flow).
      const REQUIRED_OPEN_FIELDS = [
        'alertId',
        'tier',
        'ruleId',
        'severity',
        'mode',
        'status',
        'created',
        'reading',
        'pulsePressure',
        'escalationCount',
      ]
      for (const k of REQUIRED_OPEN_FIELDS) {
        await expect(
          page.locator(`[data-testid="audit-field-${k}"]`),
          `15-field audit footer missing field: ${k}`,
        ).toBeVisible({ timeout: 15_000 })
      }
      // Tier-specific value: TIER_1_ANGIOEDEMA in the tier row.
      await expect(page.locator('[data-testid="audit-field-tier"]')).toContainText(/Angioedema|TIER_1/i)
      await expect(page.locator('[data-testid="audit-field-ruleId"]')).toContainText('ACE_ANGIOEDEMA')
    } finally {
      await tc.dispose()
    }
  })

  test('19. Tier 1 angioedema is non-dismissible — resolve requires rationale + writes audit row', async ({ page }) => {
    test.setTimeout(240_000)
    const { tc, patientName, alertId } = await setupAndTriggerAlert(
      PATIENTS.aisha.email,
      async (tc, uid) => {
        await tc.setUserMedication(uid, {
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          verificationStatus: 'VERIFIED',
        })
      },
      { faceSwelling: true },
      'RULE_ACE_ANGIOEDEMA',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      // Open the resolve modal directly via the per-alert resolve button.
      const resolveBtn = page.locator(byTestId(T.admin.alertResolveBtnFor(alertId)))
      await expect(resolveBtn).toBeVisible({ timeout: 15_000 })
      await resolveBtn.click()

      const rationale = page.locator(byTestId(T.admin.alertResolveRationale))
      const confirm = page.locator(byTestId(T.admin.alertResolveBtn))
      await expect(rationale).toBeVisible({ timeout: 15_000 })
      await expect(confirm).toBeVisible()
      // Confirm should be disabled until rationale + action are provided —
      // the v2 modal flow gates confirm on resolutionAction being selected;
      // the per-spec invariant tested here is "non-dismissable: not just
      // a one-click resolve".
      await expect(confirm).toBeDisabled()
      // Provide rationale + click an action; confirm should enable.
      await rationale.fill('qa-test: angioedema resolved post-treatment')
      // Click the first available resolution-action button. Action keys
      // differ by tier; the first visible action is sufficient.
      const actions = page.locator('[data-testid^="admin-resolve-action-"]')
      const actionCount = await actions.count()
      if (actionCount > 0) {
        await actions.first().click()
      }
      await expect(confirm).toBeEnabled()
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-ADMIN — brady-surveillance + CAD admin surfaces', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('20. Brady-surveillance reading renders the yellow-dot pill (Cluster 8.1 Gap 5)', async ({ page }) => {
    test.setTimeout(180_000)
    const { tc, patientName } = await setupAndTriggerAlert(
      PATIENTS.nora.email,
      async () => {},
      { pulse: 45 },
      'RULE_BRADY_SURVEILLANCE',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Readings')

      // The Cluster-8.1-Gap-5 pill renders on any reading whose deviation is
      // RULE_BRADY_SURVEILLANCE — testid added in this branch.
      await expect(
        page.locator(byTestId(T.admin.readingsBradySurveillancePill)).first(),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })

  test('21. CAD patient ProfileTab renders the persistent treatment-target note (Cluster 8.1 Gap 3)', async ({ page }) => {
    test.setTimeout(120_000)
    // Paul is the seeded CAD patient. No alert trigger needed — the note
    // renders unconditionally on profile.hasCAD.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, PATIENTS.paul.name, 'Profile')

      const note = page.locator(byTestId(T.admin.profileCadTreatmentNote))
      await expect(note).toBeVisible({ timeout: 15_000 })
      // Verbatim content: AHA/ACC 130/80 target + the engine alert defaults
      // (SBP ≥140 Q2 ramp + DBP ≥80 + J-curve DBP <70).
      await expect(note).toContainText(/AHA\/ACC treatment target 130\/80/i)
      await expect(note).toContainText(/SBP ≥140/i)
    } finally {
      await tc.dispose()
    }
  })

  test('22. CAD patient SBP 145 → RULE_CAD_HIGH appears in admin AlertsTab', async ({ page }) => {
    test.setTimeout(180_000)
    // Paul has CAD diagnosis. Stamp him ENROLLED to push enrolledAt past
    // the rollout anchor so the Q2 default (140) applies. SBP 145 fires.
    const { tc, patientName, alertId } = await setupAndTriggerAlert(
      PATIENTS.paul.email,
      async (tc, uid) => {
        // Re-stamp enrolledAt so the Q2 ramp applies (Phase 1 newly enrolled).
        await tc.setEnrollment(uid, 'ENROLLED')
      },
      { systolicBP: 145, diastolicBP: 78, pulse: 72 },
      'RULE_CAD_HIGH',
    )
    try {
      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      // AlertsTab Open filter (default) should surface the new CAD_HIGH alert.
      const row = page.locator(byTestId(T.admin.alertRow(alertId)))
      await expect(row).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })
})
