import { test, expect, type Page } from '@playwright/test'
import { authedApi, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  postSessionWithTwoReadings,
  waitForAlerts,
  adminResolveAlert,
  adminAuditAlert,
  resolveAlertViaModal,
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
  opts: { twoReadingSession?: boolean } = {},
): Promise<{ tc: TestControl; userId: string; patientName: string; alertId: string; alertTier: string }> {
  const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  const u = await tc.findUser(patientEmail)
  await tc.resetUser(u.id)
  await seedHistoryToClearPreDay3(tc, u.id)
  await prep(tc, u.id)

  const api = await authedApi(API_BASE_URL, patientEmail)
  try {
    // Angioedema (Stage A pre-gate) + brady-surveillance (Pass 3) + first-
    // month nudge (Pass 4) bypass the Cluster 6 Q2 single-reading gate, so
    // a single reading produces exactly ONE alert (predictable for the
    // admin-UI "first visible Expand" assertion). CAD_HIGH and other
    // standard-pipeline rules opt-in to the 2-reading session.
    if (opts.twoReadingSession) {
      await postSessionWithTwoReadings(api, {
        systolicBP: trigger.systolicBP ?? 124,
        diastolicBP: trigger.diastolicBP ?? 78,
        pulse: trigger.pulse ?? 72,
        position: 'SITTING',
        faceSwelling: trigger.faceSwelling,
        throatTightness: trigger.throatTightness,
        medicationTaken: trigger.medicationTaken,
      })
    } else {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: trigger.systolicBP ?? 124,
        diastolicBP: trigger.diastolicBP ?? 78,
        pulse: trigger.pulse ?? 72,
        position: 'SITTING',
        faceSwelling: trigger.faceSwelling,
        throatTightness: trigger.throatTightness,
        medicationTaken: trigger.medicationTaken,
        sessionId: crypto.randomUUID(),
      })
    }
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
      // The dashboard queue is provider-scoped in the seed (every patient is
      // assigned to primary-provider@cardioplace.test; Manisha is just
      // PROVIDER+SUPER_ADMIN without explicit assignment). Spec 10 uses
      // medicalDirector for the same reason — the MD role sees the whole
      // practice's queue, so the seeded angioedema alert surfaces.
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/dashboard`)
      // Switch to the TIER_1 filter — post-FIX 5, angioedema buckets into
      // TIER_1 (same chrome + filter group as contraindications).
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
      // Spec 13 pattern — switch to 'All' status filter first so the seeded
      // alert is reliably visible (default is OPEN; the seeded alert IS
      // open, but 'All' is the most-robust filter for finding it). Then
      // expand the card.
      await page.getByRole('button', { name: 'All', exact: true }).first().click().catch(() => {})
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // Post-FIX 6: angioedema renders via TIER_1_ANGIOEDEMA_LADDER —
      // compressed rungs T+0 / T+15m / T+1h / T+4h, NOT the standard
      // T+0 / T+4h / T+8h / T+24h / T+48h. Asserting all 4 compressed rungs.
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T0'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T15M'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T1H'))),
      ).toBeVisible({ timeout: 15_000 })
      await expect(
        page.locator(byTestId(T.admin.escalationRung('T4H'))),
      ).toBeVisible({ timeout: 15_000 })
      // Cross-wiring guard at the UI: standard-ladder rungs MUST NOT render.
      expect(
        await page.locator(byTestId(T.admin.escalationRung('T8H'))).count(),
        'compressed angioedema ladder must NOT render the standard T+8h rung',
      ).toBe(0)
      expect(
        await page.locator(byTestId(T.admin.escalationRung('T24H'))).count(),
        'compressed angioedema ladder must NOT render the standard T+24h rung',
      ).toBe(0)
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
      // NDHP_HFREF is a Stage A contraindication — bypasses the single-
      // reading gate. Single-reading session for predictable expand target.
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

  test('18. RESOLVED angioedema alert renders the 15-field JCAHO audit footer with all resolution fields populated', async ({ page }) => {
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
      // API-resolve the alert FIRST (post-FIX 5, TIER_1_ANGIOEDEMA accepts
      // the TIER_1 resolution catalog). The audit footer's
      // resolutionAction / resolutionRationale / resolved / resolvedBy
      // rows render after the alert is RESOLVED — testing on RESOLVED
      // covers the full 15-field JCAHO surface in one shot.
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      try {
        await adminResolveAlert(adminApi, alertId, {
          resolutionAction: 'TIER1_FALSE_POSITIVE',
          resolutionRationale: 'qa-test: angioedema audit-footer coverage (TIER_1 resolution catalog now wired for angioedema per FIX 5)',
        })
      } finally {
        await adminApi.dispose()
      }

      await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
      await openPatientDetailTab(page, patientName, 'Alerts')
      // Spec 13 pattern: switch to 'All' status filter so the RESOLVED
      // alert is visible (default is OPEN). Then expand the card.
      await page.getByRole('button', { name: 'All', exact: true }).first().click().catch(() => {})
      await page.getByRole('button', { name: 'Expand alert' }).first().click()

      // 15 JCAHO fields populated on a RESOLVED alert. Open-only fields +
      // resolution-fields = the full audit panel surface.
      const REQUIRED_FIELDS = [
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
        'resolved',
        'resolvedBy',
        'resolutionAction',
      ]
      for (const k of REQUIRED_FIELDS) {
        await expect(
          page.locator(`[data-testid="audit-field-${k}"]`),
          `15-field audit footer missing field: ${k}`,
        ).toBeVisible({ timeout: 15_000 })
      }
      // Resolution rationale renders as a free-form block (separate testid).
      await expect(
        page.locator('[data-testid="audit-field-resolutionRationale"]'),
      ).toBeVisible({ timeout: 15_000 })
      // Tier-specific values: TIER_1_ANGIOEDEMA in tier; ACE_ANGIOEDEMA in
      // ruleId; resolved / resolvedBy populated.
      await expect(page.locator('[data-testid="audit-field-tier"]')).toContainText(/Angioedema|TIER_1/i)
      await expect(page.locator('[data-testid="audit-field-ruleId"]')).toContainText('ACE_ANGIOEDEMA')
      await expect(page.locator('[data-testid="audit-field-resolvedBy"]')).not.toContainText('—')
      await expect(page.locator('[data-testid="audit-field-resolutionAction"]')).toContainText(/TIER1_FALSE_POSITIVE/i)
    } finally {
      await tc.dispose()
    }
  })

  test('19. Tier 1 angioedema non-dismissible resolution writes RESOLVED + audit row (post-FIX 5: TIER_1 resolution catalog wired)', async ({ page }) => {
    test.setTimeout(240_000)
    const { tc, userId, patientName, alertId } = await setupAndTriggerAlert(
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

      // Use the canonical resolveAlertViaModal helper (spec 13 pattern):
      // clicks the per-alert Resolve button → modal opens → picks a TIER_1
      // action → fills rationale → confirms. Post-FIX 5 the Tier-1
      // resolution catalog is wired for TIER_1_ANGIOEDEMA, so the modal's
      // action list is populated; without FIX 5 the modal would have no
      // selectable action.
      await resolveAlertViaModal(page, alertId, {
        resolutionAction: 'TIER1_FALSE_POSITIVE',
        rationale: 'qa-test: angioedema non-dismissible resolution + audit row coverage',
      })

      // Backend invariant: alert is now RESOLVED with resolutionAction +
      // resolvedBy populated. resolutionRationale lives on the audit
      // endpoint (not the listAlerts shape), so we read the full audit
      // record explicitly. This proves FIX 5's resolution catalog works
      // end-to-end (modal → API → DB → audit row).
      const after = await tc.listAlerts(userId)
      const resolved = after.find((a) => a.id === alertId)
      expect(resolved?.status, 'alert must be RESOLVED after modal flow').toBe('RESOLVED')
      expect(resolved?.resolutionAction, 'resolutionAction round-trip').toBe('TIER1_FALSE_POSITIVE')
      expect(resolved?.resolvedBy, 'resolvedBy populated (audit attribution)').toBeTruthy()
      // Audit row carries the rationale we filled in the modal.
      const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
      try {
        const audit = await adminAuditAlert(adminApi, alertId)
        expect(audit.resolutionAction).toBe('TIER1_FALSE_POSITIVE')
        expect(String(audit.resolutionRationale ?? '')).toMatch(/qa-test: angioedema/i)
      } finally {
        await adminApi.dispose()
      }
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
      // CAD_HIGH is in the standard pipeline — Cluster 6 Q2 single-reading
      // gate suppresses it; opt-in to the 2-reading session.
      { twoReadingSession: true },
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
