import { jest } from '@jest/globals'
import { ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  ActorUser,
  PatientAccessService,
} from './patient-access.service.js'

// May 2026 access-scope decision — see docs/ACCESS_SCOPE.md.
//
// Coverage matrix for the helper:
//   • SUPER_ADMIN / HEALPLACE_OPS short-circuit (no scope filter)
//   • MEDICAL_DIRECTOR scoped via PracticeMedicalDirector membership
//   • PROVIDER scoped via PatientProviderAssignment primary/backup
//   • Deny path → ForbiddenException
//
// Pure-unit style: PrismaService is fully mocked, no DB needed.

const PRACTICE_A = 'practice-a'
const PRACTICE_B = 'practice-b'
const PATIENT_A = 'patient-a'
const MED_ID = 'med-dir-1'
const PROV_ID = 'provider-1'
const SUPER_ID = 'super-1'
const OPS_ID = 'ops-1'

describe('PatientAccessService', () => {
  let service: PatientAccessService
  let prisma: {
    patientProviderAssignment: {
      findUnique: jest.Mock
    }
    practiceMedicalDirector: {
      findUnique: jest.Mock
      findMany: jest.Mock
    }
  }

  beforeEach(async () => {
    prisma = {
      patientProviderAssignment: {
        findUnique: jest.fn() as jest.Mock<any, any>,
      },
      practiceMedicalDirector: {
        findUnique: jest.fn() as jest.Mock<any, any>,
        findMany: jest.fn() as jest.Mock<any, any>,
      },
    }
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PatientAccessService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile()
    service = module.get(PatientAccessService)
  })

  // ────────────────────────────────────────────────────────────────────────
  // assertCanAccessPatient — patient-detail mutation gate
  // ────────────────────────────────────────────────────────────────────────

  describe('assertCanAccessPatient', () => {
    const superActor: ActorUser = {
      id: SUPER_ID,
      roles: [UserRole.SUPER_ADMIN],
    }
    const opsActor: ActorUser = {
      id: OPS_ID,
      roles: [UserRole.HEALPLACE_OPS],
    }
    const medActor: ActorUser = {
      id: MED_ID,
      roles: [UserRole.MEDICAL_DIRECTOR],
    }
    const provActor: ActorUser = {
      id: PROV_ID,
      roles: [UserRole.PROVIDER],
    }

    it('SUPER_ADMIN bypasses scope checks (no Prisma lookup)', async () => {
      await expect(
        service.assertCanAccessPatient(superActor, PATIENT_A),
      ).resolves.toBeUndefined()
      expect(prisma.patientProviderAssignment.findUnique).not.toHaveBeenCalled()
    })

    it('HEALPLACE_OPS bypasses scope checks (no Prisma lookup)', async () => {
      await expect(
        service.assertCanAccessPatient(opsActor, PATIENT_A),
      ).resolves.toBeUndefined()
      expect(prisma.patientProviderAssignment.findUnique).not.toHaveBeenCalled()
    })

    it('MED_DIR allowed when they head the patient practice', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: 'someone-else',
        backupProviderId: 'someone-else',
      })
      prisma.practiceMedicalDirector.findUnique.mockResolvedValue({
        id: 'pmd-1',
      })

      await expect(
        service.assertCanAccessPatient(medActor, PATIENT_A),
      ).resolves.toBeUndefined()
      expect(prisma.practiceMedicalDirector.findUnique).toHaveBeenCalledWith({
        where: {
          practiceId_userId: { practiceId: PRACTICE_A, userId: MED_ID },
        },
        select: { id: true },
      })
    })

    it('MED_DIR denied when they do not head the patient practice', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_B,
        primaryProviderId: 'someone-else',
        backupProviderId: 'someone-else',
      })
      prisma.practiceMedicalDirector.findUnique.mockResolvedValue(null)

      await expect(
        service.assertCanAccessPatient(medActor, PATIENT_A),
      ).rejects.toThrow(ForbiddenException)
    })

    it('MED_DIR denied when patient has no assignment yet', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue(null)
      await expect(
        service.assertCanAccessPatient(medActor, PATIENT_A),
      ).rejects.toThrow(ForbiddenException)
    })

    it('PROVIDER allowed when they are primary on patient assignment', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_ID,
        backupProviderId: 'someone-else',
      })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).resolves.toBeUndefined()
    })

    it('PROVIDER allowed when they are backup on patient assignment', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: 'someone-else',
        backupProviderId: PROV_ID,
      })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).resolves.toBeUndefined()
    })

    it('PROVIDER denied when not in panel', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: 'someone-else',
        backupProviderId: 'someone-else',
      })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).rejects.toThrow(ForbiddenException)
    })

    it('PROVIDER denied when patient has no assignment yet', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue(null)
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // assertCanModifyPracticeAssignment — care-team mutation gate
  // ────────────────────────────────────────────────────────────────────────

  describe('assertCanModifyPracticeAssignment', () => {
    const medActor: ActorUser = {
      id: MED_ID,
      roles: [UserRole.MEDICAL_DIRECTOR],
    }
    const opsActor: ActorUser = {
      id: OPS_ID,
      roles: [UserRole.HEALPLACE_OPS],
    }
    const provActor: ActorUser = {
      id: PROV_ID,
      roles: [UserRole.PROVIDER],
    }

    it('OPS bypasses without DB lookup', async () => {
      await expect(
        service.assertCanModifyPracticeAssignment(opsActor, PRACTICE_A),
      ).resolves.toBeUndefined()
      expect(prisma.practiceMedicalDirector.findUnique).not.toHaveBeenCalled()
    })

    it('MED_DIR allowed for a practice they head', async () => {
      prisma.practiceMedicalDirector.findUnique.mockResolvedValue({
        id: 'pmd-1',
      })
      await expect(
        service.assertCanModifyPracticeAssignment(medActor, PRACTICE_A),
      ).resolves.toBeUndefined()
    })

    it('MED_DIR denied for a practice they do not head', async () => {
      prisma.practiceMedicalDirector.findUnique.mockResolvedValue(null)
      await expect(
        service.assertCanModifyPracticeAssignment(medActor, PRACTICE_B),
      ).rejects.toThrow(ForbiddenException)
    })

    it('MED_DIR allowed only when ALL listed practices are headed (update flow)', async () => {
      // First practice (existing) — yes. Second (new) — no. Should deny.
      prisma.practiceMedicalDirector.findUnique
        .mockResolvedValueOnce({ id: 'pmd-1' })
        .mockResolvedValueOnce(null)
      await expect(
        service.assertCanModifyPracticeAssignment(medActor, [
          PRACTICE_A,
          PRACTICE_B,
        ]),
      ).rejects.toThrow(ForbiddenException)
    })

    it('PROVIDER denied — assignment is admin-tier only', async () => {
      await expect(
        service.assertCanModifyPracticeAssignment(provActor, PRACTICE_A),
      ).rejects.toThrow(ForbiddenException)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // patientScopeFilter — list/queue where-clause builder
  // ────────────────────────────────────────────────────────────────────────

  describe('patientScopeFilter', () => {
    it('returns undefined for SUPER_ADMIN (no filter)', async () => {
      const filter = await service.patientScopeFilter({
        id: SUPER_ID,
        roles: [UserRole.SUPER_ADMIN],
      })
      expect(filter).toBeUndefined()
    })

    it('returns undefined for HEALPLACE_OPS (no filter)', async () => {
      const filter = await service.patientScopeFilter({
        id: OPS_ID,
        roles: [UserRole.HEALPLACE_OPS],
      })
      expect(filter).toBeUndefined()
    })

    it('MED_DIR filter scopes by practice membership', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
        { practiceId: PRACTICE_B },
      ])
      const filter = await service.patientScopeFilter({
        id: MED_ID,
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: {
          is: { practiceId: { in: [PRACTICE_A, PRACTICE_B] } },
        },
      })
    })

    it('PROVIDER filter scopes by panel (primary OR backup)', async () => {
      const filter = await service.patientScopeFilter({
        id: PROV_ID,
        roles: [UserRole.PROVIDER],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: {
          is: {
            OR: [
              { primaryProviderId: PROV_ID },
              { backupProviderId: PROV_ID },
            ],
          },
        },
      })
    })

    it('PATIENT-only caller gets an impossible filter (defensive)', async () => {
      const filter = await service.patientScopeFilter({
        id: 'p-1',
        roles: [UserRole.PATIENT],
      })
      // The patient frontend never hits admin endpoints — the JWT guard
      // catches that case upstream. But if it somehow reached the service,
      // we want zero rows, not a 500.
      expect(filter).toEqual({
        providerAssignmentAsPatient: { is: { id: '__never__' } },
      })
    })
  })
})
