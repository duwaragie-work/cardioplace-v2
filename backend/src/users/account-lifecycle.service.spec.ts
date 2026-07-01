import { jest } from '@jest/globals'
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common'
import { AccountLifecycleService } from './account-lifecycle.service.js'

// Unit coverage for the phase/28 account-lifecycle mechanics. Prisma / Jwt /
// Email / Config are all mocked — this exercises the state transitions, the
// session kill-switch, the last-Super-Admin guard, and the tombstone scrub.

function makeService() {
  const prisma: any = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({
        id: 'u1',
        email: null,
        roles: [],
        accountStatus: 'DEACTIVATED',
      } as any),
      // Default: another active Super Admin exists, so the guard never blocks
      // unless a test explicitly sets it to 0.
      count: jest.fn().mockResolvedValue(1 as any),
    },
    authSession: { deleteMany: jest.fn().mockResolvedValue({ count: 1 } as any) },
    refreshToken: { deleteMany: jest.fn().mockResolvedValue({ count: 1 } as any) },
    accountClosureLog: { create: jest.fn().mockResolvedValue({} as any) },
    totpCredential: { deleteMany: jest.fn().mockResolvedValue({ count: 0 } as any) },
    mfaRecoveryCode: { deleteMany: jest.fn().mockResolvedValue({ count: 0 } as any) },
    webAuthnCredential: { deleteMany: jest.fn().mockResolvedValue({ count: 0 } as any) },
    displayId: { updateMany: jest.fn().mockResolvedValue({ count: 1 } as any) },
    $transaction: jest.fn((arg: any) =>
      typeof arg === 'function' ? arg(prisma) : Promise.all(arg),
    ),
  }
  const jwt: any = {
    signAsync: jest.fn().mockResolvedValue('tok' as any),
    verifyAsync: jest.fn(),
  }
  const email: any = { sendEmail: jest.fn().mockResolvedValue(undefined as any) }
  const config: any = { get: jest.fn().mockReturnValue('http://localhost:3000') }
  const svc = new AccountLifecycleService(prisma, jwt, email, config)
  return { svc, prisma, jwt, email }
}

const activePatient = {
  id: 'u1',
  email: 'p@test',
  displayId: 'CP1',
  roles: ['PATIENT'],
  accountStatus: 'ACTIVE',
  terminationSnapshot: null,
}

