// End-to-end scenario spec — one Jest case per narrative in
// docs/ALERT_SCENARIOS.md. Runs AlertEngineService against a REAL
// OutputGeneratorService (not a mock) so message-wording assertions exercise
// the live registry. ProfileResolver + SessionAverager + Prisma are mocked.

import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import type { ContextMedication, ResolvedContext } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
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
    readingCount: 1,
    symptoms: noSymptoms(),
    suboptimalMeasurement: false,
    sessionId: null,
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
  pregnancyThresholdsActive?: boolean
  triggerPregnancyContraindicationCheck?: boolean
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
    isPregnant,
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
    pregnancyThresholdsActive:
      over.pregnancyThresholdsActive ?? isPregnant,
    triggerPregnancyContraindicationCheck:
      over.triggerPregnancyContraindicationCheck ?? isPregnant,
    resolvedAt: FIXED_NOW,
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('AlertEngine — end-to-end scenarios (ALERT_SCENARIOS.md)', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let profileResolver: { resolve: jest.Mock }
  let sessionAverager: { averageForEntry: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        upsert: (jest.fn() as jest.Mock<any>).mockImplementation(
          (args: any) =>
            Promise.resolve({
              id: 'alert-fixture-id',
              escalated: false,
              ...args.create,
            }),
        ),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
      },
    }
    eventEmitter = { emit: jest.fn() }
    profileResolver = { resolve: jest.fn() as jest.Mock<any> }
    sessionAverager = { averageForEntry: jest.fn() as jest.Mock<any> }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        OutputGeneratorService, // real
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
    const upsertArgs = prisma.deviationAlert.upsert.mock.calls[0]?.[0]
    const eventArgs = eventEmitter.emit.mock.calls[0]
    return { result, upsertArgs, eventArgs }
  }

  // ========================================================================
  // Tier 1 — Contraindications (non-dismissable)
  // ========================================================================

  it('Scenario 1 — Pregnant patient on lisinopril → Tier 1 RULE_PREGNANCY_ACE_ARB', async () => {
    const { result, upsertArgs, eventArgs } = await run(
      buildSession({ systolicBP: 130, diastolicBP: 82, pulse: 78 }),
      buildCtx({
        isPregnant: true,
        profile: { historyPreeclampsia: true },
        contextMeds: [buildMed()],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(upsertArgs.create.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(upsertArgs.create.dismissible).toBe(false)
    expect(upsertArgs.create.severity).toBe('HIGH')
    expect(upsertArgs.create.type).toBe('MEDICATION_ADHERENCE')
    expect(upsertArgs.create.pulsePressure).toBeNull()
    expect(upsertArgs.create.patientMessage).toContain(
      'blood pressure medicine',
    )
    expect(upsertArgs.create.patientMessage).toContain('pregnant')
    expect(upsertArgs.create.physicianMessage).toContain('Teratogenic')
    expect(upsertArgs.create.physicianMessage).toContain('Lisinopril')
    expect(eventArgs[0]).toBe(JOURNAL_EVENTS.ANOMALY_TRACKED)
    expect(eventArgs[1]).toMatchObject({ alertId: 'alert-fixture-id' })
  })

  it('Scenario 2 — HFrEF patient on diltiazem → Tier 1 RULE_NDHP_HFREF', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 118, diastolicBP: 74, pulse: 68 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
        contextMeds: [
          buildMed({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
          buildMed({ drugName: 'Carvedilol', drugClass: 'BETA_BLOCKER', id: 'med-2' }),
        ],
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 85,
          dbpUpperTarget: null,
          dbpLowerTarget: null,
          hrUpperTarget: null,
          hrLowerTarget: null,
          setByProviderId: 'prov-1',
          setAt: TEN_YEARS_AGO,
          notes: null,
        },
      }),
    )

    expect(result?.ruleId).toBe('RULE_NDHP_HFREF')
    expect(upsertArgs.create.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(upsertArgs.create.dismissible).toBe(false)
    expect(upsertArgs.create.patientMessage).toContain('heart medicines')
    expect(upsertArgs.create.physicianMessage).toContain('Nondihydropyridine CCB')
    expect(upsertArgs.create.physicianMessage).toContain('Diltiazem')
    expect(upsertArgs.create.physicianMessage).toContain('HFrEF')
  })

  it('Scenario 3 — Unverified ACE + pregnant (safety-net) → Tier 1 still fires', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 122, diastolicBP: 78 }),
      buildCtx({
        isPregnant: true,
        profile: { verificationStatus: 'UNVERIFIED' },
        contextMeds: [buildMed({ verificationStatus: 'UNVERIFIED' })],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(upsertArgs.create.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  // ========================================================================
  // BP Level 2 — Emergency + symptom override (non-dismissable)
  // ========================================================================

  it('Scenario 4 — Absolute emergency 190/105 → BP Level 2 RULE_ABSOLUTE_EMERGENCY', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 190, diastolicBP: 105, pulse: 88 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_2')
    expect(upsertArgs.create.dismissible).toBe(false)
    expect(upsertArgs.create.pulsePressure).toBe(85)
    expect(upsertArgs.create.patientMessage).toContain('190/105')
    expect(upsertArgs.create.patientMessage).toMatch(/911/)
    // Wide PP annotation rides on physician msg (>60)
    expect(upsertArgs.create.physicianMessage.toLowerCase()).toContain(
      'pulse pressure',
    )
  })

  it('Scenario 5 — severeHeadache at 122/76 → BP Level 2 symptom override', async () => {
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 122,
        diastolicBP: 76,
        pulse: 74,
        symptoms: { ...noSymptoms(), severeHeadache: true },
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(upsertArgs.create.dismissible).toBe(false)
    expect(upsertArgs.create.patientMessage).toContain('122/76')
    expect(upsertArgs.create.patientMessage).toMatch(/911/)
    expect(upsertArgs.create.physicianMessage).toContain('severe headache')
  })

  it('Scenario 6 — Pregnant + 165/112 → BP Level 2 RULE_PREGNANCY_L2', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 112, pulse: 90 }),
      buildCtx({ isPregnant: true }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_L2')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_2')
    expect(upsertArgs.create.patientMessage).toContain('165/112')
    expect(upsertArgs.create.patientMessage).toContain('pregnancy')
    expect(upsertArgs.create.physicianMessage).toContain('ACOG')
  })

  // ========================================================================
  // BP Level 1 — High / Low (dismissable)
  // ========================================================================

  it('Scenario 7 — Pregnant + 144/88 → BP L1 High RULE_PREGNANCY_L1_HIGH', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 144, diastolicBP: 88, pulse: 82 }),
      buildCtx({ isPregnant: true }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_L1_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.dismissible).toBe(true)
    expect(upsertArgs.create.patientMessage).toContain('144/88')
    expect(upsertArgs.create.physicianMessage).toContain('preeclampsia')
  })

  it('Scenario 8 — CAD + 132/68 → BP L1 Low RULE_CAD_DBP_CRITICAL', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 132, diastolicBP: 68, pulse: 66 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        contextMeds: [
          buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_LOW')
    expect(upsertArgs.create.type).toBe('DIASTOLIC_BP')
    expect(upsertArgs.create.patientMessage).toContain('132/68')
    expect(upsertArgs.create.patientMessage).toContain('lower number')
    expect(upsertArgs.create.physicianMessage).toContain('J-curve')
  })

  it('Scenario 9 — AFib + 3 readings avg HR 115 → BP L1 High RULE_AFIB_HR_HIGH', async () => {
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 76,
        pulse: 115,
        readingCount: 3,
      }),
      buildCtx({
        profile: { hasAFib: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_AFIB_HR_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.patientMessage).toContain('HR 115 bpm')
    expect(upsertArgs.create.physicianMessage).toContain('AFib')
  })

  it('Scenario 10 — HFpEF + 106/70 → BP L1 Low RULE_HFPEF_LOW', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 106, diastolicBP: 70, pulse: 76 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFPEF',
          resolvedHFType: 'HFPEF',
        },
      }),
    )

    expect(result?.ruleId).toBe('RULE_HFPEF_LOW')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_LOW')
    expect(upsertArgs.create.physicianMessage).toContain('HFpEF')
  })

  it('Scenario 11 — Age 65+ + 96/58 → BP L1 Low RULE_AGE_65_LOW', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 96, diastolicBP: 58, pulse: 70 }),
      buildCtx({
        ageGroup: '65+',
        dateOfBirth: new Date('1953-01-01'),
      }),
    )

    expect(result?.ruleId).toBe('RULE_AGE_65_LOW')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_LOW')
    expect(upsertArgs.create.patientMessage).toContain('dizziness')
    expect(upsertArgs.create.patientMessage).toContain('fall risk')
    expect(upsertArgs.create.physicianMessage).toContain('age 65+')
  })

  it('Scenario 12 — Personalized mode + 152/88 → BP L1 High mode=PERSONALIZED', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 152, diastolicBP: 88, pulse: 76 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        readingCount: 12,
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 90,
          dbpUpperTarget: null,
          dbpLowerTarget: null,
          hrUpperTarget: null,
          hrLowerTarget: null,
          setByProviderId: 'prov-1',
          setAt: TEN_YEARS_AGO,
          notes: null,
        },
      }),
    )

    expect(result?.ruleId).toBe('RULE_PERSONALIZED_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.mode).toBe('PERSONALIZED')
    expect(upsertArgs.create.patientMessage).toContain('target')
    expect(upsertArgs.create.physicianMessage).toContain('target + 20')
  })

  it('Scenario 13 — Pre-Day-3 (readingCount=3) + 165/94 → STANDARD L1 High + disclaimer', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 94, pulse: 82 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        readingCount: 3,
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 90,
          dbpUpperTarget: null,
          dbpLowerTarget: null,
          hrUpperTarget: null,
          hrLowerTarget: null,
          setByProviderId: 'prov-1',
          setAt: TEN_YEARS_AGO,
          notes: null,
        },
      }),
    )

    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.mode).toBe('STANDARD')
    expect(upsertArgs.create.patientMessage).toMatch(
      /personalization begins after Day 3/i,
    )
  })

  // ========================================================================
  // Tier 3 — Physician-only
  // ========================================================================

  it('Scenario 14 — HCM + amlodipine → Tier 3 RULE_HCM_VASODILATOR (empty patient msg)', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 82, pulse: 72 }),
      buildCtx({
        profile: { hasHCM: true },
        contextMeds: [
          buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_HCM_VASODILATOR')
    expect(upsertArgs.create.tier).toBe('TIER_3_INFO')
    expect(upsertArgs.create.dismissible).toBe(true)
    expect(upsertArgs.create.patientMessage).toBe('')
    expect(upsertArgs.create.caregiverMessage).toBe('')
    expect(upsertArgs.create.physicianMessage).toContain('HCM')
    expect(upsertArgs.create.physicianMessage).toContain('Amlodipine')
    expect(upsertArgs.create.physicianMessage).toContain('LVOT')
  })

  it('Scenario 15 — Wide PP 172/88 → BP L1 High + PP annotation in physician msg', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 172, diastolicBP: 88, pulse: 78 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.pulsePressure).toBe(84)
    expect(upsertArgs.create.physicianMessage).toContain(
      'Wide pulse pressure: 84 mmHg',
    )
    // Patient message stays plain L1 High — no PP talk
    expect(upsertArgs.create.patientMessage.toLowerCase()).not.toContain(
      'pulse pressure',
    )
  })

  // ========================================================================
  // No-alert paths
  // ========================================================================

  it('Scenario 16 — Controlled patient benign 124/78 → no alert + BP L1 scope resolve', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 124, diastolicBP: 78, pulse: 70 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        contextMeds: [
          buildMed({ drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
          buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB', id: 'med-2' }),
        ],
      }),
    )

    expect(result).toBeNull()
    expect(upsertArgs).toBeUndefined()
    expect(prisma.deviationAlert.updateMany).toHaveBeenCalledTimes(1)
    const updateManyCall = prisma.deviationAlert.updateMany.mock.calls[0][0]
    expect(updateManyCall.where.tier).toEqual({
      in: ['BP_LEVEL_1_HIGH', 'BP_LEVEL_1_LOW'],
    })
    expect(updateManyCall.data).toEqual({ status: 'RESOLVED' })
  })

  it('Scenario 17 — AFib + 1 reading + pulse 118 → no alert (gate closed)', async () => {
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 135,
        diastolicBP: 82,
        pulse: 118,
        readingCount: 1,
      }),
      buildCtx({ profile: { hasAFib: true } }),
    )

    expect(result).toBeNull()
    expect(upsertArgs).toBeUndefined()
  })

  it('Scenario 18 — AFib + 1 reading + pregnant + ACE → Tier 1 fires (gate does NOT block)', async () => {
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 128,
        diastolicBP: 80,
        pulse: 96,
        readingCount: 1,
      }),
      buildCtx({
        isPregnant: true,
        profile: { hasAFib: true, verificationStatus: 'UNVERIFIED' },
        contextMeds: [buildMed({ verificationStatus: 'UNVERIFIED' })],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(upsertArgs.create.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('Scenario 19 — Beta-blocker + HR 55 → no alert (suppressed 50–60 window)', async () => {
    const { result, upsertArgs } = await run(
      buildSession({ systolicBP: 118, diastolicBP: 72, pulse: 55 }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    expect(result).toBeNull()
    expect(upsertArgs).toBeUndefined()
  })

  // ========================================================================
  // Quality-of-measurement modifiers
  // ========================================================================

  it('Scenario 20 — Suboptimal checklist + 164/96 → L1 High + retake suffix', async () => {
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 164,
        diastolicBP: 96,
        pulse: 78,
        suboptimalMeasurement: true,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_1_HIGH')
    expect(upsertArgs.create.suboptimalMeasurement).toBe(true)
    expect(upsertArgs.create.patientMessage.toLowerCase()).toContain('retake')
  })

  it('Scenario 21 — Session-averaged 175+185 → avg 180/95 → BP Level 2', async () => {
    // SessionAverager is mocked — we pass a pre-averaged session to the
    // orchestrator. In production the averager folds the two raw readings
    // into this shape; here we assert the orchestrator correctly classifies
    // the averaged values.
    const { result, upsertArgs } = await run(
      buildSession({
        systolicBP: 180,
        diastolicBP: 95,
        pulse: 80,
        readingCount: 2,
        sessionId: 'sess-a',
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
    expect(upsertArgs.create.tier).toBe('BP_LEVEL_2')
    expect(upsertArgs.create.patientMessage).toContain('180/95')
    expect(upsertArgs.create.patientMessage).toMatch(/911/)
  })
})
