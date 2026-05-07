import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { postJournalEntry, type CreateJournalEntry } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * COMPREHENSIVE rule engine + multi-alert coverage. One spec per
 * CLINICAL_SPEC branch + a dedicated set for multi-alert scenarios where
 * one reading triggers multiple rules (pre-gate + BP rule, BP + Tier 3
 * physician-only annotation, etc.).
 *
 * Each test:
 *   1. resets the patient via /test-control
 *   2. submits a deterministic reading via POST /daily-journal
 *   3. asserts the resulting DeviationAlert(s) by tier + ruleId
 *
 * Pass = expected ruleId(s) present, NO unexpected ruleIds.
 * Fail = either expected absent, or extra rules fired (unless test allows).
 */

const FUTURE = (offsetMin = 0) =>
  new Date(Date.now() + offsetMin * 60_000).toISOString()

type Expectation = {
  label: string
  patient: keyof typeof PATIENTS
  entry: CreateJournalEntry
  // The rule(s) we expect to fire. Order doesn't matter.
  expectRuleIds: string[]
  // The tier(s) we expect on the corresponding alerts.
  expectTiers: string[]
  // If true: assert NO other rules fired beyond expectRuleIds.
  exclusive?: boolean
  // Optional: additional setup before submitting (e.g. multiple readings for AFib gate).
  preSubmit?: (api: Awaited<ReturnType<typeof authedApi>>, sessionId: string) => Promise<void>
  notes?: string
}

let tc: TestControl

test.beforeAll(async () => {
  tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
})

test.afterAll(async () => {
  await tc?.dispose()
})

async function submitAndAssert(e: Expectation): Promise<{
  fired: string[]
  tiers: string[]
  unexpected: string[]
}> {
  const u = await tc.findUser(PATIENTS[e.patient].email)
  await tc.resetUser(u.id)
  const api = await authedApi(API_BASE_URL, PATIENTS[e.patient].email)

  const sessionId = randomUUID()
  if (e.preSubmit) await e.preSubmit(api, sessionId)
  await postJournalEntry(api, { ...e.entry, sessionId })

  // Allow async event-driven engine ≤4s to land alerts.
  let alerts: Awaited<ReturnType<typeof tc.listAlerts>> = []
  for (let i = 0; i < 40; i++) {
    alerts = await tc.listAlerts(u.id)
    const haveAll = e.expectRuleIds.every((r) => alerts.some((a) => a.ruleId === r))
    if (haveAll) break
    await new Promise((r) => setTimeout(r, 100))
  }
  await api.dispose()

  const fired = alerts.map((a) => a.ruleId)
  const tiers = alerts.map((a) => a.tier)
  const unexpected = e.exclusive
    ? fired.filter((r) => !e.expectRuleIds.includes(r))
    : []
  return { fired, tiers, unexpected }
}

// ─── Section 1 — Standard adult thresholds ─────────────────────────────────
test.describe('Standard adult thresholds (CLINICAL_SPEC §1.2)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')

  const cases: Expectation[] = [
    {
      label: '124/78 (normal) → no alert',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 124, diastolicBP: 78, pulse: 72 },
      expectRuleIds: [],
      expectTiers: [],
      exclusive: true,
    },
    {
      label: '165/100 (Severe Stage 2) → STANDARD_L1_HIGH',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 165, diastolicBP: 100, pulse: 78 },
      expectRuleIds: ['RULE_STANDARD_L1_HIGH'],
      expectTiers: ['BP_LEVEL_1_HIGH'],
    },
    {
      label: '185/95 (SBP ≥180) → ABSOLUTE_EMERGENCY (BP_LEVEL_2)',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 185, diastolicBP: 95, pulse: 88 },
      expectRuleIds: ['RULE_ABSOLUTE_EMERGENCY'],
      expectTiers: ['BP_LEVEL_2'],
    },
    {
      label: '170/125 (DBP ≥120) → ABSOLUTE_EMERGENCY',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 170, diastolicBP: 125, pulse: 80 },
      expectRuleIds: ['RULE_ABSOLUTE_EMERGENCY'],
      expectTiers: ['BP_LEVEL_2'],
    },
    {
      label: 'Aisha 95/75 (65+ override) → AGE_65_LOW',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 95, diastolicBP: 75, pulse: 68 },
      expectRuleIds: ['RULE_AGE_65_LOW'],
      expectTiers: ['BP_LEVEL_1_LOW'],
      notes: 'Aisha DOB 1958 — 65+ lower bound is <100, not standard <90',
    },
  ]

  for (const c of cases) {
    test(c.label, async () => {
      const r = await submitAndAssert(c)
      for (const ruleId of c.expectRuleIds) {
        expect(r.fired, `${c.label} | expected ${ruleId} | fired: [${r.fired.join(',')}]`).toContain(ruleId)
      }
      if (c.exclusive) {
        expect(r.unexpected, `${c.label} | unexpected fires: ${r.unexpected.join(',')}`).toEqual([])
      }
    })
  }
})

