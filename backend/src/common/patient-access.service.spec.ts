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
// June 2026 update (Manisha 2026-06-12 Doc 3 Q2): PROVIDER now sees every
// patient in their practices (mirrors MEDICAL_DIRECTOR). Assignment still
// governs alert routing + escalation; only data visibility widened.
//
// Coverage matrix for the helper:
//   • SUPER_ADMIN / HEALPLACE_OPS short-circuit (no scope filter)
//   • MEDICAL_DIRECTOR scoped via PracticeMedicalDirector membership
//   • PROVIDER scoped via PracticeProvider membership (practice-wide)
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
  // Loose prisma typing so mockResolvedValue accepts any payload — matches
  // the alert-resolution.service.spec.ts pattern. Strict typing made TS
  // infer `never` for the mock parameter type (jest types in this project
  // only accept one generic arg).
  let prisma: Record<string, any>

  beforeEach(async () => {
    prisma = {
      patientProviderAssignment: {
        findUnique: jest.fn() as jest.Mock<any>,
      },
      practiceMedicalDirector: {
        findUnique: jest.fn() as jest.Mock<any>,
        findMany: jest.fn() as jest.Mock<any>,
      },
      practiceProvider: {
        findUnique: jest.fn() as jest.Mock<any>,
        findMany: jest.fn() as jest.Mock<any>,
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

    it('PROVIDER allowed when they are primary AND a practice member', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: PROV_ID,
        backupProviderId: 'someone-else',
      })
      prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).resolves.toBeUndefined()
    })

    it('PROVIDER allowed when they are backup AND a practice member', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: 'someone-else',
        backupProviderId: PROV_ID,
      })
      prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).resolves.toBeUndefined()
    })

    it('PROVIDER allowed when in same practice but NOT primary/backup (Manisha 2026-06-12)', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_A,
        primaryProviderId: 'someone-else',
        backupProviderId: 'someone-else',
      })
      prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
      await expect(
        service.assertCanAccessPatient(provActor, PATIENT_A),
      ).resolves.toBeUndefined()
      expect(prisma.practiceProvider.findUnique).toHaveBeenCalledWith({
        where: {
          practiceId_userId: { practiceId: PRACTICE_A, userId: PROV_ID },
        },
        select: { id: true },
      })
    })

    it('PROVIDER denied when NOT a member of the patient practice', async () => {
      prisma.patientProviderAssignment.findUnique.mockResolvedValue({
        practiceId: PRACTICE_B,
        primaryProviderId: 'someone-else',
        backupProviderId: 'someone-else',
      })
      prisma.practiceProvider.findUnique.mockResolvedValue(null)
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

    it('PROVIDER filter scopes by practice membership (Manisha 2026-06-12)', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
      ])
      const filter = await service.patientScopeFilter({
        id: PROV_ID,
        roles: [UserRole.PROVIDER],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: {
          is: { practiceId: { in: [PRACTICE_A] } },
        },
      })
    })

    it('PROVIDER sees patients across multiple practices they are a member of', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
        { practiceId: PRACTICE_B },
      ])
      const filter = await service.patientScopeFilter({
        id: PROV_ID,
        roles: [UserRole.PROVIDER],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: {
          is: { practiceId: { in: [PRACTICE_A, PRACTICE_B] } },
        },
      })
    })

    it('PROVIDER with zero memberships gets an empty practice list (sees no patients)', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([])
      const filter = await service.patientScopeFilter({
        id: 'newbie-provider',
        roles: [UserRole.PROVIDER],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: { is: { practiceId: { in: [] } } },
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

  // ────────────────────────────────────────────────────────────────────────
  // alertQueueScopeFilter — the dashboard queue is the provider's caseload,
  // not the whole practice (Manisha 2026-06 / Humaira HIPAA N14). Only a plain
  // PROVIDER narrows to assigned patients; every other role delegates to
  // patientScopeFilter so the two methods never drift.
  // ────────────────────────────────────────────────────────────────────────

  describe('alertQueueScopeFilter', () => {
    it('returns undefined for SUPER_ADMIN (no filter)', async () => {
      const filter = await service.alertQueueScopeFilter({
        id: SUPER_ID,
        roles: [UserRole.SUPER_ADMIN],
      })
      expect(filter).toBeUndefined()
    })

    it('returns undefined for HEALPLACE_OPS (no filter)', async () => {
      const filter = await service.alertQueueScopeFilter({
        id: OPS_ID,
        roles: [UserRole.HEALPLACE_OPS],
      })
      expect(filter).toBeUndefined()
    })

    it('MED_DIR stays practice-wide (delegates — no primary/backup OR clause)', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
      ])
      const filter = await service.alertQueueScopeFilter({
        id: MED_ID,
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      expect(filter).toEqual({
        providerAssignmentAsPatient: {
          is: { practiceId: { in: [PRACTICE_A] } },
        },
      })
      expect(
        (filter?.providerAssignmentAsPatient.is as Record<string, unknown>).OR,
      ).toBeUndefined()
    })

    it('PROVIDER narrows to assigned patients only (primary OR backup)', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
      ])
      const filter = await service.alertQueueScopeFilter({
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
            practiceId: { in: [PRACTICE_A] },
          },
        },
      })
    })

    it('a PROVIDER who is ALSO MED_DIR keeps practice-wide (no assigned-only narrowing)', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
      ])
      const filter = await service.alertQueueScopeFilter({
        id: MED_ID,
        roles: [UserRole.PROVIDER, UserRole.MEDICAL_DIRECTOR],
      })
      expect(
        (filter?.providerAssignmentAsPatient.is as Record<string, unknown>).OR,
      ).toBeUndefined()
    })

    it('PROVIDER queue still respects active practice context (multi-practice)', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
        { practiceId: PRACTICE_B },
      ])
      const filter = await service.alertQueueScopeFilter({
        id: PROV_ID,
        roles: [UserRole.PROVIDER],
        activePracticeId: PRACTICE_B,
      })
      const is = filter?.providerAssignmentAsPatient.is as {
        practiceId: { in: string[] }
      }
      expect(is.practiceId.in).toEqual([PRACTICE_B])
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Strict practice-context scoping (PR #90 Bug B, Duwaragie 2026-06-19) —
  // when the session carries an activePracticeId, patient visibility narrows
  // to ONLY that practice. Multi-practice providers must explicitly switch.
  // ────────────────────────────────────────────────────────────────────────
  describe('strict practice-context scoping', () => {
    describe('patientScopeFilter', () => {
      it('multi-practice PROVIDER acting as practiceA sees ONLY practiceA', async () => {
        prisma.practiceProvider.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
          { practiceId: PRACTICE_B },
        ])
        const filter = await service.patientScopeFilter({
          id: PROV_ID,
          roles: [UserRole.PROVIDER],
          activePracticeId: PRACTICE_A,
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_A] } },
          },
        })
      })

      it('multi-practice PROVIDER acting as practiceB sees ONLY practiceB', async () => {
        prisma.practiceProvider.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
          { practiceId: PRACTICE_B },
        ])
        const filter = await service.patientScopeFilter({
          id: PROV_ID,
          roles: [UserRole.PROVIDER],
          activePracticeId: PRACTICE_B,
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_B] } },
          },
        })
      })

      it('multi-practice PROVIDER with null active context sees the union (legacy session)', async () => {
        prisma.practiceProvider.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
          { practiceId: PRACTICE_B },
        ])
        const filter = await service.patientScopeFilter({
          id: PROV_ID,
          roles: [UserRole.PROVIDER],
          activePracticeId: null,
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_A, PRACTICE_B] } },
          },
        })
      })

      it('PROVIDER with a stale active id NOT in memberships narrows to memberships (never widens)', async () => {
        prisma.practiceProvider.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
          { practiceId: PRACTICE_B },
        ])
        const filter = await service.patientScopeFilter({
          id: PROV_ID,
          roles: [UserRole.PROVIDER],
          activePracticeId: 'practice-not-a-member',
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_A, PRACTICE_B] } },
          },
        })
      })

      it('single-practice PROVIDER acting as their only practice is a no-op narrow', async () => {
        prisma.practiceProvider.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
        ])
        const filter = await service.patientScopeFilter({
          id: PROV_ID,
          roles: [UserRole.PROVIDER],
          activePracticeId: PRACTICE_A,
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_A] } },
          },
        })
      })

      it('MED_DIR acting as practiceA sees ONLY practiceA', async () => {
        prisma.practiceMedicalDirector.findMany.mockResolvedValue([
          { practiceId: PRACTICE_A },
          { practiceId: PRACTICE_B },
        ])
        const filter = await service.patientScopeFilter({
          id: MED_ID,
          roles: [UserRole.MEDICAL_DIRECTOR],
          activePracticeId: PRACTICE_A,
        })
        expect(filter).toEqual({
          providerAssignmentAsPatient: {
            is: { practiceId: { in: [PRACTICE_A] } },
          },
        })
      })

      it('SUPER_ADMIN with active context still gets no filter (narrow is a no-op for org-wide)', async () => {
        const filter = await service.patientScopeFilter({
          id: SUPER_ID,
          roles: [UserRole.SUPER_ADMIN],
          activePracticeId: PRACTICE_A,
        })
        expect(filter).toBeUndefined()
      })

      it('HEALPLACE_OPS with active context still gets no filter', async () => {
        const filter = await service.patientScopeFilter({
          id: OPS_ID,
          roles: [UserRole.HEALPLACE_OPS],
          activePracticeId: PRACTICE_A,
        })
        expect(filter).toBeUndefined()
      })
    })

    describe('assertCanAccessPatient', () => {
      it('multi-practice PROVIDER acting as practiceA is DENIED a practiceB patient', async () => {
        prisma.patientProviderAssignment.findUnique.mockResolvedValue({
          practiceId: PRACTICE_B,
          primaryProviderId: 'someone-else',
          backupProviderId: 'someone-else',
        })
        prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
        await expect(
          service.assertCanAccessPatient(
            { id: PROV_ID, roles: [UserRole.PROVIDER], activePracticeId: PRACTICE_A },
            PATIENT_A,
          ),
        ).rejects.toThrow(ForbiddenException)
      })

      it('multi-practice PROVIDER acting as practiceA is ALLOWED a practiceA patient', async () => {
        prisma.patientProviderAssignment.findUnique.mockResolvedValue({
          practiceId: PRACTICE_A,
          primaryProviderId: 'someone-else',
          backupProviderId: 'someone-else',
        })
        prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
        await expect(
          service.assertCanAccessPatient(
            { id: PROV_ID, roles: [UserRole.PROVIDER], activePracticeId: PRACTICE_A },
            PATIENT_A,
          ),
        ).resolves.toBeUndefined()
      })

      it('PROVIDER with null active context falls back to union (legacy session, practiceB patient allowed)', async () => {
        prisma.patientProviderAssignment.findUnique.mockResolvedValue({
          practiceId: PRACTICE_B,
          primaryProviderId: 'someone-else',
          backupProviderId: 'someone-else',
        })
        prisma.practiceProvider.findUnique.mockResolvedValue({ id: 'pp-1' })
        await expect(
          service.assertCanAccessPatient(
            { id: PROV_ID, roles: [UserRole.PROVIDER], activePracticeId: null },
            PATIENT_A,
          ),
        ).resolves.toBeUndefined()
      })

      it('MED_DIR acting as practiceA is DENIED a practiceB patient (even one they head)', async () => {
        prisma.patientProviderAssignment.findUnique.mockResolvedValue({
          practiceId: PRACTICE_B,
          primaryProviderId: 'someone-else',
          backupProviderId: 'someone-else',
        })
        prisma.practiceMedicalDirector.findUnique.mockResolvedValue({ id: 'pmd-1' })
        await expect(
          service.assertCanAccessPatient(
            { id: MED_ID, roles: [UserRole.MEDICAL_DIRECTOR], activePracticeId: PRACTICE_A },
            PATIENT_A,
          ),
        ).rejects.toThrow(ForbiddenException)
      })
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // practiceScopeIds — drives /practices list filter for May 2026 scope.
  // ────────────────────────────────────────────────────────────────────────
  describe('practiceScopeIds', () => {
    it('SUPER_ADMIN returns undefined (no filter)', async () => {
      const ids = await service.practiceScopeIds({
        id: SUPER_ID,
        roles: [UserRole.SUPER_ADMIN],
      })
      expect(ids).toBeUndefined()
      expect(prisma.practiceMedicalDirector.findMany).not.toHaveBeenCalled()
      expect(prisma.practiceProvider.findMany).not.toHaveBeenCalled()
    })

    it('HEALPLACE_OPS returns undefined (no filter)', async () => {
      const ids = await service.practiceScopeIds({
        id: OPS_ID,
        roles: [UserRole.HEALPLACE_OPS],
      })
      expect(ids).toBeUndefined()
    })

    it('MED_DIR returns their PracticeMedicalDirector memberships', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
        { practiceId: PRACTICE_B },
      ])
      prisma.practiceProvider.findMany.mockResolvedValue([])
      const ids = await service.practiceScopeIds({
        id: MED_ID,
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      expect(ids).toEqual(expect.arrayContaining([PRACTICE_A, PRACTICE_B]))
      expect(ids).toHaveLength(2)
    })

    it('PROVIDER returns their PracticeProvider memberships', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
      ])
      const ids = await service.practiceScopeIds({
        id: PROV_ID,
        roles: [UserRole.PROVIDER],
      })
      expect(ids).toEqual([PRACTICE_A])
    })

    it('multi-role MED_DIR + PROVIDER unions both join tables (dedup)', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A },
        { practiceId: PRACTICE_B },
      ])
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: PRACTICE_A }, // overlap with MED_DIR membership
        { practiceId: 'practice-C' },
      ])
      const ids = await service.practiceScopeIds({
        id: 'multi-1',
        roles: [UserRole.MEDICAL_DIRECTOR, UserRole.PROVIDER],
      })
      expect(ids).toEqual(
        expect.arrayContaining([PRACTICE_A, PRACTICE_B, 'practice-C']),
      )
      expect(ids).toHaveLength(3)
    })

    it('MED_DIR with zero memberships returns empty array (sees no practices)', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([])
      prisma.practiceProvider.findMany.mockResolvedValue([])
      const ids = await service.practiceScopeIds({
        id: 'md-newbie',
        roles: [UserRole.MEDICAL_DIRECTOR],
      })
      expect(ids).toEqual([])
    })
  })
})
