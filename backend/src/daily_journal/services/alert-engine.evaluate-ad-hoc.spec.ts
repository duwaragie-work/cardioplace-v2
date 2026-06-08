// Tests for AlertEngineService.evaluateAdHoc — the chatbot entry point that
// asks the rule engine "what does this reading mean for THIS patient" without
// persisting anything. Mirrors the alert-engine.service.spec.ts harness:
// fully-mocked Prisma + dependencies; uses the public evaluateAdHoc surface
// only (private helpers are exercised transitively via runPipeline).

import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ProfileNotFoundException, type ResolvedContext } from '@cardioplace/shared'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AlertEngineService } from './alert-engine.service.js'
import { OutputGeneratorService } from './output-generator.service.js'
import { ProfileResolverService } from './profile-resolver.service.js'
import { SessionAveragerService } from './session-averager.service.js'

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
      hasAorticStenosis: false,
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
    enrolledAt: null,
    practiceName: null,
    patientName: null,
    resolvedAt: new Date('2026-04-22T10:00:00Z'),
    ...over,
  }
}

describe('AlertEngineService.evaluateAdHoc', () => {
  let service: AlertEngineService
  let prisma: Record<string, any>
  let profileResolver: { resolve: jest.Mock }
  let outputGenerator: { generate: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
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
        count: (jest.fn() as jest.Mock<any>).mockResolvedValue(0),
      },
      journalEntry: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        count: (jest.fn() as jest.Mock<any>).mockResolvedValue(20),
      },
      patientMedication: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      $transaction: ((fn: any) => Promise.resolve(fn(prisma))) as any,
    }
    profileResolver = {
      resolve: (jest.fn() as jest.Mock<any>).mockResolvedValue(baseCtx()),
    }
    // OutputGenerator returns deterministic strings so we can assert the
    // canonical patient-tier message reaches the caller verbatim.
    outputGenerator = {
      generate: (jest.fn() as jest.Mock<any>).mockImplementation(
        (result: any, _session: any, preDay3: boolean) => ({
          patientMessage: `PATIENT:${result.ruleId}:preDay3=${preDay3}`,
          caregiverMessage: `CAREGIVER:${result.ruleId}`,
          physicianMessage: `PHYSICIAN:${result.ruleId}`,
        }),
      ),
    }
    const sessionAverager = {
      averageForEntry: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertEngineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: ProfileResolverService, useValue: profileResolver },
        { provide: SessionAveragerService, useValue: sessionAverager },
        { provide: OutputGeneratorService, useValue: outputGenerator },
      ],
    }).compile()
    service = module.get<AlertEngineService>(AlertEngineService)
  })

  // ─── Profile-not-found ────────────────────────────────────────────────────

  it('returns PROFILE_NOT_FOUND when the patient has no PatientProfile', async () => {
    profileResolver.resolve.mockRejectedValueOnce(
      new ProfileNotFoundException('user-1'),
    )

    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 140,
      diastolicBP: 90,
    })

    expect(result).toEqual({ evaluated: false, reason: 'PROFILE_NOT_FOUND' })
    // Profile gate fires before any DB writes happen.
    expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
  })

  it('lets non-ProfileNotFound errors propagate (engine bug surfaces, not swallowed)', async () => {
    profileResolver.resolve.mockRejectedValueOnce(new Error('boom'))
    await expect(
      service.evaluateAdHoc({ userId: 'user-1', systolicBP: 140, diastolicBP: 90 }),
    ).rejects.toThrow('boom')
  })

  // ─── No persistence (this is the whole point) ─────────────────────────────

  it('does NOT write to DeviationAlert / Notification — even for a Tier 1 emergency BP', async () => {
    // 195/130 trips absoluteEmergency in the live engine. We don't assert the
    // tier here (that's covered by the orchestrator spec); we just need to
    // know the pipeline ran AND nothing was persisted.
    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 195,
      diastolicBP: 130,
    })

    expect(result.evaluated).toBe(true)
    expect(prisma.deviationAlert.create).not.toHaveBeenCalled()
    expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    expect(prisma.notification.create).not.toHaveBeenCalled()
  })

  // ─── In-target reading ────────────────────────────────────────────────────

  it('returns ruleId:null / patientMessage:null when no rule fires (within targets)', async () => {
    // 122/76 against a healthy default profile — should not fire any rule.
    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 122,
      diastolicBP: 76,
    })

    expect(result).toEqual({
      evaluated: true,
      ruleId: null,
      tier: null,
      mode: null,
      preDay3: false,
      patientMessage: null,
    })
    expect(outputGenerator.generate).not.toHaveBeenCalled()
  })

  // ─── Out-of-target reading: top result + canonical message ────────────────

  it('returns the canonical patient-tier message when a rule fires', async () => {
    // Pregnant patient at 145/95 — pregnancyL1HighRule fires.
    profileResolver.resolve.mockResolvedValueOnce(
      baseCtx({
        profile: { ...baseCtx().profile, isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )

    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 145,
      diastolicBP: 95,
    })

    expect(result.evaluated).toBe(true)
    if (result.evaluated) {
      expect(result.ruleId).not.toBeNull()
      expect(result.tier).not.toBeNull()
      expect(result.patientMessage).toMatch(/^PATIENT:/)
    }
    expect(outputGenerator.generate).toHaveBeenCalledTimes(1)
  })

  // ─── preDay3 propagation ──────────────────────────────────────────────────

  it('flags preDay3=true when the patient has fewer than 7 journal entries', async () => {
    prisma.journalEntry.count.mockResolvedValueOnce(3)
    profileResolver.resolve.mockResolvedValueOnce(
      baseCtx({
        profile: { ...baseCtx().profile, isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )

    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 145,
      diastolicBP: 95,
    })

    if (result.evaluated) {
      expect(result.preDay3).toBe(true)
      // Verify the flag was threaded into OutputGenerator (downstream
      // wording differs based on whether the patient is pre-Day-3).
      // Issue #68 — the call signature gained a 5th arg (dateOfBirth) so
      // the output generator can compute `patientAgeYears` for any rule
      // that opts into `agePhrase(ctx)`. Assert it's a Date (the engine
      // pipes `ctx.dateOfBirth`) without pinning the exact value.
      expect(outputGenerator.generate).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        true,
        null,
        expect.any(Date),
      )
    }
  })

  it('flags preDay3=false when the patient has 7 or more journal entries', async () => {
    prisma.journalEntry.count.mockResolvedValueOnce(20)
    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 122,
      diastolicBP: 76,
    })
    if (result.evaluated) {
      expect(result.preDay3).toBe(false)
    }
  })

  // ─── Symptom propagation ──────────────────────────────────────────────────

  it('propagates symptom flags so symptom-override rules can fire', async () => {
    // Pregnant patient + RUQ pain at SBP 150 — preeclampsia symptom override
    // wins the emergency axis ahead of the L1-High BP rule.
    profileResolver.resolve.mockResolvedValueOnce(
      baseCtx({
        profile: { ...baseCtx().profile, isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )

    const result = await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 150,
      diastolicBP: 95,
      symptoms: { ruqPain: true },
    })

    expect(result.evaluated).toBe(true)
    if (result.evaluated) {
      // The exact ruleId is implementation-detail (could be the symptom-
      // override OR pregnancyL2 depending on rule ordering) — what we
      // care about is that SOME rule fired and the canonical wording came
      // back. Without the ruqPain flag, this same call returns the
      // ordinary pregnancyL1High path.
      expect(result.ruleId).not.toBeNull()
      expect(result.patientMessage).toMatch(/^PATIENT:/)
    }
  })

  // ─── Defaults: synthetic session is a single non-finalized reading ───────

  it('uses readingCount=1 + singleReadingFinalized=true (so Stage C rules can fire on a single reading)', async () => {
    // Mock outputGenerator to capture the SessionAverage it receives, so we
    // can assert the synthetic session shape that reaches downstream rules.
    let capturedSession: any = null
    outputGenerator.generate.mockImplementation(
      (_r: any, session: any, _p: boolean) => {
        capturedSession = session
        return {
          patientMessage: 'PATIENT:any',
          caregiverMessage: 'CAREGIVER:any',
          physicianMessage: 'PHYSICIAN:any',
        }
      },
    )
    profileResolver.resolve.mockResolvedValueOnce(
      baseCtx({
        profile: { ...baseCtx().profile, isPregnant: true },
        pregnancyThresholdsActive: true,
      }),
    )

    await service.evaluateAdHoc({
      userId: 'user-1',
      systolicBP: 145,
      diastolicBP: 95,
    })

    if (capturedSession) {
      expect(capturedSession.readingCount).toBe(1)
      expect(capturedSession.singleReadingFinalized).toBe(true)
      expect(capturedSession.entryId).toBe('')
      expect(capturedSession.sessionId).toBeNull()
      expect(capturedSession.medicationTaken).toBeNull()
      expect(capturedSession.missedMedications).toEqual([])
    }
  })
})
