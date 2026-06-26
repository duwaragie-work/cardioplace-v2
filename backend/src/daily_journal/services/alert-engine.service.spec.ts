import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ProfileNotFoundException, type ResolvedContext } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { AlertEngineService } from './alert-engine.service.js'
import { OutputGeneratorService } from './output-generator.service.js'
import { ProfileResolverService } from './profile-resolver.service.js'
import { SessionAveragerService } from './session-averager.service.js'
import type { SessionAverage } from '../engine/types.js'

function baseSession(over: Partial<SessionAverage> = {}): SessionAverage {
  return {
    entryId: 'entry-1',
    userId: 'user-1',
    measuredAt: new Date('2026-04-22T10:00:00Z'),
    systolicBP: 125,
    diastolicBP: 78,
    pulse: 72,
    weight: null,
    // Cluster 6 Q2 default — ≥2 readings to bypass the single-reading gate.
    readingCount: 2,
    symptoms: {
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
    },
    suboptimalMeasurement: false,
    sessionId: null,
    medicationTaken: null,
    missedMedications: [],
    singleReadingFinalized: false,
    ...over,
  }
}

function baseCtx(over: Partial<ResolvedContext> = {}): ResolvedContext {
  return {
    userId: 'user-1',
    dateOfBirth: new Date('1980-01-01'),
    timezone: 'America/New_York',
    ageGroup: '40-64',
    profile: {
      gender: 'FEMALE',
      heightCm: 165,
      isPregnant: false,
      pregnancyDueDate: null,
      historyHDP: false,
      hasHeartFailure: false,
      heartFailureType: 'NOT_APPLICABLE',
      resolvedHFType: 'NOT_APPLICABLE',
      hasAFib: false,
      hasCAD: false,
      hasHCM: false,
      hasDCM: false,
      hasTachycardia: false,
      hasBradycardia: false,
      hasAorticStenosis: false,
      diagnosedHypertension: false,
      verificationStatus: 'VERIFIED',
      verifiedAt: new Date('2026-01-01'),
      lastEditedAt: new Date('2026-01-01'),
    },
    contextMeds: [],
    excludedMeds: [],
    threshold: null,
    assignment: null,
    readingCount: 10,
    preDay3Mode: false,
    personalizedEligible: false,
    pregnancyThresholdsActive: false,
    triggerPregnancyContraindicationCheck: false,
    enrolledAt: null,
    practiceName: null,
    patientName: null,
    resolvedAt: new Date('2026-04-22T10:00:00Z'),
    ...over,
  }
}

