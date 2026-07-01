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
  })
})
