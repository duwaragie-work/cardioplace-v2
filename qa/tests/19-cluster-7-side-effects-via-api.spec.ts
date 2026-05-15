import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Cluster 7 — Appendix A side-effect + interaction rules via the API
 * (Manisha 5/11 sign-off).
 *
 * One Playwright test per new rule. Each composes a persona via test-control
 * (reset → seed history → set condition + medication), posts a daily-journal
 * entry carrying the relevant symptom flag, then polls listAlerts until the
 * expected ruleId appears.
 *
 * Personas:
 *   - aisha  — control, no condition flags, no meds. Used for non-HF variants.
 *   - mike   — HFpEF, used for HF-gated rules (A.2 HF, A.6 caregiver edema).
 *   - kate   — HCM, used for A.5 HCM low BP under-perfusion wording.
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

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
    sessionId: randomUUID(),
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

async function waitForAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  timeoutMs = 12_000,
): Promise<AlertRow[]> {
  const deadline = Date.now() + timeoutMs
  let last: AlertRow[] = []
  while (Date.now() < deadline) {
    last = await tc.listAlerts(userId)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 200))
  }
  return last
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
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          fatigue: true,
          sessionId: randomUUID(),
        },
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
    const u = await tc.findUser(PATIENTS.mike.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserCondition(u.id, 'hasHeartFailure', true, 'HFPEF')
    await tc.setUserMedication(u.id, {
      drugName: 'Metoprolol',
      drugClass: 'BETA_BLOCKER',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.mike.email)
    try {
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          shortnessOfBreath: true,
          sessionId: randomUUID(),
        },
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF'),
      )
      const sobHfRow = alerts.find((a) => a.ruleId === 'RULE_BETA_BLOCKER_SOB_HF')
      expect(sobHfRow?.tier).toBe('TIER_2_DISCREPANCY')
    } finally {
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
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          shortnessOfBreath: true,
          sessionId: randomUUID(),
        },
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
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          nsaidUse: true,
          sessionId: randomUUID(),
        },
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
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          dryCough: true,
          sessionId: randomUUID(),
        },
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

  test('A.5 — HCM + SBP <100 → RULE_HCM_LOW carries under-perfusion patient wording', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.kate.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.kate.email)
    try {
      const sessionId = randomUUID()
      // Two readings in same session → averaged → bypasses Q2 single-reading gate.
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 96,
          diastolicBP: 64,
          pulse: 70,
          position: 'SITTING',
          sessionId,
        },
      })
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date(Date.now() + 60_000).toISOString(),
          systolicBP: 94,
          diastolicBP: 62,
          pulse: 70,
          position: 'SITTING',
          sessionId,
        },
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_HCM_LOW'),
      )
      const hcmLow = alerts.find((a) => a.ruleId === 'RULE_HCM_LOW')
      expect(hcmLow?.patientMessage ?? '').toMatch(/low blood pressure can reduce blood flow/i)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('A.6 — legSwelling + HF → RULE_HF_CAREGIVER_EDEMA fires alongside hfDecomp', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.mike.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    await tc.setUserCondition(u.id, 'hasHeartFailure', true, 'HFPEF')
    const api = await authedApi(API_BASE_URL, PATIENTS.mike.email)
    try {
      await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          legSwelling: true,
          sessionId: randomUUID(),
        },
      })
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_HF_CAREGIVER_EDEMA'),
      )
      expect(alerts.map((a) => a.ruleId)).toContain('RULE_HF_CAREGIVER_EDEMA')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
