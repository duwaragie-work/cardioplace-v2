import { jest } from '@jest/globals'
import { BadRequestException, ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import {
  ActorUser,
  PatientAccessService,
} from '../common/patient-access.service.js'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AssignmentService } from './assignment.service.js'
import { EncryptionService } from '../common/encryption.service.js'
import { encryptionMock } from '../common/test/encryption.mock.js'

// May 2026 follow-up coverage for the two assignment-service fixes:
//   • Primary != backup must reject — backend safeguard so a hand-crafted
//     POST can't bypass the frontend dropdown.
//   • MED_DIR practice scope enforced — runtime guard via
//     PatientAccessService.assertCanModifyPracticeAssignment.

describe('AssignmentService — May 2026 hardening', () => {
  let service: AssignmentService
  // Loose prisma + access typing matches the alert-resolution.spec.ts
  // pattern — strict types make TS infer `never` for mockResolvedValue
  // parameters because this project's jest types only accept one generic.
  let prisma: Record<string, any>
  let access: { assertCanModifyPracticeAssignment: jest.Mock<any> }

  const PRACTICE_A = 'practice-A'
  const PATIENT_USER = 'patient-1'
  const PROV_X = 'prov-X'
  const PROV_Y = 'prov-Y'
  const MD_Z = 'md-Z'

  const opsActor: ActorUser = {
    id: 'ops-1',
    roles: [UserRole.HEALPLACE_OPS],
  }

  function patientUser() {
    return { id: PATIENT_USER, roles: [UserRole.PATIENT] }
  }
  function providerUser(id: string) {
    return { id, roles: [UserRole.PROVIDER] }
  }
  function mdUser(id: string) {
    return { id, roles: [UserRole.MEDICAL_DIRECTOR] }
  }

  beforeEach(async () => {
    prisma = {
      user: { findUnique: jest.fn() as jest.Mock<any> },
      practice: { findUnique: jest.fn() as jest.Mock<any> },
      patientProviderAssignment: {
        create: jest.fn() as jest.Mock<any>,
        update: jest.fn() as jest.Mock<any>,
        findUnique: jest.fn() as jest.Mock<any>,
      },
      profileVerificationLog: {
        create: jest.fn() as jest.Mock<any>,
      },
    }
    access = {
      assertCanModifyPracticeAssignment: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentService,
        { provide: PrismaService, useValue: prisma },
        { provide: PatientAccessService, useValue: access },
        { provide: EncryptionService, useValue: encryptionMock() },
      ],
    }).compile()
    service = module.get(AssignmentService)

    // Default fixture stubs — overridden in individual tests.
    prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === PATIENT_USER) return patientUser()
      if (where.id === PROV_X) return providerUser(PROV_X)
      if (where.id === PROV_Y) return providerUser(PROV_Y)
      if (where.id === MD_Z) return mdUser(MD_Z)
      return null
    })
    prisma.practice.findUnique.mockResolvedValue({ id: PRACTICE_A })
    prisma.patientProviderAssignment.create.mockResolvedValue({
      id: 'assignment-1',
      userId: PATIENT_USER,
      practiceId: PRACTICE_A,
      primaryProviderId: PROV_X,
      backupProviderId: PROV_Y,
      medicalDirectorId: MD_Z,
      assignedAt: new Date(),
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // create — primary != backup
  // ────────────────────────────────────────────────────────────────────────
  describe('create — primary == backup', () => {
    it('rejects when primary and backup are the same clinician', async () => {
      await expect(
        service.create(opsActor, PATIENT_USER, {
          practiceId: PRACTICE_A,
          primaryProviderId: PROV_X,
          backupProviderId: PROV_X, // collision
          medicalDirectorId: MD_Z,
        }),
      ).rejects.toThrow(BadRequestException)
      // The DB write must not run when validation fails.
      expect(prisma.patientProviderAssignment.create).not.toHaveBeenCalled()
    })

    it('happy path: distinct primary + backup proceeds to write', async () => {
      const r = await service.create(opsActor, PATIENT_USER, {
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_X,
        backupProviderId: PROV_Y,
        medicalDirectorId: MD_Z,
      })
      expect(r.statusCode).toBe(201)
      expect(prisma.patientProviderAssignment.create).toHaveBeenCalledTimes(1)
    })

    // Phase/practice-identity (Manisha 2026-06-12 §1, HIPAA 45 CFR
    // §164.312(a)(2)(i)) — assignment changes are clinical-staff actions and
    // must capture WHICH practice the admin was acting under.
    it('persists practiceContext on ProfileVerificationLog when ctx provided', async () => {
      await service.create(
        opsActor,
        PATIENT_USER,
        {
          practiceId: PRACTICE_A,
          primaryProviderId: PROV_X,
          backupProviderId: PROV_Y,
          medicalDirectorId: MD_Z,
        },
        { practiceId: 'p-bridge' },
      )
      expect(prisma.profileVerificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ practiceContext: 'p-bridge' }),
      })
    })

    it('falls back to null practiceContext when ctx omitted (org-wide actor)', async () => {
      await service.create(opsActor, PATIENT_USER, {
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_X,
        backupProviderId: PROV_Y,
        medicalDirectorId: MD_Z,
      })
      expect(prisma.profileVerificationLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ practiceContext: null }),
      })
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // update — primary != backup (partial DTOs)
  // ────────────────────────────────────────────────────────────────────────
  describe('update — primary == backup', () => {
    beforeEach(() => {
      // Existing row: primary X, backup Y.
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        userId: PATIENT_USER,
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_X,
        backupProviderId: PROV_Y,
        medicalDirectorId: MD_Z,
        assignedAt: new Date(),
      })
    })

    it('rejects when DTO sets backup to existing primary (partial update)', async () => {
      await expect(
        service.update(opsActor, PATIENT_USER, {
          backupProviderId: PROV_X, // matches existing primary
        }),
      ).rejects.toThrow(BadRequestException)
      expect(prisma.patientProviderAssignment.update).not.toHaveBeenCalled()
    })

    it('rejects when DTO sets primary to existing backup (partial update)', async () => {
      await expect(
        service.update(opsActor, PATIENT_USER, {
          primaryProviderId: PROV_Y, // matches existing backup
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects when DTO sets both to the same id', async () => {
      await expect(
        service.update(opsActor, PATIENT_USER, {
          primaryProviderId: PROV_X,
          backupProviderId: PROV_X,
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // MED_DIR practice scope — delegates to PatientAccessService
  // ────────────────────────────────────────────────────────────────────────
  describe('MED_DIR practice scope', () => {
    it('create denies MED_DIR who does not head the target practice', async () => {
      access.assertCanModifyPracticeAssignment.mockRejectedValueOnce(
        new ForbiddenException('Practice practice-A is outside your MED_DIR scope'),
      )
      const medActor: ActorUser = { id: 'md-other', roles: [UserRole.MEDICAL_DIRECTOR] }
      await expect(
        service.create(medActor, PATIENT_USER, {
          practiceId: PRACTICE_A,
          primaryProviderId: PROV_X,
          backupProviderId: PROV_Y,
          medicalDirectorId: MD_Z,
        }),
      ).rejects.toThrow(ForbiddenException)
      expect(access.assertCanModifyPracticeAssignment).toHaveBeenCalledWith(
        medActor,
        PRACTICE_A,
      )
    })

    it('update checks BOTH existing and new practice when DTO changes practiceId', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        id: 'assignment-1',
        userId: PATIENT_USER,
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_X,
        backupProviderId: PROV_Y,
        medicalDirectorId: MD_Z,
        assignedAt: new Date(),
      })
      // Stub the .update() return so the audit-snapshot read of practiceId
      // doesn't NPE — the test only asserts the access-service call args.
      prisma.patientProviderAssignment.update.mockResolvedValue({
        id: 'assignment-1',
        userId: PATIENT_USER,
        practiceId: 'practice-B',
        primaryProviderId: PROV_X,
        backupProviderId: PROV_Y,
        medicalDirectorId: MD_Z,
        assignedAt: new Date(),
      })
      // Practice existence + role validation are also touched on this path
      // — practice.findUnique is already stubbed in the outer beforeEach.
      await service.update(opsActor, PATIENT_USER, {
        practiceId: 'practice-B',
      })
      expect(access.assertCanModifyPracticeAssignment).toHaveBeenCalledWith(
        opsActor,
        [PRACTICE_A, 'practice-B'],
      )
    })
  })
})
