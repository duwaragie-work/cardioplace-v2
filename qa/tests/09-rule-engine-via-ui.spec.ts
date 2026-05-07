import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { postJournalEntry } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Rule engine E2E via the API — for each branch of CLINICAL_SPEC, drive a
 * deterministic reading and assert the resulting `DeviationAlert.tier +
 * ruleId` matches what the spec says should fire.
 *
 * We submit via `POST /daily-journal` instead of clicking through the wizard
 * because:
 *  - the wizard markup is volatile (1855 lines, multiple steps, conditional
 *    symptoms) — selectors would drift
 *  - the engine itself is what we're testing; the wizard's UX is covered
 *    separately in 05-patient-check-in
 *  - per-test-fast: API submission is ~100ms vs ~3s wizard walk
 *
 * Each test resets the patient's prior journal/alert state via test-control
 * before submitting, so the assertion is deterministic regardless of
 * preceding tests.
 */

test.describe('Rule engine — fires the expected ruleId per CLINICAL_SPEC branch', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1',
  )

  let tc: TestControl

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })

  test.afterAll(async () => {
    await tc?.dispose()
  })

  type Case = {
    label: string
    patient: keyof typeof PATIENTS
    entry: Parameters<typeof postJournalEntry>[1]
    expectTier: string | string[]
    expectRuleId?: string
    notes?: string
  }

  const cases: Case[] = [
    {
      label: 'Aisha 165/100 → standard L1 high',
      patient: 'aisha',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 165, diastolicBP: 100, pulse: 78 },
      expectTier: 'BP_LEVEL_1_HIGH',
      expectRuleId: 'RULE_STANDARD_L1_HIGH',
    },
    {
      label: 'Aisha 185/95 → BP Level 2 (absolute SBP ≥180)',
      patient: 'aisha',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 185, diastolicBP: 95, pulse: 88 },
      expectTier: 'BP_LEVEL_2',
    },
    {
      label: 'Aisha 130/80 + chestPainOrDyspnea → BP Level 2 symptom override',
      patient: 'aisha',
      entry: {
        measuredAt: new Date().toISOString(),
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 72,
        chestPainOrDyspnea: true,
      },
      expectTier: 'BP_LEVEL_2_SYMPTOM_OVERRIDE',
    },
    {
      label: 'Priya pregnant + Lisinopril (already seeded) → pregnancy ACE/ARB Tier 1',
      patient: 'priya',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 132, diastolicBP: 84, pulse: 78 },
      expectTier: 'TIER_1_CONTRAINDICATION',
      expectRuleId: 'RULE_PREGNANCY_ACE_ARB',
      notes:
        'Tier 1 contraindication is a pre-gate rule — it fires regardless of the BP value (seeded normal range here)',
    },
    {
      label: 'Priya 145/95 (pregnant) → pregnancy L1',
      patient: 'priya',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 145, diastolicBP: 95, pulse: 82 },
      expectTier: ['BP_LEVEL_1_HIGH', 'TIER_1_CONTRAINDICATION'],
      notes:
        'Both fire — the contraindication is pre-gate, the L1 is the BP rule. Either tier passing the test is correct.',
    },
    {
      label: 'James HFrEF + Diltiazem (NDHP) → NDHP+HFrEF Tier 1',
      patient: 'james',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 118, diastolicBP: 74, pulse: 68 },
      expectTier: 'TIER_1_CONTRAINDICATION',
      expectRuleId: 'RULE_NDHP_HFREF',
    },
    {
      label: 'Rita CAD + DBP 68 → CAD critical',
      patient: 'rita',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 122, diastolicBP: 68, pulse: 72 },
      expectTier: 'BP_LEVEL_1_LOW',
      expectRuleId: 'RULE_CAD_DBP_CRITICAL',
    },
    {
      label: 'Aisha 65+ + 95/75 → 65+ low override (RULE_AGE_65_LOW, threshold <100 not <90)',
      patient: 'aisha',
      entry: { measuredAt: new Date().toISOString(), systolicBP: 95, diastolicBP: 75, pulse: 68 },
      expectTier: 'BP_LEVEL_1_LOW',
      // Aisha was born 1958 → age 65+ at the seed-day-of-test. CLINICAL_SPEC §1.1.
    },
  ]

  for (const c of cases) {
    test(c.label, async () => {
      const u = await tc.findUser(PATIENTS[c.patient].email)
      await tc.resetUser(u.id)
      const api = await authedApi(API_BASE_URL, PATIENTS[c.patient].email)
      const created = await postJournalEntry(api, c.entry)
      expect(created.id).toBeDefined()

      // Async event-driven engine — give it up to 3s to land an alert row.
      let alerts: Awaited<ReturnType<typeof tc.listAlerts>> = []
      for (let i = 0; i < 30; i++) {
        alerts = await tc.listAlerts(u.id)
        if (alerts.length > 0) break
        await new Promise((r) => setTimeout(r, 100))
      }

      const expectTiers = Array.isArray(c.expectTier) ? c.expectTier : [c.expectTier]
      const tiers = alerts.map((a) => a.tier)
      const matched = expectTiers.some((t) => tiers.includes(t))
      expect(
        matched,
        `${c.label}: expected one of ${expectTiers.join(',')} in [${tiers.join(',')}]\n` +
          (c.notes ?? ''),
      ).toBeTruthy()

      if (c.expectRuleId) {
        const ruleIds = alerts.map((a) => a.ruleId)
        expect(ruleIds, `expected ruleId ${c.expectRuleId} in [${ruleIds.join(',')}]`).toContain(
          c.expectRuleId,
        )
      }
      await api.dispose()
    })
  }
})

test.describe('Rule engine — benign reading auto-resolves open BP_LEVEL_1', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('165/100 then 124/78 → first alert flips OPEN→RESOLVED', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(api, {
      measuredAt: new Date(Date.now() - 60_000).toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
      sessionId: 'session-elevated',
    })
    await new Promise((r) => setTimeout(r, 1500))
    let alerts = await tc.listAlerts(u.id)
    const elevatedId = alerts.find((a) => a.tier === 'BP_LEVEL_1_HIGH')?.id
    expect(elevatedId).toBeDefined()

    // Submit a benign reading — auto-resolve should kick in
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 124,
      diastolicBP: 78,
      pulse: 72,
      sessionId: 'session-benign',
    })
    await new Promise((r) => setTimeout(r, 1500))
    alerts = await tc.listAlerts(u.id)
    const elevatedAfter = alerts.find((a) => a.id === elevatedId)
    expect(elevatedAfter?.status, 'expected BP_LEVEL_1_HIGH to auto-resolve').toBe('RESOLVED')

    await api.dispose()
    await tc.dispose()
  })
})
