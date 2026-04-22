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
    // pin isPregnant last so explicit over.isPregnant (or default false) wins
    // over a stale value in over.profile.isPregnant
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
        // Phase/7 — findFirst + create|update pattern replacing upsert.
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        create: (jest.fn() as jest.Mock<any>).mockImplementation((args: any) =>
          Promise.resolve({
            id: 'alert-fixture-id',
            escalated: false,
            ...args.data,
          }),
        ),
        update: (jest.fn() as jest.Mock<any>).mockImplementation((args: any) =>
          Promise.resolve({
            id: args.where?.id ?? 'alert-fixture-id',
            escalated: false,
            ...args.data,
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
    // Phase/7 — upsert replaced with create (new row) or update (existing).
    // Scenarios all start from an empty DB so create fires.
    const createArgs = prisma.deviationAlert.create.mock.calls[0]?.[0]
    const eventArgs = eventEmitter.emit.mock.calls[0]
    return { result, createArgs, eventArgs }
  }

  // ========================================================================
  // Tier 1 — Contraindications (non-dismissable)
  // ========================================================================

  it('Scenario 1 — Pregnant patient on lisinopril → Tier 1 RULE_PREGNANCY_ACE_ARB', async () => {
    const { result, createArgs, eventArgs } = await run(
      buildSession({ systolicBP: 130, diastolicBP: 82, pulse: 78 }),
      buildCtx({
        isPregnant: true,
        profile: { historyPreeclampsia: true },
        contextMeds: [buildMed()],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.severity).toBe('HIGH')
    expect(createArgs.data.type).toBe('MEDICATION_ADHERENCE')
    expect(createArgs.data.pulsePressure).toBeNull()
    expect(createArgs.data.patientMessage).toContain(
      'blood pressure medicine',
    )
    expect(createArgs.data.patientMessage).toContain('pregnant')
    expect(createArgs.data.physicianMessage).toContain('Teratogenic')
    expect(createArgs.data.physicianMessage).toContain('Lisinopril')
    expect(eventArgs[0]).toBe(JOURNAL_EVENTS.ALERT_CREATED)
    expect(eventArgs[1]).toMatchObject({ alertId: 'alert-fixture-id' })
  })

  it('Scenario 2 — HFrEF patient on diltiazem → Tier 1 RULE_NDHP_HFREF', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.patientMessage).toContain('heart medicines')
    expect(createArgs.data.physicianMessage).toContain('Nondihydropyridine CCB')
    expect(createArgs.data.physicianMessage).toContain('Diltiazem')
    expect(createArgs.data.physicianMessage).toContain('HFrEF')
  })

  it('Scenario 3 — Unverified ACE + pregnant (safety-net) → Tier 1 still fires', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 122, diastolicBP: 78 }),
      buildCtx({
        isPregnant: true,
        profile: { verificationStatus: 'UNVERIFIED' },
        contextMeds: [buildMed({ verificationStatus: 'UNVERIFIED' })],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  // ========================================================================
  // BP Level 2 — Emergency + symptom override (non-dismissable)
  // ========================================================================

  it('Scenario 4 — Absolute emergency 190/105 → BP Level 2 RULE_ABSOLUTE_EMERGENCY', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 190, diastolicBP: 105, pulse: 88 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.pulsePressure).toBe(85)
    expect(createArgs.data.patientMessage).toContain('190/105')
    expect(createArgs.data.patientMessage).toMatch(/911/)
    // Wide PP annotation rides on physician msg (>60)
    expect(createArgs.data.physicianMessage.toLowerCase()).toContain(
      'pulse pressure',
    )
  })

  it('Scenario 5 — severeHeadache at 122/76 → BP Level 2 symptom override', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 122,
        diastolicBP: 76,
        pulse: 74,
        symptoms: { ...noSymptoms(), severeHeadache: true },
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.patientMessage).toContain('122/76')
    expect(createArgs.data.patientMessage).toMatch(/911/)
    expect(createArgs.data.physicianMessage).toContain('severe headache')
  })

  it('Scenario 6 — Pregnant + 165/112 → BP Level 2 RULE_PREGNANCY_L2', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 112, pulse: 90 }),
      buildCtx({ isPregnant: true }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_L2')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2')
    expect(createArgs.data.patientMessage).toContain('165/112')
    expect(createArgs.data.patientMessage).toContain('pregnancy')
    expect(createArgs.data.physicianMessage).toContain('ACOG')
  })

  // ========================================================================
  // BP Level 1 — High / Low (dismissable)
  // ========================================================================

  it('Scenario 7 — Pregnant + 144/88 → BP L1 High RULE_PREGNANCY_L1_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 144, diastolicBP: 88, pulse: 82 }),
      buildCtx({ isPregnant: true }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_L1_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.dismissible).toBe(true)
    expect(createArgs.data.patientMessage).toContain('144/88')
    expect(createArgs.data.physicianMessage).toContain('preeclampsia')
  })

  it('Scenario 8 — CAD + 132/68 → BP L1 Low RULE_CAD_DBP_CRITICAL', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 132, diastolicBP: 68, pulse: 66 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        contextMeds: [
          buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.type).toBe('DIASTOLIC_BP')
    expect(createArgs.data.patientMessage).toContain('132/68')
    expect(createArgs.data.patientMessage).toContain('lower number')
    expect(createArgs.data.physicianMessage).toContain('J-curve')
  })

  it('Scenario 9 — AFib + 3 readings avg HR 115 → BP L1 High RULE_AFIB_HR_HIGH', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.patientMessage).toContain('HR 115 bpm')
    expect(createArgs.data.physicianMessage).toContain('AFib')
  })

  it('Scenario 10 — HFpEF + 106/70 → BP L1 Low RULE_HFPEF_LOW', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('HFpEF')
  })

  it('Scenario 11 — Age 65+ + 96/58 → BP L1 Low RULE_AGE_65_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 96, diastolicBP: 58, pulse: 70 }),
      buildCtx({
        ageGroup: '65+',
        dateOfBirth: new Date('1953-01-01'),
      }),
    )

    expect(result?.ruleId).toBe('RULE_AGE_65_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.patientMessage).toContain('dizziness')
    expect(createArgs.data.patientMessage).toContain('fall risk')
    expect(createArgs.data.physicianMessage).toContain('age 65+')
  })

  it('Scenario 12 — Personalized mode + 152/88 → BP L1 High mode=PERSONALIZED', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.mode).toBe('PERSONALIZED')
    expect(createArgs.data.patientMessage).toContain('target')
    expect(createArgs.data.physicianMessage).toContain('target + 20')
  })

  it('Scenario 13 — Pre-Day-3 (readingCount=3) + 165/94 → STANDARD L1 High + disclaimer', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.mode).toBe('STANDARD')
    expect(createArgs.data.patientMessage).toMatch(
      /personalization begins after Day 3/i,
    )
  })

  // ========================================================================
  // Tier 3 — Physician-only
  // ========================================================================

  it('Scenario 14 — HCM + amlodipine → Tier 3 RULE_HCM_VASODILATOR (empty patient msg)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 82, pulse: 72 }),
      buildCtx({
        profile: { hasHCM: true },
        contextMeds: [
          buildMed({ drugName: 'Amlodipine', drugClass: 'DHP_CCB' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_HCM_VASODILATOR')
    expect(createArgs.data.tier).toBe('TIER_3_INFO')
    expect(createArgs.data.dismissible).toBe(true)
    expect(createArgs.data.patientMessage).toBe('')
    expect(createArgs.data.caregiverMessage).toBe('')
    expect(createArgs.data.physicianMessage).toContain('HCM')
    expect(createArgs.data.physicianMessage).toContain('Amlodipine')
    expect(createArgs.data.physicianMessage).toContain('LVOT')
  })

  it('Scenario 15 — Wide PP 172/88 → BP L1 High + PP annotation in physician msg', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 172, diastolicBP: 88, pulse: 78 }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.pulsePressure).toBe(84)
    expect(createArgs.data.physicianMessage).toContain(
      'Wide pulse pressure: 84 mmHg',
    )
    // Patient message stays plain L1 High — no PP talk
    expect(createArgs.data.patientMessage.toLowerCase()).not.toContain(
      'pulse pressure',
    )
  })

  // ========================================================================
  // No-alert paths
  // ========================================================================

  it('Scenario 16 — Controlled patient benign 124/78 → no alert + BP L1 scope resolve', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs).toBeUndefined()
    expect(prisma.deviationAlert.updateMany).toHaveBeenCalledTimes(1)
    const updateManyCall = prisma.deviationAlert.updateMany.mock.calls[0][0]
    expect(updateManyCall.where.tier).toEqual({
      in: ['BP_LEVEL_1_HIGH', 'BP_LEVEL_1_LOW'],
    })
    expect(updateManyCall.data).toEqual({ status: 'RESOLVED' })
  })

  it('Scenario 17 — AFib + 1 reading + pulse 118 → no alert (gate closed)', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 135,
        diastolicBP: 82,
        pulse: 118,
        readingCount: 1,
      }),
      buildCtx({ profile: { hasAFib: true } }),
    )

    expect(result).toBeNull()
    expect(createArgs).toBeUndefined()
  })

  it('Scenario 18 — AFib + 1 reading + pregnant + ACE → Tier 1 fires (gate does NOT block)', async () => {
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('Scenario 19 — Beta-blocker + HR 55 → no alert (suppressed 50–60 window)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 118, diastolicBP: 72, pulse: 55 }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    expect(result).toBeNull()
    expect(createArgs).toBeUndefined()
  })

  // ========================================================================
  // Quality-of-measurement modifiers
  // ========================================================================

  it('Scenario 20 — Suboptimal checklist + 164/96 → L1 High + retake suffix', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 164,
        diastolicBP: 96,
        pulse: 78,
        suboptimalMeasurement: true,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.suboptimalMeasurement).toBe(true)
    expect(createArgs.data.patientMessage.toLowerCase()).toContain('retake')
  })

  it('Scenario 21 — Session-averaged 175+185 → avg 180/95 → BP Level 2', async () => {
    // SessionAverager is mocked — we pass a pre-averaged session to the
    // orchestrator. In production the averager folds the two raw readings
    // into this shape; here we assert the orchestrator correctly classifies
    // the averaged values.
    const { result, createArgs } = await run(
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
    expect(createArgs.data.tier).toBe('BP_LEVEL_2')
    expect(createArgs.data.patientMessage).toContain('180/95')
    expect(createArgs.data.patientMessage).toMatch(/911/)
  })

  // ========================================================================
  // Rule-ID coverage: every remaining RULE_* has at least one scenario
  // ========================================================================

  it('Scenario 22 — Pregnant + ruqPain → RULE_SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 128,
        diastolicBP: 82,
        symptoms: { ...noSymptoms(), ruqPain: true },
      }),
      buildCtx({ isPregnant: true }),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(createArgs.data.physicianMessage).toContain('preeclampsia')
  })

  it('Scenario 23 — HFrEF + SBP 82 → RULE_HFREF_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 82, diastolicBP: 55 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(result?.ruleId).toBe('RULE_HFREF_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('HFrEF')
  })

  it('Scenario 24 — HFrEF + SBP 162 → RULE_HFREF_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 88 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(result?.ruleId).toBe('RULE_HFREF_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 25 — HFpEF + SBP 162 → RULE_HFPEF_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 88 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFPEF',
          resolvedHFType: 'HFPEF',
        },
      }),
    )
    expect(result?.ruleId).toBe('RULE_HFPEF_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    expect(createArgs.data.physicianMessage).toContain('HFpEF')
  })

  it('Scenario 26 — CAD + SBP 162 DBP 82 (DBP normal) → RULE_CAD_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 82 }),
      buildCtx({ profile: { hasCAD: true, diagnosedHypertension: true } }),
    )
    expect(result?.ruleId).toBe('RULE_CAD_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 27 — HCM + SBP 98 (no risky med) → RULE_HCM_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 98, diastolicBP: 64 }),
      buildCtx({ profile: { hasHCM: true } }),
    )
    expect(result?.ruleId).toBe('RULE_HCM_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('LVOT')
  })

  it('Scenario 28 — HCM + SBP 162 (no risky med) → RULE_HCM_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 88 }),
      buildCtx({ profile: { hasHCM: true } }),
    )
    expect(result?.ruleId).toBe('RULE_HCM_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 29 — DCM only (no HF flag) + SBP 82 → RULE_DCM_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 82, diastolicBP: 55 }),
      buildCtx({
        profile: {
          hasHeartFailure: false,
          hasDCM: true,
          heartFailureType: 'NOT_APPLICABLE',
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(result?.ruleId).toBe('RULE_DCM_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('DCM')
  })

  it('Scenario 30 — DCM only + SBP 162 → RULE_DCM_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 88 }),
      buildCtx({
        profile: {
          hasHeartFailure: false,
          hasDCM: true,
          resolvedHFType: 'HFREF',
        },
      }),
    )
    expect(result?.ruleId).toBe('RULE_DCM_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 31 — Personalized low (threshold lower=110 + SBP 108) → RULE_PERSONALIZED_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 108, diastolicBP: 70 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        readingCount: 12,
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 110,
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
    expect(result?.ruleId).toBe('RULE_PERSONALIZED_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.mode).toBe('PERSONALIZED')
  })

  it('Scenario 32 — Age 45 + SBP 88 → RULE_STANDARD_L1_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 88, diastolicBP: 58 }),
      buildCtx({ ageGroup: '40-64' }),
    )
    expect(result?.ruleId).toBe('RULE_STANDARD_L1_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('Scenario 33 — AFib + 3 readings + pulse 48 → RULE_AFIB_HR_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 120,
        diastolicBP: 75,
        pulse: 48,
        readingCount: 3,
      }),
      buildCtx({ profile: { hasAFib: true } }),
    )
    expect(result?.ruleId).toBe('RULE_AFIB_HR_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
  })

  it('Scenario 34 — Tachy patient + pulse 105 + prior elevated (102) → RULE_TACHY_HR', async () => {
    prisma.journalEntry.findFirst.mockResolvedValue({ pulse: 102 })
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 80, pulse: 105 }),
      buildCtx({ profile: { hasTachycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_TACHY_HR')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  // Brady + TOD symptom: the L2 symptom override fires first (clinically safer
  // — higher-urgency tier takes precedence). RULE_BRADY_HR_SYMPTOMATIC is
  // reachable in unit tests (rules.spec.ts) but not end-to-end because the 3
  // structured flags used to detect bradycardic symptomaticity are all TOD
  // triggers that short-circuit to L2. Accepted per clinical-safety design.
  it('Scenario 35 — Brady + pulse 48 + chestPainOrDyspnea → L2 symptom override wins', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 118,
        diastolicBP: 72,
        pulse: 48,
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
  })

  it('Scenario 36 — Brady + pulse 38 (asymptomatic) → RULE_BRADY_HR_ASYMPTOMATIC', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 115, diastolicBP: 70, pulse: 38 }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_BRADY_HR_ASYMPTOMATIC')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('asymptomatic bradycardia')
  })

  it('Scenario 37 — Wide PP standalone 145/80 (PP 65) → RULE_PULSE_PRESSURE_WIDE', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 145, diastolicBP: 80, pulse: 74 }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_PULSE_PRESSURE_WIDE')
    expect(createArgs.data.tier).toBe('TIER_3_INFO')
    expect(createArgs.data.patientMessage).toBe('')
    expect(createArgs.data.pulsePressure).toBe(65)
  })

  it('Scenario 38 — Loop diuretic + SBP 92 standalone → RULE_LOOP_DIURETIC_HYPOTENSION', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 92, diastolicBP: 60, pulse: 72 }),
      buildCtx({
        contextMeds: [
          buildMed({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_LOOP_DIURETIC_HYPOTENSION')
    expect(createArgs.data.tier).toBe('TIER_3_INFO')
    expect(createArgs.data.patientMessage).toBe('')
  })

  // ========================================================================
  // All 6 general symptom triggers (scenario 5 covered severeHeadache)
  // ========================================================================

  it('Scenario 39 — visualChanges at 125/75 → BP Level 2 symptom override', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 125,
        diastolicBP: 75,
        symptoms: { ...noSymptoms(), visualChanges: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(createArgs.data.physicianMessage).toContain('visual changes')
  })

  it('Scenario 40 — alteredMentalStatus at 125/75 → BP Level 2 override', async () => {
    const { result } = await run(
      buildSession({
        symptoms: { ...noSymptoms(), alteredMentalStatus: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
  })

  it('Scenario 41 — chestPainOrDyspnea at 125/75 → BP Level 2 override', async () => {
    const { result, createArgs } = await run(
      buildSession({
        symptoms: { ...noSymptoms(), chestPainOrDyspnea: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(createArgs.data.physicianMessage).toContain(
      'chest pain or dyspnea',
    )
  })

  it('Scenario 42 — focalNeuroDeficit at 125/75 → BP Level 2 override', async () => {
    const { result } = await run(
      buildSession({
        symptoms: { ...noSymptoms(), focalNeuroDeficit: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
  })

  it('Scenario 43 — severeEpigastricPain at 125/75 → BP Level 2 override', async () => {
    const { result } = await run(
      buildSession({
        symptoms: { ...noSymptoms(), severeEpigastricPain: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
  })

  it('Scenario 44 — Pregnant + newOnsetHeadache → RULE_SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const { result } = await run(
      buildSession({
        symptoms: { ...noSymptoms(), newOnsetHeadache: true },
      }),
      buildCtx({ isPregnant: true }),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
  })

  it('Scenario 45 — Pregnant + edema at 110/70 → RULE_SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 110,
        diastolicBP: 70,
        symptoms: { ...noSymptoms(), edema: true },
      }),
      buildCtx({ isPregnant: true }),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_PREGNANCY')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
  })

  // ========================================================================
  // Combo drug contraindications (registersAs path)
  // ========================================================================

  it('Scenario 46 — Pregnant + Entresto (ARNI+ARB combo) → Tier 1', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 80 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [
          buildMed({
            drugName: 'Entresto',
            drugClass: 'ARNI',
            isCombination: true,
            combinationComponents: ['ARNI', 'ARB'],
          }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.physicianMessage).toContain('Entresto')
  })

  it('Scenario 47 — Pregnant + Zestoretic (ACE+THIAZIDE combo) → Tier 1', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 80 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [
          buildMed({
            drugName: 'Zestoretic',
            drugClass: 'OTHER_UNVERIFIED',
            isCombination: true,
            combinationComponents: ['ACE_INHIBITOR', 'THIAZIDE'],
          }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.physicianMessage).toContain('Zestoretic')
  })

  // ========================================================================
  // Safety-net HF type biases
  // ========================================================================

  it('Scenario 48 — HF type UNKNOWN + diltiazem → Tier 1 NDHP (via HFREF bias)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 120, diastolicBP: 74 }),
      buildCtx({
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'UNKNOWN',
          resolvedHFType: 'HFREF', // biased by ProfileResolver
        },
        contextMeds: [
          buildMed({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_NDHP_HFREF')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('Scenario 49 — DCM only (no HF flag) + diltiazem → Tier 1 NDHP', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 120, diastolicBP: 74 }),
      buildCtx({
        profile: {
          hasHeartFailure: false,
          hasDCM: true,
          resolvedHFType: 'HFREF',
        },
        contextMeds: [
          buildMed({ drugName: 'Diltiazem', drugClass: 'NDHP_CCB' }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_NDHP_HFREF')
  })

  // ========================================================================
  // Rule precedence (short-circuit order)
  // ========================================================================

  it('Scenario 50 — Both Tier 1 pairs present → pregnancy+ACE wins (fires first)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 120, diastolicBP: 76 }),
      buildCtx({
        isPregnant: true,
        profile: {
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
        contextMeds: [
          buildMed({ drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR' }),
          buildMed({
            id: 'med-2',
            drugName: 'Diltiazem',
            drugClass: 'NDHP_CCB',
          }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.physicianMessage).toContain('Lisinopril')
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
  })

  it('Scenario 51 — Pregnant + ACE + BP 195/130 → Tier 1 (not absolute emergency)', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 195, diastolicBP: 130 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [buildMed()],
      }),
    )
    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    // Contraindication short-circuits — no BP-tier alert even though BP is emergency-range.
  })

  // ========================================================================
  // Boundary values (fires at, does not fire at)
  // ========================================================================

  it('Scenario 52 — Standard SBP=160 boundary → L1 High fires', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 160, diastolicBP: 95 }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 53 — CAD + DBP=70 boundary → no CAD critical alert', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 130, diastolicBP: 70 }),
      buildCtx({ profile: { hasCAD: true } }),
    )
    expect(result).toBeNull()
  })

  it('Scenario 54 — Standard SBP=90 boundary → no low alert', async () => {
    const { result } = await run(buildSession({ systolicBP: 90 }), buildCtx())
    expect(result).toBeNull()
  })

  it('Scenario 55 — Age 65+ + SBP=100 boundary → no alert', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 100 }),
      buildCtx({ ageGroup: '65+', dateOfBirth: new Date('1953-01-01') }),
    )
    expect(result).toBeNull()
  })

  // ========================================================================
  // System-level edge paths
  // ========================================================================

  it('Scenario 56 — AFib + 3 readings + SBP 165 + pulse 75 → RULE_STANDARD_L1_HIGH (AFib gets BP alerts)', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 165,
        diastolicBP: 92,
        pulse: 75,
        readingCount: 3,
      }),
      buildCtx({ profile: { hasAFib: true } }),
    )
    expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 57 — Admin user (no PatientProfile) → skip silently, no alert, no upsert', async () => {
    sessionAverager.averageForEntry.mockResolvedValue(buildSession())
    profileResolver.resolve.mockRejectedValue(
      new (await import('@cardioplace/shared')).ProfileNotFoundException(
        'admin-user-1',
      ),
    )
    const r = await service.evaluate('entry-admin')
    expect(r).toBeNull()
    expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
  })
})
