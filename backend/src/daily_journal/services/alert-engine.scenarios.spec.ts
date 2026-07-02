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
import { ClsService } from 'nestjs-cls'
import { AlertEngineService } from './alert-engine.service.js'

// runAsCronActor wraps the @OnEvent handlers in cls.run — pass-through stub.
const clsStub = {
  run: (fn: () => unknown) => fn(),
  set: () => undefined,
  get: () => null,
} as unknown as ClsService
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
    fatigue: false,
    shortnessOfBreath: false,
    dryCough: false,
    nsaidUse: false,
    faceSwelling: false,
    throatTightness: false,
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
    // Cluster 6 Q2 default — ≥2 readings to bypass the single-reading gate.
    readingCount: 2,
    symptoms: noSymptoms(),
    suboptimalMeasurement: false,
    sessionId: null,
    // Adherence defaults — null = not asked, empty array = no per-med detail.
    // Keeps all 57 pre-existing scenarios unaffected by the adherence pass.
    medicationTaken: null,
    missedMedications: [],
    singleReadingFinalized: false,
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
  // Cluster 8 Q2 / Q3 — drive the CAD ramp + first-month nudge gates.
  // enrolledAt is compared against CAD_ROLLOUT_START (default
  // 2026-05-18T00:00:00Z) for the CAD ramp; the nudge requires
  // ctx.resolvedAt - ctx.enrolledAt ≤ 30 days.
  enrolledAt?: Date | null
  practiceName?: string | null
  patientName?: string | null
} = {}): ResolvedContext {
  const isPregnant = over.isPregnant ?? over.profile?.isPregnant ?? false
  const profile: ResolvedContext['profile'] = {
    gender: 'FEMALE',
    heightCm: 165,
    pregnancyDueDate: null,
    historyHDP: false,
    hasHeartFailure: false,
    heartFailureType: 'NOT_APPLICABLE',
    resolvedHFType: 'NOT_APPLICABLE',
    hasAFib: false,
    hasCAD: false,
    hasHCM: false,
    hasDCM: false,
    hasAorticStenosis: false,
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
    enrolledAt: over.enrolledAt ?? null,
    practiceName: over.practiceName ?? null,
    patientName: over.patientName ?? null,
    resolvedAt: FIXED_NOW,
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('AlertEngine — end-to-end scenarios (ALERT_SCENARIOS.md)', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let profileResolver: { resolve: jest.Mock<any> }
  let sessionAverager: { averageForEntry: jest.Mock<any> }

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
        // Cluster 8 Q3 — engine's one-time-per-patient guard for the
        // first-month nudge calls deviationAlert.count. Default 0 (no
        // prior nudges) so the guard passes; scenarios that test
        // suppression override per-test via mockResolvedValueOnce.
        count: (jest.fn() as jest.Mock<any>).mockResolvedValue(0),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        // Cluster 6 — loadAdherenceWindow queries the past 7 days. Empty
        // result means "no recent misses" so the rule needs a 2-of-3-day
        // pattern in the test fixture (or beta-blocker carve-out) to fire.
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      // HOLD-ADHERENCE — loadAdherenceWindow fetches the patient's HELD meds
      // to exclude them from the miss count. Default: no held meds.
      patientMedication: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        // alert-engine writes a patient-facing dashboard Notification per alert
        // (idempotent on @@unique([alertId, escalationEventId, userId, channel])).
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      // Cluster 6 bug #11 — persistAlert wraps writes in $transaction.
      $transaction: ((fn: any) => Promise.resolve(fn(prisma))) as any,
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
        { provide: ClsService, useValue: clsStub },
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
        profile: { historyHDP: true },
        contextMeds: [buildMed()],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.severity).toBe('HIGH')
    expect(createArgs.data.type).toBe('MEDICATION_ADHERENCE')
    expect(createArgs.data.pulsePressure).toBeNull()
    expect(createArgs.data.patientMessage).toContain('Lisinopril')
    expect(createArgs.data.patientMessage).toContain('pregnancy')
    expect(createArgs.data.physicianMessage).toContain('contraindicated in pregnancy')
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
    expect(createArgs.data.patientMessage).toContain('heart condition')
    expect(createArgs.data.physicianMessage).toContain('non-dihydropyridine CCB')
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
    // Doc 2: patient tier is directive with no raw number; caregiver carries it.
    expect(createArgs.data.patientMessage).toContain('dangerously high')
    expect(createArgs.data.patientMessage).toMatch(/911/)
    expect(createArgs.data.caregiverMessage).toContain('190/105')
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
    // Doc 2: symptom-override patient tier carries no number; physician does.
    expect(createArgs.data.patientMessage).toMatch(/911/)
    expect(createArgs.data.physicianMessage).toContain('122/76')
    expect(createArgs.data.physicianMessage).toContain('severe headache')
  })

  it('Scenario 6 — Pregnant + 165/112 → BP Level 2 RULE_PREGNANCY_L2', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 165, diastolicBP: 112, pulse: 90 }),
      buildCtx({ isPregnant: true }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_L2')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2')
    expect(createArgs.data.patientMessage).toContain('pregnancy')
    expect(createArgs.data.caregiverMessage).toContain('165/112')
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
    expect(createArgs.data.caregiverMessage).toContain('144/88')
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
    expect(createArgs.data.patientMessage).toContain('bottom blood pressure number')
    expect(createArgs.data.physicianMessage).toContain('132/68')
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
    expect(createArgs.data.caregiverMessage).toContain('115 bpm')
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
    expect(createArgs.data.patientMessage).toContain('dizzy')
    expect(createArgs.data.patientMessage).toContain('careful when standing')
    expect(createArgs.data.physicianMessage).toContain('AGE 65+')
    expect(createArgs.data.physicianMessage).toContain('fall risk')
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
    expect(createArgs.data.physicianMessage).toContain('patient-specific threshold')
  })

  // Lock for the 30u B3 e2e. A post-Day-3 patient (lifetime ≥ 7) does NOT fire a
  // non-emergency alert on a lone, non-finalized reading — the session must have
  // ≥2 readings (or be finalized) per the single-reading gate (getActiveSession:
  // "post-Day-3 + 1 reading → requiresMoreReadings=true"). With a 2-reading
  // session the personalized rule fires. The e2e originally posted ONE reading,
  // so no alert fired and it saw "no PERSONALIZED" — a TEST-SETUP gap, not an
  // engine bug. Verified: readingCount:1 here yields result=undefined (no alert).
  it('Scenario 12b — post-Day-3 personalized fires on a 2-reading session (30u B3 lock)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 155, diastolicBP: 92, pulse: 76, readingCount: 2, singleReadingFinalized: false }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        readingCount: 8, // lifetime ≥ 7 → post-Day-3 → single reading should fire
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: null,
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
    expect(createArgs?.data.mode).toBe('PERSONALIZED')
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
    // F26 — the pre-personalization disclaimer is admin-only. It rides on the
    // physician message, never the patient message.
    expect(createArgs.data.patientMessage).not.toMatch(/personalization/i)
    expect(createArgs.data.physicianMessage).toMatch(
      /personalization begins after 7 readings/i,
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

  it('Scenario 16 — Controlled patient benign 124/78 → no alert, no auto-resolve', async () => {
    // Bug #6/#7 fix (commit 37b7989) — the silent auto-resolve sweep on a
    // clean reading was REMOVED for JCAHO audit-trail compliance: a clean
    // reading must NEVER flip prior open alerts to RESOLVED with NULL
    // resolutionAction / resolutionRationale / resolvedBy. Resolution now
    // happens ONLY through the explicit /admin/alerts/:id/resolve API path
    // (alert-resolution.service.ts), which writes the full 15-field audit.
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
    expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
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
    expect(createArgs.data.patientMessage).toContain('dangerously high')
    expect(createArgs.data.patientMessage).toMatch(/911/)
    expect(createArgs.data.caregiverMessage).toContain('180/95')
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

  // Manisha 5/24 Q5C — aortic stenosis interim thresholds (low <100, high ≥160).
  it('Scenario 28a — aortic stenosis + SBP 98 → RULE_AORTIC_STENOSIS_LOW', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 98, diastolicBP: 70 }),
      buildCtx({ profile: { hasAorticStenosis: true } }),
    )
    expect(result?.ruleId).toBe('RULE_AORTIC_STENOSIS_LOW')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(createArgs.data.physicianMessage).toContain('outflow obstruction')
  })

  it('Scenario 28b — aortic stenosis + SBP 162 → RULE_AORTIC_STENOSIS_HIGH', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 162, diastolicBP: 88 }),
      buildCtx({ profile: { hasAorticStenosis: true } }),
    )
    expect(result?.ruleId).toBe('RULE_AORTIC_STENOSIS_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
  })

  it('Scenario 28c — aortic stenosis + SBP 130 (in interim range) → no alert', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 130, diastolicBP: 80 }),
      buildCtx({ profile: { hasAorticStenosis: true } }),
    )
    expect(result).toBeNull()
  })

  it('Scenario 28d — aortic stenosis provider threshold (low 105) overrides default', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 102, diastolicBP: 72 }),
      buildCtx({
        profile: { hasAorticStenosis: true },
        // Provider threshold — only SBP bounds matter for this rule; cast
        // to bypass the full ContextThreshold shape requirement.
        threshold: { sbpLowerTarget: 105, sbpUpperTarget: 160 } as unknown as NonNullable<ResolvedContext['threshold']>,
      }),
    )
    expect(result?.ruleId).toBe('RULE_AORTIC_STENOSIS_LOW')
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
    // Chunk B fix-up — the Gate A probe is now the FIRST journalEntry.findFirst
    // call; feed it null (no later reading) so the blanket prior-entry stub
    // below only serves the tachy consecutive-check + prior-reading queries.
    prisma.journalEntry.findFirst.mockResolvedValueOnce(null)
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

  // Cluster 6 (Manisha 5/10/26) — HR<40 retiered to Tier 1 (was Tier 2
  // BP_LEVEL_1_LOW). Rule renamed BRADY_HR_ASYMPTOMATIC → BRADY_ABSOLUTE.
  it('Scenario 36 — Brady + pulse 38 (asymptomatic) → RULE_BRADY_ABSOLUTE (Tier 1)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 115, diastolicBP: 70, pulse: 38 }),
      buildCtx({ profile: { hasBradycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_BRADY_ABSOLUTE')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.physicianMessage).toContain('Absolute bradycardia')
  })

  // ── NIVA_HR doc — HR<40 / HR>130 bypass the single-reading gate ──────────
  // The emergency HR floors must fire on a SINGLE reading for an established
  // (post-Day-3), non-AFib patient — they were previously trapped behind the
  // Cluster 6 Q2 single-reading non-emergency gate. readingCount:1 +
  // preDay3Mode:false reproduces the established-single-reading state (preDay3
  // would otherwise auto-derive true from readingCount<7 and mask the bug).
  it('NIVA_HR — established single reading HR<40 fires RULE_BRADY_ABSOLUTE (regression anchor)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 115, diastolicBP: 70, pulse: 38, readingCount: 1 }),
      buildCtx({ readingCount: 1, preDay3Mode: false, profile: { hasBradycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_BRADY_ABSOLUTE')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
  })

  it('NIVA_HR — established single reading HR>130 fires RULE_TACHY_HR immediately', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 125, diastolicBP: 78, pulse: 135, readingCount: 1 }),
      buildCtx({ readingCount: 1, preDay3Mode: false, profile: { hasTachycardia: true } }),
    )
    expect(result?.ruleId).toBe('RULE_TACHY_HR')
    expect(result?.actualValue).toBe(135)
  })

  it('NIVA_HR — guard: established single reading HR 45 + dizziness stays HELD (symptomatic brady is still gated)', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 115,
        diastolicBP: 70,
        pulse: 45,
        readingCount: 1,
        symptoms: { ...noSymptoms(), dizziness: true },
      }),
      buildCtx({ readingCount: 1, preDay3Mode: false, profile: { hasBradycardia: true } }),
    )
    expect(result).toBeNull()
    expect(createArgs).toBeUndefined()
  })

  it('NIVA_HR — AFib <3 single reading HR<40 still fires RULE_BRADY_ABSOLUTE (Stage A runs before the AFib gate)', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 115, diastolicBP: 70, pulse: 38, readingCount: 1 }),
      buildCtx({
        readingCount: 1,
        preDay3Mode: false,
        profile: { hasAFib: true, hasBradycardia: true },
      }),
    )
    expect(result?.ruleId).toBe('RULE_BRADY_ABSOLUTE')
  })

  it('NIVA_HR — established single reading HR 105 (no prior elevated) does NOT fire (consecutive path still needs 2 readings)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 125, diastolicBP: 78, pulse: 105, readingCount: 1 }),
      buildCtx({ readingCount: 1, preDay3Mode: false, profile: { hasTachycardia: true } }),
    )
    expect(result).toBeNull()
    expect(createArgs).toBeUndefined()
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

  it('Scenario 38 — Loop diuretic + SBP 89 → loop-diuretic rides as annotation on STANDARD_L1_LOW (Cluster 6 Q1: strict <90)', async () => {
    // Manisha 5/9 Q1: the 90-92 trending-low band is dropped. Loop rule
    // fires only at strict SBP < 90. At <90 STANDARD_L1_LOW also claims
    // sbp-low, so the loop note rides as a physicianMessage annotation
    // on the primary row instead of firing standalone — preserves the
    // Scenario 15 "PP wide rides as annotation" pattern.
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 89, diastolicBP: 60, pulse: 72 }),
      buildCtx({
        contextMeds: [
          buildMed({ drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC' }),
        ],
      }),
    )
    expect(result?.ruleId).toBe('RULE_STANDARD_L1_LOW')
    expect(createArgs.data.physicianMessage).toMatch(/loop diuretic/i)
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

  it('Scenario 51 — Pregnant + ACE + BP 195/130 → Tier 1 + emergency co-fire; L1-high suppressed (D.5 + F20)', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 195, diastolicBP: 130 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [buildMed()],
      }),
    )
    // v2 addendum D.5: emergency-axis row must co-fire so the patient
    // gets the 911 message at T+0; Tier 1 contraindication runs its own
    // T+0/4h/8h/24h/48h ladder in parallel. At 195/130 both
    // absoluteEmergency (≥180/120) and pregnancyL2 (≥160/110 + pregnant)
    // qualify on the emergency axis — absoluteEmergency runs first in
    // Stage B and claims the slot.
    expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
    // F20 — emergency is exclusive: two rows, not three. The Tier 1 ACE/ARB
    // contraindication (Stage A) co-fires with the BP L2 911 row, but the
    // lower-tier pregnancyL1High (bp-high) ladder is suppressed so no
    // "contact your provider" message renders beside the 911 takeover.
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_ABSOLUTE_EMERGENCY',
        'RULE_PREGNANCY_ACE_ARB',
      ]),
    )
    expect(persistedRuleIds).not.toContain('RULE_PREGNANCY_L1_HIGH')
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
    // DBP 60 keeps PP=30 (normal) so this stays a pure SBP-boundary test — the
    // default 90/78 would trip the new narrow-PP (<25) physician note.
    const { result } = await run(buildSession({ systolicBP: 90, diastolicBP: 60 }), buildCtx())
    expect(result).toBeNull()
  })

  it('Scenario 55 — Age 65+ + SBP=100 boundary → no alert', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 100, diastolicBP: 70 }),
      buildCtx({ ageGroup: '65+', dateOfBirth: new Date('1953-01-01') }),
    )
    expect(result).toBeNull()
  })

  // ── Manisha 5/24 Q2 — narrow pulse pressure (session-averaged < 25) ───────
  it('NARROW-PP — generic patient at 110/90 (PP 20) → RULE_PULSE_PRESSURE_NARROW (physician-only)', async () => {
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 110, diastolicBP: 90 }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_PULSE_PRESSURE_NARROW')
    expect(createArgs.data.tier).toBe('TIER_3_INFO')
    expect(createArgs.data.patientMessage).toBe('')
    expect(createArgs.data.physicianMessage).toMatch(/narrow pulse pressure/i)
    expect(createArgs.data.physicianMessage).toMatch(/reduced cardiac output/i)
  })

  it('NARROW-PP — HFrEF patient gets the reduced-stroke-volume wording', async () => {
    const { createArgs } = await run(
      buildSession({ systolicBP: 110, diastolicBP: 92 }),
      buildCtx({ profile: { hasHeartFailure: true, heartFailureType: 'HFREF', resolvedHFType: 'HFREF' } }),
    )
    // HFrEF SBP 110 is above the 85 lower bound, so the narrow-PP note is the row.
    expect(createArgs.data.ruleId).toBe('RULE_PULSE_PRESSURE_NARROW')
    expect(createArgs.data.physicianMessage).toMatch(/reduced stroke volume/i)
  })

  it('NARROW-PP F23 — HFrEF co-fire: higher-tier alert carries reduced-stroke-volume annotation', async () => {
    // Carol CM-9: HFrEF, session-averaged 128/108 (PP=20). DBP≥100 fires a
    // higher-tier BP alert; narrow PP rides as a physician annotation that must
    // carry the HFrEF clinical-correlation wording, not the generic note.
    const { createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 108 }),
      buildCtx({ profile: { hasHeartFailure: true, heartFailureType: 'HFREF', resolvedHFType: 'HFREF' } }),
    )
    expect(createArgs.data.ruleId).not.toBe('RULE_PULSE_PRESSURE_NARROW')
    expect(createArgs.data.physicianMessage).toMatch(
      /In HFrEF, narrow PP may indicate reduced stroke volume/i,
    )
  })

  it('NARROW-PP — PP ≥ 25 does not fire', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 120, diastolicBP: 80 }),
      buildCtx(),
    )
    expect(result?.ruleId).not.toBe('RULE_PULSE_PRESSURE_NARROW')
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

  // ========================================================================
  // Drug-class coverage gaps (not covered by earlier scenarios)
  // ========================================================================

  it('Scenario 58 — Pregnant + Losartan (ARB standalone) → Tier 1 RULE_PREGNANCY_ACE_ARB', async () => {
    // Guards the ARB branch of the pregnancy rule. Scenario 1 covers ACE
    // (Lisinopril). Scenario 46 covers an ARB inside a combination (Entresto
    // ARNI+ARB). This adds standalone ARB — the common Losartan prescription.
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 128, diastolicBP: 80, pulse: 78 }),
      buildCtx({
        isPregnant: true,
        contextMeds: [buildMed({ drugName: 'Losartan', drugClass: 'ARB' })],
      }),
    )

    expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.physicianMessage).toContain('Losartan')
  })

  // ========================================================================
  // BB suppression boundary (<50 fires regardless of BB)
  // ========================================================================

  // ========================================================================
  // Tier 2 — Medication adherence (dismissable, independent pipeline pass)
  // ========================================================================

  it('Scenario 60 — Cluster 6: 2-of-3-day miss pattern → RULE_MEDICATION_MISSED Tier 2', async () => {
    // Cluster 6 (Manisha 5/10/26) — adherence is now pattern-based. Seed the
    // adherence-window query with two prior days of misses so the threshold
    // (≥2 in rolling 3) is met by the current session.
    const now = new Date('2026-04-22T10:00:00Z')
    prisma.journalEntry.findMany.mockResolvedValueOnce([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
      {
        id: 'prev-2',
        measuredAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
    ])
    const { result, createArgs, eventArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        medicationTaken: false,
        measuredAt: now,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_MEDICATION_MISSED')
    expect(createArgs.data.tier).toBe('TIER_2_DISCREPANCY')
    expect(createArgs.data.type).toBe('MEDICATION_ADHERENCE')
    expect(createArgs.data.dismissible).toBe(true)
    expect(createArgs.data.severity).toBe('MEDIUM')
    // #86 wording — patient message anchors to the multi-day pattern
    // ("the last few days"), never claiming a miss happened "today".
    expect(createArgs.data.patientMessage.toLowerCase()).toContain(
      'last few days',
    )
    expect(createArgs.data.physicianMessage).toContain('Tier 2')
    expect(createArgs.data.physicianMessage.toLowerCase()).toContain(
      'no medication specified',
    )
    expect(eventArgs[0]).toBe(JOURNAL_EVENTS.ALERT_CREATED)
    expect(eventArgs[1]).toMatchObject({
      ruleId: 'RULE_MEDICATION_MISSED',
      tier: 'TIER_2_DISCREPANCY',
    })
  })

  it('Scenario 61 — Cluster 6: 2-of-3 miss pattern with Lisinopril → physician msg names drug + reason', async () => {
    // Per-med detail flows through the adherence window's per-med accumulator
    // → metadata.missedMedications → AlertContext → physicianMessage.
    const now = new Date('2026-04-22T10:00:00Z')
    const missDetail = {
      medicationId: 'med-lisino',
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR' as const,
      reason: 'FORGOT' as const,
      missedDoses: 1,
    }
    prisma.journalEntry.findMany.mockResolvedValueOnce([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: null,
        missedMedications: [missDetail],
      },
      {
        id: 'prev-2',
        measuredAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        medicationTaken: null,
        missedMedications: [missDetail],
      },
    ])
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        medicationTaken: true,
        missedMedications: [missDetail],
        measuredAt: now,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result?.ruleId).toBe('RULE_MEDICATION_MISSED')
    expect(createArgs.data.tier).toBe('TIER_2_DISCREPANCY')
    expect(createArgs.data.physicianMessage).toContain('Lisinopril')
    expect(createArgs.data.physicianMessage).toContain('ACE_INHIBITOR')
    expect(createArgs.data.physicianMessage).toContain('FORGOT')
  })

  it('Scenario 62 — BP L1 High + 2-of-3 day miss pattern → TWO DeviationAlert rows created', async () => {
    // Co-occurrence path: independent BP pipeline fires (row 1), then the
    // Cluster 6 windowed adherence pass fires (row 2). Both creates are
    // asserted; event emission happens twice.
    const now = new Date('2026-04-22T10:00:00Z')
    prisma.journalEntry.findMany.mockResolvedValueOnce([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
      {
        id: 'prev-2',
        measuredAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
    ])
    await run(
      buildSession({
        systolicBP: 165,
        diastolicBP: 94,
        pulse: 78,
        medicationTaken: false,
        measuredAt: now,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)

    const firstCall = prisma.deviationAlert.create.mock.calls[0][0]
    expect(firstCall.data.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    expect(firstCall.data.type).toBe('SYSTOLIC_BP')
    expect(firstCall.data.tier).toBe('BP_LEVEL_1_HIGH')

    const secondCall = prisma.deviationAlert.create.mock.calls[1][0]
    expect(secondCall.data.ruleId).toBe('RULE_MEDICATION_MISSED')
    expect(secondCall.data.type).toBe('MEDICATION_ADHERENCE')
    expect(secondCall.data.tier).toBe('TIER_2_DISCREPANCY')

    // Resolve-sweep MUST NOT run when any alert fires — would incorrectly
    // auto-resolve the BP L1 row we just created.
    expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
  })

  it('Scenario 63 — medicationTaken=true + missedMedications=[] → no adherence alert, no auto-resolve', async () => {
    // Bug #6/#7 fix (commit 37b7989) — happy path: patient took all meds,
    // no BP rule fires either. The pre-bug-fix behavior silently swept
    // open BP L1 alerts to RESOLVED on a clean reading; that sweep was
    // removed for JCAHO audit-trail compliance. Resolution now requires
    // the explicit /admin/alerts/:id/resolve path with full audit fields.
    const { result } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        medicationTaken: true,
      }),
      buildCtx({ profile: { diagnosedHypertension: true } }),
    )

    expect(result).toBeNull()
    expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
  })

  it('Scenario 59 — Brady + Beta-blocker + pulse 38 → RULE_BRADY_ABSOLUTE Tier 1 (Cluster 6 retier)', async () => {
    // BB suppression window is 50–60 exclusive — below 40, RULE_BRADY_ABSOLUTE
    // fires at Tier 1 regardless of beta-blocker (clinically: <40 bpm on BB
    // needs urgent provider review).
    const { result, createArgs } = await run(
      buildSession({ systolicBP: 118, diastolicBP: 72, pulse: 38 }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    expect(result?.ruleId).toBe('RULE_BRADY_ABSOLUTE')
    expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
    expect(createArgs.data.physicianMessage).toContain('Absolute bradycardia')
  })

  it('Scenario 64 — 65+ CAD + 95/65 → TWO rows (RULE_AGE_65_LOW + RULE_CAD_DBP_CRITICAL)', async () => {
    // Phase/26 multi-axis fix: SBP 95 violates the §1.1 65+ raised lower
    // bound (SBP <100 — orthostatic / fall-risk concern), and DBP 65
    // violates the §4.3 CAD critical lower bound (DBP <70 — J-curve /
    // coronary perfusion concern). The two rules drive different
    // remediation paths so both must persist as distinct alerts.
    // Pre-fix behavior: only RULE_CAD_DBP_CRITICAL was written because the
    // BP/HR pipeline short-circuited on first match.
    await run(
      buildSession({
        systolicBP: 95,
        diastolicBP: 65,
        pulse: 70,
      }),
      buildCtx({
        ageGroup: '65+',
        profile: { hasCAD: true, diagnosedHypertension: true },
      }),
    )

    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)

    // Persist order: AXIS_PRIORITY puts sbp-low before dbp-low, so the
    // bucket-derived rule lands at calls[0]. Both rows are BP_LEVEL_1_LOW
    // but on independent clinical axes.
    const firstCall = prisma.deviationAlert.create.mock.calls[0][0]
    expect(firstCall.data.ruleId).toBe('RULE_AGE_65_LOW')
    expect(firstCall.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(firstCall.data.type).toBe('SYSTOLIC_BP')

    const secondCall = prisma.deviationAlert.create.mock.calls[1][0]
    expect(secondCall.data.ruleId).toBe('RULE_CAD_DBP_CRITICAL')
    expect(secondCall.data.tier).toBe('BP_LEVEL_1_LOW')
    expect(secondCall.data.type).toBe('DIASTOLIC_BP')

    // Distinct ALERT_CREATED events fire per row so EscalationService
    // instantiates two independent ladders (verified per design — no
    // assertion on count here because eventEmitter is shared with the
    // patient-notification pipeline; existing scenarios hold that contract).
  })

  // ========================================================================
  // Phase/27 multi-ladder co-fire (B1 + G1–G7) — v2 addendum Part D
  // requires Tier 1 contraindication, BP L2 emergency, and BP L1 to each
  // run their own escalation ladder. Stage A/B no longer terminally
  // short-circuit, so distinct-axis rules co-fire.
  // ========================================================================

  it('Scenario 65 (B1) — Non-pregnant + ruqPain → RULE_SYMPTOM_OVERRIDE_GENERAL fires (§2.3 lumped trigger)', async () => {
    const { result, createArgs } = await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 80,
        symptoms: { ...noSymptoms(), ruqPain: true },
      }),
      buildCtx(),
    )
    expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
    expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    expect(createArgs.data.physicianMessage).toContain('RUQ pain')
  })

  it('Scenario 66 (G1) — HFrEF + Diltiazem + SBP 80 → NDHP_HFREF + HFREF_LOW co-fire', async () => {
    await run(
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
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining(['RULE_NDHP_HFREF', 'RULE_HFREF_LOW']),
    )
  })

  it('Scenario 67 (G2) — Pregnant + ACE + 175/115 → ACE_ARB + L2; L1_HIGH suppressed (F20)', async () => {
    await run(
      buildSession({ systolicBP: 175, diastolicBP: 115, pulse: 80 }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    // F20 — emergency is exclusive. pregnancyL2 (≥160/110) claims the
    // emergency axis, so the lower-tier pregnancyL1High (bp-high) ladder is
    // suppressed. The Tier 1 ACE/ARB contraindication (Stage A) survives →
    // two ladders, not three.
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_PREGNANCY_ACE_ARB',
        'RULE_PREGNANCY_L2',
      ]),
    )
    expect(persistedRuleIds).not.toContain('RULE_PREGNANCY_L1_HIGH')
  })

  it('Scenario 68 (G3) — Pregnant + ACE + newOnsetHeadache + normal BP → ACE_ARB + SYMPTOM_OVERRIDE_PREGNANCY', async () => {
    await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 85,
        symptoms: { ...noSymptoms(), newOnsetHeadache: true },
      }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_PREGNANCY_ACE_ARB',
        'RULE_SYMPTOM_OVERRIDE_PREGNANCY',
      ]),
    )
  })

  it('Scenario 69 (G4) — Pregnant + ACE + ruqPain → ACE_ARB + SYMPTOM_OVERRIDE_PREGNANCY (pregnancy wording wins)', async () => {
    // Pregnancy override runs first in Stage A so it claims the
    // emergency axis ahead of the general override that also includes
    // ruqPain (§2.3 lumped trigger). Result: preeclampsia-specific
    // wording, not generic.
    await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 85,
        symptoms: { ...noSymptoms(), ruqPain: true },
      }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_PREGNANCY_ACE_ARB',
        'RULE_SYMPTOM_OVERRIDE_PREGNANCY',
      ]),
    )
    expect(persistedRuleIds).not.toContain('RULE_SYMPTOM_OVERRIDE_GENERAL')
  })

  it('Scenario 70 (G5) — Pregnant + ACE + visualChanges → ACE_ARB + SYMPTOM_OVERRIDE_GENERAL', async () => {
    // visualChanges is a general (non-pregnancy-specific) symptom, so
    // the pregnancy-specific override does not fire and the general
    // override claims the emergency axis.
    await run(
      buildSession({
        systolicBP: 130,
        diastolicBP: 85,
        symptoms: { ...noSymptoms(), visualChanges: true },
      }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_PREGNANCY_ACE_ARB',
        'RULE_SYMPTOM_OVERRIDE_GENERAL',
      ]),
    )
  })

  it('Scenario 71 (G6) — HFrEF + Diltiazem + SBP 165 → NDHP_HFREF + HFREF_HIGH co-fire', async () => {
    await run(
      buildSession({ systolicBP: 165, diastolicBP: 95, pulse: 78 }),
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
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining(['RULE_NDHP_HFREF', 'RULE_HFREF_HIGH']),
    )
  })

  it('Scenario 72 (G7) — Pregnant + ACE + 145/85 → ACE_ARB + PREGNANCY_L1_HIGH (no L2)', async () => {
    await run(
      buildSession({ systolicBP: 145, diastolicBP: 85, pulse: 78 }),
      buildCtx({ isPregnant: true, contextMeds: [buildMed()] }),
    )
    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(2)
    const persistedRuleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(persistedRuleIds).toEqual(
      expect.arrayContaining([
        'RULE_PREGNANCY_ACE_ARB',
        'RULE_PREGNANCY_L1_HIGH',
      ]),
    )
    expect(persistedRuleIds).not.toContain('RULE_PREGNANCY_L2')
  })

  // ========================================================================
  // Cluster 8 (Manisha 5/18/26) — angioedema (P0 pilot blocker)
  // ========================================================================
  // Source: cardioplace-ace-angioedema-rule-signoff. Stage A pre-gate rule.
  // Fires for ALL patients on a SINGLE reading regardless of med profile
  // (bypasses Cluster 6 Q2 ≥2-reading gate). TIER_1_ANGIOEDEMA, non-dismiss-
  // able, compressed escalation ladder. Three branches by med list:
  //   ACE_ANGIOEDEMA      — ACE inhibitor present (ACE physician variant)
  //   ACE_ANGIOEDEMA      — ARB present, no ACE  (ARB physician variant)
  //   GENERIC_ANGIOEDEMA  — neither (NO "stop your medicine" patient line)
  // Edge: GENERIC_ANGIOEDEMA + "list unverified" annotation when contextMeds
  // has any non-VERIFIED entry but no matched ACE/ARB.

  it('Scenario 73 (Cluster 8 B.1) — faceSwelling + VERIFIED ACE inhibitor → RULE_ACE_ANGIOEDEMA TIER_1_ANGIOEDEMA', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1, // bypasses Cluster 6 Q2 single-reading gate
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      buildCtx({ contextMeds: [buildMed()] }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_ACE_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    expect(createArgs.data.dismissible).toBe(false)
    expect(createArgs.data.patientMessage).toMatch(
      /do not take any more of your blood pressure medicine/i,
    )
    expect(createArgs.data.physicianMessage).toContain('Lisinopril')
    expect(createArgs.data.physicianMessage).toContain('ACE_INHIBITOR')
    expect(createArgs.data.physicianMessage).toMatch(/bradykinin-mediated/i)
  })

  it('Scenario 74 (Cluster 8 B.1) — faceSwelling + VERIFIED ARB (no ACE) → RULE_ACE_ANGIOEDEMA ARB variant', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      buildCtx({
        contextMeds: [
          buildMed({ drugName: 'Losartan', drugClass: 'ARB' }),
        ],
      }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_ACE_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    // ARB physician variant: different wording, no bradykinin paragraph.
    expect(createArgs.data.physicianMessage).toContain('Losartan')
    expect(createArgs.data.physicianMessage).toContain('(ARB)')
    expect(createArgs.data.physicianMessage).toMatch(
      /ARB-associated angioedema is less common/i,
    )
    expect(createArgs.data.physicianMessage).not.toMatch(/bradykinin-mediated/i)
  })

  it('Scenario 75 (Cluster 8 B.1) — faceSwelling + NO ACE/ARB → RULE_GENERIC_ANGIOEDEMA, no "stop medicine" line', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      // Empty contextMeds is the cleanest "neither ACE nor ARB" condition.
      buildCtx({ contextMeds: [] }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_GENERIC_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    // Generic branch must NOT tell the patient to stop their medicine —
    // cause may not be a medication.
    expect(createArgs.data.patientMessage).not.toMatch(
      /do not take any more of your blood pressure medicine/i,
    )
    // Patient still gets the airway/911 lead.
    expect(createArgs.data.patientMessage).toMatch(/swelling of your face/i)
    expect(createArgs.data.physicianMessage).toContain('Differential')
    expect(createArgs.data.physicianMessage).not.toMatch(/bradykinin-mediated/i)
  })

  it('Scenario 76 (Cluster 8 B.1) — faceSwelling + UNVERIFIED non-ACE med → GENERIC + physician "unverified" annotation', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      buildCtx({
        contextMeds: [
          // Non-ACE/ARB drug class so the rule doesn't match ACE/ARB, but
          // it IS on the list and IS unverified — the safety-net branch.
          buildMed({
            drugName: 'Amlodipine',
            drugClass: 'DHP_CCB',
            verificationStatus: 'UNVERIFIED',
          }),
        ],
      }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_GENERIC_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    // Provider annotation surfaced via physSuffix — flags that ACE/ARB
    // exposure cannot be ruled out from an unverified list.
    expect(createArgs.data.physicianMessage).toMatch(
      /Medication list unverified — cannot rule out ACE inhibitor or ARB exposure/i,
    )
  })

  it('Scenario 77 (Cluster 8 B.1) — throatTightness + ACE inhibitor → RULE_ACE_ANGIOEDEMA TIER_1_ANGIOEDEMA', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), throatTightness: true },
      }),
      buildCtx({ contextMeds: [buildMed()] }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_ACE_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    // Throat-tightness-only lead leads with the airway phrasing.
    expect(createArgs.data.patientMessage).toMatch(/your throat feels tight/i)
    expect(createArgs.data.patientMessage).toMatch(/911/)
    expect(createArgs.data.physicianMessage).toMatch(
      /Throat tightness reported — potential airway compromise/i,
    )
  })

  it('Scenario 78 (Cluster 8 B.1) — throatTightness + NO meds at all → RULE_GENERIC_ANGIOEDEMA Tier 1 (universal airway)', async () => {
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), throatTightness: true },
      }),
      buildCtx({ contextMeds: [] }),
    )

    // Critical: airway symptoms must fire Tier 1 EVEN with no med history —
    // angioedema can be allergic, hereditary, idiopathic. The rule must not
    // gate on med presence.
    expect(createArgs.data.ruleId).toBe('RULE_GENERIC_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
    expect(createArgs.data.dismissible).toBe(false)
    // No "stop medicine" line — no medicine to stop.
    expect(createArgs.data.patientMessage).not.toMatch(
      /do not take any more of your blood pressure medicine/i,
    )
  })

  it('Scenario 79 (Cluster 8 B.1) — angioedema preempts SBP — Stage A fires alone on a 145 reading + faceSwelling + ACE', async () => {
    // Wiring spec: ACE_ANGIOEDEMA claims the top-priority 'angioedema' axis
    // ahead of every BP axis, and the Stage A pre-gate is terminal for that
    // axis. With diagnosedHypertension + SBP 145 in standard mode, no L1
    // SBP rule fires here either (STANDARD_L1_HIGH threshold is 160). We
    // explicitly assert only ONE row is persisted, the angioedema row.
    const { createArgs } = await run(
      buildSession({
        systolicBP: 145,
        diastolicBP: 85,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        contextMeds: [buildMed()],
      }),
    )

    expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
    expect(createArgs.data.ruleId).toBe('RULE_ACE_ANGIOEDEMA')
  })

  it('Scenario 80 (Cluster 8 B.1) — ACE inhibitor reported 10 years ago (no duration gate) → still fires Tier 1', async () => {
    // OCTAVE / doc Q4 — ACE-induced angioedema can occur after years of
    // therapy. Explicit guard: an ACE on the list for a decade must fire
    // identically to a fresh prescription. We backdate verifiedAt + the
    // med's reportedAt to TEN_YEARS_AGO to exercise the "no time filter".
    const { createArgs } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: { ...noSymptoms(), faceSwelling: true },
      }),
      buildCtx({
        contextMeds: [
          buildMed({
            // Same default ACE drug + class; explicit 10y-old reportedAt
            // documents the test's intent. The rule never inspects this
            // field — that IS the assertion.
            reportedAt: TEN_YEARS_AGO,
            verificationStatus: 'VERIFIED',
          }),
        ],
      }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_ACE_ANGIOEDEMA')
    expect(createArgs.data.tier).toBe('TIER_1_ANGIOEDEMA')
  })

  it('Scenario 81 (Cluster 8 B.1) — no airway symptoms → angioedema rule is silent (negative guard)', async () => {
    // Belt-and-suspenders: the rule must NOT fire on an ordinary clean
    // reading. A regression here would mean an ACE inhibitor on the list +
    // any reading is producing spurious Tier 1 emergency alerts.
    const { result } = await run(
      buildSession({
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        readingCount: 1,
        symptoms: noSymptoms(),
      }),
      buildCtx({ contextMeds: [buildMed()] }),
    )

    expect(result).toBeNull()
    expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
  })

  // ========================================================================
  // Cluster 8 Q1 (Manisha 5/18/26) — asymptomatic-brady surveillance
  // ========================================================================
  // MESA differential-mortality cohort: HR 40–49 with NO brady-relevant
  // symptoms must not be silent for patients on rate-controlling meds (or
  // hasBradycardia). Pass 3 fires AFTER the BP/HR pipeline:
  //   • Tier 3 chart event (physician-only, empty patient/caregiver msg)
  //     when the trailing consecutive ≤45 session run is < 3
  //   • Tier 2 review when the run is ≥ 3 (escalation)
  // Distinct from bradyAbsoluteRule (HR<40, Tier 1) and bradySymptomaticRule
  // (HR 40–49 + symptom, Tier 2 via the BP/HR pipeline). 50–60 BB-therapeutic
  // is unchanged (no alert).

  function bradyHrEntry(measuredAt: Date, pulse: number) {
    return { id: 'h-' + measuredAt.getTime(), measuredAt, pulse }
  }

  it('Scenario 82 (Cluster 8 B.2) — HR 45 asymptomatic on beta-blocker → RULE_BRADY_SURVEILLANCE Tier 3, empty patient/caregiver msg', async () => {
    // loadAdherenceWindow (Pass 2) + loadBradyPatternWindow (Pass 3) BOTH
    // call prisma.journalEntry.findMany. Default mock returns [] for both
    // → consecutiveSessionsLe45 = 0 → Tier 3 (not escalated).
    const { createArgs } = await run(
      buildSession({ systolicBP: 122, diastolicBP: 76, pulse: 45 }),
      buildCtx({
        profile: { hasBradycardia: true, diagnosedHypertension: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    // Find the surveillance row — other passes may co-fire (HR-context
    // annotations, missed-dose row from empty adherence) so don't index 0.
    const calls = prisma.deviationAlert.create.mock.calls as Array<
      [{ data: { ruleId: string; tier: string; patientMessage: string; caregiverMessage: string } }]
    >
    const surveillance = calls
      .map((c) => c[0].data)
      .find((d) => d.ruleId === 'RULE_BRADY_SURVEILLANCE')
    expect(surveillance).toBeTruthy()
    expect(surveillance?.tier).toBe('TIER_3_INFO')
    // Per the registry: surveillance patient/caregiver messages are empty
    // strings — physician-only chart event, no alarm to an asymptomatic
    // patient.
    expect(surveillance?.patientMessage).toBe('')
    expect(surveillance?.caregiverMessage).toBe('')
    expect(createArgs).toBeTruthy()
  })

  it('Scenario 83 (Cluster 8 B.2) — HR 45 + dizziness → SYMPTOMATIC (Tier 2), NOT surveillance', async () => {
    await run(
      buildSession({
        systolicBP: 122,
        diastolicBP: 76,
        pulse: 45,
        symptoms: { ...noSymptoms(), dizziness: true },
      }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).toContain('RULE_BRADY_HR_SYMPTOMATIC')
    expect(ruleIds).not.toContain('RULE_BRADY_SURVEILLANCE')
  })

  it('Scenario 84 (Cluster 8 B.2) — HR 45 asymptomatic + NOT on rate-control + no hasBradycardia → no alert', async () => {
    // Gate: hasBradycardia OR rate-control med. With NEITHER, the rule is
    // silent (avoids surveillance noise for healthy athletic bradycardia).
    await run(
      buildSession({ systolicBP: 122, diastolicBP: 76, pulse: 45 }),
      buildCtx({
        profile: { hasBradycardia: false },
        contextMeds: [],
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_BRADY_SURVEILLANCE')
    expect(ruleIds).not.toContain('RULE_BRADY_HR_SYMPTOMATIC')
    expect(ruleIds).not.toContain('RULE_BRADY_HR_ASYMPTOMATIC')
  })

  it('Scenario 85 (Cluster 8 B.2) — HR 45 × 3 consecutive sessions → ESCALATE to TIER_2_DISCREPANCY (sustained)', async () => {
    // Seed prisma.journalEntry.findMany with 3 prior days each at HR ≤45.
    // The brady-pattern window buckets by calendar day → 3 distinct days
    // → consecutiveSessionsLe45 = 3 → Tier 2 (sustained-pattern review).
    //
    // CRITICAL: there are THREE findMany call sites in evaluate():
    //   Pass 1 → wasPriorReadingPulseElevated (Stage C)
    //   Pass 2 → loadAdherenceWindow  (adherence)
    //   Pass 3 → loadBradyPatternWindow (THIS)
    // We use the default-mock-resolved-value pattern (mockResolvedValue,
    // not mockResolvedValueOnce) so all three calls get the same payload
    // — fine because the prior-elevated check + adherence both tolerate
    // pulse-only / measuredAt-only rows.
    const now = new Date('2026-04-22T10:00:00Z')
    prisma.journalEntry.findMany.mockResolvedValue([
      bradyHrEntry(new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000), 44),
      bradyHrEntry(new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000), 45),
      bradyHrEntry(new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000), 43),
    ])

    await run(
      buildSession({ systolicBP: 122, diastolicBP: 76, pulse: 45 }),
      buildCtx({
        profile: { hasBradycardia: true, diagnosedHypertension: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    const surveillance = (
      prisma.deviationAlert.create.mock.calls as Array<
        [{ data: { ruleId: string; tier: string; physicianMessage: string } }]
      >
    )
      .map((c) => c[0].data)
      .find((d) => d.ruleId === 'RULE_BRADY_SURVEILLANCE')
    expect(surveillance).toBeTruthy()
    expect(surveillance?.tier).toBe('TIER_2_DISCREPANCY')
    expect(surveillance?.physicianMessage).toMatch(
      /Sustained asymptomatic bradycardia/i,
    )
    expect(surveillance?.physicianMessage).toMatch(/3 consecutive sessions/i)
  })

  it('Scenario 86 (Cluster 8 B.2) — HR 38 (below 40) → bradyAbsoluteRule Tier 1, NOT surveillance', async () => {
    // The surveillance rule's [40, 50) band carves out HR<40 — that's
    // owned by bradyAbsoluteRule (Tier 1). A regression would mean a HR
    // 38 reading produces only a Tier 3 surveillance row, losing the
    // Tier 1 absolute-emergency escalation.
    await run(
      buildSession({ systolicBP: 122, diastolicBP: 76, pulse: 38 }),
      buildCtx({
        profile: { hasBradycardia: true },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).toContain('RULE_BRADY_ABSOLUTE')
    expect(ruleIds).not.toContain('RULE_BRADY_SURVEILLANCE')
  })

  it('Scenario 87 (Cluster 8 B.2) — HR 55 on beta-blocker (BB therapeutic 50–60) → no brady alert', async () => {
    // The MESA cohort still uses 50 as the suppression floor — HR 55 on a
    // BB is the therapeutic target, not a surveillance signal. Guard
    // against accidental band widening that would alarm-fatigue providers.
    await run(
      buildSession({ systolicBP: 122, diastolicBP: 76, pulse: 55 }),
      buildCtx({
        profile: { hasBradycardia: false },
        contextMeds: [
          buildMed({ drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER' }),
        ],
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_BRADY_SURVEILLANCE')
    expect(ruleIds).not.toContain('RULE_BRADY_HR_ASYMPTOMATIC')
    expect(ruleIds).not.toContain('RULE_BRADY_HR_SYMPTOMATIC')
    expect(ruleIds).not.toContain('RULE_BRADY_ABSOLUTE')
  })

  // ========================================================================
  // Cluster 8 Q2 (Manisha 5/18/26) — CAD default sbpUpperTarget 160 → 140
  // ========================================================================
  // Phased ramp anchored at 2026-05-18 (env-overridable). Phase 1 (default)
  // = newly enrolled CAD patients only. Phase 2 = + Cedar Hill. Phase 3 =
  // all. Provider-set PatientThreshold.sbpUpperTarget always wins. The DBP-
  // high companion (≥80) shares the same ramp gate.
  //
  // FIXED_NOW = 2026-04-22 sits BEFORE the rollout, so "ramp-active"
  // scenarios use enrolledAt ≥ 2026-05-18 explicitly. cadRampApplies is a
  // pure date comparison — it doesn't enforce enrolledAt ≤ resolvedAt
  // ordering, so this exercises the gate without env mutation.

  const CAD_RAMP_ENROLLED_AT = new Date('2026-05-18T12:00:00Z')
  const CAD_PRE_ROLLOUT_ENROLLED_AT = new Date('2026-04-01T00:00:00Z')

  it('Scenario 88 (Cluster 8 B.3) — CAD + SBP 145 + enrolledAt ≥ rollout → RULE_CAD_HIGH fires (Q2 default 140)', async () => {
    const { createArgs } = await run(
      buildSession({ systolicBP: 145, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        enrolledAt: CAD_RAMP_ENROLLED_AT,
      }),
    )

    expect(createArgs.data.ruleId).toBe('RULE_CAD_HIGH')
    expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
    // Physician message surfaces the new 140 threshold + AHA/ACC treatment
    // target — verifies the message-registry is reading the ramp default.
    expect(createArgs.data.physicianMessage).toContain('140')
    expect(createArgs.data.physicianMessage).toMatch(/AHA\/ACC treatment target 130\/80/i)
  })

  it('Scenario 89 (Cluster 8 B.3) — CAD + SBP 135 + ramp active → NO CAD_HIGH (below 140)', async () => {
    const { result } = await run(
      buildSession({ systolicBP: 135, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        enrolledAt: CAD_RAMP_ENROLLED_AT,
      }),
    )

    // Below the new 140 default — no bp-high row should fire. Guards against
    // a regression that drops the floor below 140.
    expect(result).toBeNull()
    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_CAD_HIGH')
  })

  it('Scenario 90 (Cluster 8 B.3) — CAD + 145/85 + ramp active → CAD_HIGH + CAD_DBP_HIGH co-fire', async () => {
    await run(
      buildSession({ systolicBP: 145, diastolicBP: 85, pulse: 72 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        enrolledAt: CAD_RAMP_ENROLLED_AT,
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    // Distinct axes (bp-high SBP vs dbp-high DBP) so both must fire.
    expect(ruleIds).toContain('RULE_CAD_HIGH')
    expect(ruleIds).toContain('RULE_CAD_DBP_HIGH')
    const dbpRow = (
      prisma.deviationAlert.create.mock.calls as Array<
        [{ data: { ruleId: string; tier: string; actualValue: unknown; physicianMessage: string } }]
      >
    )
      .map((c) => c[0].data)
      .find((d) => d.ruleId === 'RULE_CAD_DBP_HIGH')
    expect(dbpRow?.tier).toBe('BP_LEVEL_1_HIGH')
    // actualValue is wrapped in Prisma.Decimal at persist time — compare
    // by stringified form so the assertion works regardless of whether
    // the driver returns a number, BigInt, or Decimal instance.
    expect(String(dbpRow?.actualValue)).toBe('85')
    // Sanity: the new DBP-high companion's physician message references the
    // 80 default + AHA/ACC 130/80 target.
    expect(dbpRow?.physicianMessage).toContain('80')
    expect(dbpRow?.physicianMessage).toMatch(/AHA\/ACC treatment target 130\/80/i)
    // NOTE: legacy DeviationType for RULE_CAD_DBP_HIGH currently falls
    // through to 'SYSTOLIC_BP' (only RULE_CAD_DBP_CRITICAL is special-cased
    // in legacyTypeFor). Not asserting type here — the legacy column is
    // slated for removal per the engine comment, and the source-of-truth
    // for axis routing is the new `axisFor` helper, not the legacy enum.
  })

  it('Scenario 91 (Cluster 8 B.3) — CAD + SBP 145 + enrolledAt BEFORE rollout → old 160 threshold (no CAD_HIGH)', async () => {
    // Ramp gating: a CAD patient enrolled before the rollout anchor stays on
    // the 160 default unless ops advances the rollout phase. SBP 145 < 160
    // → no CAD bp-high row. Without this guard, the 140 default would apply
    // to every legacy CAD patient on the same day, surprising the cohort.
    //
    // NOTE: 145/78 produces PP=67 which fires the Tier 3 RULE_PULSE_PRESSURE
    // _WIDE chart event. That's an independent axis (info), unrelated to the
    // CAD ramp under test — we assert specifically on the CAD rules, not on
    // total row count.
    await run(
      buildSession({ systolicBP: 145, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        enrolledAt: CAD_PRE_ROLLOUT_ENROLLED_AT,
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_CAD_HIGH')
    expect(ruleIds).not.toContain('RULE_CAD_DBP_HIGH')
  })

  it('Scenario 92 (Cluster 8 B.3) — CAD + custom PatientThreshold.sbpUpperTarget=150 → custom wins over the new 140', async () => {
    // Provider-set custom thresholds bypass the ramp entirely. SBP 145 with
    // custom=150 → no CAD_HIGH row. If the ramp default 140 ever leaked
    // through, SBP 145 would fire — that's the regression this catches.
    //
    // (Same PP=67 noise as Scenario 91 — assert on the CAD rule, not on
    // overall result/row count.)
    await run(
      buildSession({ systolicBP: 145, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { hasCAD: true, diagnosedHypertension: true },
        // Ramp-active enrolledAt — ensures the custom threshold's win is
        // tested against the default 140 path (not the 160 path).
        enrolledAt: CAD_RAMP_ENROLLED_AT,
        threshold: {
          sbpUpperTarget: 150,
          sbpLowerTarget: null,
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

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_CAD_HIGH')
  })

  // ========================================================================
  // Cluster 8 Q3 (Manisha 5/18/26) — first-month educational adherence nudge
  // ========================================================================
  // Patient-only Tier 3 educational message. One-time per patient ever —
  // engine guards on prisma.deviationAlert.count for prior nudge rows. Only
  // within the first 30 days of enrollment. 2-of-3 default adherence window
  // is UNCHANGED — a single miss must NOT fire RULE_MEDICATION_MISSED, only
  // this nudge.

  const NUDGE_RECENT_ENROLLED_AT = new Date('2026-04-12T10:00:00Z') // 10d before FIXED_NOW

  it('Scenario 93 (Cluster 8 B.4) — enrolled 10d ago + first missed dose (no prior nudge) → RULE_FIRST_MONTH_ADHERENCE_NUDGE Tier 3', async () => {
    // Seed one prior journal entry with medicationTaken=false to give the
    // adherence window 1 day with miss → nudge gate passes. The current
    // session is a clean BP reading (no co-fires) so the nudge is the only
    // expected row.
    const now = FIXED_NOW
    prisma.journalEntry.findMany.mockResolvedValue([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
    ])

    await run(
      buildSession({ systolicBP: 124, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        enrolledAt: NUDGE_RECENT_ENROLLED_AT,
      }),
    )

    const calls = prisma.deviationAlert.create.mock.calls as Array<
      [{ data: { ruleId: string; tier: string; patientMessage: string } }]
    >
    const nudge = calls
      .map((c) => c[0].data)
      .find((d) => d.ruleId === 'RULE_FIRST_MONTH_ADHERENCE_NUDGE')
    expect(nudge).toBeTruthy()
    expect(nudge?.tier).toBe('TIER_3_INFO')
    // Approved verbatim wording — protect against silent edits.
    expect(nudge?.patientMessage).toMatch(/starting a new medicine/i)
    // 2-of-3 default window unchanged: a single miss must NOT fire the
    // Tier 2 RULE_MEDICATION_MISSED row.
    const ruleIds = calls.map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_MEDICATION_MISSED')
  })

  it('Scenario 94 (Cluster 8 B.4) — enrolled 40d ago + missed dose → no nudge (>30d window)', async () => {
    // First-month window: enrolledAt 40 days before FIXED_NOW puts the
    // patient OUT of the 30-day educational window. Even with a fresh miss
    // signal, the nudge must stay silent — single miss also doesn't trip
    // the 2-of-3 default, so we expect NO adherence row at all.
    const now = FIXED_NOW
    prisma.journalEntry.findMany.mockResolvedValue([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
    ])

    await run(
      buildSession({ systolicBP: 124, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        enrolledAt: new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000),
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_FIRST_MONTH_ADHERENCE_NUDGE')
    // 2-of-3 default unchanged — single miss is below threshold.
    expect(ruleIds).not.toContain('RULE_MEDICATION_MISSED')
  })

  it('Scenario 95 (Cluster 8 B.4) — enrolled 10d ago + nudge already fired once → does NOT fire again (one-time guard)', async () => {
    // Override the prior-nudge count from 0 → 1: the engine's
    // deviationAlert.count guard suppresses the second nudge. This is the
    // one-time-per-patient-ever invariant — without it, a patient who
    // misses doses across the first month would be nagged every time.
    prisma.deviationAlert.count.mockResolvedValueOnce(1)
    const now = FIXED_NOW
    prisma.journalEntry.findMany.mockResolvedValue([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: null,
      },
    ])

    await run(
      buildSession({ systolicBP: 124, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { diagnosedHypertension: true },
        enrolledAt: NUDGE_RECENT_ENROLLED_AT,
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).not.toContain('RULE_FIRST_MONTH_ADHERENCE_NUDGE')
  })

  it('Scenario 95a (Manisha 5/24 Med §5) — first-month HFrEF patient misses a beta-blocker → Tier 2 carve-out, NOT the gentle nudge', async () => {
    // Within the 30-day window but the patient qualifies for the beta-blocker
    // single-miss carve-out (HFrEF + BB miss). They must get the Tier-2
    // RULE_MEDICATION_MISSED alert, and the softer first-month nudge must be
    // suppressed so the safety-critical signal isn't diluted.
    const now = FIXED_NOW
    prisma.journalEntry.findMany.mockResolvedValue([
      {
        id: 'prev-1',
        measuredAt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        medicationTaken: false,
        missedMedications: [
          {
            medicationId: 'bb-1',
            drugName: 'Metoprolol',
            drugClass: 'BETA_BLOCKER',
            reason: 'FORGOT',
            missedDoses: 1,
          },
        ],
      },
    ])

    await run(
      buildSession({ systolicBP: 124, diastolicBP: 78, pulse: 72 }),
      buildCtx({
        profile: { hasHeartFailure: true, heartFailureType: 'HFREF', resolvedHFType: 'HFREF' },
        enrolledAt: NUDGE_RECENT_ENROLLED_AT,
      }),
    )

    const ruleIds = (
      prisma.deviationAlert.create.mock.calls as Array<[{ data: { ruleId: string } }]>
    ).map((c) => c[0].data.ruleId)
    expect(ruleIds).toContain('RULE_MEDICATION_MISSED')
    expect(ruleIds).not.toContain('RULE_FIRST_MONTH_ADHERENCE_NUDGE')
  })

  // ========================================================================
  // Chunk B + fix-up — DelayBand gating (Manisha Backdated Readings sign-off
  // 2026-06-06, docs/clinical-signoffs/MANISHA_2026_06_06_OPEN_DECISIONS_AND_
  // BACKDATING_SIGNOFF.md). The signed dual-gate framework:
  //   Gate A (structural): an entry that is not the user's new-latest reading
  //     fires NO alerts of any tier (engine-entry pre-filter).
  //   Gate B (time-window): HISTORICAL_ENTRY (≥24h lag) fires NO alerts of
  //     any tier. DELAYED_ENTRY (1–24h) fires everything, with the patient
  //     911 CTA suppressed, the signed L2 physician delayed-entry wording
  //     (Recheck #1 refinement), and the L1 provider-only disclaimer
  //     (Recheck #2). The patient "recorded but won't alert" note renders off
  //     serializeEntry's delayBand / alertsSuppressedReason (Chunk C scope).
  // ========================================================================
  describe('Chunk B — DelayBand gating', () => {
    it('BP_LEVEL_2 fires normally on a REAL_TIME entry (911 intact, no delayed wording)', async () => {
      const { result, createArgs } = await run(
        buildSession({ systolicBP: 190, diastolicBP: 105, pulse: 88, delayBand: 'REAL_TIME' }),
        buildCtx({ profile: { diagnosedHypertension: true } }),
      )
      expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(createArgs.data.tier).toBe('BP_LEVEL_2')
      expect(createArgs.data.patientMessage).toMatch(/911/)
      expect(createArgs.data.physicianMessage).not.toContain('DELAYED ENTRY')
      expect(createArgs.data.physicianMessage).not.toContain('Delayed entry:')
    })

    it('BP_LEVEL_2 on DELAYED_ENTRY fires with patient 911 CTA suppressed + the signed physician wording', async () => {
      const { result, createArgs } = await run(
        buildSession({
          systolicBP: 190,
          diastolicBP: 105,
          pulse: 88,
          delayBand: 'DELAYED_ENTRY',
          delayHours: 5,
        }),
        buildCtx({ profile: { diagnosedHypertension: true } }),
      )
      expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(createArgs.data.tier).toBe('BP_LEVEL_2')
      expect(createArgs.data.patientMessage).not.toMatch(/911/)
      expect(createArgs.data.patientMessage).toContain('care team')
      // Recheck #1 refinement — signed verbatim, with [BP]/[date/time]/[X]
      // templated. FIXED_NOW (2026-04-22T10:00Z) renders 6:00 AM in the
      // fixture timezone America/New_York (EDT). \s tolerates the narrow
      // no-break space some ICU versions emit before the meridiem.
      expect(createArgs.data.physicianMessage).toMatch(
        /^Delayed entry: patient reported 190\/105 mmHg for Apr 22, 2026, 6:00\sAM\. Reading entered 5 hours later\. Verify current BP and assess for headache, visual changes, chest pain, or dyspnea\. If unable to reach patient, escalate per standard protocol\. /u,
      )
      // The Chunk B generic band-only badge is gone (replaced by signed text).
      expect(createArgs.data.physicianMessage).not.toContain('[DELAYED ENTRY')
    })

    it('BP_LEVEL_2_SYMPTOM_OVERRIDE on DELAYED_ENTRY fires with CTA suppressed + signed wording (singular hour)', async () => {
      const { result, createArgs } = await run(
        buildSession({
          systolicBP: 122,
          diastolicBP: 76,
          pulse: 74,
          symptoms: { ...noSymptoms(), severeHeadache: true },
          delayBand: 'DELAYED_ENTRY',
          delayHours: 1,
        }),
        buildCtx({ profile: { diagnosedHypertension: true } }),
      )
      expect(result?.ruleId).toBe('RULE_SYMPTOM_OVERRIDE_GENERAL')
      expect(createArgs.data.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
      expect(createArgs.data.patientMessage).not.toMatch(/911/)
      expect(createArgs.data.physicianMessage).toContain(
        'Delayed entry: patient reported 122/76 mmHg for',
      )
      // Plural-aware [X]: 1 → "1 hour" (grammatical instantiation of the
      // signed "[X] hours" template, approved 2026-06-10).
      expect(createArgs.data.physicianMessage).toContain('Reading entered 1 hour later.')
      expect(createArgs.data.physicianMessage).toContain(
        'escalate per standard protocol.',
      )
    })

    it('HISTORICAL_ENTRY suppresses BP_LEVEL_2 — and every other tier — at engine entry', async () => {
      const { result } = await run(
        buildSession({ systolicBP: 190, diastolicBP: 105, pulse: 88, delayBand: 'HISTORICAL_ENTRY' }),
        buildCtx({ profile: { diagnosedHypertension: true } }),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
      // The early return precedes profile resolution — structural proof that
      // no pass (BP/HR, adherence, surveillance, nudge) can ever run.
      expect(profileResolver.resolve).not.toHaveBeenCalled()
    })

    it('HISTORICAL_ENTRY suppresses BP_LEVEL_2_SYMPTOM_OVERRIDE', async () => {
      const { result } = await run(
        buildSession({
          systolicBP: 122,
          diastolicBP: 76,
          pulse: 74,
          symptoms: { ...noSymptoms(), severeHeadache: true },
          delayBand: 'HISTORICAL_ENTRY',
        }),
        buildCtx({ profile: { diagnosedHypertension: true } }),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })

    // FLIPPED (fix-up) — Chunk B as shipped asserted L1 still fired on
    // HISTORICAL_ENTRY; the signed policy suppresses ALL tiers.
    it('BP_LEVEL_1_HIGH does NOT fire on HISTORICAL_ENTRY (signed policy: no alerts, any tier)', async () => {
      const { result } = await run(
        buildSession({ systolicBP: 144, diastolicBP: 88, pulse: 82, delayBand: 'HISTORICAL_ENTRY' }),
        buildCtx({ isPregnant: true }),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })

    // FLIPPED (fix-up) — same as above for Tier 1 contraindications.
    it('TIER_1_CONTRAINDICATION does NOT fire on HISTORICAL_ENTRY', async () => {
      const { result } = await run(
        buildSession({ systolicBP: 130, diastolicBP: 82, pulse: 78, delayBand: 'HISTORICAL_ENTRY' }),
        buildCtx({ isPregnant: true, profile: { historyHDP: true }, contextMeds: [buildMed()] }),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })

    it('BP_LEVEL_1_LOW does NOT fire on HISTORICAL_ENTRY', async () => {
      const { result } = await run(
        buildSession({ systolicBP: 85, diastolicBP: 60, pulse: 78, delayBand: 'HISTORICAL_ENTRY' }),
        buildCtx({}),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })

    it('Tier 2 adherence + Tier 3 surveillance passes are unreachable on HISTORICAL_ENTRY', async () => {
      const { result } = await run(
        buildSession({
          systolicBP: 125,
          diastolicBP: 78,
          pulse: 44,
          medicationTaken: false,
          delayBand: 'HISTORICAL_ENTRY',
        }),
        buildCtx({ profile: { hasBradycardia: true } }),
      )
      expect(result).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
      expect(profileResolver.resolve).not.toHaveBeenCalled()
    })

    describe('Gate A — structural "is new latest?" pre-filter (fix-up)', () => {
      it('an entry older than an existing later reading fires nothing (any tier)', async () => {
        // First journalEntry.findFirst call in evaluate() is the Gate A probe.
        prisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'newer-entry' })
        const { result } = await run(
          buildSession({
            systolicBP: 190,
            diastolicBP: 105,
            pulse: 88,
            delayBand: 'DELAYED_ENTRY',
            delayHours: 5,
          }),
          buildCtx({ profile: { diagnosedHypertension: true } }),
        )
        expect(result).toBeNull()
        expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
        expect(profileResolver.resolve).not.toHaveBeenCalled()
        // Strictly-greater predicate: session siblings (measuredAt <= session
        // max) can never suppress each other; equal-timestamp ties fire (the
        // (journalEntryId, ruleId) dedup guards double-fires).
        expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith({
          where: { userId: 'user-1', measuredAt: { gt: FIXED_NOW } },
          select: { id: true },
        })
      })

      it('the new-latest entry passes Gate A and fires normally', async () => {
        // Default journalEntry.findFirst mock resolves null = no later reading.
        const { result, createArgs } = await run(
          buildSession({ systolicBP: 190, diastolicBP: 105, pulse: 88, delayBand: 'REAL_TIME' }),
          buildCtx({ profile: { diagnosedHypertension: true } }),
        )
        expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
        expect(createArgs.data.tier).toBe('BP_LEVEL_2')
      })

      it('first-ever entry from a new patient passes Gate A (MAX is null)', async () => {
        prisma.journalEntry.findFirst.mockResolvedValueOnce(null)
        const { result, createArgs } = await run(
          buildSession({ systolicBP: 165, diastolicBP: 100, pulse: 80, delayBand: 'REAL_TIME' }),
          buildCtx({}),
        )
        expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
        expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
      })
    })

    describe('L1 DELAYED_ENTRY provider-only disclaimer (Recheck #2, fix-up)', () => {
      it('BP_LEVEL_1_HIGH physician message carries the disclaimer; patient/caregiver unchanged', async () => {
        const { result, createArgs } = await run(
          buildSession({
            systolicBP: 165,
            diastolicBP: 100,
            pulse: 80,
            delayBand: 'DELAYED_ENTRY',
            delayHours: 5,
          }),
          buildCtx({}),
        )
        expect(result?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
        expect(createArgs.data.tier).toBe('BP_LEVEL_1_HIGH')
        expect(createArgs.data.physicianMessage).toContain(
          'Note: this reading was entered 5 hours after measurement. Clinical context may have changed.',
        )
        // Recheck #2 — the patient already knows they backdated; patient +
        // caregiver tiers stay byte-identical to real-time.
        expect(createArgs.data.patientMessage).not.toContain('Note: this reading')
        expect(createArgs.data.caregiverMessage).not.toContain('Note: this reading')
      })

      it('renders "1 hour" singular for a 1-hour lag', async () => {
        const { createArgs } = await run(
          buildSession({
            systolicBP: 165,
            diastolicBP: 100,
            pulse: 80,
            delayBand: 'DELAYED_ENTRY',
            delayHours: 1,
          }),
          buildCtx({}),
        )
        expect(createArgs.data.physicianMessage).toContain(
          'entered 1 hour after measurement',
        )
      })

      it('non-BP-axis L1 (HF decompensation, BP_LEVEL_1_LOW) also carries it — dispatch is tier-based', async () => {
        const { result, createArgs } = await run(
          buildSession({
            systolicBP: 118,
            diastolicBP: 74,
            pulse: 68,
            symptoms: { ...noSymptoms(), legSwelling: true },
            delayBand: 'DELAYED_ENTRY',
            delayHours: 3,
          }),
          buildCtx({
            profile: {
              hasHeartFailure: true,
              heartFailureType: 'HFREF',
              resolvedHFType: 'HFREF',
            },
          }),
        )
        expect(result?.ruleId).toBe('RULE_HF_DECOMPENSATION')
        expect(createArgs.data.tier).toBe('BP_LEVEL_1_LOW')
        expect(createArgs.data.physicianMessage).toContain(
          'entered 3 hours after measurement',
        )
      })

      it('REAL_TIME L1 carries no disclaimer (snapshot-gate regression guard)', async () => {
        const { createArgs } = await run(
          buildSession({ systolicBP: 165, diastolicBP: 100, pulse: 80, delayBand: 'REAL_TIME' }),
          buildCtx({}),
        )
        expect(createArgs.data.physicianMessage).not.toContain('Note: this reading')
      })

      it('TIER_1 on DELAYED_ENTRY stays unchanged — T1/T2 delayed disclaimers deferred pending Manisha', async () => {
        const { result, createArgs } = await run(
          buildSession({
            systolicBP: 130,
            diastolicBP: 82,
            pulse: 78,
            delayBand: 'DELAYED_ENTRY',
            delayHours: 4,
          }),
          buildCtx({ isPregnant: true, profile: { historyHDP: true }, contextMeds: [buildMed()] }),
        )
        expect(result?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
        expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
        expect(createArgs.data.physicianMessage).not.toContain('Note: this reading')
        expect(createArgs.data.physicianMessage).not.toContain('Delayed entry:')
      })
    })

    // ====================================================================
    // Option D — retake-to-confirm (Manisha 2026-06-12 Q2). The held AWAITING
    // first-of-pair never reaches the engine; these cover the two resolutions
    // that DO evaluate (CONFIRMATORY + UNCONFIRMED). Each is TERMINAL — exactly
    // one outcome alert, no average-based co-fire.
    // ====================================================================
    describe('Option D — retake-to-confirm', () => {
      it('CONFIRMATORY + second reading still ≥180/120 → RULE_ABSOLUTE_EMERGENCY (BP Level 2)', async () => {
        const { result, createArgs } = await run(
          buildSession({
            emergencyConfirmation: 'CONFIRMATORY',
            readingCount: 2,
            systolicBP: 192,
            diastolicBP: 121,
            submittedSystolicBP: 195,
            submittedDiastolicBP: 122,
            optionDInitialSystolicBP: 190,
            optionDInitialDiastolicBP: 120,
          }),
          buildCtx({}),
        )
        expect(result?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
        expect(createArgs.data.tier).toBe('BP_LEVEL_2')
        expect(prisma.deviationAlert.create.mock.calls.length).toBe(1)
      })

      it('CONFIRMATORY + second reading below threshold → RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL (Tier 3); names BP1+BP2, NOT the average; no spurious L1', async () => {
        const { result, createArgs } = await run(
          buildSession({
            emergencyConfirmation: 'CONFIRMATORY',
            readingCount: 2,
            // Session AVERAGE of 195/120 + 135/85 — would fire STANDARD_L1_HIGH
            // (≥160/100) if the resolution weren't terminal.
            systolicBP: 165,
            diastolicBP: 102,
            // BP2 (confirmatory) — below the 180/120 emergency band.
            submittedSystolicBP: 135,
            submittedDiastolicBP: 85,
            // BP1 (the held first-of-pair, emergency range).
            optionDInitialSystolicBP: 195,
            optionDInitialDiastolicBP: 120,
          }),
          buildCtx({}),
        )
        expect(result?.ruleId).toBe('RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL')
        expect(createArgs.data.tier).toBe('TIER_3_INFO')
        // BP1 (emergency) + BP2 (confirmatory) spelled out; the average is NOT.
        expect(createArgs.data.physicianMessage).toContain('195/120 mmHg')
        expect(createArgs.data.physicianMessage).toContain('135/85 mmHg')
        expect(createArgs.data.physicianMessage).not.toContain('165/102')
        // Provider-only + terminal (no average-based BP Level 1 co-fire).
        expect(createArgs.data.patientMessage).toBeFalsy()
        expect(createArgs.data.caregiverMessage).toBeFalsy()
        expect(prisma.deviationAlert.create.mock.calls.length).toBe(1)
      })

      it('UNCONFIRMED → RULE_UNCONFIRMED_EMERGENCY (Tier 1 contraindication), provider-only, no L2/L1 co-fire on the lone ≥180/120 reading', async () => {
        const { result, createArgs } = await run(
          buildSession({
            emergencyConfirmation: 'UNCONFIRMED',
            readingCount: 1,
            singleReadingFinalized: true,
            systolicBP: 195,
            diastolicBP: 120,
            submittedSystolicBP: 195,
            submittedDiastolicBP: 120,
          }),
          buildCtx({}),
        )
        expect(result?.ruleId).toBe('RULE_UNCONFIRMED_EMERGENCY')
        expect(createArgs.data.tier).toBe('TIER_1_CONTRAINDICATION')
        expect(createArgs.data.physicianMessage).toContain(
          'Single unconfirmed emergency-range reading',
        )
        expect(createArgs.data.physicianMessage).toContain('195/120 mmHg')
        expect(createArgs.data.patientMessage).toBeFalsy()
        expect(createArgs.data.caregiverMessage).toBeFalsy()
        // Lone ≥180/120 reading must NOT also fire ABSOLUTE_EMERGENCY / L1.
        expect(prisma.deviationAlert.create.mock.calls.length).toBe(1)
      })
    })
  })
})