// ─── Section 2 — Symptom overrides (§1.3) ──────────────────────────────────
test.describe('Symptom overrides — Level 2 at any BP', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  const symptoms: Array<[string, Partial<CreateJournalEntry>]> = [
    ['severeHeadache', { severeHeadache: true }],
    ['visualChanges', { visualChanges: true }],
    ['alteredMentalStatus', { alteredMentalStatus: true }],
    ['chestPainOrDyspnea', { chestPainOrDyspnea: true }],
    ['focalNeuroDeficit', { focalNeuroDeficit: true }],
    ['severeEpigastricRuq', { severeEpigastricRuq: true }],
  ]

  for (const [name, flag] of symptoms) {
    test(`general symptom override "${name}" at 130/80 → BP L2 SYMPTOM_OVERRIDE`, async () => {
      const r = await submitAndAssert({
        label: name,
        patient: 'aisha',
        entry: { measuredAt: FUTURE(), systolicBP: 130, diastolicBP: 80, pulse: 72, ...flag },
        expectRuleIds: ['RULE_SYMPTOM_OVERRIDE_GENERAL'],
        expectTiers: ['BP_LEVEL_2_SYMPTOM_OVERRIDE'],
      })
      expect(r.fired, `${name} | fired: [${r.fired.join(',')}]`).toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
    })
  }

  test('pregnancy-specific symptom override (newOnsetHeadache) → SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy newOnsetHeadache',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 130, diastolicBP: 80, pulse: 76, newOnsetHeadache: true },
      expectRuleIds: ['RULE_SYMPTOM_OVERRIDE_PREGNANCY'],
      expectTiers: ['BP_LEVEL_2_SYMPTOM_OVERRIDE'],
    })
    expect(r.fired).toContain('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
  })

  test('pregnancy-specific symptom override (ruqPain) → SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy ruqPain',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 130, diastolicBP: 80, pulse: 76, ruqPain: true },
      expectRuleIds: ['RULE_SYMPTOM_OVERRIDE_PREGNANCY'],
      expectTiers: ['BP_LEVEL_2_SYMPTOM_OVERRIDE'],
    })
    expect(r.fired).toContain('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
  })

  test('pregnancy-specific symptom override (edema) → SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy edema',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 130, diastolicBP: 80, pulse: 76, edema: true },
      expectRuleIds: ['RULE_SYMPTOM_OVERRIDE_PREGNANCY'],
      expectTiers: ['BP_LEVEL_2_SYMPTOM_OVERRIDE'],
    })
    expect(r.fired).toContain('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
  })
})

// ─── Section 3 — Pregnancy thresholds (§3) ─────────────────────────────────
test.describe('Pregnancy thresholds (§3)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Priya 145/95 → PREGNANCY_L1_HIGH (and ACE Tier 1 from pre-gate)', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy L1',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 145, diastolicBP: 95, pulse: 82 },
      expectRuleIds: ['RULE_PREGNANCY_L1_HIGH', 'RULE_PREGNANCY_ACE_ARB'],
      expectTiers: ['BP_LEVEL_1_HIGH', 'TIER_1_CONTRAINDICATION'],
    })
    expect(r.fired).toContain('RULE_PREGNANCY_L1_HIGH')
    expect(r.fired).toContain('RULE_PREGNANCY_ACE_ARB')
  })

  test('Priya 165/115 → PREGNANCY_L2 (and ACE Tier 1)', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy L2',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 165, diastolicBP: 115, pulse: 86 },
      expectRuleIds: ['RULE_PREGNANCY_L2', 'RULE_PREGNANCY_ACE_ARB'],
      expectTiers: ['BP_LEVEL_2', 'TIER_1_CONTRAINDICATION'],
    })
    expect(r.fired).toContain('RULE_PREGNANCY_L2')
    expect(r.fired).toContain('RULE_PREGNANCY_ACE_ARB')
  })
})

