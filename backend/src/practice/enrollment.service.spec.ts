import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from '../prisma/prisma.service.js'
import { PatientAccessService } from '../common/patient-access.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'
import { EnrollmentService } from './enrollment.service.js'
import { EncryptionService } from '../common/encryption.service.js'
import { encryptionMock } from '../common/test/encryption.mock.js'

// Covers the IVR-04-completion behaviour:
//   • completeEnrollment writes a user.enrollmentStatus audit row (so the manual
//     "Enroll patient" action shows in the Timeline like the auto revert/restore).
//   • autoReEnrollIfGateCleared restores a *reverted* patient (detected via the
//     last enrollment-status log being a revert — robust to seed patients that
//     never get enrolledAt stamped) only when the gate now passes.
describe('EnrollmentService', () => {
  let service: EnrollmentService
  let prisma: any
  let escalation: { dispatchDeferredForUser: jest.Mock<any> }

  // Drive the real canCompleteEnrollment gate via the mocked prisma.
  function gatePasses() {
    prisma.patientProviderAssignment.findUnique.mockResolvedValue({
      userId: 'p1',
      practice: {
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        businessHoursTimezone: 'America/New_York',
      },
    })
    prisma.patientProfile.findUnique.mockResolvedValue({
      userId: 'p1',
      heartFailureType: 'HFREF',
      hasHCM: false,
      hasDCM: false,
    })
    prisma.patientThreshold.findUnique.mockResolvedValue({ userId: 'p1' })
  }
  function gateFailsMissingThreshold() {
    prisma.patientProviderAssignment.findUnique.mockResolvedValue({
      userId: 'p1',
      practice: {
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        businessHoursTimezone: 'America/New_York',
      },
    })
    prisma.patientProfile.findUnique.mockResolvedValue({
      userId: 'p1',
      heartFailureType: 'HFREF', // mandatory…
      hasHCM: false,
      hasDCM: false,
    })
    prisma.patientThreshold.findUnique.mockResolvedValue(null) // …but no threshold → fail
  }

  const ADMIN = { id: 'admin', roles: [] } as never

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'p1',
          enrollmentStatus: 'ENROLLED',
        }),
      },
      profileVerificationLog: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      patientProviderAssignment: { findUnique: jest.fn() },
      patientProfile: { findUnique: jest.fn() },
      patientThreshold: { findUnique: jest.fn() },
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
    }
    escalation = {
      dispatchDeferredForUser: (jest.fn() as jest.Mock<any>).mockResolvedValue({
        dispatched: 0,
        skipped: 0,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EnrollmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: EscalationService, useValue: escalation },
        {
          provide: PatientAccessService,
          useValue: { assertCanAccessPatient: jest.fn() },
        },
        { provide: EncryptionService, useValue: encryptionMock() },
      ],
    }).compile()

    service = module.get<EnrollmentService>(EnrollmentService)
  })

  describe('autoReEnrollIfGateCleared', () => {
    it('re-enrolls a reverted patient + writes audit + catch-up when the gate passes', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'NOT_ENROLLED' })
      prisma.profileVerificationLog.findFirst.mockResolvedValue({ newValue: 'NOT_ENROLLED' })
      gatePasses()

      const result = await service.autoReEnrollIfGateCleared(ADMIN, 'p1')

      expect(result).toBe(true)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enrollmentStatus: 'ENROLLED' } }),
      )
      expect(prisma.profileVerificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldPath: 'user.enrollmentStatus',
            previousValue: 'NOT_ENROLLED',
            newValue: 'ENROLLED',
          }),
        }),
      )
      expect(escalation.dispatchDeferredForUser).toHaveBeenCalledWith('p1')
    })

    it('does NOT re-enroll a never-enrolled patient (no revert log)', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'NOT_ENROLLED' })
      prisma.profileVerificationLog.findFirst.mockResolvedValue(null)
      gatePasses()

      const result = await service.autoReEnrollIfGateCleared(ADMIN, 'p1')
      expect(result).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('does NOT re-enroll while the gate still fails', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'NOT_ENROLLED' })
      prisma.profileVerificationLog.findFirst.mockResolvedValue({ newValue: 'NOT_ENROLLED' })
      gateFailsMissingThreshold()

      const result = await service.autoReEnrollIfGateCleared(ADMIN, 'p1')
      expect(result).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('no-ops when already enrolled', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'ENROLLED' })
      const result = await service.autoReEnrollIfGateCleared(ADMIN, 'p1')
      expect(result).toBe(false)
      expect(prisma.profileVerificationLog.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('revertIfThresholdGap (THR-033 delete cascade)', () => {
    it('reverts an enrolled patient when removing the threshold leaves a gap', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'ENROLLED' })
      gateFailsMissingThreshold() // mandatory + no threshold → threshold-required reason

      const result = await service.revertIfThresholdGap(ADMIN, 'p1')

      expect(result).toBe(true)
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { enrollmentStatus: 'NOT_ENROLLED' } }),
      )
      expect(prisma.profileVerificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldPath: 'user.enrollmentStatus',
            previousValue: 'ENROLLED',
            newValue: 'NOT_ENROLLED',
          }),
        }),
      )
    })

    it('does NOT revert when the gate still passes (non-mandatory / threshold not required)', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'ENROLLED' })
      gatePasses()

      const result = await service.revertIfThresholdGap(ADMIN, 'p1')
      expect(result).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('no-ops when the patient is not enrolled', async () => {
      prisma.user.findUnique.mockResolvedValue({ enrollmentStatus: 'NOT_ENROLLED' })
      const result = await service.revertIfThresholdGap(ADMIN, 'p1')
      expect(result).toBe(false)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('completeEnrollment', () => {
    it('writes a user.enrollmentStatus ADMIN_VERIFY audit row on the ENROLLED flip', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'p1',
        roles: ['PATIENT'],
        enrollmentStatus: 'NOT_ENROLLED',
      })
      gatePasses()

      await service.completeEnrollment(ADMIN, 'p1')

      expect(prisma.profileVerificationLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            fieldPath: 'user.enrollmentStatus',
            previousValue: 'NOT_ENROLLED',
            newValue: 'ENROLLED',
            changeType: 'ADMIN_VERIFY',
          }),
        }),
      )
    })

    it('is idempotent — no audit row when already enrolled', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'p1',
        roles: ['PATIENT'],
        enrollmentStatus: 'ENROLLED',
      })

      await service.completeEnrollment(ADMIN, 'p1')
      expect(prisma.profileVerificationLog.create).not.toHaveBeenCalled()
    })
  })
})
