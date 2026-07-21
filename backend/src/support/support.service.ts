import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import type { Prisma } from '../generated/prisma/client.js'
import {
  NotificationChannel,
  SupportActionType,
  SupportCategory,
  SupportContactPref,
  UserRole,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmailService } from '../email/email.service.js'
import {
  EMAIL_TEMPLATE_VERSION,
  supportOpsNotifyHtml,
  supportReplyEmailHtml,
  supportResolvedEmailHtml,
  supportTicketReceivedEmailHtml,
} from '../email/email-templates.js'
import { AuthService, type SessionContext } from '../auth/auth.service.js'
import { TicketNumberService } from './ticket-number.service.js'
import type {
  ActionDto,
  AssignDto,
  ContactDto,
  LockedOutDto,
  PriorityDto,
  ReplyDto,
  ResolveDto,
  VerifyIdentityDto,
} from './dto/support-request.dto.js'
import type { ListTicketsQuery } from './dto/list-tickets.query.js'

export interface SupportActor {
  id: string
  email: string | null
  roles: UserRole[]
}
export interface SupportContext {
  ipAddress?: string
  userAgent?: string
}

const OPS_INBOX = 'ops@healplace.com'
/**
 * Machine-readable signal returned (HTTP 422) when a patient files a CLINICAL
 * ticket. The frontend keys on this to render Manisha's approved care-team
 * redirect + 911 carve-out copy — the server does NOT author clinical wording,
 * only the neutral fallback below. The single most important healthcare rule of
 * this system: a medical question must never sit silently in an ops queue.
 * See continue-support-system roadmap Phase 3 (clinical vs operational split).
 */
export const CLINICAL_DEFLECTED_CODE = 'CLINICAL_DEFLECTED'

/** Who the ticket is waiting on. Derived, never stored — see SupportStatus. */
export type AwaitingParty = 'PATIENT' | 'OPS' | null

/**
 * Whose turn is it? Derived from the last reply's author instead of a stored
 * AWAITING_REPLY state (Duwaragie, 2026-07-21): the stored copy was functionally
 * identical to this and could drift from the thread it claimed to describe.
 *
 *   last reply by OPS  → waiting on the PATIENT ("your turn" badge)
 *   last reply by USER → waiting on OPS (needs an agent)
 *   no replies yet     → null (a brand-new ticket is nobody's "turn" yet)
 *
 * Only meaningful while the ticket is active; a RESOLVED/CLOSED ticket is not
 * waiting on anyone, so callers pass null for those.
 */
export function deriveAwaitingParty(
  lastReplyAuthorType: 'USER' | 'OPS' | null | undefined,
): AwaitingParty {
  if (lastReplyAuthorType === 'OPS') return 'PATIENT'
  if (lastReplyAuthorType === 'USER') return 'OPS'
  return null
}
const LOCKED_OUT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const LOCKED_OUT_MAX = 5 // per IP per hour
const CONTACT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const CONTACT_MAX = 3 // authenticated tickets per user per 5-minute window
// A patient can reopen a RESOLVED ticket within this window (anchored on
// resolvedAt); past it they raise a fresh request rather than resurrecting an
// old thread. Deliberately SHORTER than the auto-close delay, so the reopen
// window has already lapsed by the time a ticket reaches CLOSED — that keeps
// CLOSED genuinely terminal instead of "closed but still reopenable".
const REOPEN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
// The auto-close sweep moves a RESOLVED ticket to CLOSED after this much
// inactivity (measured from resolvedAt).
const AUTO_CLOSE_AFTER_MS = 14 * 24 * 60 * 60 * 1000 // 14 days

/**
 * Support System Phase 1. Two intake paths (signed-in contact + public
 * locked-out), the ops triage surface, and the privileged reset actions that
 * WRAP the existing admin reset endpoints behind a manual identity-verify gate.
 */
