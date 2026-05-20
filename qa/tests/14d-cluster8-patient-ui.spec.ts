import { test, expect, type Page } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  waitForAlerts,
} from '../helpers/api.js'
import { byTestId, T } from '../helpers/selectors.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 8 §D-PATIENT — patient app UI E2E (12 tests).
 *
 * Complements Niva's API-level spec 20 + un-fixme'd 09. Drives REAL patient
 * UI surfaces: the 5 new symptom buttons (Cluster 8.1 faceSwelling /
 * throatTightness, Cluster 7 Appendix A fatigue / SOB / dryCough), the
 * angioedema full-screen EmergencyAlertScreen, the brady-surveillance
 * "patient sees nothing" negative test, and the first-month adherence
 * nudge surfacing in the patient notifications inbox.
 *
 * SUBMIT-PATH NOTE: tests use API submission for the trigger (the path is
 * already covered by Niva's spec 20 + my §C); §D's added value is verifying
 * the resulting PATIENT UI SURFACES — buttons receive clicks + the alert
 * detail / notifications page render the expected text. Tests 5 + 6 are
 * pure-UI (no engine path).
 *
 * Angioedema routing — post-FIX 1 (commit 388b816): TIER_1_ANGIOEDEMA now
 * routes to EmergencyAlertScreen (full-screen red with 911 button + signed-
 * off registry body), matching Manisha's "full-screen red page + 911" spec.
 * Tests assert against T.emergency.{screen,message,call911} accordingly.
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

async function setupPatient(
  email: string,
  prep: (tc: TestControl, userId: string) => Promise<void>,
): Promise<{ tc: TestControl; userId: string }> {
  const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  const u = await tc.findUser(email)
  await tc.resetUser(u.id)
  await seedHistoryToClearPreDay3(tc, u.id)
  await prep(tc, u.id)
  return { tc, userId: u.id }
}

/**
 * Walk the patient through the check-in flow up to the B3 symptoms step,
 * click the requested symptom button via UI (so the button is exercised),
 * then bail out of the form. Caller is responsible for triggering the engine
 * separately (we submit via API for determinism — see SUBMIT-PATH NOTE).
 * Returns true if the button was found + clicked.
 */
async function clickSymptomButtonViaUI(
  page: Page,
  symptomKey: string,
): Promise<boolean> {
  await page.goto('/check-in')
  // Next 16 hydration race: spec 05 documents that the wizard ships
  // interactive DOM ahead of React onClick attachment. Wait for step 1 to
  // mount before any click, then advance step-by-step with the same
  // hydration wait pattern at each gate.
  await page.locator(byTestId(T.checkin.step(1))).waitFor({ state: 'visible', timeout: 10_000 })

  // Walk through B1 → B2 → WEIGHT → MEDICATION → B3 (StepKey order in
  // CheckIn.tsx:1461 STEP_FLOW). The helper terminates when the requested
  // symptom button on B3 is visible.
  for (let i = 0; i < 10; i++) {
    // Target reached? Done.
    if (
      await page
        .locator(byTestId(T.checkin.symptom(symptomKey)))
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      break
    }
    // B2 — BP + position. Wait for systolic to hydrate before filling.
    if (await page.locator(byTestId(T.checkin.systolic)).isVisible().catch(() => false)) {
      await page.locator(byTestId(T.checkin.systolic)).fill('120')
      await page.locator(byTestId(T.checkin.diastolic)).fill('78')
      await page.locator(byTestId(T.checkin.pulse)).fill('72')
      const posSitting = page.locator(byTestId('check-in-position-sitting')).first()
      if (await posSitting.isVisible().catch(() => false)) {
        await posSitting.click().catch(() => {})
      }
    }
    // MEDICATION — Aisha has Lisinopril seeded + optional setUserMedication
    // add-on (which dedupes by drugName, so the count is stable). Click YES
    // on every med row to satisfy MEDICATION step validation.
    const medYes = page.locator(byTestId(T.checkin.medicationYes))
    if (await medYes.first().isVisible().catch(() => false)) {
      const count = await medYes.count()
      for (let j = 0; j < count; j++) {
        await medYes.nth(j).click().catch(() => {})
      }
    }
    // Advance — wait for the next button to hydrate before clicking.
    const next = page.locator(byTestId(T.checkin.next))
    if (await next.isVisible().catch(() => false)) {
      await next.click()
      // Small settle so React state mutation lands before the next iteration
      // queries visibility. Without this the next iteration occasionally
      // reads the pre-click DOM and double-clicks the same Next button.
      await page.waitForTimeout(150)
    } else {
      break
    }
  }
  const btn = page.locator(byTestId(T.checkin.symptom(symptomKey)))
  if (!(await btn.isVisible().catch(() => false))) return false
  await btn.click()
  return true
}

async function postAngioedemaEntry(
  patientEmail: string,
  opts: { faceSwelling?: boolean; throatTightness?: boolean } = { faceSwelling: true },
): Promise<void> {
  const api = await authedApi(API_BASE_URL, patientEmail)
  try {
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 124,
      diastolicBP: 78,
      pulse: 72,
      position: 'SITTING',
      faceSwelling: opts.faceSwelling,
      throatTightness: opts.throatTightness,
      sessionId: crypto.randomUUID(),
    })
  } finally {
    await api.dispose()
  }
}

