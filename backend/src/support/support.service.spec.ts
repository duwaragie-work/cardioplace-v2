import { jest } from '@jest/globals'
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common'
import { SupportService, type SupportActor } from './support.service.js'

const OPS: SupportActor = { id: 'ops-1', email: 'ops@healplace.com', roles: ['HEALPLACE_OPS'] as any }
const CTX = { ipAddress: '1.2.3.4', userAgent: 'jest' }

function make() {
  const prisma = {
    supportTicket: {
      create: jest.fn() as any,
      count: jest.fn() as any,
      findUnique: jest.fn() as any,
      findMany: jest.fn() as any,
      update: jest.fn() as any,
    },
    user: { findUnique: jest.fn() as any, findMany: jest.fn() as any },
    notification: { create: jest.fn() as any, createMany: jest.fn() as any },
    supportTicketReply: { create: jest.fn() as any },
    supportTicketAction: { create: jest.fn((a: any) => Promise.resolve(a.data)) as any },
    mfaRecoveryCode: { count: jest.fn(async () => 0) as any },
    webAuthnCredential: { count: jest.fn(async () => 0) as any },
  }
  const email = { sendEmail: jest.fn(async () => undefined) as any }
  const auth = {
    adminResetMfa: jest.fn(async () => ({ message: 'ok' })) as any,
    adminResetPatientBiometric: jest.fn(async () => ({ message: 'ok' })) as any,
    regenerateRecoveryCodes: jest.fn(async () => ({ recoveryCodes: [] })) as any,
    regeneratePatientRecoveryCodes: jest.fn(async () => ({ recoveryCodes: [] })) as any,
  }
  const ticketNumbers = { next: jest.fn(async () => 'CP-SUP-ABCDEFG') as any }
  const config = { get: (_k: string, d?: string) => d } as any
  prisma.user.findMany.mockResolvedValue([{ id: 'ops-1' }])
  const svc = new SupportService(
    prisma as any,
    email as any,
    auth as any,
    ticketNumbers as any,
    config,
  )
  return { svc, prisma, email, auth }
}

const ticketRow = (over: Record<string, any> = {}) => ({
  id: 'ticket-1',
  ticketNumber: 'CP-SUP-ABCDEFG',
  userId: 'user-1',
  email: 'p@example.com',
  category: 'ACCOUNT',
  priority: 'HIGH',
  subject: 'Locked out',
  body: 'help',
  status: 'OPEN',
  identityVerified: false,
  ...over,
})

describe('SupportService', () => {
  describe('intake', () => {
    it('signed-in contact lands identity-verified and notifies ops', async () => {
      const { svc, prisma, email } = make()
      prisma.supportTicket.create.mockImplementation((a: any) =>
        Promise.resolve(ticketRow({ ...a.data })),
      )
      const res = await svc.createContactTicket(
        { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any },
        { subject: 'Help', body: 'hi', category: 'ACCOUNT' as any },
        CTX,
      )
      expect(res.ticketNumber).toBe('CP-SUP-ABCDEFG')
      const created = prisma.supportTicket.create.mock.calls[0][0].data
      expect(created.identityVerified).toBe(true)
      expect(created.userId).toBe('user-1')
      // Ops notified — email to the inbox + one dashboard row per ops user.
      expect(email.sendEmail.mock.calls[0][0]).toBe('ops@healplace.com')
      expect(prisma.notification.createMany).toHaveBeenCalled()
    })

    it('locked-out lands unverified + HIGH priority', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(0)
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
      prisma.supportTicket.create.mockImplementation((a: any) =>
        Promise.resolve(ticketRow({ ...a.data })),
      )
      await svc.createLockedOutTicket(
        { email: 'p@example.com', description: 'cant sign in', contactPhone: '555' },
        CTX,
      )
      const created = prisma.supportTicket.create.mock.calls[0][0].data
      expect(created.identityVerified).toBe(false)
      expect(created.priority).toBe('HIGH')
      expect(created.body).toContain('555') // callback phone folded in
    })

    it('locked-out is rate-limited to 5/IP/hour (6th → 429)', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(5)
      await expect(
        svc.createLockedOutTicket({ email: 'p@example.com', description: 'x' }, CTX),
      ).rejects.toBeInstanceOf(HttpException)
      expect(prisma.supportTicket.create).not.toHaveBeenCalled()
    })
  })

  describe('identity-verify gate', () => {
    it('blocks MFA reset until the ticket is verified', async () => {
      const { svc, auth, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ identityVerified: false }),
      )
      await expect(svc.actionMfaReset(OPS, 'ticket-1', {}, CTX)).rejects.toBeInstanceOf(
        ForbiddenException,
      )
      expect(auth.adminResetMfa).not.toHaveBeenCalled()
    })

    it('wraps the admin MFA reset once verified + writes an audit action', async () => {
      const { svc, auth, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ identityVerified: true, userId: 'user-1' }),
      )
      await svc.actionMfaReset(OPS, 'ticket-1', { reason: 'phone verified' }, CTX)
      expect(auth.adminResetMfa).toHaveBeenCalledWith(
        'ops-1',
        'user-1',
        'phone verified',
        expect.objectContaining({ ipAddress: '1.2.3.4' }),
      )
      expect(prisma.supportTicketAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'MFA_RESET', opsUserId: 'ops-1' }),
        }),
      )
    })

    it('rejects a reset on a ticket with no linked account', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ identityVerified: true, userId: null }),
      )
      await expect(
        svc.actionWebauthnReset(OPS, 'ticket-1', {}, CTX),
      ).rejects.toBeInstanceOf(BadRequestException)
    })

    it('recovery-codes regen picks the patient WebAuthn variant for patients', async () => {
      const { svc, auth, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ identityVerified: true, userId: 'user-1' }),
      )
      prisma.user.findUnique.mockResolvedValue({ roles: ['PATIENT'] })
      await svc.actionRecoveryCodesRegen(OPS, 'ticket-1', {}, CTX)
      expect(auth.regeneratePatientRecoveryCodes).toHaveBeenCalledWith(
        'user-1',
        expect.any(Object),
      )
      expect(auth.regenerateRecoveryCodes).not.toHaveBeenCalled()
    })
  })

  describe('verify + resolve', () => {
    it('verifyIdentity flips the flag and records IDENTITY_VERIFIED', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow())
      await svc.verifyIdentity(OPS, 'ticket-1', {
        rationale: 'Confirmed DOB + last 4 via reply email',
      })
      expect(prisma.supportTicket.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { identityVerified: true } }),
      )
      expect(prisma.supportTicketAction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ actionType: 'IDENTITY_VERIFIED' }),
        }),
      )
    })

    it('resolve sets RESOLVED + resolvedAt and records the action', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow())
      await svc.resolve(OPS, 'ticket-1', { resolutionNotes: 'done' })
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('RESOLVED')
      expect(upd.resolvedAt).toBeInstanceOf(Date)
    })
  })
})