@Injectable()
export class SupportService {
  private readonly adminBaseUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly auth: AuthService,
    private readonly ticketNumbers: TicketNumberService,
    config: ConfigService,
    private readonly cls: ClsService,
  ) {
    // Deep-link ops into the admin ticket detail from notification emails
    // (notify-and-link — the email itself carries no requester PHI).
    this.adminBaseUrl = config
      .get<string>('ADMIN_BASE_URL', 'http://localhost:3001')
      .replace(/\/+$/, '')
  }

  // ── Intake ─────────────────────────────────────────────────────────────
  async createContactTicket(
    actor: SupportActor,
    dto: ContactDto,
    ctx: SupportContext,
  ): Promise<{ ticketNumber: string }> {
    // Clinical-vs-operational split — the hard healthcare rule. A CLINICAL
    // question must NOT enter the administrative ops queue (support agents are
    // not clinicians and there is no clinical SLA on this channel). Deflect at
    // the API with a machine-readable code so the client renders the care-team
    // redirect + emergency guidance; defense-in-depth behind the UI category
    // picker. No ticket is created.
    if (dto.category === SupportCategory.CLINICAL) {
      throw new HttpException(
        {
          code: CLINICAL_DEFLECTED_CODE,
          message:
            'Support requests are for account and technical help. For anything about your health, symptoms, or medications, please contact your care team.',
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      )
    }
    // Phone contact is not yet available (no call-center / HIPAA phone-ID
    // verification infrastructure) — reject at the API even if the UI guard is
    // bypassed (Fix 6, defense in depth).
    if (dto.contactPreference === SupportContactPref.PHONE) {
      throw new BadRequestException(
        'Phone contact is not yet available. Please choose email.',
      )
    }
    // Rate-limit — 3 tickets per user per 5 minutes (mirrors the locked-out IP
    // guard) so a stuck/looping client can't flood the ops queue (Fix 4).
    const recent = await this.prisma.supportTicket.count({
      where: {
        userId: actor.id,
        createdAt: { gt: new Date(Date.now() - CONTACT_WINDOW_MS) },
      },
    })
    if (recent >= CONTACT_MAX) {
      throw new HttpException(
        'You have submitted several requests recently. Please wait a few minutes before sending another.',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    const ticketNumber = await this.ticketNumbers.next()
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: actor.id,
        email: actor.email ?? '',
        category: dto.category,
        subject: dto.subject,
        body: dto.alertId ? `${dto.body}\n\n[alert: ${dto.alertId}]` : dto.body,
        contactPreference: dto.contactPreference ?? null,
        identityVerified: true, // already authenticated
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })
    // N-1 (Duwaragie 2026-07-14 triage) — fire both notifications concurrently.
    // Ops routing and submitter confirmation are independent; awaiting one
    // before the other would delay the response for no gain. Both are
    // fire-and-forget at the email layer (EmailService never throws).
    await Promise.all([
      this.notifyOpsNewTicket(ticket),
      this.notifyRequesterTicketReceived(ticket),
    ])
    return { ticketNumber: ticket.ticketNumber }
  }

  async createLockedOutTicket(
    dto: LockedOutDto,
    ctx: SupportContext,
  ): Promise<{ ticketNumber: string }> {
    // Rate-limit — 5 tickets per IP per hour (DB-backed, mirrors the OTP guard).
    if (ctx.ipAddress) {
      const recent = await this.prisma.supportTicket.count({
        where: {
          ipAddress: ctx.ipAddress,
          createdAt: { gt: new Date(Date.now() - LOCKED_OUT_WINDOW_MS) },
        },
      })
      if (recent >= LOCKED_OUT_MAX) {
        throw new HttpException(
          'Too many requests. Please try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        )
      }
    }
    // Best-effort match to an account — but NEVER reveal whether it matched
    // (identity is verified out-of-band by ops before any action).
    const matched = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    })
    const ticketNumber = await this.ticketNumbers.next()
    // L-3 — no callback phone is collected on the locked-out form anymore.
    const body = dto.description
    const ticket = await this.prisma.supportTicket.create({
      data: {
        ticketNumber,
        userId: matched?.id ?? null,
        email: dto.email,
        category: 'ACCOUNT',
        subject: 'Locked out — cannot sign in',
        body,
        priority: 'HIGH',
        identityVerified: false, // ops must verify by phone before any action
        ipAddress: ctx.ipAddress ?? null,
        userAgent: ctx.userAgent ?? null,
      },
    })
    // N-1 — same concurrent dispatch as createContactTicket. The locked-out
    // flow shows "check the link in your confirmation email" copy directly
    // on the success screen (frontend/src/i18n/en.ts:996), so a missing
    // requester email is user-visibly wrong. Ops still gets its routing
    // notification alongside.
    await Promise.all([
      this.notifyOpsNewTicket(ticket),
      this.notifyRequesterTicketReceived(ticket),
    ])
    return { ticketNumber: ticket.ticketNumber }
  }

  // ── Requester self-service ─────────────────────────────────────────────
  /** The signed-in user's own tickets + reply threads, newest first (Fix 9).
   *  Scoped to `userId` so a user only ever sees their own requests. */
  async listMyTickets(actor: SupportActor) {
    const data = await this.prisma.supportTicket.findMany({
      where: { userId: actor.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ticketNumber: true,
        category: true,
        subject: true,
        body: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        reopenedAt: true,
        closedAt: true,
        replies: {
          orderBy: { sentAt: 'asc' },
          select: { authorType: true, body: true, sentAt: true },
        },
      },
    })
    // Attach the derived "whose turn is it" hint so the UI can badge a thread
    // without a stored AWAITING_REPLY state. Only meaningful while active —
    // a resolved/closed ticket is waiting on nobody.
    return {
      data: data.map((t) => ({
        ...t,
        awaitingParty:
          t.status === 'OPEN' || t.status === 'IN_PROGRESS'
            ? deriveAwaitingParty(t.replies.at(-1)?.authorType)
            : null,
      })),
    }
  }

  // ── Ops queue + detail ─────────────────────────────────────────────────
  async listTickets(query: ListTicketsQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    const where: Prisma.SupportTicketWhereInput = {}
    if (query.status) where.status = query.status
    if (query.category) where.category = query.category
    if (query.priority) where.priority = query.priority
    if (query.assignee) {
      where.assignedToOpsId =
        query.assignee === 'unassigned' ? null : query.assignee
    }
    if (query.search) {
      const term = query.search.trim()
      const idTerm = term.replace(/[\s-]/g, '').toUpperCase()
      where.OR = [
        { ticketNumber: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { subject: { contains: term, mode: 'insensitive' } },
        { user: { is: { displayId: { contains: idTerm } } } },
      ]
    }

    const [rows, total] = await Promise.all([
      this.prisma.supportTicket.findMany({
        where,
        skip,
        take: limit,
        // HIGH first (enum order LOW<NORMAL<HIGH, so desc = HIGH→LOW), then
        // newest within a priority band. S5 — priority-ordered ops queue.
        orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          ticketNumber: true,
          email: true,
          category: true,
          subject: true,
          status: true,
          priority: true,
          identityVerified: true,
          assignedToOpsId: true,
          createdAt: true,
          updatedAt: true,
          resolvedAt: true,
          user: { select: { name: true, displayId: true } },
          // Just the last reply's author — enough to derive whose turn it is
          // without pulling whole threads into the queue list.
          replies: {
            take: 1,
            orderBy: { sentAt: 'desc' },
            select: { authorType: true },
          },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ])
    // Swap the one-row `replies` probe for the derived hint so the ops queue can
    // show "needs an agent" vs "waiting on patient" without a stored state.
    const data = rows.map(({ replies, ...t }) => ({
      ...t,
      awaitingParty:
        t.status === 'OPEN' || t.status === 'IN_PROGRESS'
          ? deriveAwaitingParty(replies[0]?.authorType)
          : null,
    }))
    return { data, total, page, limit }
  }

  async getTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            displayId: true,
            email: true,
            accountStatus: true,
            roles: true,
            totpCredential: { select: { enrolledAt: true } },
          },
        },
        replies: { orderBy: { sentAt: 'asc' } },
        actions: { orderBy: { performedAt: 'asc' } },
      },
    })
    if (!ticket) throw new NotFoundException('Support ticket not found')

    // Minimum Necessary — the ops-facing account snapshot only (never clinical
    // data). Recovery-codes-remaining drives the "regenerate" affordance.
    let recoveryCodesRemaining = 0
    let mfaEnrolled = false
    let webAuthnCount = 0
    if (ticket.user) {
      mfaEnrolled = ticket.user.totpCredential?.enrolledAt != null
      recoveryCodesRemaining = await this.prisma.mfaRecoveryCode.count({
        where: { userId: ticket.user.id, usedAt: null },
      })
      webAuthnCount = await this.prisma.webAuthnCredential.count({
        where: { userId: ticket.user.id },
      })
    }

    const { user, totpCredential, ...rest } = ticket as typeof ticket & {
      totpCredential?: unknown
    }
    return {
      ...rest,
      user: ticket.user
        ? {
            id: ticket.user.id,
            name: ticket.user.name,
            displayId: ticket.user.displayId,
            email: ticket.user.email,
            accountStatus: ticket.user.accountStatus,
            roles: ticket.user.roles,
            mfaEnrolled,
            recoveryCodesRemaining,
            webAuthnCount,
          }
        : null,
    }
  }

  // ── Ops actions ────────────────────────────────────────────────────────
  async reply(actor: SupportActor, ticketId: string, dto: ReplyDto) {
    const ticket = await this.requireTicket(ticketId)
    const reply = await this.prisma.supportTicketReply.create({
      data: {
        ticketId: ticket.id,
        authorType: 'OPS',
        authorUserId: actor.id,
        body: dto.body,
      },
    })
    // An ops reply moves an untouched ticket into the active lane. It does NOT
    // get its own "awaiting reply" state — whose turn it is is derived from the
    // last reply's authorType (deriveAwaitingParty). Never downgrade a
    // RESOLVED/CLOSED ticket: ops can reply on a resolved thread without
    // silently un-resolving it.
    if (ticket.status === 'OPEN') {
      await this.prisma.supportTicket.update({
        where: { id: ticket.id },
        data: { status: 'IN_PROGRESS' },
      })
    }
    // Email the user + in-app bell (if they have an account). Fire-and-forget —
    // EmailService blocks on its transport and never throws (see its docstring),
    // so the reply must not await mail delivery.
    void this.email.sendEmail(
      ticket.email,
      `Re: your Cardioplace support request ${ticket.ticketNumber}`,
      supportReplyEmailHtml(ticket.ticketNumber, dto.body),
      {
        template: 'support_reply',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: ticket.userId ?? null,
        metadata: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          category: ticket.category,
          priority: ticket.priority,
        },
      },
    )
    if (ticket.userId) {
      await this.prisma.notification.create({
        data: {
          userId: ticket.userId,
          channel: NotificationChannel.DASHBOARD,
          title: 'Support replied to your request',
          body: `Ticket ${ticket.ticketNumber}`,
          dispatchTrigger: 'SUPPORT_REPLY',
          supportTicketId: ticket.id,
        },
      })
    }
    return reply
  }

  // ── Requester in-thread actions ────────────────────────────────────────
  /**
   * In-thread patient reply. The patient adds a message to their own active
   * ticket, moving the ball back to ops (→ IN_PROGRESS) and pinging the ops
   * queue. A resolved/closed ticket must be reopened first — the reply composer
   * is hidden in that state, and the server rejects it as defense-in-depth.
   */
  async replyAsUser(actor: SupportActor, ticketId: string, dto: ReplyDto) {
    const ticket = await this.requireOwnedTicket(actor, ticketId)
    if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
      throw new BadRequestException(
        'This request is resolved. Reopen it to add a reply.',
      )
    }
    const reply = await this.prisma.supportTicketReply.create({
      data: {
        ticketId: ticket.id,
        authorType: 'USER',
        authorUserId: actor.id,
        body: dto.body,
      },
    })
    // Keep the ticket in the active lane. The reply itself is what signals the
    // ball is back with ops — deriveAwaitingParty reads the last authorType.
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'IN_PROGRESS' },
    })
    await this.notifyOpsTicketActivity(ticket, 'SUPPORT_USER_REPLIED')
    return reply
  }

  /**
   * Patient reopens a RESOLVED ticket within the reopen window, returning it to
   * IN_PROGRESS. There is no distinct REOPENED state — `reopenedAt` is what
   * records that it happened, and it stays set for the ops timeline.
   *
   * CLOSED is deliberately NOT reopenable: the reopen window (7d) lapses before
   * the auto-close delay (14d), so by the time a ticket is CLOSED the window is
   * already gone. Past that point the patient raises a fresh request.
   */
  async reopen(actor: SupportActor, ticketId: string) {
    const ticket = await this.requireOwnedTicket(actor, ticketId)
    if (ticket.status !== 'RESOLVED') {
      throw new BadRequestException(
        'Only a resolved request can be reopened.',
      )
    }
    if (
      !ticket.resolvedAt ||
      ticket.resolvedAt.getTime() < Date.now() - REOPEN_WINDOW_MS
    ) {
      throw new BadRequestException(
        'This request can no longer be reopened. Please raise a new request.',
      )
    }
    const updated = await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        status: 'IN_PROGRESS',
        reopenedAt: new Date(),
        resolvedAt: null,
      },
    })
    await this.notifyOpsTicketActivity(ticket, 'SUPPORT_REOPENED')
    return updated
  }

  /**
   * Auto-close sweep (daily cron). Moves RESOLVED tickets with no activity for
   * AUTO_CLOSE_AFTER_MS to CLOSED. A reopened ticket is back in IN_PROGRESS, so
   * it is excluded by construction. Silent housekeeping — the requester was
   * already notified at resolve time, and by 14 days the reopen window has
   * lapsed, so CLOSED is terminal.
   */
  async autoCloseResolvedTickets(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - AUTO_CLOSE_AFTER_MS)
    const result = await this.prisma.supportTicket.updateMany({
      where: { status: 'RESOLVED', resolvedAt: { lt: cutoff } },
      data: { status: 'CLOSED', closedAt: now },
    })
    return result.count
  }

  async verifyIdentity(
    actor: SupportActor,
    ticketId: string,
    dto: VerifyIdentityDto,
  ) {
    const ticket = await this.requireTicket(ticketId)
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { identityVerified: true },
    })
    return this.recordAction(ticket.id, actor.id, SupportActionType.IDENTITY_VERIFIED, {
      rationale: dto.rationale,
    })
  }

  async resolve(actor: SupportActor, ticketId: string, dto: ResolveDto) {
    const ticket = await this.requireTicket(ticketId)
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    })
    // Notify the requester the ticket closed — mirrors the reply-flow dispatch
    // (email + in-app bell), fire-and-forget, so they aren't left wondering
    // whether it was handled (Fix 5). Internal resolutionNotes are NOT sent.
    void this.email.sendEmail(
      ticket.email,
      `Your Cardioplace support request ${ticket.ticketNumber} is resolved`,
      supportResolvedEmailHtml(ticket.ticketNumber),
      {
        template: 'support_resolved',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: ticket.userId ?? null,
        metadata: {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          category: ticket.category,
          priority: ticket.priority,
        },
      },
    )
    if (ticket.userId) {
      await this.prisma.notification.create({
        data: {
          userId: ticket.userId,
          channel: NotificationChannel.DASHBOARD,
          title: 'Support request closed',
          body: `Ticket ${ticket.ticketNumber} has been marked resolved.`,
          dispatchTrigger: 'SUPPORT_RESOLVE',
          supportTicketId: ticket.id,
        },
      })
    }
    return this.recordAction(ticket.id, actor.id, SupportActionType.RESOLVED, {
      resolutionNotes: dto.resolutionNotes,
    })
  }

  /**
   * S4 — assign / pick up a ticket. Omitting assigneeId assigns to the acting
   * ops user (assign-to-me); passing another user's id hands it off (validated
   * to be an ops/admin). Picking up an OPEN ticket auto-advances it to
   * IN_PROGRESS, mirroring the audit-worklist assignIncident pattern.
   */
  async assign(actor: SupportActor, ticketId: string, dto: AssignDto) {
    const ticket = await this.requireTicket(ticketId)
    const assigneeId = dto.assigneeId ?? actor.id
    // Only validate a hand-off to someone else; the actor is already ops (the
    // controller RolesGuard gates HEALPLACE_OPS + SUPER_ADMIN).
    if (assigneeId !== actor.id) {
      const assignee = await this.prisma.user.findUnique({
        where: { id: assigneeId },
        select: { roles: true },
      })
      const isOps =
        assignee?.roles.includes(UserRole.HEALPLACE_OPS) ||
        assignee?.roles.includes(UserRole.SUPER_ADMIN)
      if (!isOps) {
        throw new BadRequestException(
          'Tickets can only be assigned to a support agent.',
        )
      }
    }
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: {
        assignedToOpsId: assigneeId,
        // Pickup advances an untouched OPEN ticket into the active lane.
        ...(ticket.status === 'OPEN' ? { status: 'IN_PROGRESS' as const } : {}),
      },
    })
    return this.recordAction(ticket.id, actor.id, SupportActionType.ASSIGNED, {
      assignedToOpsId: assigneeId,
      self: assigneeId === actor.id,
    })
  }

  /**
   * S5 — re-triage a ticket's priority. Records from/to in the action metadata
   * for the ops timeline. A no-op change (same priority) still records, so the
   * timeline reflects that ops looked at it.
   */
  async changePriority(actor: SupportActor, ticketId: string, dto: PriorityDto) {
    const ticket = await this.requireTicket(ticketId)
    await this.prisma.supportTicket.update({
      where: { id: ticket.id },
      data: { priority: dto.priority },
    })
    return this.recordAction(
      ticket.id,
      actor.id,
      SupportActionType.PRIORITY_CHANGED,
      { from: ticket.priority, to: dto.priority },
    )
  }

  async actionMfaReset(
    actor: SupportActor,
    ticketId: string,
    dto: ActionDto,
    ctx: SupportContext,
  ) {
    const { ticket, targetId } = await this.requireVerifiedTarget(ticketId)
    const reason = this.reasonFor(dto, ticket.ticketNumber, 'MFA reset')
    await this.auth.adminResetMfa(actor.id, targetId, reason, this.sessionCtx(ctx))
    return this.recordAction(ticket.id, actor.id, SupportActionType.MFA_RESET, {
      targetId,
      reason,
    })
  }

  async actionWebauthnReset(
    actor: SupportActor,
    ticketId: string,
    dto: ActionDto,
    ctx: SupportContext,
  ) {
    const { ticket, targetId } = await this.requireVerifiedTarget(ticketId)
    const reason = this.reasonFor(dto, ticket.ticketNumber, 'WebAuthn reset')
    await this.auth.adminResetPatientBiometric(
      actor.id,
      targetId,
      reason,
      this.sessionCtx(ctx),
    )
    return this.recordAction(ticket.id, actor.id, SupportActionType.WEBAUTHN_RESET, {
      targetId,
      reason,
    })
  }

  async actionRecoveryCodesRegen(
    actor: SupportActor,
    ticketId: string,
    _dto: ActionDto,
    ctx: SupportContext,
  ) {
    const { ticket, targetId } = await this.requireVerifiedTarget(ticketId)
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      select: { roles: true },
    })
    // Patients regenerate WebAuthn recovery codes; staff regenerate TOTP ones.
    if (target?.roles.includes(UserRole.PATIENT)) {
      await this.auth.regeneratePatientRecoveryCodes(targetId, this.sessionCtx(ctx))
    } else {
      await this.auth.regenerateRecoveryCodes(targetId, this.sessionCtx(ctx))
    }
    return this.recordAction(
      ticket.id,
      actor.id,
      SupportActionType.RECOVERY_CODES_REGEN,
      { targetId },
    )
  }

  // ── Helpers ────────────────────────────────────────────────────────────
  private async requireTicket(id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } })
    if (!ticket) throw new NotFoundException('Support ticket not found')
    return ticket
  }

  /**
   * Ownership gate for the requester in-thread endpoints. A NotFound (not
   * Forbidden) on a mismatch so a patient cannot probe whether another user's
   * ticket id exists — same non-enumeration posture as the rest of the app.
   */
  private async requireOwnedTicket(actor: SupportActor, id: string) {
    const ticket = await this.prisma.supportTicket.findUnique({ where: { id } })
    if (!ticket || ticket.userId !== actor.id) {
      throw new NotFoundException('Support ticket not found')
    }
    return ticket
  }

  /**
   * Ops-facing ping for patient-initiated activity (in-thread reply / reopen).
   * Reuses the notify-and-link ops email (NO requester PHI in the body) and the
   * ops dashboard bell, deep-linked via supportTicketId. Wrapped in the
   * support-ops-notify principal scope so the disclosure attributes correctly.
   */
  private async notifyOpsTicketActivity(
    ticket: {
      id: string
      ticketNumber: string
      category: string
      priority: string
      subject: string
    },
    trigger: 'SUPPORT_USER_REPLIED' | 'SUPPORT_REOPENED',
  ) {
    const reopened = trigger === 'SUPPORT_REOPENED'
    return runAsCronActor(this.cls, 'support-ops-notify', async () => {
      void this.email.sendEmail(
        OPS_INBOX,
        `[Support] ${ticket.ticketNumber} — patient ${
          reopened ? 'reopened' : 'replied'
        } · ${ticket.priority} ${ticket.category}`,
        supportOpsNotifyHtml(
          ticket.ticketNumber,
          ticket.priority,
          ticket.category,
          `${this.adminBaseUrl}/support/${ticket.id}`,
        ),
        {
          template: 'support_ops_notify',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: null,
          metadata: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            category: ticket.category,
            priority: ticket.priority,
          },
        },
      )
      const opsUsers = await this.prisma.user.findMany({
        where: { roles: { has: UserRole.HEALPLACE_OPS } },
        select: { id: true },
      })
      if (opsUsers.length) {
        await this.prisma.notification.createMany({
          data: opsUsers.map((u) => ({
            userId: u.id,
            channel: NotificationChannel.DASHBOARD,
            title: reopened
              ? `Ticket ${ticket.ticketNumber} reopened`
              : `New reply on ${ticket.ticketNumber}`,
            body: `${ticket.category} · ${ticket.subject}`,
            dispatchTrigger: trigger,
            supportTicketId: ticket.id,
          })),
        })
      }
    })
  }

  /** Identity-verification gate — the sensitive reset actions are blocked
   *  until ops has verified the requester, even for a HEALPLACE_OPS caller. */
  private async requireVerifiedTarget(ticketId: string) {
    const ticket = await this.requireTicket(ticketId)
    if (!ticket.identityVerified) {
      throw new ForbiddenException(
        'Verify the requester’s identity before performing account actions.',
      )
    }
    if (!ticket.userId) {
      throw new BadRequestException(
        'This ticket is not linked to a Cardioplace account.',
      )
    }
    return { ticket, targetId: ticket.userId }
  }

  private reasonFor(dto: ActionDto, ticketNumber: string, label: string): string {
    return dto.reason?.trim() || `${label} via support ticket ${ticketNumber}`
  }

  private sessionCtx(ctx: SupportContext): SessionContext {
    return { ipAddress: ctx.ipAddress, userAgent: ctx.userAgent }
  }

  private recordAction(
    ticketId: string,
    opsUserId: string,
    actionType: SupportActionType,
    metadata: Record<string, unknown>,
  ) {
    return this.prisma.supportTicketAction.create({
      data: {
        ticketId,
        opsUserId,
        actionType,
        metadata: metadata as Prisma.InputJsonValue,
      },
    })
  }

  /**
   * N-1 (Duwaragie 2026-07-14 triage) — submitter confirmation email fired on
   * ticket create. The intake flows (both authenticated contact + public
   * locked-out) show copy promising "check the link in your confirmation
   * email"; before this method existed, the promise was hollow. Wrapped in
   * the `support-ops-notify` CLS scope (same principal PR 2 introduced) so
   * `EmailDisclosureLog.senderPrincipal` doesn't fall back to
   * `system-principal-unknown`. Fire-and-forget — never delay the intake
   * response on mail delivery.
   */
  private async notifyRequesterTicketReceived(ticket: {
    email: string
    ticketNumber: string
    category: string
    userId: string | null
  }) {
    if (!ticket.email) return
    return runAsCronActor(this.cls, 'support-ops-notify', async () => {
      void this.email.sendEmail(
        ticket.email,
        `[Support] ${ticket.ticketNumber} — we've received your request`,
        supportTicketReceivedEmailHtml(ticket.ticketNumber, ticket.category),
        {
          template: 'support_ticket_received',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: ticket.userId,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            category: ticket.category,
          },
        },
      )
    })
  }

  private async notifyOpsNewTicket(ticket: {
    id: string
    ticketNumber: string
    category: string
    priority: string
    subject: string
  }) {
    // N-2 (Duwaragie 2026-07-14 triage) — wrap the whole ops-notify body in
    // a registered system-principal CLS scope so `EmailDisclosureLog
    // .senderPrincipal` and every AccessLog row emitted here attribute to
    // the `support-ops-notify` principal instead of the placeholder
    // `system-principal-unknown` that N7's unattributed-disclosure detector
    // flags. Runs from the HTTP intake path (createContactTicket /
    // createLockedOutTicket), NOT a cron — but the CLS-actor pattern is
    // the same. See backend/src/common/cls/system-principals.ts.
    return runAsCronActor(this.cls, 'support-ops-notify', async () => {
      // Notify-and-link — the ops email carries NO requester email or message
      // body (mirrors the clinical-alert PHI refactor); ops opens the dashboard
      // for full, audit-logged context (Fix 10). Fire-and-forget — never make the
      // intake request wait on mail delivery (EmailService never throws).
      // N6 — ops-team internal notification. Ticket may reference PHI, but the
      // notify-and-link body itself carries NO requester email or message content
      // (Fix 10 refactor). Classifying as PHI-adjacent anyway because the ticket
      // subject is a specific patient in most cases; ticketUserId lets audit
      // reconstruct which patient the disclosure was ABOUT.
      void this.email.sendEmail(
        OPS_INBOX,
        `[Support] ${ticket.ticketNumber} — ${ticket.priority} ${ticket.category}`,
        supportOpsNotifyHtml(
          ticket.ticketNumber,
          ticket.priority,
          ticket.category,
          `${this.adminBaseUrl}/support/${ticket.id}`,
        ),
        {
          template: 'support_ops_notify',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: null,
          metadata: {
            ticketId: ticket.id,
            ticketNumber: ticket.ticketNumber,
            category: ticket.category,
            priority: ticket.priority,
          },
        },
      )
      const opsUsers = await this.prisma.user.findMany({
        where: { roles: { has: UserRole.HEALPLACE_OPS } },
        select: { id: true },
      })
      if (opsUsers.length) {
        await this.prisma.notification.createMany({
          data: opsUsers.map((u) => ({
            userId: u.id,
            channel: NotificationChannel.DASHBOARD,
            title: `New support ticket ${ticket.ticketNumber}`,
            body: `${ticket.category} · ${ticket.subject}`,
            dispatchTrigger: 'SUPPORT_TICKET_CREATED',
            supportTicketId: ticket.id,
          })),
        })
      }
    })
  }
}