// ─── Section 4 — Contraindications (§7) ────────────────────────────────────
test.describe('Tier 1 contraindications (§7)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Priya pregnant + Lisinopril (ACE) → PREGNANCY_ACE_ARB Tier 1', async () => {
    const r = await submitAndAssert({
      label: 'pregnancy + ACE',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 132, diastolicBP: 84, pulse: 78 },
      expectRuleIds: ['RULE_PREGNANCY_ACE_ARB'],
      expectTiers: ['TIER_1_CONTRAINDICATION'],
      notes: 'Pre-gate rule — fires regardless of BP value',
    })
    expect(r.fired).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(r.tiers).toContain('TIER_1_CONTRAINDICATION')
  })

  test('James HFrEF + Diltiazem (NDHP) → NDHP_HFREF Tier 1', async () => {
    const r = await submitAndAssert({
      label: 'HFrEF + NDHP',
      patient: 'james',
      entry: { measuredAt: FUTURE(), systolicBP: 118, diastolicBP: 74, pulse: 68 },
      expectRuleIds: ['RULE_NDHP_HFREF'],
      expectTiers: ['TIER_1_CONTRAINDICATION'],
    })
    expect(r.fired).toContain('RULE_NDHP_HFREF')
    expect(r.tiers).toContain('TIER_1_CONTRAINDICATION')
  })
})

// ─── Section 5 — Heart Failure (§4.2 + 4.9) ────────────────────────────────
test.describe('Heart Failure rules (§4.2 HFrEF, §4.9 HFpEF)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('James HFrEF SBP 80 → HFREF_LOW (low bound <85)', async () => {
    const r = await submitAndAssert({
      label: 'HFrEF low',
      patient: 'james',
      entry: { measuredAt: FUTURE(), systolicBP: 80, diastolicBP: 50, pulse: 68 },
      expectRuleIds: ['RULE_HFREF_LOW', 'RULE_NDHP_HFREF'],
      expectTiers: ['BP_LEVEL_1_LOW', 'TIER_1_CONTRAINDICATION'],
    })
    expect(r.fired).toContain('RULE_HFREF_LOW')
  })

  test('James HFrEF SBP 165 → HFREF_HIGH', async () => {
    const r = await submitAndAssert({
      label: 'HFrEF high',
      patient: 'james',
      entry: { measuredAt: FUTURE(), systolicBP: 165, diastolicBP: 95, pulse: 78 },
      expectRuleIds: ['RULE_HFREF_HIGH', 'RULE_NDHP_HFREF'],
      expectTiers: ['BP_LEVEL_1_HIGH', 'TIER_1_CONTRAINDICATION'],
    })
    expect(r.fired).toContain('RULE_HFREF_HIGH')
  })
})

// ─── Section 6 — CAD (§4.3) ────────────────────────────────────────────────
test.describe('CAD rules (§4.3)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Rita CAD DBP 68 → CAD_DBP_CRITICAL (DBP <70 regardless of SBP)', async () => {
    const r = await submitAndAssert({
      label: 'CAD DBP critical',
      patient: 'rita',
      entry: { measuredAt: FUTURE(), systolicBP: 130, diastolicBP: 68, pulse: 72 },
      expectRuleIds: ['RULE_CAD_DBP_CRITICAL'],
      expectTiers: ['BP_LEVEL_1_LOW'],
    })
    expect(r.fired).toContain('RULE_CAD_DBP_CRITICAL')
  })

  test('Rita CAD SBP 165 → CAD_HIGH', async () => {
    const r = await submitAndAssert({
      label: 'CAD high',
      patient: 'rita',
      entry: { measuredAt: FUTURE(), systolicBP: 165, diastolicBP: 95, pulse: 78 },
      expectRuleIds: ['RULE_CAD_HIGH'],
      expectTiers: ['BP_LEVEL_1_HIGH'],
    })
    expect(r.fired).toContain('RULE_CAD_HIGH')
  })
})

