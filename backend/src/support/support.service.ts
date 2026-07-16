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
} from '../email/email-templates.js'
import { AuthService, type SessionContext } from '../auth/auth.service.js'
import { TicketNumberService } from './ticket-number.service.js'
import type {
  ActionDto,
  ContactDto,
  LockedOutDto,
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
const LOCKED_OUT_WINDOW_MS = 60 * 60 * 1000 // 1 hour
const LOCKED_OUT_MAX = 5 // per IP per hour
const CONTACT_WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const CONTACT_MAX = 3 // authenticated tickets per user per 5-minute window

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
    await this.notifyOpsNewTicket(ticket)
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
    await this.notifyOpsNewTicket(ticket)
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
        resolvedAt: true,
        replies: {
          orderBy: { sentAt: 'asc' },
          select: { authorType: true, body: true, sentAt: true },
        },
      },
    })
    return { data }
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
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          ticketNumber: true,
          email: true,
          category: true,
          subject: true,
          status: true,
          priority: true,
          identityVerified: true,
          createdAt: true,
          resolvedAt: true,
          user: { select: { name: true, displayId: true } },
        },
      }),
      this.prisma.supportTicket.count({ where }),
    ])
    return { data: rows, total, page, limit }
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
        },
      })
    }
    return reply
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
        },
      })
    }
    return this.recordAction(ticket.id, actor.id, SupportActionType.RESOLVED, {
      resolutionNotes: dto.resolutionNotes,
    })
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
          })),
        })
      }
    })
  }
}
