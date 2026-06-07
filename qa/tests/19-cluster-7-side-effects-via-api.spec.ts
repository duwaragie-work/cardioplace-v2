import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { postSessionWithTwoReadings, waitForAlerts } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 7 — Appendix A side-effect + interaction rules via the API
 * (Manisha 5/11 sign-off).
 *
 * One Playwright test per new rule. Each composes a persona via test-control
 * (reset → seed history → flip condition flags → set medication), posts a
 * 2-reading journal session carrying the relevant symptom flag, then polls
 * listAlerts until the expected ruleId appears.
 *
 * NOTE — Cluster 7 side-effect rules are classified Stage C, so they inherit
 * the Cluster 6 Q2 session-averaging gate (alert-engine.service.ts ~line 425).
 * Tests submit TWO readings in the same `sessionId` (1 minute apart) via
 * `postSessionWithTwoReadings` to satisfy the gate. If Manisha later decides
 * side-effect rules should fire on a single reading, the engine changes —
 * these tests still pass (2 readings still triggers the rule).
 *
 * PERSONA STRATEGY — Aisha + test-control flag flips.
 *   The Cluster 6 persona expansion (Mike, Kate, Carol, Olive, Iris, Jane)
 *   is not yet seeded on every dev DB. To stay portable, every test runs
 *   against Aisha (always seeded) and flips `hasHeartFailure` / `hasHCM`
 *   on her PatientProfile in setup, then restores the original flag value
 *   in `finally`. Each test also calls `resetUser(u.id)` first to wipe
 *   journal/alert/notification rows from prior runs.
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