// ─── Section 7 — AFib (§4.4 — requires ≥3 readings per session) ────────────
test.describe('AFib HR rules (§4.4 — ≥3-reading session gate)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Charles AFib + HR 115 (3rd reading in session) → AFIB_HR_HIGH', async () => {
    const r = await submitAndAssert({
      label: 'AFib HR high',
      patient: 'charles',
      entry: { measuredAt: FUTURE(2), systolicBP: 132, diastolicBP: 82, pulse: 115 },
      expectRuleIds: ['RULE_AFIB_HR_HIGH'],
      expectTiers: ['BP_LEVEL_1_HIGH'],
      preSubmit: async (api, sessionId) => {
        // Two prior readings in same session to satisfy the ≥3 gate
        await postJournalEntry(api, {
          measuredAt: FUTURE(0),
          systolicBP: 130,
          diastolicBP: 80,
          pulse: 110,
          sessionId,
        })
        await postJournalEntry(api, {
          measuredAt: FUTURE(1),
          systolicBP: 132,
          diastolicBP: 82,
          pulse: 112,
          sessionId,
        })
      },
    })
    expect(r.fired).toContain('RULE_AFIB_HR_HIGH')
  })

  test('Charles AFib + HR 45 (≥3 in session) → AFIB_HR_LOW', async () => {
    const r = await submitAndAssert({
      label: 'AFib HR low',
      patient: 'charles',
      entry: { measuredAt: FUTURE(2), systolicBP: 120, diastolicBP: 80, pulse: 45 },
      expectRuleIds: ['RULE_AFIB_HR_LOW'],
      expectTiers: ['BP_LEVEL_1_LOW'],
      preSubmit: async (api, sessionId) => {
        await postJournalEntry(api, {
          measuredAt: FUTURE(0),
          systolicBP: 122,
          diastolicBP: 80,
          pulse: 48,
          sessionId,
        })
        await postJournalEntry(api, {
          measuredAt: FUTURE(1),
          systolicBP: 120,
          diastolicBP: 78,
          pulse: 46,
          sessionId,
        })
      },
    })
    expect(r.fired).toContain('RULE_AFIB_HR_LOW')
  })

  test('Charles AFib + HR 115 with only 1 reading → AFib gate closes BP/HR rules', async () => {
    const r = await submitAndAssert({
      label: 'AFib gate single reading',
      patient: 'charles',
      entry: { measuredAt: FUTURE(), systolicBP: 132, diastolicBP: 82, pulse: 115 },
      expectRuleIds: [],
      expectTiers: [],
    })
    expect(r.fired, `expected no AFib rules from single reading; fired: [${r.fired.join(',')}]`).not.toContain('RULE_AFIB_HR_HIGH')
  })
})

// ─── Section 8 — Tier 3 physician-only annotations ─────────────────────────
test.describe('Tier 3 physician-only annotations', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Wide pulse pressure (170/85 → PP=85) → PULSE_PRESSURE_WIDE Tier 3', async () => {
    const r = await submitAndAssert({
      label: 'wide PP',
      patient: 'aisha',
      entry: { measuredAt: FUTURE(), systolicBP: 170, diastolicBP: 85, pulse: 78 },
      expectRuleIds: ['RULE_PULSE_PRESSURE_WIDE', 'RULE_STANDARD_L1_HIGH'],
      expectTiers: ['TIER_3_INFO', 'BP_LEVEL_1_HIGH'],
      notes: 'PP rule rides as a separate Tier 3 alongside the primary BP rule',
    })
    // PP rule may ride as physicianAnnotation on the primary alert OR as
    // its own Tier 3 row. Accept either by checking the alerts list.
    const ppPresent =
      r.fired.includes('RULE_PULSE_PRESSURE_WIDE') ||
      r.tiers.includes('TIER_3_INFO')
    expect(ppPresent, `expected wide pulse pressure flagged; fired: [${r.fired.join(',')}], tiers: [${r.tiers.join(',')}]`).toBeTruthy()
  })
})