describe('AlertEngineService (orchestrator)', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let profileResolver: { resolve: jest.Mock<any> }
  let sessionAverager: { averageForEntry: jest.Mock<any> }
  let outputGenerator: { generate: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        // Phase/7 — upsert replaced with findFirst + create|update (no more
        // @@unique([journalEntryId, type]); app-level dedup on (entryId, ruleId)).
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'alert-1',
          escalated: false,
        }),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'alert-1',
          escalated: false,
        }),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      // HOLD-ADHERENCE — loadAdherenceWindow fetches HELD meds to exclude
      // them from the miss count. Default: no held meds.
      patientMedication: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        // Round 2 Group B: alert-engine NO LONGER writes a patient-facing
        // Notification mirror on alert fire. Mock retained so any future write
        // would surface in test expectations (and so the no-mirror assertion
        // below has a callable to inspect).
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      // Cluster 6 bug #11 — persistAlert now wraps its writes in
      // `prisma.$transaction(async (tx) => {...}, {isolationLevel})`. The
      // simplest mock just invokes the callback with `prisma` itself as tx,
      // so the inner `tx.deviationAlert.findFirst/create/update` calls hit
      // the same per-method mocks above.
      $transaction: ((fn: any) => Promise.resolve(fn(prisma))) as any,
    }
    eventEmitter = { emit: jest.fn() }
    profileResolver = {
      resolve: (jest.fn() as jest.Mock<any>).mockResolvedValue(baseCtx()),
    }
    sessionAverager = {
      averageForEntry: (jest.fn() as jest.Mock<any>).mockResolvedValue(baseSession()),
    }
    outputGenerator = {
      generate: (jest.fn() as jest.Mock<any>).mockImplementation(
        (result: any, _session: any, _preDay3: boolean) => ({
          patientMessage: `PATIENT:${result.ruleId}`,
          caregiverMessage: `CAREGIVER:${result.ruleId}`,
          physicianMessage: `PHYSICIAN:${result.ruleId}${
            result.metadata?.physicianAnnotations?.length
              ? ' | ' + result.metadata.physicianAnnotations.join(' | ')
              : ''
          }`,
        }),
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: SessionAveragerService, useValue: sessionAverager },
        { provide: OutputGeneratorService, useValue: outputGenerator },
      ],
    }).compile()
    service = module.get<AlertEngineService>(AlertEngineService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  // ────────────────────────────────────────────────────────────────────────
  // Short-circuit order (§D)
  // ────────────────────────────────────────────────────────────────────────
  describe('short-circuit order (D.1–D.3)', () => {
    it('pregnancy+ACE beats absolute-emergency even at SBP 195', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 195, diastolicBP: 130 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({
          profile: { ...baseCtx().profile, isPregnant: true },
          pregnancyThresholdsActive: true,
          triggerPregnancyContraindicationCheck: true,
          contextMeds: [
            {
              id: 'm1',
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'VERIFIED',
              reportedAt: new Date(),
            },
          ],
        }),
      )

      const r = await service.evaluate('entry-1')
      // v2 addendum D.5: emergency-axis row co-fires with the Tier 1
      // contraindication so the patient gets the 911 message at T+0.
      // At 195/130 absoluteEmergency (≥180/120) wins the emergency axis
      // ahead of pregnancyL2.
      // F20 — emergency is exclusive: once the 911 row claims the emergency
      // axis the lower-tier bp-high ladder (pregnancyL1High) is suppressed,
      // so a "contact your provider tomorrow" message never co-renders with
      // the 911 takeover. The Tier 1 ACE/ARB contraindication (Stage A,
      // different axis) still co-fires per D.5.
      expect(r?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(r?.tier).toBe('BP_LEVEL_2')
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

    it('both Tier 1 pairs present — pregnancy+ACE wins short-circuit', async () => {
      profileResolver.resolve.mockResolvedValue(
        baseCtx({
          profile: {
            ...baseCtx().profile,
            isPregnant: true,
            hasHeartFailure: true,
            heartFailureType: 'HFREF',
            resolvedHFType: 'HFREF',
          },
          pregnancyThresholdsActive: true,
          triggerPregnancyContraindicationCheck: true,
          contextMeds: [
            {
              id: 'm1',
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'VERIFIED',
              reportedAt: new Date(),
            },
            {
              id: 'm2',
              drugName: 'Diltiazem',
              drugClass: 'NDHP_CCB',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'VERIFIED',
              reportedAt: new Date(),
            },
          ],
        }),
      )

      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // AFib ≥3 gate (C.2)
  // ────────────────────────────────────────────────────────────────────────
  describe('AFib ≥3-reading gate', () => {
    it('AFib + 1 reading + HR 115 → no alert', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 115, readingCount: 1 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasAFib: true } }),
      )
      const r = await service.evaluate('entry-1')
      expect(r).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })

    it('AFib + 3 readings + HR 115 → fires AFib HR high', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 115, readingCount: 3 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasAFib: true } }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_AFIB_HR_HIGH')
    })

    // Bug 3 fix — contraindications and symptom overrides must run even when
    // the AFib gate closes.
    it('AFib + 1 reading + pregnant + ACE → Tier 1 still fires (gate does NOT block contraindications)', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ readingCount: 1 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({
          profile: {
            ...baseCtx().profile,
            hasAFib: true,
            isPregnant: true,
          },
          pregnancyThresholdsActive: true,
          triggerPregnancyContraindicationCheck: true,
          contextMeds: [
            {
              id: 'm1',
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'VERIFIED',
              reportedAt: new Date(),
            },
          ],
        }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
      expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
      expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
    })

    it('AFib + 1 reading + severe headache → BP Level 2 symptom override still fires', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          symptoms: {
            severeHeadache: true,
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
          },
        }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasAFib: true } }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.tier).toBe('BP_LEVEL_2_SYMPTOM_OVERRIDE')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Persistence + event emission
  // ────────────────────────────────────────────────────────────────────────
  describe('persistence', () => {
    it('Tier 1 alert persists with dismissible=false and emits ALERT_CREATED', async () => {
      profileResolver.resolve.mockResolvedValue(
        baseCtx({
          profile: { ...baseCtx().profile, isPregnant: true },
          pregnancyThresholdsActive: true,
          triggerPregnancyContraindicationCheck: true,
          contextMeds: [
            {
              id: 'm1',
              drugName: 'Lisinopril',
              drugClass: 'ACE_INHIBITOR',
              isCombination: false,
              combinationComponents: [],
              frequency: 'ONCE_DAILY',
              source: 'PATIENT_SELF_REPORT',
              verificationStatus: 'VERIFIED',
              reportedAt: new Date(),
            },
          ],
        }),
      )

      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.tier).toBe('TIER_1_CONTRAINDICATION')
      expect(call.data.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
      expect(call.data.dismissible).toBe(false)
      expect(call.data.patientMessage).toBe('PATIENT:RULE_PREGNANCY_ACE_ARB')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ALERT_CREATED,
        expect.objectContaining({ userId: 'user-1' }),
      )
    })

    it('BP L1 High alert has dismissible=true', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.tier).toBe('BP_LEVEL_1_HIGH')
      expect(call.data.dismissible).toBe(true)
    })

    // Round 2 Group B (Manisha sign-off pending) — regression-pinning. The
    // alert-engine MUST NOT mirror clinical alerts into the patient in-app
    // notification inbox. The alert surface alone carries the patient-facing
    // message; the inbox is reserved for admin/care-team actions.
    it('does NOT write a patient Notification row when a clinical alert fires (Round 2 Group B)', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('no rule fires → no new alert AND no silent auto-resolve (JCAHO)', async () => {
      // Reconciled 2026-05-20 (B.2): the silent auto-resolve sweep on a clean
      // reading was removed in 37b7989 — it broke the JCAHO audit trail (a
      // provider, not the system, must resolve an alert with a rationale).
      // A benign reading now creates nothing and resolves nothing.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 125, diastolicBP: 78 }),
      )
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
    })

    it('no PatientProfile → skip silently', async () => {
      profileResolver.resolve.mockRejectedValue(
        new ProfileNotFoundException('user-1'),
      )
      const r = await service.evaluate('entry-1')
      expect(r).toBeNull()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Pulse-pressure + loop-diuretic physician annotations
  // ────────────────────────────────────────────────────────────────────────
  describe('physician annotations (Q + R)', () => {
    it('L1 High + wide PP → annotation added to physicianMessage', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 170, diastolicBP: 85 }), // PP 85, fires L1 High
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.tier).toBe('BP_LEVEL_1_HIGH')
      // OutputGenerator mock echoes physicianAnnotations — real phase/6 wording
      // is validated in output-generator.service.spec.ts.
      expect(call.data.physicianMessage.toLowerCase()).toContain(
        'pulse pressure',
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Part C — Audit fix pass
  // ────────────────────────────────────────────────────────────────────────

  // Bug 1 — ANOMALY_TRACKED must carry the DeviationAlert.id, not entryId.
  describe('Bug 1 — ALERT_CREATED alertId', () => {
    it('emits the upserted DeviationAlert.id (not entryId)', async () => {
      prisma.deviationAlert.create.mockResolvedValue({
        id: 'deviation-alert-99',
        escalated: false,
      })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ entryId: 'entry-xyz', systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-xyz')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ALERT_CREATED,
        expect.objectContaining({ alertId: 'deviation-alert-99' }),
      )
      // And specifically NOT entryId
      const payload = eventEmitter.emit.mock.calls[0][1] as { alertId: string }
      expect(payload.alertId).not.toBe('entry-xyz')
    })

    it('propagates DeviationAlert.escalated onto the event payload', async () => {
      prisma.deviationAlert.create.mockResolvedValue({
        id: 'a-1',
        escalated: true,
      })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ALERT_CREATED,
        expect.objectContaining({ escalated: true }),
      )
    })
  })

  // Bug 2 (superseded) — the auto-resolve sweep was removed entirely in
  // 37b7989 for JCAHO compliance (only a provider resolves an alert, with a
  // rationale). The scope concern is moot: a benign reading resolves nothing.
  describe('Bug 2 (superseded) — no auto-resolve sweep', () => {
    it('benign reading does not auto-resolve any tier', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 125, diastolicBP: 78 }),
      )
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
    })
  })

  // Bug 4 — tachy must check the immediately previous reading, not any prior.
  // Chunk B fix-up — the Gate A "is new latest?" probe is now the FIRST
  // journalEntry.findFirst call in evaluate(); each test feeds it null (no
  // later reading) so the blanket prior-entry stub only serves the tachy
  // consecutive-check + prior-reading queries.
  describe('Bug 4 — tachycardia consecutive check', () => {
    it('prior reading pulse 80 (normal) → no tachy alert even at current 105', async () => {
      prisma.journalEntry.findFirst.mockResolvedValueOnce(null) // Gate A probe
      prisma.journalEntry.findFirst.mockResolvedValue({ pulse: 80 })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 105 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasTachycardia: true } }),
      )
      const r = await service.evaluate('entry-1')
      // pulse=105 + no other conditions → shouldn't fire any rule
      expect(r).toBeNull()
    })

    it('prior reading pulse 102 + current 105 → tachy alert fires', async () => {
      prisma.journalEntry.findFirst.mockResolvedValueOnce(null) // Gate A probe
      prisma.journalEntry.findFirst.mockResolvedValue({ pulse: 102 })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 105 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasTachycardia: true } }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_TACHY_HR')
    })

    it('prior entry with pulse=null → no false positive', async () => {
      prisma.journalEntry.findFirst.mockResolvedValueOnce(null) // Gate A probe
      prisma.journalEntry.findFirst.mockResolvedValue({ pulse: null })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 105 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasTachycardia: true } }),
      )
      const r = await service.evaluate('entry-1')
      expect(r).toBeNull()
    })

    it('query omits pulse filter — just fetches latest prior entry', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ pulse: 105 }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({ profile: { ...baseCtx().profile, hasTachycardia: true } }),
      )
      await service.evaluate('entry-1')
      // calls[0] is the Gate A probe (Chunk B fix-up); the tachy
      // prior-reading lookup is the second findFirst.
      const findFirstCall = prisma.journalEntry.findFirst.mock.calls[1][0]
      expect(findFirstCall.where.pulse).toBeUndefined()
      expect(findFirstCall.orderBy).toEqual({ measuredAt: 'desc' })
    })
  })

  // Explicit row-shape assertions (dismissibility, PP cached, legacy cols).
  describe('DeviationAlert row shape', () => {
    it('BP Level 2 row: dismissible=false', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 185, diastolicBP: 100 }),
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.tier).toBe('BP_LEVEL_2')
      expect(call.data.dismissible).toBe(false)
    })

    it('Tier 3 (wide PP alone) row: dismissible=true', async () => {
      // 170/100 → PP=70 (>60) and DBP=100 triggers L1 High. To isolate the
      // pulse-pressure rule we need no other rule to fire first. Use
      // 140/70 → PP 70 (no L1 High, no emergency).
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 140, diastolicBP: 70 }),
      )
      // Wait — 70 is boundary; rule wants pp>60 strict. Use 145/80 → PP 65.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 145, diastolicBP: 80 }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_PULSE_PRESSURE_WIDE')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.tier).toBe('TIER_3_INFO')
      expect(call.data.dismissible).toBe(true)
    })

    it('pulsePressure cached on DeviationAlert row explicitly', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 170, diastolicBP: 85 }), // PP=85
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.pulsePressure).toBe(85)
    })

    it('legacy type + severity populated for back-compat', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.create.mock.calls[0][0]
      expect(call.data.type).toBe('SYSTOLIC_BP')
      expect(call.data.severity).toBe('MEDIUM')
    })

    it('F18 — DBP-driven L1 tags legacy type DIASTOLIC_BP, not SBP', async () => {
      // 119/109 → SBP below the 160 L1 threshold, DBP ≥100 drives the rule.
      // Pre-fix this mislabelled the axis as SYSTOLIC_BP even though the
      // diastolic reading (actualValue=109) is what fired.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 119, diastolicBP: 109 }),
      )
      await service.evaluate('entry-1')
      const call = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string; type: string; actualValue: unknown } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_STANDARD_L1_HIGH')
      expect(call).toBeDefined()
      expect(call![0].data.type).toBe('DIASTOLIC_BP')
      expect(String(call![0].data.actualValue)).toBe('109')
    })

    it('F18 — SBP-driven L1 still tags SYSTOLIC_BP', async () => {
      // 165/95 — systolic drives, axis stays SYSTOLIC_BP (no regression).
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      const call = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string; type: string } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_STANDARD_L1_HIGH')
      expect(call![0].data.type).toBe('SYSTOLIC_BP')
    })

    it('F9 — dedup idempotency: re-eval finds existing row and does NOT rewrite it (JCAHO immutability)', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      // First pass: findFirst → null, so create fires.
      // Second pass: findFirst → existing row. Per F9 the row is the
      // at-fire-time clinical record — re-eval must NOT touch it.
      let call = 0
      prisma.deviationAlert.findFirst.mockImplementation(() => {
        call++
        return Promise.resolve(
          call > 1 ? { id: 'alert-1', escalated: false } : null,
        )
      })
      await service.evaluate('entry-1')
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.findFirst).toHaveBeenCalledWith({
        where: { journalEntryId: 'entry-1', ruleId: 'RULE_STANDARD_L1_HIGH' },
        select: { id: true, escalated: true },
      })
      expect(prisma.deviationAlert.create).toHaveBeenCalledTimes(1)
      // F9: the update branch is gone — re-eval is a no-op write.
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    })

    it('F9 — mode is NOT mutated when patient crosses into personalized eligibility (Carol case)', async () => {
      // Reading fires STANDARD-mode L1 at fire time. A later re-eval pass runs
      // once the patient is personalizedEligible — pre-fix this rewrote the
      // original row to PERSONALIZED, corrupting the audit trail.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      // Pass 1: STANDARD mode (not yet eligible), row created.
      profileResolver.resolve.mockResolvedValueOnce(
        baseCtx({ personalizedEligible: false }),
      )
      await service.evaluate('entry-1')
      const created = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string; mode: string } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_STANDARD_L1_HIGH')
      expect(created![0].data.mode).toBe('STANDARD')

      // Pass 2: row now exists; patient is personalizedEligible.
      prisma.deviationAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        escalated: false,
      })
      profileResolver.resolve.mockResolvedValueOnce(
        baseCtx({ personalizedEligible: true }),
      )
      await service.evaluate('entry-1')

      // No update issued → the original STANDARD record stands.
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    })

    it('session-averaged emergency: readingCount=2 + mean SBP 180 → fires BP Level 2', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 2,
          systolicBP: 180, // pre-averaged by the averager
          diastolicBP: 95,
        }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(r?.tier).toBe('BP_LEVEL_2')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // F20 — emergency-exclusive short-circuit. Once a 911/BP-L2 rule claims the
  // emergency axis, no lower-tier BP/HR row co-fires on the same reading, so
  // the patient never gets a "contact tomorrow" message beside a 911 takeover.
  // ────────────────────────────────────────────────────────────────────────
  describe('F20 — emergency-exclusive short-circuit', () => {
    function persistedIds(): string[] {
      return (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string } }]
        >
      ).map((c) => c[0].data.ruleId)
    }

    it('immediate path — multi-reading session 185/100 fires ONLY emergency, not L1-high', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ readingCount: 2, systolicBP: 185, diastolicBP: 100 }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(persistedIds()).toContain('RULE_ABSOLUTE_EMERGENCY')
      expect(persistedIds()).not.toContain('RULE_STANDARD_L1_HIGH')
    })

    it('session-finalize path — single finalized reading 185/100 still fires ONLY emergency', async () => {
      // The 5-min finalize cron re-runs evaluate() with singleReadingFinalized
      // = true, which would otherwise let Stage C L1-high through the gate.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          singleReadingFinalized: true,
          systolicBP: 185,
          diastolicBP: 100,
        }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
      expect(persistedIds()).not.toContain('RULE_STANDARD_L1_HIGH')
    })

    it('non-emergency reading is unaffected — 165/95 still fires L1-high', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_STANDARD_L1_HIGH')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // RULE_HFREF_HIGH single-reading firing (Manisha Q2, 2026-06-02 reply).
  // The ≥2-reading single-reading gate previously suppressed a lone HFrEF
  // SBP≥target reading until a 2nd reading or the 5-min finalize. Manisha
  // reverted this: the narrow HFrEF therapeutic window (≈120–130) makes a
  // missed lone 145 high-cost, a false-positive at 132 low-cost. HFREF_HIGH
  // (only the high branch) now bypasses the gate. HFREF_LOW and standard L1
  // averaging are untouched.
  // ────────────────────────────────────────────────────────────────────────
  describe('RULE_HFREF_HIGH single-reading firing (Manisha Q2)', () => {
    // Carol — HFrEF, provider-set sbpUpperTarget 130, post-7-readings.
    function carolCtx(over: Partial<ResolvedContext> = {}): ResolvedContext {
      return baseCtx({
        profile: {
          ...baseCtx().profile,
          hasHeartFailure: true,
          heartFailureType: 'HFREF',
          resolvedHFType: 'HFREF',
        },
        threshold: {
          sbpUpperTarget: 130,
          sbpLowerTarget: 85,
          dbpUpperTarget: null,
          dbpLowerTarget: null,
          hrUpperTarget: null,
          hrLowerTarget: null,
          setByProviderId: 'prov-1',
          setAt: new Date('2026-01-01'),
          notes: null,
        },
        personalizedEligible: true,
        ...over,
      })
    }

    function persistedIds(): string[] {
      return (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string } }]
        >
      ).map((c) => c[0].data.ruleId)
    }

    it('fires on a single reading SBP ≥target with no session average', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          systolicBP: 135,
          diastolicBP: 85,
          readingCount: 1,
          singleReadingFinalized: false,
        }),
      )
      profileResolver.resolve.mockResolvedValue(carolCtx())

      await service.evaluate('entry-1')

      const call = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string; tier: string; actualValue: unknown } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_HFREF_HIGH')
      expect(call).toBeDefined()
      expect(call![0].data.tier).toBe('BP_LEVEL_1_HIGH')
      // Evaluated against THIS reading's own value, not a session average.
      // actualValue is persisted as a Prisma.Decimal — coerce to compare.
      expect(Number(call![0].data.actualValue)).toBe(135)
    })

    it('does NOT wait for session-finalize (no singleReadingFinalized needed)', async () => {
      // readingCount=1 AND singleReadingFinalized=false is the un-finalized
      // single-reading state the gate used to hold. HFREF_HIGH must already
      // be persisted on this first pass.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          systolicBP: 145,
          diastolicBP: 88,
          readingCount: 1,
          singleReadingFinalized: false,
        }),
      )
      profileResolver.resolve.mockResolvedValue(carolCtx())

      const r = await service.evaluate('entry-1')
      expect(r?.ruleId).toBe('RULE_HFREF_HIGH')
      expect(persistedIds()).toContain('RULE_HFREF_HIGH')
    })

    it('still fires when multiple readings present (averaged ≥target → never 0)', async () => {
      // 3 readings 135/140/132 → averager hands the engine the mean (136).
      // Gate does not apply (readingCount≥2); Stage C runs as before.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          systolicBP: 136,
          diastolicBP: 86,
          readingCount: 3,
          singleReadingFinalized: false,
        }),
      )
      profileResolver.resolve.mockResolvedValue(carolCtx())

      await service.evaluate('entry-1')
      expect(persistedIds()).toContain('RULE_HFREF_HIGH')
    })

    it('HFREF_LOW is NOT exempt — lone low reading stays gated', async () => {
      // Only the high branch bypasses the gate. A lone SBP 80 (< lower 85)
      // must still wait for a 2nd reading / finalize.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          systolicBP: 80,
          diastolicBP: 55,
          readingCount: 1,
          singleReadingFinalized: false,
        }),
      )
      profileResolver.resolve.mockResolvedValue(carolCtx())

      await service.evaluate('entry-1')
      expect(persistedIds()).not.toContain('RULE_HFREF_LOW')
    })

    it('RULE_STANDARD_L1_HIGH stays gated on a lone reading (averaging preserved)', async () => {
      // Daniel — no conditions, single reading SBP 165. Standard L1 must
      // still gate on session averaging per Manisha (averaging stays ONLY
      // for standard L1).
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          systolicBP: 165,
          diastolicBP: 95,
          readingCount: 1,
          singleReadingFinalized: false,
        }),
      )
      await service.evaluate('entry-1')
      expect(persistedIds()).not.toContain('RULE_STANDARD_L1_HIGH')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // F9 / #82 — physicianMessage (and the whole three-tier record) is immutable
  // after fire. The Sprint-1 F9 fix dropped the update branch in persistAlert;
  // these tests pin that the session-finalize re-evaluation (the path the
  // 2026-06-01 walk fingered, matching the cron cadence) cannot rewrite the
  // at-fire-time clinical record — even when the engine would now render a
  // DIFFERENT message. Covers the adherence + emergency rules named in #82.
  // ────────────────────────────────────────────────────────────────────────
  describe('F9/#82 — physicianMessage immutability across session-finalize re-eval', () => {
    function rewriteOutputOnReeval() {
      // Make the output generator return a visibly different render so any
      // write-back on the second pass would be detectable.
      outputGenerator.generate.mockImplementation((result: any) => ({
        patientMessage: `PATIENT:${result.ruleId}:REWRITE`,
        caregiverMessage: `CAREGIVER:${result.ruleId}:REWRITE`,
        physicianMessage: `PHYSICIAN:${result.ruleId}:REWRITE`,
      }))
    }

    it('RULE_ABSOLUTE_EMERGENCY — re-eval finds existing row, never updates messages', async () => {
      // Pass 1: lone emergency reading fires + creates the at-fire-time record.
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          singleReadingFinalized: false,
          systolicBP: 185,
          diastolicBP: 122,
        }),
      )
      await service.evaluate('entry-1')
      const createCall = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string; physicianMessage: string } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_ABSOLUTE_EMERGENCY')
      expect(createCall).toBeDefined()
      const firedPhysicianMessage = createCall![0].data.physicianMessage

      // Pass 2: session-finalize re-runs evaluate() with
      // singleReadingFinalized=true. The existing row is found; even though
      // the generator now renders a different message, nothing is written.
      prisma.deviationAlert.create.mockClear()
      prisma.deviationAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        escalated: false,
      })
      rewriteOutputOnReeval()
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          singleReadingFinalized: true,
          systolicBP: 185,
          diastolicBP: 122,
        }),
      )
      await service.evaluate('entry-1')

      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
      // No re-create either → the at-fire-time record is the only write.
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
      // The fired record never carried the "REWRITE" render.
      expect(firedPhysicianMessage).not.toContain('REWRITE')
    })

    it('RULE_MEDICATION_MISSED — re-eval finds existing row, never updates messages', async () => {
      // Adherence window: two prior days of misses → pattern threshold met.
      prisma.journalEntry.findMany.mockResolvedValue([
        {
          id: 'prev-1',
          measuredAt: new Date('2026-04-21T10:00:00Z'),
          medicationTaken: false,
          missedMedications: null,
          pulse: 72,
          systolicBP: 120,
          diastolicBP: 78,
          weight: null,
        },
        {
          id: 'prev-2',
          measuredAt: new Date('2026-04-20T10:00:00Z'),
          medicationTaken: false,
          missedMedications: null,
          pulse: 72,
          systolicBP: 120,
          diastolicBP: 78,
          weight: null,
        },
      ])
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          singleReadingFinalized: false,
          systolicBP: 124,
          diastolicBP: 78,
          medicationTaken: false,
        }),
      )
      profileResolver.resolve.mockResolvedValue(
        baseCtx({
          profile: { ...baseCtx().profile, diagnosedHypertension: true },
        }),
      )
      await service.evaluate('entry-1')
      const createCall = (
        prisma.deviationAlert.create.mock.calls as Array<
          [{ data: { ruleId: string } }]
        >
      ).find((c) => c[0].data.ruleId === 'RULE_MEDICATION_MISSED')
      expect(createCall).toBeDefined()

      // Pass 2: session-finalize re-eval → existing row found, no write-back.
      prisma.deviationAlert.create.mockClear()
      prisma.deviationAlert.findFirst.mockResolvedValue({
        id: 'alert-1',
        escalated: false,
      })
      rewriteOutputOnReeval()
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({
          readingCount: 1,
          singleReadingFinalized: true,
          systolicBP: 124,
          diastolicBP: 78,
          medicationTaken: false,
        }),
      )
      await service.evaluate('entry-1')

      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    })
  })
})
