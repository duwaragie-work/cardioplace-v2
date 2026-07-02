import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { Test, TestingModule } from '@nestjs/testing'
import { EmailService } from '../email/email.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { AccountLifecycleService } from './account-lifecycle.service.js'
import { UsersService, type Actor } from './users.service.js'

describe('UsersService', () => {
  let service: UsersService
  let prisma: any
  let lifecycle: any

  const superAdmin: Actor = {
    id: 'admin-1',
    email: 'admin@cardioplace.test',
    roles: ['SUPER_ADMIN'] as any,
  }

  const medDir: Actor = {
    id: 'md-1',
    email: 'md@cardioplace.test',
    roles: ['MEDICAL_DIRECTOR'] as any,
  }

  beforeEach(async () => {
    prisma = {
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        count: jest.fn(),
      },
      authLog: { create: jest.fn() },
      practiceMedicalDirector: { findMany: jest.fn() },
      practiceProvider: { findMany: jest.fn() },
      practiceCoordinator: { findUnique: jest.fn() },
      patientProviderAssignment: { findUnique: jest.fn() },
      practice: { findUnique: jest.fn() },
    }
    lifecycle = {
      deactivate: jest.fn(),
      reactivate: jest.fn(),
      permanentClose: jest.fn(),
      revokeAllSessions: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EmailService, useValue: { send: jest.fn() } },
        { provide: AccountLifecycleService, useValue: lifecycle },
      ],
    }).compile()

    service = module.get<UsersService>(UsersService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  // ─── reactivate — admin default restores the pre-deactivation role ─────────
  describe('reactivate', () => {
    beforeEach(() => {
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'provider@cardioplace.test',
        roles: ['PROVIDER'],
        accountStatus: 'DEACTIVATED',
      })
      lifecycle.reactivate.mockResolvedValue({
        id: 'u1',
        email: 'provider@cardioplace.test',
        roles: ['PROVIDER'],
        accountStatus: 'ACTIVE',
      })
    })

    it('defaults restoreRoles to true when the dto omits it (staff role handed back)', async () => {
      await service.reactivate(superAdmin, 'u1', {})
      expect(lifecycle.reactivate).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ restoreRoles: true }),
      )
    })

    it('honours an explicit restoreRoles:false (fresh re-authorization)', async () => {
      await service.reactivate(superAdmin, 'u1', { restoreRoles: false })
      expect(lifecycle.reactivate).toHaveBeenCalledWith(
        'u1',
        expect.objectContaining({ restoreRoles: false }),
      )
    })
  })

  // ─── listUsers — permanently-closed tombstones are hidden by default ───────
  describe('listUsers', () => {
    beforeEach(() => {
      prisma.user.findMany.mockResolvedValue([])
      prisma.user.count.mockResolvedValue(0)
      // Avoid mocking the whole invite chain — the invite bucket is orthogonal
      // to the CLOSED-visibility rule under test.
      jest.spyOn(service as any, 'fetchPendingInvites').mockResolvedValue([])
    })

    it('excludes CLOSED accounts from the default (unfiltered) list', async () => {
      await service.listUsers(superAdmin, {})
      expect(prisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            accountStatus: { not: 'CLOSED' },
          }),
        }),
      )
    })

    it('filters to the requested status verbatim (no CLOSED-exclusion override)', async () => {
      await service.listUsers(superAdmin, { status: 'DEACTIVATED' as any })
      const where = prisma.user.findMany.mock.calls[0][0].where
      expect(where.accountStatus).toBe('DEACTIVATED')
    })

    it('MED_DIR list is scoped to headed practices (in: [...])', async () => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: 'prac-a' },
        { practiceId: 'prac-b' },
      ])
      await service.listUsers(medDir, {})
      const where = prisma.user.findMany.mock.calls[0][0].where
      // The practice scope group is one of the AND groups; find the OR that
      // references providerAssignmentAsPatient with an `in` list.
      const andGroups = where.AND ?? []
      const scoped = JSON.stringify(andGroups)
      expect(scoped).toContain('prac-a')
      expect(scoped).toContain('prac-b')
    })
  })

  // ─── assertCanInvite — MED_DIR practice-scoped branch (2026-07-01) ──────────
  describe('assertCanInvite (MED_DIR)', () => {
    beforeEach(() => {
      prisma.practiceMedicalDirector.findMany.mockResolvedValue([
        { practiceId: 'prac-a' },
      ])
    })

    it('allows inviting a PROVIDER into a practice they head', async () => {
      await expect(
        service.assertCanInvite(medDir, 'PROVIDER' as any, 'prac-a'),
      ).resolves.toBeUndefined()
    })

    it('rejects inviting into a practice they do NOT head', async () => {
      await expect(
        service.assertCanInvite(medDir, 'PROVIDER' as any, 'prac-z'),
      ).rejects.toThrow()
    })

    it('rejects inviting a HEALPLACE_OPS (org-level role)', async () => {
      await expect(
        service.assertCanInvite(medDir, 'HEALPLACE_OPS' as any, 'prac-a'),
      ).rejects.toThrow()
    })

    it('rejects inviting a SUPER_ADMIN', async () => {
      await expect(
        service.assertCanInvite(medDir, 'SUPER_ADMIN' as any, 'prac-a'),
      ).rejects.toThrow()
    })

    it('requires a practiceId', async () => {
      await expect(
        service.assertCanInvite(medDir, 'PROVIDER' as any, null),
      ).rejects.toThrow()
    })
  })

  // ─── assertCanDeactivate — MED_DIR practice-scoped branch (2026-07-01) ──────
  describe('assertCanDeactivate (MED_DIR)', () => {
    beforeEach(() => {
      // The caller (md-1) heads prac-a. The target's MD memberships (queried
      // inside resolveTargetPractices) must be keyed separately, else the
      // shared mock makes every target look like an MD of prac-a.
      prisma.practiceMedicalDirector.findMany.mockImplementation(
        ({ where }: any) =>
          where.userId === medDir.id
            ? Promise.resolve([{ practiceId: 'prac-a' }])
            : Promise.resolve([]),
      )
      prisma.practiceProvider.findMany.mockResolvedValue([])
      prisma.practiceCoordinator.findUnique.mockResolvedValue(null)
      prisma.patientProviderAssignment.findUnique.mockResolvedValue(null)
    })

    it('allows deactivating a provider in a practice they head', async () => {
      // Target prov-9 is a provider in prac-a (overlaps caller's headed set).
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: 'prac-a' },
      ])
      await expect(
        service.assertCanDeactivate(medDir, {
          id: 'prov-9',
          roles: ['PROVIDER'] as any,
        }),
      ).resolves.toBeUndefined()
    })

    it('rejects deactivating a user with no overlapping practice', async () => {
      prisma.practiceProvider.findMany.mockResolvedValue([
        { practiceId: 'prac-z' },
      ])
      await expect(
        service.assertCanDeactivate(medDir, {
          id: 'prov-9',
          roles: ['PROVIDER'] as any,
        }),
      ).rejects.toThrow()
    })

    it('rejects deactivating a SUPER_ADMIN', async () => {
      await expect(
        service.assertCanDeactivate(medDir, {
          id: 'su-1',
          roles: ['SUPER_ADMIN'] as any,
        }),
      ).rejects.toThrow()
    })

    it('rejects deactivating a HEALPLACE_OPS', async () => {
      await expect(
        service.assertCanDeactivate(medDir, {
          id: 'ops-1',
          roles: ['HEALPLACE_OPS'] as any,
        }),
      ).rejects.toThrow()
    })
  })
})
