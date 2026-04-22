import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ProfileNotFoundException, type ResolvedContext } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { AlertEngineService } from './alert-engine.service.js'
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

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        upsert: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'alert-1' }),
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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: SessionAveragerService, useValue: sessionAverager },
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
      expect(call.create.patientMessage).toBe('TODO(phase/6)')
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
      expect(call.create.physicianMessage).toMatch(/pulse pressure/i)
    })
  })
})
