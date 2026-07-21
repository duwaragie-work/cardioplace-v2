import { jest } from '@jest/globals'
import { BadRequestException, ForbiddenException, HttpException } from '@nestjs/common'
import {
  SupportService,
  deriveAwaitingParty,
  deriveSupportSla,
  type SupportActor,
} from './support.service.js'

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
    notification: {
      create: jest.fn() as any,
      createMany: jest.fn() as any,
      // Nudge idempotency probe — default "no prior nudge".
      findFirst: jest.fn(async () => null) as any,
    },
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

    // Public general contact — the signed-out hub's non-PHI "send us a message".
    it('public contact creates a real trackable ticket, forced to OTHER', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(0)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.supportTicket.create.mockImplementation((a: any) =>
        Promise.resolve(ticketRow({ ...a.data })),
      )
      const res = await svc.createPublicContactTicket(
        { email: 'someone@example.com', subject: 'Question', message: 'hello' },
        CTX,
      )
      // A real ticket number — the whole point vs the old email-only endpoint.
      expect(res.ticketNumber).toBe('CP-SUP-ABCDEFG')
      const created = prisma.supportTicket.create.mock.calls[0][0].data
      // Category is forced server-side so a public visitor can never file CLINICAL.
      expect(created.category).toBe('OTHER')
      expect(created.identityVerified).toBe(false)
      expect(created.email).toBe('someone@example.com')
    })

    it('the anonymous per-IP cap counts ONLY anonymous tickets', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(0)
      prisma.user.findUnique.mockResolvedValue(null)
      prisma.supportTicket.create.mockImplementation((a: any) =>
        Promise.resolve(ticketRow({ ...a.data })),
      )
      await svc.createLockedOutTicket({ email: 'p@example.com', description: 'x' }, CTX)
      // Authenticated intake has its own per-user cap. If it also counted here,
      // signed-in patients behind a shared NAT (clinic / household / shelter —
      // realistic for the Ward 7/8 cohort) could exhaust the anonymous budget
      // and lock out someone who genuinely cannot sign in.
      const where = prisma.supportTicket.count.mock.calls[0][0].where
      expect(where.identityVerified).toBe(false)
      expect(where.ipAddress).toBe('1.2.3.4')
    })

    it('public contact is rate-limited per IP like locked-out', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.count.mockResolvedValue(5)
      await expect(
        svc.createPublicContactTicket(
          { email: 'p@example.com', subject: 's', message: 'm' },
          CTX,
        ),
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
    it('an ops reply moves an OPEN ticket to IN_PROGRESS and deep-links the bell', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ status: 'OPEN' }))
      await svc.reply(OPS, 'ticket-1', { body: 'we are looking into it' })
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('IN_PROGRESS')
      const notif = prisma.notification.create.mock.calls[0][0].data
      expect(notif.dispatchTrigger).toBe('SUPPORT_REPLY')
      expect(notif.supportTicketId).toBe('ticket-1')
    })

    it('never un-resolves a RESOLVED ticket when ops replies on the thread', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(ticketRow({ status: 'RESOLVED' }))
      await svc.reply(OPS, 'ticket-1', { body: 'one more thing' })
      // The reply row is written, but no status update is issued.
      expect(prisma.supportTicketReply.create).toHaveBeenCalled()
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })
  })

  describe('patient in-thread reply', () => {
    const PATIENT: SupportActor = { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any }

    it('appends a USER reply, hands the ball back to ops, and pings the queue', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'IN_PROGRESS', userId: 'user-1' }),
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

    it('reopens a recently-resolved ticket back to IN_PROGRESS (no REOPENED state)', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1', resolvedAt: new Date() }),
      )
      await svc.reopen(PATIENT, 'ticket-1')
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('IN_PROGRESS')
      // reopenedAt is what records the event now that no status does.
      expect(upd.reopenedAt).toBeInstanceOf(Date)
      expect(upd.resolvedAt).toBeNull()
      const notif = prisma.notification.createMany.mock.calls[0][0].data
      expect(notif[0].dispatchTrigger).toBe('SUPPORT_REOPENED')
    })

    it('reopens right up to the 7-day boundary', async () => {
      const { svc, prisma } = make()
      const justInside = new Date(Date.now() - 6.9 * 24 * 60 * 60 * 1000)
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1', resolvedAt: justInside }),
      )
      await svc.reopen(PATIENT, 'ticket-1')
      expect(prisma.supportTicket.update.mock.calls[0][0].data.status).toBe('IN_PROGRESS')
    })

    it('refuses to reopen once the 7-day window has lapsed', async () => {
      const { svc, prisma } = make()
      const tooOld = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1', resolvedAt: tooOld }),
      )
      await expect(svc.reopen(PATIENT, 'ticket-1')).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })

    it('refuses to reopen a CLOSED ticket — CLOSED is terminal', async () => {
      const { svc, prisma } = make()
      // Auto-close (14d) always lands after the reopen window (7d) has lapsed,
      // so a CLOSED ticket must never be resurrectable.
      const closedAt = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'CLOSED', userId: 'user-1', resolvedAt: closedAt, closedAt }),
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

  // "Closed ... or on user confirm" — the patient-driven half of reaching CLOSED.
  describe('user-confirmed close', () => {
    const PATIENT: SupportActor = { id: 'user-1', email: 'p@example.com', roles: ['PATIENT'] as any }

    it('closes a resolved ticket on the owner’s confirmation', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'user-1', resolvedAt: new Date() }),
      )
      await svc.closeByUser(PATIENT, 'ticket-1')
      const upd = prisma.supportTicket.update.mock.calls[0][0].data
      expect(upd.status).toBe('CLOSED')
      expect(upd.closedAt).toBeInstanceOf(Date)
    })

    it('refuses to close a still-active ticket', async () => {
      const { svc, prisma } = make()
      // Closing an ACTIVE ticket would strand ops mid-conversation — that is a
      // different action from confirming a resolution, so it is refused.
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'IN_PROGRESS', userId: 'user-1' }),
      )
      await expect(svc.closeByUser(PATIENT, 'ticket-1')).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })

    it("cannot close someone else's ticket (NotFound, non-enumeration)", async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findUnique.mockResolvedValue(
        ticketRow({ status: 'RESOLVED', userId: 'someone-else' }),
      )
      await expect(svc.closeByUser(PATIENT, 'ticket-1')).rejects.toMatchObject({
        status: 404,
      })
      expect(prisma.supportTicket.update).not.toHaveBeenCalled()
    })
  })

  // "Waiting on the patient" nudge — ops replied, the thread went quiet.
  describe('awaiting-patient nudge sweep', () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000)
    const candidate = (over: Record<string, any> = {}) => ({
      id: 'ticket-1',
      ticketNumber: 'CP-SUP-ABCDEFG',
      category: 'ACCOUNT',
      email: 'p@example.com',
      userId: 'user-1',
      replies: [{ authorType: 'OPS', sentAt: daysAgo(5) }],
      ...over,
    })

    it('nudges when ops replied last and the thread has gone quiet', async () => {
      const { svc, prisma, email } = make()
      prisma.supportTicket.findMany.mockResolvedValue([candidate()])
      prisma.notification.findFirst.mockResolvedValue(null)
      const count = await svc.nudgeAwaitingPatientTickets()
      expect(count).toBe(1)
      const notif = prisma.notification.create.mock.calls[0][0].data
      expect(notif.dispatchTrigger).toBe('SUPPORT_AWAITING_REPLY')
      expect(notif.supportTicketId).toBe('ticket-1')
      // Email too — a silent patient isn't opening the app.
      const templates = email.sendEmail.mock.calls.map((c: any[]) => c[3]?.template)
      expect(templates).toContain('support_awaiting_reply')
    })

    it('never nudges when the PATIENT replied last (the ball is with ops)', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findMany.mockResolvedValue([
        candidate({ replies: [{ authorType: 'USER', sentAt: daysAgo(9) }] }),
      ])
      const count = await svc.nudgeAwaitingPatientTickets()
      expect(count).toBe(0)
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('only considers active, account-linked tickets that have a reply', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findMany.mockResolvedValue([])
      await svc.nudgeAwaitingPatientTickets()
      const where = prisma.supportTicket.findMany.mock.calls[0][0].where
      // Resolved/closed threads are nobody's turn.
      expect(where.status).toEqual({ in: ['OPEN', 'IN_PROGRESS'] })
      // A locked-out ticket can have no linked account — we will not email an
      // unverified address on a schedule.
      expect(where.userId).toEqual({ not: null })
      // Nothing to be "waiting" on if ops never replied.
      expect(where.replies).toEqual({ some: {} })
    })

    it('skips a ticket whose thread has no replies at all', async () => {
      const { svc, prisma } = make()
      // Defensive: even if the query filter regressed, an empty thread must
      // never produce a nudge (there is no ops reply to be waiting on).
      prisma.supportTicket.findMany.mockResolvedValue([candidate({ replies: [] })])
      const count = await svc.nudgeAwaitingPatientTickets()
      expect(count).toBe(0)
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('nudges in-app even when the ticket has no email on file', async () => {
      const { svc, prisma, email } = make()
      prisma.supportTicket.findMany.mockResolvedValue([candidate({ email: '' })])
      prisma.notification.findFirst.mockResolvedValue(null)
      const count = await svc.nudgeAwaitingPatientTickets()
      // The in-app notification still lands; only the email is skipped.
      expect(count).toBe(1)
      expect(prisma.notification.create).toHaveBeenCalled()
      expect(email.sendEmail).not.toHaveBeenCalled()
    })

    it('respects the injectable `now` so the sweep is drivable in tests', async () => {
      const { svc, prisma } = make()
      // Reply 5 days ago, but evaluate as if it were only 1 day later — the
      // silence window has not elapsed from that vantage point.
      prisma.supportTicket.findMany.mockResolvedValue([candidate()])
      const asOf = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000)
      const count = await svc.nudgeAwaitingPatientTickets(asOf)
      expect(count).toBe(0)
    })

    it('waits out the silence window before nudging', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findMany.mockResolvedValue([
        candidate({ replies: [{ authorType: 'OPS', sentAt: daysAgo(1) }] }),
      ])
      const count = await svc.nudgeAwaitingPatientTickets()
      expect(count).toBe(0)
    })

    it('does not re-nudge the same silence (idempotent per last reply)', async () => {
      const { svc, prisma } = make()
      // Capture the timestamp ONCE — asserting against a second daysAgo(5) call
      // compares two Dates milliseconds apart and fails spuriously.
      const lastReplyAt = daysAgo(5)
      prisma.supportTicket.findMany.mockResolvedValue([
        candidate({ replies: [{ authorType: 'OPS', sentAt: lastReplyAt }] }),
      ])
      // A nudge already exists that was sent AFTER the last reply.
      prisma.notification.findFirst.mockResolvedValue({ id: 'notif-1' })
      const count = await svc.nudgeAwaitingPatientTickets()
      expect(count).toBe(0)
      expect(prisma.notification.create).not.toHaveBeenCalled()
      // The dedupe must be anchored on the last reply, not a fixed window —
      // otherwise a later ops reply could never earn a fresh nudge.
      const where = prisma.notification.findFirst.mock.calls[0][0].where
      expect(where.supportTicketId).toBe('ticket-1')
      expect(where.sentAt.gt).toBe(lastReplyAt)
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

  // ── First-response SLA — derived from reply history, never stored ────────
  describe('deriveSupportSla', () => {
    const createdAt = new Date('2026-07-01T00:00:00Z')
    const after = (mins: number) => new Date(createdAt.getTime() + mins * 60_000)

    it('measures first response from createdAt to the first OPS reply', () => {
      const sla = deriveSupportSla({
        createdAt,
        priority: 'NORMAL' as any,
        firstOpsReplyAt: after(90),
      })
      expect(sla.firstResponseMinutes).toBe(90)
      expect(sla.targetMinutes).toBe(24 * 60)
      expect(sla.breached).toBe(false)
    })

    it('flags a first response that came in later than the target', () => {
      // HIGH = 4h target; answered at 5h.
      const sla = deriveSupportSla({
        createdAt,
        priority: 'HIGH' as any,
        firstOpsReplyAt: after(5 * 60),
      })
      expect(sla.breached).toBe(true)
      expect(sla.firstResponseMinutes).toBe(5 * 60)
    })

    it('flags an UNANSWERED ticket once its target has elapsed', () => {
      // The case that is easy to miss: checking only "was the reply late" lets a
      // completely ignored ticket look compliant forever — and that is exactly
      // the ticket most worth surfacing.
      const sla = deriveSupportSla({
        createdAt,
        priority: 'HIGH' as any,
        firstOpsReplyAt: null,
        now: after(5 * 60),
      })
      expect(sla.firstResponseMinutes).toBeNull()
      expect(sla.breached).toBe(true)
    })

    it('does not flag an unanswered ticket that is still inside its window', () => {
      const sla = deriveSupportSla({
        createdAt,
        priority: 'HIGH' as any,
        firstOpsReplyAt: null,
        now: after(60),
      })
      expect(sla.breached).toBe(false)
    })

    it('uses a longer target for LOW than for HIGH', () => {
      const high = deriveSupportSla({ createdAt, priority: 'HIGH' as any, firstOpsReplyAt: null, now: createdAt })
      const low = deriveSupportSla({ createdAt, priority: 'LOW' as any, firstOpsReplyAt: null, now: createdAt })
      expect(low.targetMinutes).toBeGreaterThan(high.targetMinutes)
    })
  })

  // ── Derived "whose turn is it" — the replacement for a stored AWAITING_REPLY ──
  describe('deriveAwaitingParty', () => {
    it('maps the last reply author to who is being waited on', () => {
      // Ops spoke last → the patient owes a response.
      expect(deriveAwaitingParty('OPS')).toBe('PATIENT')
      // Patient spoke last → an agent needs to pick it up.
      expect(deriveAwaitingParty('USER')).toBe('OPS')
    })

    it('is null when the thread has no replies yet', () => {
      expect(deriveAwaitingParty(null)).toBeNull()
      expect(deriveAwaitingParty(undefined)).toBeNull()
    })
  })

  describe('awaitingParty on the list endpoints', () => {
    it('listMyTickets derives it from the last reply in the thread', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findMany.mockResolvedValue([
        {
          id: 't1',
          status: 'IN_PROGRESS',
          replies: [
            { authorType: 'USER', body: 'a', sentAt: new Date() },
            { authorType: 'OPS', body: 'b', sentAt: new Date() },
          ],
        },
      ])
      const { data } = await svc.listMyTickets(OPS)
      // OPS replied last → the patient's turn.
      expect(data[0].awaitingParty).toBe('PATIENT')
    })

    it('listMyTickets reports null once the ticket is no longer active', async () => {
      const { svc, prisma } = make()
      prisma.supportTicket.findMany.mockResolvedValue([
        { id: 't1', status: 'RESOLVED', replies: [{ authorType: 'OPS', body: 'b', sentAt: new Date() }] },
        { id: 't2', status: 'CLOSED', replies: [{ authorType: 'USER', body: 'c', sentAt: new Date() }] },
      ])
      const { data } = await svc.listMyTickets(OPS)
      expect(data[0].awaitingParty).toBeNull()
      expect(data[1].awaitingParty).toBeNull()
    })

    it('listTickets derives BOTH awaitingParty and SLA from one reply fetch', async () => {
      const { svc, prisma } = make()
      const createdAt = new Date('2026-07-01T00:00:00Z')
      prisma.supportTicket.findMany.mockResolvedValue([
        {
          id: 't1',
          status: 'IN_PROGRESS',
          priority: 'NORMAL',
          createdAt,
          replies: [
            // Earliest OPS reply drives the SLA...
            { authorType: 'OPS', sentAt: new Date(createdAt.getTime() + 30 * 60_000) },
            // ...while the LAST reply drives awaitingParty.
            { authorType: 'USER', sentAt: new Date(createdAt.getTime() + 60 * 60_000) },
          ],
        },
      ])
      prisma.supportTicket.count.mockResolvedValue(1)
      const { data } = await svc.listTickets({})
      expect(data[0].awaitingParty).toBe('OPS')
      expect(data[0].sla.firstResponseMinutes).toBe(30)
      expect(data[0].sla.breached).toBe(false)
      // The raw thread must not leak into the queue payload.
      expect('replies' in data[0]).toBe(false)
      // Prisma can't select one relation twice with different args, so this is
      // deliberately the whole thread ascending — but only two scalar columns.
      const sel = prisma.supportTicket.findMany.mock.calls[0][0].select
      expect(sel.replies).toMatchObject({ orderBy: { sentAt: 'asc' } })
      expect(Object.keys(sel.replies.select).sort()).toEqual(['authorType', 'sentAt'])
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