test.describe('Cluster 8 §D-PATIENT — angioedema symptom buttons + red alert treatment', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient state)',
  )

  test('1. faceSwelling button receives click + EmergencyAlertScreen renders with 911 button (ACE branch)', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserMedication(uid, {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      // Exercise the new button via UI (the C8.1 deliverable).
      const clicked = await clickSymptomButtonViaUI(page, 'FACE_SWELLING')
      expect(clicked, 'FACE_SWELLING button must be reachable in the check-in flow').toBe(true)

      // Drive the engine via API (proven path — spec 20). The §D assertion
      // is "patient UI surfaces are exercised + the resulting full-screen
      // emergency renders with the signed-off body + 911 CTA".
      await postAngioedemaEntry(PATIENTS.aisha.email, { faceSwelling: true })
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')!
      expect(row.tier).toBe('TIER_1_ANGIOEDEMA')

      await page.goto(`/alerts/${row.id}`)
      // Post-FIX 1 (commit 388b816): angioedema routes to
      // EmergencyAlertScreen — full-screen red, 911 button, signed-off body.
      await expect(page.locator(byTestId(T.emergency.screen))).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator(byTestId(T.emergency.call911))).toBeVisible()
      const msg = page.locator(byTestId(T.emergency.message))
      await expect(msg).toBeVisible()
      await expect(msg).toContainText(/911|emergency room/i)
    } finally {
      await tc.dispose()
    }
  })

  test('2. throatTightness button + NO meds → EmergencyAlertScreen STILL shows (universal airway)', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async () => {})
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const clicked = await clickSymptomButtonViaUI(page, 'THROAT_TIGHTNESS')
      expect(clicked, 'THROAT_TIGHTNESS button must be reachable').toBe(true)

      await postAngioedemaEntry(PATIENTS.aisha.email, { throatTightness: true })
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA')!
      expect(row.tier).toBe('TIER_1_ANGIOEDEMA')

      await page.goto(`/alerts/${row.id}`)
      // Critical: airway symptoms must surface the full-screen emergency
      // even with no med history (allergic / idiopathic / hereditary).
      await expect(page.locator(byTestId(T.emergency.screen))).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator(byTestId(T.emergency.call911))).toBeVisible()
      await expect(page.locator(byTestId(T.emergency.message))).toContainText(/911/)
    } finally {
      await tc.dispose()
    }
  })

  test('3. faceSwelling + ARB → Tier 1 red alert + ARB-variant physician text', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserMedication(uid, {
        drugName: 'Losartan',
        drugClass: 'ARB',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const clicked = await clickSymptomButtonViaUI(page, 'FACE_SWELLING')
      expect(clicked).toBe(true)

      await postAngioedemaEntry(PATIENTS.aisha.email, { faceSwelling: true })
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')!
      expect(row.tier).toBe('TIER_1_ANGIOEDEMA')
      // Physician message is the ARB variant (verified at the DB layer —
      // patient UI doesn't display physician text per v2's tier split).
      expect(row.physicianMessage ?? '').toMatch(/\(ARB\)/)

      await page.goto(`/alerts/${row.id}`)
      // EmergencyAlertScreen renders (full-screen red) — title is neutral
      // non-diagnostic, body comes from the signed-off ACE_ANGIOEDEMA
      // registry message (ARB-variant physician text was verified above at
      // the DB layer; patient UI doesn't show physician text per v2 split).
      await expect(page.locator(byTestId(T.emergency.screen))).toBeVisible({
        timeout: 20_000,
      })
      await expect(page.locator(byTestId(T.emergency.call911))).toBeVisible()
    } finally {
      await tc.dispose()
    }
  })

  test('4a. ACE branch patient message INCLUDES "do not take ... medicine"', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserMedication(uid, {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await postAngioedemaEntry(PATIENTS.aisha.email, { faceSwelling: true })
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')!
      await page.goto(`/alerts/${row.id}`)
      // EmergencyAlertScreen body carries the signed-off ACE registry message.
      const msg = page.locator(byTestId(T.emergency.message))
      await expect(msg).toBeVisible({ timeout: 20_000 })
      // Approved verbatim ACE-branch wording.
      await expect(msg).toContainText(/do not take/i)
      await expect(msg).toContainText(/blood pressure medicine/i)
    } finally {
      await tc.dispose()
    }
  })

  test('4b. GENERIC branch (no ACE/ARB) patient message OMITS the "stop medicine" line', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async () => {})
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await postAngioedemaEntry(PATIENTS.aisha.email, { faceSwelling: true })
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA')!
      await page.goto(`/alerts/${row.id}`)
      const msg = page.locator(byTestId(T.emergency.message))
      await expect(msg).toBeVisible({ timeout: 20_000 })
      // Generic branch must NOT tell the patient to stop a medicine —
      // cause may be allergic / idiopathic / hereditary, not a drug.
      await expect(msg).not.toContainText(/do not take/i)
      await expect(msg).toContainText(/911|emergency room/i)
    } finally {
      await tc.dispose()
    }
  })

  test('5. Bespoke SVG icons render on both angioedema buttons (Cluster 8.1 Gap 6)', async ({ page }) => {
    test.setTimeout(60_000)
    const { tc } = await setupPatient(PATIENTS.aisha.email, async () => {})
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      // Walk to the B3 symptoms step using the same helper as the click tests.
      const reached = await clickSymptomButtonViaUI(page, 'FACE_SWELLING')
      expect(reached).toBe(true)
      const faceBtn = page.locator(byTestId(T.checkin.symptom('FACE_SWELLING')))
      const throatBtn = page.locator(byTestId(T.checkin.symptom('THROAT_TIGHTNESS')))
      await expect(faceBtn).toBeVisible()
      await expect(throatBtn).toBeVisible()
      // Bespoke inline SVGs (FaceSwellingIcon / ThroatTightnessIcon at
      // CheckIn.tsx:1002-1047). Counting svg children guards against a
      // regression that strips the icon (or replaces it with text).
      expect(await faceBtn.locator('svg').count()).toBeGreaterThanOrEqual(1)
      expect(await throatBtn.locator('svg').count()).toBeGreaterThanOrEqual(1)
    } finally {
      await tc.dispose()
    }
  })

  test('6. "Anything else?" otherSymptoms textarea is present + functional after the 2 new buttons inserted', async ({ page }) => {
    test.setTimeout(60_000)
    const { tc } = await setupPatient(PATIENTS.aisha.email, async () => {})
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      for (let i = 0; i < 6; i++) {
        if (
          await page
            .locator(byTestId(T.checkin.otherSymptoms))
            .first()
            .isVisible()
            .catch(() => false)
        ) {
          break
        }
        if (await page.locator(byTestId(T.checkin.systolic)).isVisible().catch(() => false)) {
          await page.locator(byTestId(T.checkin.systolic)).fill('120')
          await page.locator(byTestId(T.checkin.diastolic)).fill('78')
          await page.locator(byTestId(T.checkin.pulse)).fill('72')
        }
        if (await page.locator(byTestId(T.checkin.next)).isVisible().catch(() => false)) {
          await page.locator(byTestId(T.checkin.next)).click()
        } else {
          break
        }
      }
      const other = page.locator(byTestId(T.checkin.otherSymptoms))
      await expect(other).toBeVisible()
      // Accepts input — guards against a regression that disables / strips
      // the textarea when the symptom list grows.
      await other.fill('headache and a little dizzy')
      await expect(other).toHaveValue('headache and a little dizzy')
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-PATIENT — Cluster 7 symptom buttons (closes Phase 4b §C residuals)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  // These three tests replace the Phase 4 v3.1 §I 20g.6–.9 test-control-
  // injection workaround with REAL UI-driven button activation, completing
  // the Phase 4b §C "Cluster 7 buttons without UI" residuals.

  test('7. SOB button + beta-blocker + HF patient → click registered + RULE_BETA_BLOCKER_SOB_HF fires', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserCondition(uid, 'hasHeartFailure', true)
      await tc.setUserMedication(uid, {
        drugName: 'Carvedilol',
        drugClass: 'BETA_BLOCKER',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const clicked = await clickSymptomButtonViaUI(page, 'SHORTNESS_OF_BREATH')
      expect(clicked, 'SHORTNESS_OF_BREATH button must be reachable').toBe(true)

      // Trigger via API to deterministically fire the rule. The §D assertion
      // for Cluster 7 buttons is "UI surface exists + receives input" — the
      // engine path is owned by spec 09's un-fixme'd cases.
      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          shortnessOfBreath: true,
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF'),
      )
      expect(alerts.find((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF')).toBeDefined()
    } finally {
      await tc.dispose()
    }
  })

  test('8. fatigue button + beta-blocker → click registered + RULE_BETA_BLOCKER_FATIGUE fires', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserMedication(uid, {
        drugName: 'Metoprolol',
        drugClass: 'BETA_BLOCKER',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const clicked = await clickSymptomButtonViaUI(page, 'FATIGUE')
      expect(clicked, 'FATIGUE button must be reachable').toBe(true)

      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          fatigue: true,
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_FATIGUE'),
      )
      expect(alerts.find((a) => a.ruleId === 'RULE_BETA_BLOCKER_FATIGUE')).toBeDefined()
    } finally {
      await tc.dispose()
    }
  })

  test('9. dryCough button + ACE inhibitor → click registered + RULE_ACE_COUGH fires', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setUserMedication(uid, {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const clicked = await clickSymptomButtonViaUI(page, 'DRY_COUGH')
      expect(clicked, 'DRY_COUGH button must be reachable').toBe(true)

      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          dryCough: true,
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_COUGH'),
      )
      expect(alerts.find((a) => a.ruleId === 'RULE_ACE_COUGH')).toBeDefined()
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-PATIENT — brady surveillance "patient sees nothing" (negative)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('10. HR 45 asymptomatic on Nora (BB + bradycardia) → NO emergency screen, NO new notification (Tier 3 is physician-only)', async ({ page }) => {
    test.setTimeout(120_000)
    // Nora is the seeded BB + diagnosed bradycardia persona used by spec 20
    // §B1. The surveillance rule fires (provider-side chart event) but the
    // patient app must show NOTHING — empty patientMessage + no banner.
    const { tc, userId } = await setupPatient(PATIENTS.nora.email, async () => {})
    try {
      await signInPatient(page, PATIENTS.nora.email)

      // Notifications count BEFORE so we can prove no new row landed after.
      const notifsBefore = await tc.listNotifications(userId)

      const api = await authedApi(API_BASE_URL, PATIENTS.nora.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 122,
          diastolicBP: 76,
          pulse: 45,
          position: 'SITTING',
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }

      // Prove the rule fired so the negative assertion below is meaningful.
      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BRADY_SURVEILLANCE'),
      )
      const surveillance = alerts.find((a) => a.ruleId === 'RULE_BRADY_SURVEILLANCE')!
      expect(surveillance.tier).toBe('TIER_3_INFO')
      // Patient message MUST be empty — physician-only chart event.
      expect(surveillance.patientMessage ?? '').toBe('')

      // Patient app dashboard: no full-screen emergency overlay.
      await page.goto('/dashboard')
      await page.waitForLoadState('networkidle').catch(() => {})
      const emergencyVisible = await page
        .locator(byTestId(T.emergency.screen))
        .isVisible()
        .catch(() => false)
      expect(
        emergencyVisible,
        'patient must NOT see an emergency screen for a Tier 3 surveillance row',
      ).toBe(false)

      // Notifications inbox: no new row for the surveillance alert. The
      // engine writes Notification rows for alerts with non-empty
      // patientMessage; surveillance has an empty patient message, so the
      // notifications count must NOT grow.
      const notifsAfter = await tc.listNotifications(userId)
      expect(
        notifsAfter.length,
        `surveillance must not add a patient notification (before=${notifsBefore.length}, after=${notifsAfter.length})`,
      ).toBe(notifsBefore.length)
    } finally {
      await tc.dispose()
    }
  })
})

test.describe('Cluster 8 §D-PATIENT — first-month adherence nudge', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('11. Patient enrolled ≤30d + first missed dose → Tier 3 educational nudge text appears in notifications', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      // ENROLLED stamps enrolledAt = now. Backdate by 10 days so the
      // first-month window is comfortably open (well within 30d).
      await tc.setEnrollment(uid, 'ENROLLED')
      await tc.backdateEnrolledAt(uid, 10 * 24 * 60 * 60)
      // Non-BB med so the BB single-miss carve-out doesn't ALSO fire
      // RULE_MEDICATION_MISSED — isolates the nudge.
      await tc.setUserMedication(uid, {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          medicationTaken: false,
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }

      const alerts = await waitForAlerts(tc, userId, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE'),
      )
      const nudge = alerts.find((a) => a.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE')!
      expect(nudge.tier).toBe('TIER_3_INFO')

      // Notifications page surfaces the row. Match by the verbatim approved
      // wording — §F.2 snapshot also protects this string from silent edits.
      await page.goto('/notifications')
      await expect(
        page.getByText(/starting a new medicine/i).first(),
      ).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })

  test('12. Patient enrolled >30d + missed dose → nudge does NOT appear', async ({ page }) => {
    test.setTimeout(120_000)
    const { tc, userId } = await setupPatient(PATIENTS.aisha.email, async (tc, uid) => {
      await tc.setEnrollment(uid, 'ENROLLED')
      // Push enrolledAt to 45 days ago — outside the first-month window.
      await tc.backdateEnrolledAt(uid, 45 * 24 * 60 * 60)
      await tc.setUserMedication(uid, {
        drugName: 'Lisinopril',
        drugClass: 'ACE_INHIBITOR',
        frequency: 'ONCE_DAILY',
        verificationStatus: 'VERIFIED',
      })
    })
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      try {
        await postJournalEntry(api, {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          medicationTaken: false,
          sessionId: crypto.randomUUID(),
        })
      } finally {
        await api.dispose()
      }

      // Settle window so the engine has a chance to NOT write the row.
      await page.waitForTimeout(2500)
      const alerts = await tc.listAlerts(userId)
      expect(
        alerts.find((a) => a.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE'),
        '>30d post-enrollment must NOT fire the first-month nudge',
      ).toBeUndefined()

      await page.goto('/notifications')
      await page.waitForLoadState('networkidle').catch(() => {})
      const nudgeText = page.getByText(/starting a new medicine/i)
      expect(await nudgeText.count()).toBe(0)
    } finally {
      await tc.dispose()
    }
  })
})
