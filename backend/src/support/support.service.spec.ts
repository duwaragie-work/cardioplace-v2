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
      update: jest.fn((a: any) => Promise.resolve({ id: 'ticket-1', ...a.data })) as any,
      updateMany: jest.fn(async () => ({ count: 3 })) as any,
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
  // N-2 (2026-07-14 triage) — notifyOpsNewTicket wraps in runAsCronActor,
  // which calls `cls.run(...)`. Minimal fake that just invokes the callback
  // (spec-level attribution is out of scope for these unit tests).
  const cls = {
    run: async (fn: () => Promise<unknown>) => fn(),
    set: jest.fn(),
    get: jest.fn(),
  } as any
  prisma.user.findMany.mockResolvedValue([{ id: 'ops-1' }])
  const svc = new SupportService(
    prisma as any,
    email as any,
    auth as any,
    ticketNumbers as any,
    config,
    cls,
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
      // Also (N-1, 2026-07-14) — the requester receives a support_ticket_received
      // confirmation, backing the "check the link in your confirmation email"
      // promise the intake screens make. Both sends fire concurrently, so we
      // look them up by template rather than by call index.
      const templates = email.sendEmail.mock.calls.map((c: any[]) => c[3]?.template)
      expect(templates).toContain('support_ops_notify')
      expect(templates).toContain('support_ticket_received')
      const opsCall = email.sendEmail.mock.calls.find(
        (c: any[]) => c[3]?.template === 'support_ops_notify',
      )
      expect(opsCall?.[0]).toBe('ops@healplace.com')
      const requesterCall = email.sendEmail.mock.calls.find(
        (c: any[]) => c[3]?.template === 'support_ticket_received',
      )
      expect(requesterCall?.[0]).toBe('p@example.com')
      expect(requesterCall?.[3]).toMatchObject({
        template: 'support_ticket_received',
        patientUserId: 'user-1',
      })
      expect(prisma.notification.createMany).toHaveBeenCalled()
      // Every dashboard row declares its trigger (action → visible in the bell).
      const notifRows = prisma.notification.createMany.mock.calls[0][0].data
      expect(notifRows[0].dispatchTrigger).toBe('SUPPORT_TICKET_CREATED')
    })

    it('locked-out lands unverified + HIGH priority', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(0)
      prisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
      prisma.supportTicket.create.mockImplementation((a: any) =>
        Promise.resolve(ticketRow({ ...a.data })),
      )
      await svc.createLockedOutTicket(
        { email: 'p@example.com', description: 'cant sign in' },
        { email: 'p@example.com', description: 'cant sign in' },
        CTX,
      )
      const created = prisma.supportTicket.create.mock.calls[0][0].data
      expect(created.identityVerified).toBe(false)
      expect(created.priority).toBe('HIGH')
      // L-3 (2026-07-14) — the locked-out form no longer collects a callback
      // phone (the phone-callback implication was dropped in Fix 6/7), so the
      // body is the patient's description verbatim with nothing folded in.
      expect(created.body).toBe('cant sign in')
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

  // ── Support System roadmap Phase 3 — clinical-vs-operational split ────────
  describe('clinical deflect', () => {
    it('refuses a CLINICAL contact ticket with a machine-readable code, no ticket created', async () => {
      const { svc, prisma, email } = make()
      let thrown: any
      await svc
        .createContactTicket(
          { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any },
          { subject: 'chest pain', body: 'my chest hurts', category: 'CLINICAL' as any },
          CTX,
        )
        .catch((e) => {
          thrown = e
        })
      expect(thrown).toBeInstanceOf(HttpException)
      expect(thrown.getStatus()).toBe(422)
      expect(thrown.getResponse()).toMatchObject({ code: 'CLINICAL_DEFLECTED' })
      // The hard rule: it never becomes a ticket and never pings ops.
      expect(prisma.supportTicket.create).not.toHaveBeenCalled()
      expect(email.sendEmail).not.toHaveBeenCalled()
    })
  })

  // ── Phase 2 — lifecycle: ops reply / patient reply / reopen / auto-close ──
  describe('ops reply', () => {
    it('an ops reply moves an OPEN ticket to AWAITING_REPLY and deep-links the bell', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ status: 'OPEN' }))
      await svc.reply(OPS, 'ticket-1', { body: 'we are looking into it' })
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('AWAITING_REPLY')
      const notif = prisma.notification.create.mock.calls[0][0].data
      expect(notif.dispatchTrigger).toBe('SUPPORT_REPLY')
      expect(notif.supportTicketId).toBe('ticket-1')
    })
  })

  describe('patient in-thread reply', () => {
    const PATIENT: SupportActor = { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any }

    it('appends a USER reply, hands the ball back to ops, and pings the queue', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'AWAITING_REPLY', userId: 'user-1' }),
      )
      await svc.replyAsUser(PATIENT, 'ticket-1', { body: 'here is the info' })
      const reply = prisma.supportTicketReply.create.mock.calls[0][0].data
      expect(reply.authorType).toBe('USER')
      expect(reply.authorUserId).toBe('user-1')
      expect(prisma.supportTicket.update.mock.calls[0][0].data.status).toBe('IN_PROGRESS')
      const notif = prisma.notification.createMany.mock.calls[0][0].data
      expect(notif[0].dispatchTrigger).toBe('SUPPORT_USER_REPLIED')
      expect(notif[0].supportTicketId).toBe('ticket-1')
    })

    it("cannot reply to someone else's ticket (NotFound, non-enumeration)", async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'OPEN', userId: 'someone-else' }),
      )
      await expect(
        svc.replyAsUser(PATIENT, 'ticket-1', { body: 'x' }),
      ).rejects.toMatchObject({ status: 404 })
      expect(prisma.supportTicketReply.create).not.toHaveBeenCalled()
    })

    it('cannot in-thread reply to a resolved ticket (must reopen first)', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1' }),
      )
      await expect(
        svc.replyAsUser(PATIENT, 'ticket-1', { body: 'x' }),
      ).rejects.toBeInstanceOf(BadRequestException)
    })
  })

  describe('reopen', () => {
    const PATIENT: SupportActor = { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any }

    it('reopens a recently-resolved ticket, clearing resolved/closed timestamps', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1', resolvedAt: new Date() }),
      )
      await svc.reopen(PATIENT, 'ticket-1')
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('REOPENED')
      expect(upd.reopenedAt).toBeInstanceOf(Date)
      expect(upd.resolvedAt).toBeNull()
      expect(upd.closedAt).toBeNull()
      const notif = prisma.notification.createMany.mock.calls[0][0].data
      expect(notif[0].dispatchTrigger).toBe('SUPPORT_REOPENED')
    })

    it('refuses to reopen outside the reopen window', async () => {
      const { svc, prisma } = make()
      const longAgo = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000)
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'CLOSED', userId: 'user-1', resolvedAt: longAgo, closedAt: longAgo }),
      )
      await expect(svc.reopen(PATIENT, 'ticket-1')).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })

    it('refuses to reopen a still-active ticket', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'IN_PROGRESS', userId: 'user-1' }),
      )
      await expect(svc.reopen(PATIENT, 'ticket-1')).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })
  })

  describe('auto-close sweep', () => {
    it('closes RESOLVED tickets past the inactivity window and returns the count', async () => {
      const { svc, prisma } = make()
      const count = await svc.autoCloseResolvedTickets()
      const call = prisma.supportTicket.updateMany.mock.calls[0][0]
      expect(call.where.status).toBe('RESOLVED')
      expect(call.where.resolvedAt.lt).toBeInstanceOf(Date)
      expect(call.data.status).toBe('CLOSED')
      expect(call.data.closedAt).toBeInstanceOf(Date)
      expect(count).toBe(3)
    })
  })

  // ── Phase 5 — assignment + priority ──────────────────────────────────────
  describe('assignment', () => {
    it('assign-to-me picks up an OPEN ticket (→ IN_PROGRESS) and records ASSIGNED', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ status: 'OPEN' }))
      await svc.assign(OPS, 'ticket-1', {})
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.assignedToOpsId).toBe('ops-1')
      expect(upd.status).toBe('IN_PROGRESS')
      const action = prisma.supportTicketAction.create.mock.calls[0][0].data
      expect(action.actionType).toBe('ASSIGNED')
      expect(action.metadata).toMatchObject({ assignedToOpsId: 'ops-1', self: true })
    })

    it('refuses to hand a ticket to a non-ops user', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ status: 'OPEN' }))
      prisma.user.findUnique.mockResolvedValue({ roles: ['PATIENT'] })
      await expect(
        svc.assign(OPS, 'ticket-1', { assigneeId: 'patient-9' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })
  })

  describe('priority', () => {
    it('changes priority and records PRIORITY_CHANGED with from/to', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ priority: 'HIGH' }))
      await svc.changePriority(OPS, 'ticket-1', { priority: 'LOW' as any })
      expect(prisma.supportTicket.update.mock.calls[0][0].data.priority).toBe('LOW')
      const action = prisma.supportTicketAction.create.mock.calls[0][0].data
      expect(action.actionType).toBe('PRIORITY_CHANGED')
      expect(action.metadata).toMatchObject({ from: 'HIGH', to: 'LOW' })
    })
  })

  // ── Phase 5 — ops queue list: assignee filter + priority ordering ────────
  describe('listTickets', () => {
    const setup = () => {
      const m = make()
      m.prisma.supportTicket.findMany.mockResolvedValue([])
      m.prisma.supportTicket.count.mockResolvedValue(0)
      return m
    }

    it('orders HIGH first, then newest (priority desc, createdAt desc)', async () => {
      const { svc, prisma } = setup()
      await svc.listTickets({})
      expect(prisma.supportTicket.findMany.mock.calls[0][0].orderBy).toEqual([
        { priority: 'desc' },
        { createdAt: 'desc' },
      ])
    })

    it('filters by a specific assignee id', async () => {
      const { svc, prisma } = setup()
      await svc.listTickets({ assignee: 'ops-7' } as any)
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where.assignedToOpsId).toBe('ops-7')
    })

    it("maps assignee='unassigned' to a null assignedToOpsId", async () => {
      const { svc, prisma } = setup()
      await svc.listTickets({ assignee: 'unassigned' } as any)
      expect(prisma.supportTicket.findMany.mock.calls[0][0].where.assignedToOpsId).toBeNull()
    })
  })
})
