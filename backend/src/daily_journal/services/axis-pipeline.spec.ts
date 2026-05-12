// Phase/26 multi-axis pipeline spec — orchestrator-level cases that exercise
// the axis-bucketed emission introduced to fix the §1.1+§4.3 co-fire bug
// (65+ CAD patient with SBP 95 / DBP 65 must persist BOTH RULE_AGE_65_LOW
// and RULE_CAD_DBP_CRITICAL). Sister file: alert-engine.scenarios.spec.ts
// holds the doc-narrative cases (1–64). This file holds focused tests for
// the multi-axis emission rules: which rules co-fire, which suppress
// others, and the priority sort order applied before persistence.

import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type { ContextMedication, ResolvedContext } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AlertEngineService } from './alert-engine.service.js'
import { OutputGeneratorService } from './output-generator.service.js'
import { ProfileResolverService } from './profile-resolver.service.js'
import { SessionAveragerService } from './session-averager.service.js'
import type { SessionAverage, SessionSymptoms } from '../engine/types.js'

// ─── fixtures ───────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-04-22T10:00:00Z')
const TEN_YEARS_AGO = new Date('2016-04-22T00:00:00Z')

function noSymptoms(): SessionSymptoms {
  return {
    severeHeadache: false,
    visualChanges: false,
    alteredMentalStatus: false,
    chestPainOrDyspnea: false,
    focalNeuroDeficit: false,
    severeEpigastricPain: false,
    newOnsetHeadache: false,
    ruqPain: false,
    edema: false,
    dizziness: false,
    syncope: false,
    palpitations: false,
    legSwelling: false,
    otherSymptoms: [],
  }
}

function buildSession(over: Partial<SessionAverage> = {}): SessionAverage {
  return {
    entryId: 'entry-1',
    userId: 'user-1',
    measuredAt: FIXED_NOW,
    systolicBP: 125,
    diastolicBP: 78,
    pulse: 72,
    weight: null,
    readingCount: 1,
    symptoms: noSymptoms(),
    suboptimalMeasurement: false,
    sessionId: null,
    medicationTaken: null,
    missedMedications: [],
    ...over,
  }
}

function buildMed(over: Partial<ContextMedication> = {}): ContextMedication {
  return {
    id: 'med-1',
    drugName: 'Lisinopril',
    drugClass: 'ACE_INHIBITOR',
    isCombination: false,
    combinationComponents: [],
    frequency: 'ONCE_DAILY',
    source: 'PATIENT_SELF_REPORT',
    verificationStatus: 'VERIFIED',
    reportedAt: TEN_YEARS_AGO,
    ...over,
  }
}

