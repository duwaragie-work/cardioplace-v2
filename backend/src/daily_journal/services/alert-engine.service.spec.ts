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
    readingCount: 1,
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
      otherSymptoms: [],
    },
    suboptimalMeasurement: false,
    sessionId: null,
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
    resolvedAt: new Date('2026-04-22T10:00:00Z'),
    ...over,
  }
}

describe('AlertEngineService (orchestrator)', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let profileResolver: { resolve: jest.Mock }
  let sessionAverager: { averageForEntry: jest.Mock }
  let outputGenerator: { generate: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        upsert: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'alert-1',
          escalated: false,
        }),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
      },
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
      expect(r?.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
      expect(r?.tier).toBe('TIER_1_CONTRAINDICATION')
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
      expect(prisma.deviationAlert.upsert).not.toHaveBeenCalled()
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
      expect(prisma.deviationAlert.upsert).toHaveBeenCalledTimes(1)
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
    it('Tier 1 alert persists with dismissible=false and emits ANOMALY_TRACKED', async () => {
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
      expect(prisma.deviationAlert.upsert).toHaveBeenCalledTimes(1)
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.tier).toBe('TIER_1_CONTRAINDICATION')
      expect(call.create.ruleId).toBe('RULE_PREGNANCY_ACE_ARB')
      expect(call.create.dismissible).toBe(false)
      expect(call.create.patientMessage).toBe('PATIENT:RULE_PREGNANCY_ACE_ARB')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ANOMALY_TRACKED,
        expect.objectContaining({ userId: 'user-1' }),
      )
    })

    it('BP L1 High alert has dismissible=true', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.tier).toBe('BP_LEVEL_1_HIGH')
      expect(call.create.dismissible).toBe(true)
    })

    it('no rule fires → resolves existing open alerts', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 125, diastolicBP: 78 }),
      )
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.upsert).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'RESOLVED' },
        }),
      )
    })

    it('no PatientProfile → skip silently', async () => {
      profileResolver.resolve.mockRejectedValue(
        new ProfileNotFoundException('user-1'),
      )
      const r = await service.evaluate('entry-1')
      expect(r).toBeNull()
      expect(prisma.deviationAlert.upsert).not.toHaveBeenCalled()
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
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.tier).toBe('BP_LEVEL_1_HIGH')
      // OutputGenerator mock echoes physicianAnnotations — real phase/6 wording
      // is validated in output-generator.service.spec.ts.
      expect(call.create.physicianMessage.toLowerCase()).toContain(
        'pulse pressure',
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Part C — Audit fix pass
  // ────────────────────────────────────────────────────────────────────────

  // Bug 1 — ANOMALY_TRACKED must carry the DeviationAlert.id, not entryId.
  describe('Bug 1 — ANOMALY_TRACKED alertId', () => {
    it('emits the upserted DeviationAlert.id (not entryId)', async () => {
      prisma.deviationAlert.upsert.mockResolvedValue({
        id: 'deviation-alert-99',
        escalated: false,
      })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ entryId: 'entry-xyz', systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-xyz')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ANOMALY_TRACKED,
        expect.objectContaining({ alertId: 'deviation-alert-99' }),
      )
      // And specifically NOT entryId
      const payload = eventEmitter.emit.mock.calls[0][1] as { alertId: string }
      expect(payload.alertId).not.toBe('entry-xyz')
    })

    it('propagates DeviationAlert.escalated onto the event payload', async () => {
      prisma.deviationAlert.upsert.mockResolvedValue({
        id: 'a-1',
        escalated: true,
      })
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ANOMALY_TRACKED,
        expect.objectContaining({ escalated: true }),
      )
    })
  })

  // Bug 2 — resolveOpenAlerts must only clear BP Level 1 rows, not Tier 1 / L2.
  describe('Bug 2 — resolveOpenAlerts scope', () => {
    it('benign reading only resolves BP_LEVEL_1_* tiers', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 125, diastolicBP: 78 }),
      )
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.updateMany).toHaveBeenCalledTimes(1)
      const call = prisma.deviationAlert.updateMany.mock.calls[0][0]
      expect(call.where.tier).toEqual({
        in: ['BP_LEVEL_1_HIGH', 'BP_LEVEL_1_LOW'],
      })
      expect(call.data).toEqual({ status: 'RESOLVED' })
    })
  })

  // Bug 4 — tachy must check the immediately previous reading, not any prior.
  describe('Bug 4 — tachycardia consecutive check', () => {
    it('prior reading pulse 80 (normal) → no tachy alert even at current 105', async () => {
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
      const findFirstCall = prisma.journalEntry.findFirst.mock.calls[0][0]
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
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.tier).toBe('BP_LEVEL_2')
      expect(call.create.dismissible).toBe(false)
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
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.tier).toBe('TIER_3_INFO')
      expect(call.create.dismissible).toBe(true)
    })

    it('pulsePressure cached on DeviationAlert row explicitly', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 170, diastolicBP: 85 }), // PP=85
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.pulsePressure).toBe(85)
    })

    it('legacy type + severity populated for back-compat', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      const call = prisma.deviationAlert.upsert.mock.calls[0][0]
      expect(call.create.type).toBe('SYSTOLIC_BP')
      expect(call.create.severity).toBe('MEDIUM')
    })

    it('upsert idempotency: re-evaluating same entry uses the unique where clause', async () => {
      sessionAverager.averageForEntry.mockResolvedValue(
        baseSession({ systolicBP: 165, diastolicBP: 95 }),
      )
      await service.evaluate('entry-1')
      await service.evaluate('entry-1')
      expect(prisma.deviationAlert.upsert).toHaveBeenCalledTimes(2)
      for (const [call] of prisma.deviationAlert.upsert.mock.calls) {
        expect(call.where).toEqual({
          journalEntryId_type: {
            journalEntryId: 'entry-1',
            type: 'SYSTOLIC_BP',
          },
        })
      }
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
})