test.describe('Cluster 7 — side-effect + interaction rules via API (Manisha 5/11)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('A.1 — fatigue + β-blocker → RULE_BETA_BLOCKER_FATIGUE fires', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Metoprolol',
      drugClass: 'BETA_BLOCKER',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        fatigue: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_FATIGUE'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_BETA_BLOCKER_FATIGUE')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.2 (HF variant) — SOB + HF + β-blocker → RULE_BETA_BLOCKER_SOB_HF Tier 2', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Flip HF flag on Aisha for this test; restore in finally so subsequent
    // non-HF tests see her default state.
    await tc.setUserCondition(u.id, 'hasHeartFailure', true, 'HFPEF')
    await tc.setUserMedication(u.id, {
      drugName: 'Metoprolol',
      drugClass: 'BETA_BLOCKER',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        shortnessOfBreath: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF'),
      )
      const sobHfRow = alerts.find((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF')
      expect(sobHfRow?.tier).toBe('TIER_2_DISCREPANCY')
    } finally {
      await tc.setUserCondition(u.id, 'hasHeartFailure', false, 'NOT_APPLICABLE')
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.2 (non-HF variant) — SOB + non-HF + β-blocker → RULE_BETA_BLOCKER_SOB_NON_HF', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Metoprolol',
      drugClass: 'BETA_BLOCKER',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        shortnessOfBreath: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_NON_HF'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_BETA_BLOCKER_SOB_NON_HF')
      expect(alerts.map((a) => a.ruleId)).not.toContain('RULE_BETA_BLOCKER_SOB_HF')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.3 — nsaidUse + antihypertensive (β-blocker) → RULE_NSAID_ANTIHTN_INTERACTION', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Metoprolol',
      drugClass: 'BETA_BLOCKER',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        nsaidUse: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_NSAID_ANTIHTN_INTERACTION'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_NSAID_ANTIHTN_INTERACTION')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.4 — dryCough + ACE inhibitor → RULE_ACE_COUGH', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        dryCough: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_COUGH'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_ACE_COUGH')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.5 — HCM + SBP <100 → RULE_HCM_LOW carries Doc-2 hydration / slow-stand wording', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Flip HCM on Aisha; restore in finally so other tests see her default state.
    await tc.setUserCondition(u.id, 'hasHCM', true)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 95,
        diastolicBP: 63,
        pulse: 70,
        position: 'SITTING',
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_HCM_LOW'),
      )
      const hcmLow = alerts.find((a) => a.ruleId === 'RULE_HCM_LOW')
      // H4: Manisha Doc 2 superseded the Cluster-7 "under-perfusion" wording with
      // direct hydration + slow-stand guidance (shared/src/alert-messages.ts RULE_HCM_LOW).
      expect(hcmLow?.patientMessage ?? '').toMatch(/drink some water and sit or lie down/i)
    } finally {
      await tc.setUserCondition(u.id, 'hasHCM', false)
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.6 — legSwelling + HF → RULE_HF_CAREGIVER_EDEMA fires alongside hfDecomp', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserCondition(u.id, 'hasHeartFailure', true, 'HFPEF')
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        legSwelling: true,
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_HF_CAREGIVER_EDEMA'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_HF_CAREGIVER_EDEMA')
    } finally {
      await tc.setUserCondition(u.id, 'hasHeartFailure', false, 'NOT_APPLICABLE')
      await api.dispose()
      await tc.dispose()
    }
  })

  // A.6 follow-up — caregiver dispatch default-OFF guard. When the rule fires
  // we must NOT write a caregiver-routed Notification on the patient's behalf
  // (the caregiver dispatch path stays idle until Lakshitha Gap 5 ships the
  // PatientCaregiver relation + CAREGIVER_DISPATCH_ENABLED is flipped on).
  // Defensive — catches any regression that accidentally fans a "Caregiver
  // update" row out under the patient userId, or wires the dispatch to fire
  // when the env flag is unset.
  test('A.6 caregiver dispatch — default OFF produces no "Caregiver update" Notification', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserCondition(u.id, 'hasHeartFailure', true, 'HFPEF')
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postSessionWithTwoReadings(api, {
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        legSwelling: true,
      })
      // Confirm the rule fires before asserting the dispatch guard.
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_HF_CAREGIVER_EDEMA'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_HF_CAREGIVER_EDEMA')

      // Give the event loop a beat in case dispatch happens asynchronously,
      // then snapshot the patient's notifications.
      await new Promise((r) => setTimeout(r, 500))
      const notifications = await tc.listNotifications(u.id)
      const caregiverFanout = notifications.filter((n) => n.title === 'Caregiver update')
      expect(
        caregiverFanout,
        `expected no "Caregiver update" notifications on patient inbox (CAREGIVER_DISPATCH_ENABLED unset). Got: ${JSON.stringify(caregiverFanout)}`,
      ).toHaveLength(0)
    } finally {
      await tc.setUserCondition(u.id, 'hasHeartFailure', false, 'NOT_APPLICABLE')
      await api.dispose()
      await tc.dispose()
    }
  })

  // A.7 — admin marks a medication as HOLD → patient inbox receives the
  // SYSTEM_MSG_MEDICATION_HOLD notification carrying the drug name. The
  // admin-side endpoint already requires a rationale (mirroring REJECT).
  test('A.7 — admin HOLD action dispatches system message to patient inbox', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const med = await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    try {
      const res = await adminApi.post(`admin/medications/${med.id}/verify`, {
        data: {
          status: 'HOLD',
          // H3 #92 (d897040) tightened the contract — HOLD now requires a
          // structured holdReason (Manisha §3 codes). PROVIDER_DIRECTED_HOLD is
          // the clinical "pause it" path, whose patient message names the drug.
          holdReason: 'PROVIDER_DIRECTED_HOLD',
          rationale: 'Patient reports new GI bleed; hold pending in-person eval',
        },
      })
      expect(res.ok(), `verify-medication HOLD failed: ${res.status()} ${await res.text()}`).toBeTruthy()

      // Notification dispatch is best-effort (logged-not-rolled-back); allow
      // a brief poll window so we don't race the prisma write.
      const deadline = Date.now() + 4_000
      let holdNotification: Awaited<ReturnType<TestControl['listNotifications']>>[number] | undefined
      while (Date.now() < deadline) {
        const notifications = await tc.listNotifications(u.id)
        // H3 #92 / Manisha §3: a PROVIDER_DIRECTED_HOLD notice is titled
        // "Please pause a medication" and names the drug ("…pause Lisinopril…").
        holdNotification = notifications.find(
          (n) => n.title === 'Please pause a medication' && n.body.includes('Lisinopril'),
        )
        if (holdNotification) break
        await new Promise((r) => setTimeout(r, 200))
      }
      expect(holdNotification, 'expected SYSTEM_MSG_MEDICATION_HOLD notification in patient inbox').toBeDefined()
      expect(holdNotification?.body).toMatch(/pause/i)
    } finally {
      await adminApi.dispose()
      await tc.dispose()
    }
  })
})