// ─── Section 9 — Multi-alert / pre-gate scenarios ──────────────────────────
test.describe('Multi-alert: pre-gate Tier 1 + BP rule fire together', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('Priya 175/115 → BOTH PREGNANCY_ACE_ARB (T1) AND PREGNANCY_L2 (BP L2)', async () => {
    const r = await submitAndAssert({
      label: 'multi: pregnancy ACE + L2',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 175, diastolicBP: 115, pulse: 86 },
      expectRuleIds: ['RULE_PREGNANCY_ACE_ARB', 'RULE_PREGNANCY_L2'],
      expectTiers: ['TIER_1_CONTRAINDICATION', 'BP_LEVEL_2'],
    })
    expect(r.fired).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(r.fired).toContain('RULE_PREGNANCY_L2')
  })

  test('James 95/65 + chestPain → NDHP_HFREF (T1) + SYMPTOM_OVERRIDE_GENERAL (BP L2 SO)', async () => {
    const r = await submitAndAssert({
      label: 'multi: NDHP + symptom override',
      patient: 'james',
      entry: {
        measuredAt: FUTURE(),
        systolicBP: 95,
        diastolicBP: 65,
        pulse: 68,
        chestPainOrDyspnea: true,
      },
      expectRuleIds: ['RULE_NDHP_HFREF', 'RULE_SYMPTOM_OVERRIDE_GENERAL'],
      expectTiers: ['TIER_1_CONTRAINDICATION', 'BP_LEVEL_2_SYMPTOM_OVERRIDE'],
    })
    expect(r.fired).toContain('RULE_NDHP_HFREF')
    expect(r.fired).toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
  })

  test('Priya 145/95 → 3 alerts: PREGNANCY_ACE_ARB + PREGNANCY_L1_HIGH', async () => {
    const r = await submitAndAssert({
      label: 'multi: pregnancy L1 + ACE',
      patient: 'priya',
      entry: { measuredAt: FUTURE(), systolicBP: 145, diastolicBP: 95, pulse: 82 },
      expectRuleIds: ['RULE_PREGNANCY_ACE_ARB', 'RULE_PREGNANCY_L1_HIGH'],
      expectTiers: ['TIER_1_CONTRAINDICATION', 'BP_LEVEL_1_HIGH'],
    })
    expect(r.fired).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(r.fired).toContain('RULE_PREGNANCY_L1_HIGH')
  })
})

// ─── Section 10 — Benign auto-resolve ──────────────────────────────────────
test.describe('Benign reading auto-resolves open BP_LEVEL_1', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('165/100 then 124/78 → first alert flips OPEN→RESOLVED', async () => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)

    await postJournalEntry(api, {
      measuredAt: FUTURE(0),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
      sessionId: randomUUID(),
    })
    await new Promise((r) => setTimeout(r, 1500))
    let alerts = await tc.listAlerts(u.id)
    const elevatedId = alerts.find((a) => a.tier === 'BP_LEVEL_1_HIGH')?.id
    expect(elevatedId, 'expected elevated alert from first reading').toBeDefined()

    await postJournalEntry(api, {
      measuredAt: FUTURE(2),
      systolicBP: 124,
      diastolicBP: 78,
      pulse: 72,
      sessionId: randomUUID(),
    })
    await new Promise((r) => setTimeout(r, 1500))
    alerts = await tc.listAlerts(u.id)
    const after = alerts.find((a) => a.id === elevatedId)
    expect(after?.status, 'expected BP_LEVEL_1_HIGH to auto-resolve').toBe('RESOLVED')
    await api.dispose()
  })

  test('Tier 1 contraindication does NOT auto-resolve on benign reading', async () => {
    const u = await tc.findUser(PATIENTS.priya.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.priya.email)

    await postJournalEntry(api, {
      measuredAt: FUTURE(0),
      systolicBP: 145,
      diastolicBP: 95,
      pulse: 82,
      sessionId: randomUUID(),
    })
    await new Promise((r) => setTimeout(r, 1500))
    let alerts = await tc.listAlerts(u.id)
    const tier1Id = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')?.id
    expect(tier1Id, 'expected Tier 1 from pregnancy + ACE').toBeDefined()

    // Submit a benign reading
    await postJournalEntry(api, {
      measuredAt: FUTURE(2),
      systolicBP: 122,
      diastolicBP: 76,
      pulse: 76,
      sessionId: randomUUID(),
    })
    await new Promise((r) => setTimeout(r, 1500))
    alerts = await tc.listAlerts(u.id)
    const after = alerts.find((a) => a.id === tier1Id)
    expect(after?.status, 'Tier 1 must NOT auto-resolve on benign reading').not.toBe('RESOLVED')
    await api.dispose()
  })
})