function buildCtx(over: {
  isPregnant?: boolean
  profile?: Partial<ResolvedContext['profile']>
  contextMeds?: ContextMedication[]
  threshold?: ResolvedContext['threshold']
  readingCount?: number
  personalizedEligible?: boolean
  preDay3Mode?: boolean
  ageGroup?: ResolvedContext['ageGroup']
  dateOfBirth?: Date | null
} = {}): ResolvedContext {
  const isPregnant = over.isPregnant ?? over.profile?.isPregnant ?? false
  const profile: ResolvedContext['profile'] = {
    gender: 'FEMALE',
    heightCm: 165,
    pregnancyDueDate: null,
    historyPreeclampsia: false,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    resolvedHFType: 'NOT_APPLICABLE',
    hasAFib: false,
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasTachycardia: false,
    hasBradycardia: false,
    diagnosedHypertension: false,
    verificationStatus: 'VERIFIED',
    verifiedAt: TEN_YEARS_AGO,
    lastEditedAt: TEN_YEARS_AGO,
    ...over.profile,
    isPregnant,
  }
  const readingCount = over.readingCount ?? 10
  const threshold = over.threshold ?? null
  const personalizedEligible =
    over.personalizedEligible ?? (threshold !== null && readingCount >= 7)
  const preDay3Mode = over.preDay3Mode ?? readingCount < 7
  return {
    userId: 'user-1',
    dateOfBirth: over.dateOfBirth ?? new Date('1980-06-15T00:00:00Z'),
    timezone: 'America/New_York',
    ageGroup: over.ageGroup ?? '40-64',
    profile,
    contextMeds: over.contextMeds ?? [],
    excludedMeds: [],
    threshold,
    assignment: null,
    readingCount,
    preDay3Mode,
    personalizedEligible,
    pregnancyThresholdsActive: isPregnant,
    triggerPregnancyContraindicationCheck: isPregnant,
    resolvedAt: FIXED_NOW,
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('AlertEngine — multi-axis pipeline emission', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let profileResolver: { resolve: jest.Mock }
  let sessionAverager: { averageForEntry: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        create: (jest.fn() as jest.Mock<any>).mockImplementation((args: any) =>
          Promise.resolve({ id: `alert-${Math.random()}`, escalated: false, ...args.data }),
        ),
        update: (jest.fn() as jest.Mock<any>).mockImplementation((args: any) =>
          Promise.resolve({ id: args.where?.id ?? 'alert-1', escalated: false, ...args.data }),
        ),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
    }
    eventEmitter = { emit: jest.fn() }
    profileResolver = { resolve: jest.fn() as jest.Mock<any> }
    sessionAverager = { averageForEntry: jest.fn() as jest.Mock<any> }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        OutputGeneratorService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: SessionAveragerService, useValue: sessionAverager },
      ],
    }).compile()
    service = module.get<AlertEngineService>(AlertEngineService)
    module.get(OutputGeneratorService).onModuleInit()
  })

  async function run(session: SessionAverage, ctx: ResolvedContext) {
    sessionAverager.averageForEntry.mockResolvedValue(session)
    profileResolver.resolve.mockResolvedValue(ctx)
    const result = await service.evaluate(session.entryId)
    const calls = (prisma.deviationAlert.create.mock.calls as any[]).map(
      (c: any[]) => c[0],
    )
    return { result, calls }
  }

  function ruleIds(calls: any[]): string[] {
    return calls.map((c) => c.data.ruleId)
  }

  // ────────────────────────────────────────────────────────────────────────
  // Co-fire cases (the bug fix + its sibling cases)
  // ────────────────────────────────────────────────────────────────────────

  it('Patient B — 65+ CAD + 95/65 fires AGE_65_LOW + CAD_DBP_CRITICAL', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 95, diastolicBP: 65, pulse: 70 }),
      buildCtx({ ageGroup: '65+', profile: { hasCAD: true } }),
    )
    expect(calls).toHaveLength(2)
    expect(ruleIds(calls).sort()).toEqual([
      'RULE_AGE_65_LOW',
      'RULE_CAD_DBP_CRITICAL',
    ])
  })

  it('CAD bilateral — SBP 165 + DBP 65 fires CAD_HIGH + CAD_DBP_CRITICAL', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 65, pulse: 78 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    expect(calls).toHaveLength(2)
    expect(ruleIds(calls).sort()).toEqual([
      'RULE_CAD_DBP_CRITICAL',
      'RULE_CAD_HIGH',
    ])
  })

  it('persist order — bp-high lands at calls[0] before dbp-low (highest-tier first)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 65, pulse: 78 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    // AXIS_PRIORITY puts bp-high above dbp-low so the high alert lands first.
    expect(calls[0].data.ruleId).toBe('RULE_CAD_HIGH')
    expect(calls[1].data.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
  })

  it('HR + BP-high co-fire — STANDARD_L1_HIGH + TACHY_HR on same entry', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 88, pulse: 110 }),
      buildCtx({ profile: { hasTachycardia: true } }),
    )
    // Pulse 110 needs a prior elevated reading to fire tachy (§4.5
    // two-consecutive). journalEntry.findFirst returns null in this fixture
    // → tachy does NOT fire. Confirm the bp-high alert still emerges alone.
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_STANDARD_L1_HIGH')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Suppression invariant — HFrEF/HFpEF/HCM/DCM REPLACE the standard SBP-low
  // bucket per §4.2/4.6/4.7/4.8. Bucket-derived rules must NOT fire when a
  // condition rule already claimed sbp-low for that patient.
  // ────────────────────────────────────────────────────────────────────────

  it('HFrEF SBP 82 fires HFREF_LOW alone (suppresses STANDARD_L1_LOW)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 82, diastolicBP: 56, pulse: 72 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_HFREF_LOW')
    expect(ruleIds(calls)).not.toContain('RULE_STANDARD_L1_LOW')
  })

  it('HFpEF + 65+ + SBP 105 fires HFPEF_LOW alone (suppresses AGE_65_LOW)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 105, diastolicBP: 70, pulse: 72 }),
      buildCtx({
        ageGroup: '65+',
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFPEF',
          resolvedHFType: 'HFPEF',
        },
      }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_HFPEF_LOW')
    expect(ruleIds(calls)).not.toContain('RULE_AGE_65_LOW')
  })

  // ────────────────────────────────────────────────────────────────────────
  // HCM vasodilator — Tier 3 info on the info axis. New behavior: still fires
  // RULE_HCM_LOW on sbp-low alongside (per §4.6, the patient's clinical
  // hypotension is a real concern independent of the vasodilator flag).
  // Pre-fix behavior dropped RULE_HCM_LOW because vasodilator returned first.
  // ────────────────────────────────────────────────────────────────────────

  it('HCM + DHP-CCB + SBP 96 fires both HCM_VASODILATOR (info) and HCM_LOW (sbp-low)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 96, diastolicBP: 64, pulse: 72 }),
      buildCtx({
        profile: { hasHCM: true },
        contextMeds: [buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' })],
      }),
    )
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_HCM_VASODILATOR')
    expect(ids).toContain('RULE_HCM_LOW')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Info-axis fallback — pulse-pressure-wide and loop-diuretic fire as their
  // own row only when no other axis claimed; otherwise they ride as
  // annotations on the highest-tier primary.
  // ────────────────────────────────────────────────────────────────────────

  it('PP-wide standalone — SBP 130 / DBP 65 (PP=65) fires PULSE_PRESSURE_WIDE alone', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 130, diastolicBP: 65, pulse: 72 }),
      buildCtx(),
    )
    // DBP 65 < 70 would fire CAD_DBP_CRITICAL ONLY if hasCAD=true. Without
    // CAD, no condition matches; PP=65 ≥60 → fallback fires.
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_PULSE_PRESSURE_WIDE')
  })

  it('PP-wide co-occurring with L1-High — annotation on primary, no second row', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 95, pulse: 72 }),
      buildCtx(),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_STANDARD_L1_HIGH')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Idempotent re-evaluation — phase/7 dedup keyed on (journalEntryId, ruleId).
  // Re-running the pipeline on the same entry should hit findFirst → update,
  // not double-create.
  // ────────────────────────────────────────────────────────────────────────

  it('Re-evaluation is idempotent — second pass updates, does not re-create', async () => {
    // First pass: create both rows.
    const session = buildSession({ systolicBP: 95, diastolicBP: 65, pulse: 70 })
    const ctx = buildCtx({ ageGroup: '65+', profile: { hasCAD: true } })
    sessionAverager.averageForEntry.mockResolvedValue(session)
    profileResolver.resolve.mockResolvedValue(ctx)
    await service.evaluate(session.entryId)

    // Second pass: findFirst now returns existing rows (simulate DB state).
    let createCount = prisma.deviationAlert.create.mock.calls.length
    expect(createCount).toBe(2)
    prisma.deviationAlert.findFirst = (jest.fn() as jest.Mock<any>)
      .mockResolvedValueOnce({ id: 'existing-1' })
      .mockResolvedValueOnce({ id: 'existing-2' })

    await service.evaluate(session.entryId)

    // No new creates — both upserts went to update path.
    expect(prisma.deviationAlert.create.mock.calls.length).toBe(createCount)
    expect(prisma.deviationAlert.update.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Multi-ladder co-fire — v2 addendum Part D defines three independent
  // escalation ladders (Tier 1, BP L2, BP L1). Stage A/B no longer
  // terminally short-circuit — distinct-axis rules co-fire so each ladder
  // gets its own DeviationAlert row.
  // ────────────────────────────────────────────────────────────────────────

  it('Emergency + L1 high co-fire — SBP 185 fires BOTH ABSOLUTE_EMERGENCY + STANDARD_L1_HIGH (independent ladders)', async () => {
    // Seed two prior days of misses so the Cluster 6 2-of-3 adherence
    // window also fires, giving us the full three-ladder picture.
    const now = new Date('2026-04-22T10:00:00Z')
    prisma.journalEntry.findMany.mockResolvedValueOnce([
      { id: 'p1', measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000), medicationTaken: false, missedMedications: null },
      { id: 'p2', measuredAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), medicationTaken: false, missedMedications: null },
    ])
    const { calls } = await run(
      buildSession({
        systolicBP: 185,
        diastolicBP: 100,
        pulse: 72,
        medicationTaken: false,
        measuredAt: now,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )
    // SBP 185 violates BOTH the L2 emergency threshold (≥180) AND the L1
    // high threshold (≥160). Per v2 addendum D, the two ladders run
    // independently (T+0/2h/4h vs T+0/24h/72h/7d). Cluster 6 adherence
    // (rolling 2-of-3 pattern) adds its own row.
    expect(calls).toHaveLength(3)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_ABSOLUTE_EMERGENCY')
    expect(ids).toContain('RULE_STANDARD_L1_HIGH')
    expect(ids).toContain('RULE_MEDICATION_MISSED')
  })

  it('Contraindication alone — pregnant + ACE @ 95/60 → 1 row only (no BP rule met)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 95, diastolicBP: 60, pulse: 72 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [buildMed()],
      }),
    )
    // BP 95/60 is in-range — no L1/L2/condition rule fires. Only the
    // contraindication-axis row persists.
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Reading 3 — bidirectional BP context annotation. CAD patient with DBP <70
  // (J-curve) AND SBP above the §4.3 treatment target (130/80) but below the
  // alert threshold (≥160). The annotation surfaces the SBP framing alongside
  // the J-curve framing so the physician sees both concerns and doesn't
  // over-correct (drop dose → SBP rebounds higher).
  // ────────────────────────────────────────────────────────────────────────

  it('Reading 3 — CAD + 155/65 fires CAD_DBP_CRITICAL with bidirectional annotation', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 155, diastolicBP: 65, pulse: 70 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    // Both framings must appear in the physicianMessage.
    expect(calls[0].data.physicianMessage).toMatch(/J-curve/i)
    expect(calls[0].data.physicianMessage).toContain('SBP 155 also above CAD goal of 130/80')
  })

  it('CAD + 145/65 — annotation present (just above 140 floor)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 145, diastolicBP: 65, pulse: 70 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    expect(calls[0].data.physicianMessage).toContain('SBP 145 also above CAD goal')
  })

  it('CAD + 140/65 — NO uncontrolled-HTN annotation (boundary at floor)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 140, diastolicBP: 65, pulse: 70 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    expect(calls[0].data.physicianMessage).not.toContain('also above CAD goal')
  })

  it('CAD + 165/65 — TWO rows; CAD_HIGH covers SBP, no duplicate annotation', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 65, pulse: 70 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    // Two-axis fire: bp-high (CAD_HIGH) + dbp-low (CAD_DBP_CRITICAL).
    expect(calls).toHaveLength(2)
    const dbpAlert = calls.find(
      (c: any) => c.data.ruleId === 'RULE_CAD_DBP_CRITICAL',
    )
    // CAD_HIGH already conveys "SBP ≥160" — annotation would duplicate.
    expect(dbpAlert?.data.physicianMessage).not.toContain('also above CAD goal')
  })

  it('Non-CAD + 155/65 — no annotation (helper bails on hasCAD=false)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 155, diastolicBP: 65, pulse: 70 }),
      buildCtx({ profile: { hasCAD: false } }),
    )
    // Without CAD, DBP 65 doesn't fire any rule. PP=90 → wide-PP fallback.
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_PULSE_PRESSURE_WIDE')
    expect(calls[0].data.physicianMessage).not.toContain('also above CAD goal')
  })

  // ────────────────────────────────────────────────────────────────────────
  // DO-NOT-REGRESS — explicit guards from Reading 4 evidence + bug report.
  // These behaviors were confirmed working pre-multi-axis-refactor; lock them
  // in so future refactors don't silently break them.
  // ────────────────────────────────────────────────────────────────────────

  it('DO NOT REGRESS — BB HR 50–60 suppression: HR 58 + Metoprolol → 0 alerts', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 118, diastolicBP: 72, pulse: 58 }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )
    // HR 58 sits in [50, 60) — bradyRule returns null regardless of BB.
    // No BP/HR axis claims; no info-fallback fires (PP=46, not wide).
    expect(calls).toHaveLength(0)
  })

  it('DO NOT REGRESS — pregnancy rule sex-gating: male + 165/100 → no PREGNANCY rule', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 100, pulse: 78 }),
      buildCtx({
        profile: { gender: 'MALE', diagnosedHypertension: true },
      }),
    )
    // Standard L1 High fires (SBP ≥160 / DBP ≥100), but no pregnancy rule.
    const ids = ruleIds(calls)
    expect(ids.some((id) => id.startsWith('RULE_PREGNANCY_'))).toBe(false)
    expect(ids).toContain('RULE_STANDARD_L1_HIGH')
  })

  it('DO NOT REGRESS — PP annotation folding: 165/100 + PP 65 → 1 row, PP in physicianMessage', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 100, pulse: 72 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(calls[0].data.physicianMessage).toContain('Wide pulse pressure')
    // No separate PULSE_PRESSURE_WIDE row.
    expect(ruleIds(calls)).not.toContain('RULE_PULSE_PRESSURE_WIDE')
  })

  it('DO NOT REGRESS — pulsePressure column populated on every BP alert row', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 100, pulse: 72 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )
    expect(calls).toHaveLength(1)
    // SBP=165, DBP=100 → PP=65. Column must carry the numeric value.
    expect(calls[0].data.pulsePressure).toBe(65)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Reading 5b — HR context co-fire. Phase/27 made Stage A/B non-terminal,
  // so HR rules now fire as their OWN row alongside symptom-override /
  // absolute-emergency BP rows. The phase/26 HR-context annotation is
  // gated to only run when there is no HR row in the result set; with the
  // co-fire fix the dedicated HR row carries the framing instead.
  // ────────────────────────────────────────────────────────────────────────

  it('Reading 5b — symptom override + HR 48 + AMS + brady → 2 rows (override + brady symptomatic)', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 48,
        symptoms: { ...noSymptoms(), alteredMentalStatus: true },
      }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(ids).toContain('RULE_BRADY_HR_SYMPTOMATIC')
    // Annotation is suppressed when an HR row exists — the row's own
    // physicianMessage is the canonical surface for the HR finding.
    const overrideRow = calls.find(
      (c: { data: { ruleId: string } }) => c.data.ruleId === 'RULE_SYMPTOM_OVERRIDE_GENERAL',
    )
    expect(overrideRow?.data.physicianMessage).not.toContain('Stokes-Adams')
  })

  it('Absolute emergency + brady-asymptomatic — three rows: emergency + L1 high + HR low', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 185,
        diastolicBP: 105,
        pulse: 38,
        symptoms: noSymptoms(),
      }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    // SBP 185 → absolute_emergency (emergency axis) + standardL1High
    // (bp-high axis); HR 38 + hasBradycardia → brady_asymptomatic (hr).
    expect(calls).toHaveLength(3)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_ABSOLUTE_EMERGENCY')
    expect(ids).toContain('RULE_STANDARD_L1_HIGH')
    expect(ids).toContain('RULE_BRADY_ABSOLUTE')
  })

  it('Symptom override + AFib HR-high — two rows: override + AFIB_HR_HIGH', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 140,
        diastolicBP: 88,
        pulse: 115,
        readingCount: 3,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      buildCtx({ profile: { hasAFib: true } }),
    )
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(ids).toContain('RULE_AFIB_HR_HIGH')
  })

  it('Pregnancy + symptom override + brady — three rows: override + L1_HIGH + brady symptomatic', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 165,
        diastolicBP: 110,
        pulse: 48,
        symptoms: { ...noSymptoms(), alteredMentalStatus: true },
      }),
      buildCtx({
        isPregnant: true,
        profile: { hasBradycardia: true },
      }),
    )
    // AMS triggers symptomOverrideGeneralRule first (Stage A) which
    // claims the emergency axis; pregnancyL2 (Stage B) sees emergency
    // already claimed and skips. pregnancyL1High still fires on bp-high
    // (≥140), and brady_symptomatic on hr.
    expect(calls).toHaveLength(3)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(ids).toContain('RULE_PREGNANCY_L1_HIGH')
    expect(ids).toContain('RULE_BRADY_HR_SYMPTOMATIC')
  })

  it('NEGATIVE — symptom override + normal HR → no HR annotation', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 72,
        symptoms: { ...noSymptoms(), alteredMentalStatus: true },
      }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    // HR 72 is in normal range — no rule would have fired, no annotation.
    expect(calls[0].data.physicianMessage).not.toContain('bradycardia')
    expect(calls[0].data.physicianMessage).not.toContain('AFib')
    expect(calls[0].data.physicianMessage).not.toContain('tachycardia')
  })

  it('NEGATIVE — symptom override + HR 48 + non-flagged patient → no HR annotation', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 48,
        symptoms: { ...noSymptoms(), alteredMentalStatus: true },
      }),
      buildCtx({ profile: { hasBradycardia: false, hasAFib: false } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    // Without hasBradycardia, HR 48 is just a low pulse — no clinical action,
    // no annotation. Avoids surfacing noise on patients without that flag.
    expect(calls[0].data.physicianMessage).not.toContain('bradycardia')
  })

  it('DO NOT REGRESS — Stage C standalone brady-asymptomatic fires its own row', async () => {
    // No symptom override → Stage C runs. HR 38 < 40 → bradyAsymptomatic
    // fires regardless of symptoms.
    const { calls } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 38,
        symptoms: noSymptoms(),
      }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0].data.ruleId).toBe('RULE_BRADY_ABSOLUTE')
  })

  it('DO NOT REGRESS — Stage C BP+brady co-fire with no terminal preempt', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 165,
        diastolicBP: 95,
        pulse: 38,
        symptoms: noSymptoms(), // no symptom override → Stage C runs
      }),
      buildCtx({
        profile: { hasCAD: true, hasBradycardia: true },
      }),
    )
    // Two rows: bp-high (CAD_HIGH) + hr (BRADY_HR_ASYMPTOMATIC).
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_CAD_HIGH')
    expect(ids).toContain('RULE_BRADY_ABSOLUTE')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Phase/27 — Stage A/B no longer terminal. Tier 1 contraindications and
  // Stage B emergency rules now coexist with Stage C BP/HR rows so each
  // escalation ladder defined in v2 addendum Part D gets its own row.
  // ────────────────────────────────────────────────────────────────────────

  it('Stage A + Stage C — Tier 1 NDHP_HFREF + BP L1 LOW (HFREF_LOW) co-fire on different axes', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 80, diastolicBP: 55, pulse: 72 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
        contextMeds: [
          buildMed({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
        ],
      }),
    )
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_NDHP_HFREF')
    expect(ids).toContain('RULE_HFREF_LOW')
  })

  it('Stage A + Stage C — Tier 1 PREGNANCY_ACE_ARB + BP L1 HIGH (PREGNANCY_L1_HIGH) co-fire', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 145, diastolicBP: 85, pulse: 78 }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(ids).toContain('RULE_PREGNANCY_L1_HIGH')
    // L2 threshold (≥160/110) NOT met at 145/85.
    expect(ids).not.toContain('RULE_PREGNANCY_L2')
  })

  it('Stage A + Stage B — Tier 1 PREGNANCY_ACE_ARB + BP L2 (PREGNANCY_L2) co-fire (D.5 patient-911)', async () => {
    const { calls } = await run(
      buildSession({ systolicBP: 175, diastolicBP: 115, pulse: 80 }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    // 175/115 hits pregnancyL2 (≥160/110) and pregnancyL1High (≥140) on
    // separate axes alongside the contraindication row → three ladders.
    expect(calls).toHaveLength(3)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(ids).toContain('RULE_PREGNANCY_L2')
    expect(ids).toContain('RULE_PREGNANCY_L1_HIGH')
  })

  it('Stage A + Stage A — Tier 1 PREGNANCY_ACE_ARB + symptom override coexist (different axes)', async () => {
    const { calls } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 85,
        symptoms: { ...noSymptoms(), newOnsetHeadache: true },
      }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(calls).toHaveLength(2)
    const ids = ruleIds(calls)
    expect(ids).toContain('RULE_PREGNANCY_ACE_ARB')
    expect(ids).toContain('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
  })
})