describe('AccountLifecycleService', () => {
  describe('revokeAllSessions', () => {
    it('wipes AuthSession + RefreshToken for the user', async () => {
      const { svc, prisma } = makeService()
      await svc.revokeAllSessions('u1')
      expect(prisma.authSession.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } })
    })
  })

  describe('deactivate', () => {
    it('sets DEACTIVATED, bumps tokenVersion, revokes sessions, audits', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue(activePatient as any)
      await svc.deactivate('u1', { actorId: 'admin', selfService: false })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u1' },
          data: expect.objectContaining({
            accountStatus: 'DEACTIVATED',
            tokenVersion: { increment: 1 },
          }),
        }),
      )
      expect(prisma.authSession.deleteMany).toHaveBeenCalled()
      expect(prisma.refreshToken.deleteMany).toHaveBeenCalled()
      expect(prisma.accountClosureLog.create).toHaveBeenCalled()
    })

    it('throws when already deactivated', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'DEACTIVATED',
      } as any)
      await expect(svc.deactivate('u1', { actorId: 'a' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws when the account is permanently closed', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'CLOSED',
      } as any)
      await expect(svc.deactivate('u1', { actorId: 'a' })).rejects.toThrow(
        BadRequestException,
      )
    })

    it('blocks deactivating the last active Super Admin', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        roles: ['SUPER_ADMIN'],
      } as any)
      prisma.user.count.mockResolvedValue(0 as any)
      await expect(svc.deactivate('u1', { actorId: 'a' })).rejects.toThrow(
        ForbiddenException,
      )
      expect(prisma.user.update).not.toHaveBeenCalled()
    })
  })

  describe('reactivate', () => {
    it('without restoreRoles strips staff roles (keeps only PATIENT)', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'DEACTIVATED',
        roles: ['PROVIDER'],
        terminationSnapshot: { roles: ['PROVIDER'] },
      } as any)
      await svc.reactivate('u1', { actorId: 'a', restoreRoles: false })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ accountStatus: 'ACTIVE', roles: [] }),
        }),
      )
    })

    it('with restoreRoles restores the snapshot roles', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'DEACTIVATED',
        roles: ['PROVIDER'],
        terminationSnapshot: { roles: ['PROVIDER'] },
      } as any)
      await svc.reactivate('u1', { actorId: 'a', restoreRoles: true })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roles: ['PROVIDER'] }),
        }),
      )
    })

    it('keeps PATIENT for a reactivated patient even without restoreRoles', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'DEACTIVATED',
        terminationSnapshot: { roles: ['PATIENT'] },
      } as any)
      await svc.reactivate('u1', { actorId: 'a', restoreRoles: false })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ roles: ['PATIENT'] }),
        }),
      )
    })

    it('refuses to reactivate a CLOSED account', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'CLOSED',
      } as any)
      await expect(svc.reactivate('u1', { actorId: 'a' })).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('permanentClose', () => {
    it('anonymises PII, clears roles, sets CLOSED, bumps version, wipes creds', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue(activePatient as any)
      await svc.permanentClose('u1', { actorId: 'a', reason: 'x' })
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: null,
            name: null,
            dateOfBirth: null,
            roles: [],
            accountStatus: 'CLOSED',
            tokenVersion: { increment: 1 },
          }),
        }),
      )
      expect(prisma.totpCredential.deleteMany).toHaveBeenCalled()
      expect(prisma.webAuthnCredential.deleteMany).toHaveBeenCalled()
      expect(prisma.displayId.updateMany).toHaveBeenCalled()
      expect(prisma.accountClosureLog.create).toHaveBeenCalled()
    })

    it('blocks closing the last active Super Admin', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        roles: ['SUPER_ADMIN'],
      } as any)
      prisma.user.count.mockResolvedValue(0 as any)
      await expect(svc.permanentClose('u1', { actorId: 'a' })).rejects.toThrow(
        ForbiddenException,
      )
    })

    it('throws when the account is already closed', async () => {
      const { svc, prisma } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        ...activePatient,
        accountStatus: 'CLOSED',
      } as any)
      await expect(svc.permanentClose('u1', { actorId: 'a' })).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  describe('self-close token', () => {
    it('requestSelfClose signs a token and emails the patient', async () => {
      const { svc, prisma, jwt, email } = makeService()
      prisma.user.findUnique.mockResolvedValue({
        id: 'u1',
        email: 'p@test',
        name: 'P',
        accountStatus: 'ACTIVE',
      } as any)
      await svc.requestSelfClose('u1')
      expect(jwt.signAsync).toHaveBeenCalled()
      expect(email.sendEmail).toHaveBeenCalledWith(
        'p@test',
        expect.any(String),
        expect.any(String),
      )
    })

    it('verifySelfCloseToken returns the subject for a valid token', async () => {
      const { svc, jwt } = makeService()
      jwt.verifyAsync.mockResolvedValue({
        sub: 'u1',
        purpose: 'account_permanent_close',
      } as any)
      await expect(svc.verifySelfCloseToken('t')).resolves.toBe('u1')
    })

    it('verifySelfCloseToken rejects a token with the wrong purpose', async () => {
      const { svc, jwt } = makeService()
      jwt.verifyAsync.mockResolvedValue({ sub: 'u1', purpose: 'access' } as any)
      await expect(svc.verifySelfCloseToken('t')).rejects.toThrow(
        UnauthorizedException,
      )
    })
  })
})
