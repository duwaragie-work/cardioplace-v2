import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  postSessionWithTwoReadings,
  waitForAlerts,
} from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 8 — ACE-angioedema P0 pilot blocker + Q1/Q3 follow-up, via the API
 * (Manisha 5/18/26 sign-off).
 *
 * Angioedema is a Stage-A pre-gate rule: it fires for ALL patients on a
 * SINGLE reading (bypasses the AFib ≥3 + Q2 single-reading gates), so these
 * tests use single `postJournalEntry` posts. Persona strategy mirrors spec
 * 19 — Aisha (always seeded) + test-control condition/medication flips,
 * restored in `finally`.
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

test.describe('Cluster 8 — angioedema + Q1/Q3 via API (Manisha 5/18)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('A — faceSwelling + ACE inhibitor → RULE_ACE_ANGIOEDEMA Tier 1, "stop your medicine"', async () => {
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
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        faceSwelling: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')
      expect(row?.tier).toBe('TIER_1_ANGIOEDEMA')
      expect(row?.patientMessage ?? '').toMatch(
        /do not take any more of your blood pressure medicine/i,
      )
      expect(row?.physicianMessage ?? '').toMatch(/bradykinin-mediated/i)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A — faceSwelling + ARB (no ACE) → RULE_ACE_ANGIOEDEMA, ARB physician variant', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Clear Aisha's seed Lisinopril+Amlodipine — otherwise the engine sees
    // the ACE inhibitor in the roster and routes the ACE branch instead of
    // ARB. (resetUser doesn't touch PatientMedication rows.)
    await tc.clearUserMedications(u.id)
    await tc.setUserMedication(u.id, {
      drugName: 'Losartan',
      drugClass: 'ARB',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        faceSwelling: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_ACE_ANGIOEDEMA')
      expect(row?.tier).toBe('TIER_1_ANGIOEDEMA')
      expect(row?.physicianMessage ?? '').toMatch(/\(ARB\)/)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A — faceSwelling, NO ACE/ARB → RULE_GENERIC_ANGIOEDEMA (no "stop medicine" line)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Clear seed Lisinopril+Amlodipine so the engine routes GENERIC (no
    // ACE/ARB in roster). resetUser doesn't touch PatientMedication.
    await tc.clearUserMedications(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        faceSwelling: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA')
      expect(row?.tier).toBe('TIER_1_ANGIOEDEMA')
      expect(row?.patientMessage ?? '').not.toMatch(
        /do not take any more of your blood pressure medicine/i,
      )
      expect(alerts.map((a) => a.ruleId)).not.toContain('RULE_ACE_ANGIOEDEMA')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A — throatTightness fires Tier 1 for a no-medication patient (airway, all patients)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Clear seed meds — engine must see an empty roster to route GENERIC
    // (universal-airway rule fires for ALL patients regardless of meds).
    await tc.clearUserMedications(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        throatTightness: true,
        sessionId: crypto.randomUUID(),
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_GENERIC_ANGIOEDEMA')
      expect(row?.tier).toBe('TIER_1_ANGIOEDEMA')
      expect(row?.patientMessage ?? '').toMatch(/911/)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('B1 — Nora HR 45 (BB + bradycardia) → RULE_BRADY_SURVEILLANCE Tier 3', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.nora.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
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
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BRADY_SURVEILLANCE'),
      )
      const row = alerts.find((a) => a.ruleId === 'RULE_BRADY_SURVEILLANCE')
      expect(row?.tier).toBe('TIER_3_INFO')
      // Physician-only — no patient/caregiver alarm.
      expect(row?.patientMessage ?? '').toBe('')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('B3 — freshly-enrolled patient + first missed dose → RULE_FIRST_MONTH_ADHERENCE_NUDGE (one-time)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Fresh ENROLLED stamp → enrolledAt = now (within 30 days).
    await tc.setEnrollment(u.id, 'ENROLLED')
    // Non-beta-blocker med so the BB single-miss carve-out doesn't also
    // fire RULE_MEDICATION_MISSED — isolates the nudge.
    await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
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
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE'),
      )
      const row = alerts.find(
        (a) => a.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',
      )
      expect(row?.tier).toBe('TIER_3_INFO')
      expect(row?.patientMessage ?? '').toMatch(/starting a new medicine/i)
      // 2-of-3 default window unchanged — a single miss must NOT fire the
      // Tier 2 adherence rule.
      expect(alerts.map((a) => a.ruleId)).not.toContain('RULE_MEDICATION_MISSED')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Q2 — CAD 145/95 (in-ramp) fires BOTH RULE_CAD_HIGH and RULE_CAD_DBP_HIGH', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.paul.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Fresh ENROLLED stamp → enrolledAt = now ≥ CAD rollout anchor → Phase 1
    // "newly enrolled" → both the SBP≥140 default and the new DBP≥80 default
    // apply (the doc's "second independent alert trigger").
    await tc.setEnrollment(u.id, 'ENROLLED')
    const api = await authedApi(API_BASE_URL, PATIENTS.paul.email)
    try {
      // CAD_HIGH and CAD_DBP_HIGH are standard-pipeline rules — Cluster 6 Q2
      // single-reading-session gate suppresses them on a 1-reading post.
      // The seedHistoryToClearPreDay3 above clears preDay3Mode, but the
      // single-reading gate is independent. Submit BOTH readings in one
      // session so the engine accepts the session as confirmed.
      await postSessionWithTwoReadings(api, {
        systolicBP: 145,
        diastolicBP: 95,
        pulse: 72,
        position: 'SITTING',
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_CAD_DBP_HIGH'),
      )
      const ids = alerts.map((a) => a.ruleId)
      expect(ids).toContain('RULE_CAD_HIGH')
      expect(ids).toContain('RULE_CAD_DBP_HIGH')
      const dbpRow = alerts.find((a) => a.ruleId === 'RULE_CAD_DBP_HIGH')
      expect(dbpRow?.tier).toBe('BP_LEVEL_1_HIGH')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
