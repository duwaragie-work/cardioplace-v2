import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'crypto'
import { EmailService } from '../email/email.service.js'
import { activationEmailHtml, roleLabel } from '../email/email-templates.js'
import type { Prisma } from '../generated/prisma/client.js'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import type { BulkInviteUserDto } from './dto/bulk-invite-user.dto.js'
import type { DeactivateDto } from './dto/deactivate.dto.js'
import type { InviteUserDto } from './dto/invite-user.dto.js'
import { type ListUsersQuery, UserListStatus } from './dto/list-users.query.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Actor {
  id: string
  email: string | null
  roles: UserRole[]
}

export interface InviteContext {
  ipAddress?: string
  userAgent?: string
}

interface NormalizedInvite {
  email: string
  name: string
  role: UserRole
  practiceId: string | null
}

interface BulkRowError {
  index: number
  email: string
  reason: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

const ROLES_REQUIRING_PRACTICE_FOR_OPS: UserRole[] = [
  UserRole.COORDINATOR,
  UserRole.PROVIDER,
]

const ROLES_REQUIRING_PRACTICE_FOR_SUPER: UserRole[] = [
  UserRole.PATIENT,
  UserRole.COORDINATOR,
  UserRole.PROVIDER,
]

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
  ) {}

  // ─── Authorization helpers ────────────────────────────────────────────────

  /**
   * Service-layer scope guard for invites. Mirrors the
   * `assertCanAccessPatient` pattern. Throws ForbiddenException on deny;
   * returns silently on grant.
   *
   * Caller's controller-level @Roles() decorator already enforces
   * "must hold one of COORDINATOR | HEALPLACE_OPS | SUPER_ADMIN" — this
   * tightens that down to the per-target-role + per-practice cell of the
   * authorization matrix.
   */
  async assertCanInvite(
    caller: Actor,
    targetRole: UserRole,
    practiceId: string | null,
  ): Promise<void> {
    if (caller.roles.includes(UserRole.SUPER_ADMIN)) {
      // SUPER_ADMIN can invite any role. Practice required for PATIENT,
      // COORDINATOR, PROVIDER. Practice optional for MD/OPS/SUPER_ADMIN.
      if (
        ROLES_REQUIRING_PRACTICE_FOR_SUPER.includes(targetRole) &&
        !practiceId
      ) {
        throw new BadRequestException(
          `practiceId is required when SUPER_ADMIN invites a ${targetRole}`,
        )
      }
      if (practiceId) await this.assertPracticeExists(practiceId)
      return
    }

    if (caller.roles.includes(UserRole.HEALPLACE_OPS)) {
      // OPS can invite PROVIDER, MEDICAL_DIRECTOR, HEALPLACE_OPS,
      // COORDINATOR. Cannot invite PATIENT or SUPER_ADMIN.
      const opsAllowed: UserRole[] = [
        UserRole.PROVIDER,
        UserRole.MEDICAL_DIRECTOR,
        UserRole.HEALPLACE_OPS,
        UserRole.COORDINATOR,
      ]
      if (!opsAllowed.includes(targetRole)) {
        throw new ForbiddenException(
          `HEALPLACE_OPS cannot invite a ${targetRole}`,
        )
      }
      if (
        ROLES_REQUIRING_PRACTICE_FOR_OPS.includes(targetRole) &&
        !practiceId
      ) {
        throw new BadRequestException(
          `practiceId is required when HEALPLACE_OPS invites a ${targetRole}`,
        )
      }
      if (practiceId) await this.assertPracticeExists(practiceId)
      return
    }

    if (caller.roles.includes(UserRole.COORDINATOR)) {
      // COORDINATOR can invite ONLY PATIENT — and only into their own
      // practice. Reading PracticeCoordinator is the source of truth for
      // "their" practice (one practice per coordinator by @unique).
      if (targetRole !== UserRole.PATIENT) {
        throw new ForbiddenException(
          `COORDINATOR can only invite PATIENT users`,
        )
      }
      if (!practiceId) {
        throw new BadRequestException(
          `practiceId is required for PATIENT invites`,
        )
      }
      const own = await this.prisma.practiceCoordinator.findUnique({
        where: { userId: caller.id },
        select: { practiceId: true },
      })
      if (!own) {
        throw new ForbiddenException('You are not assigned to a practice')
      }
      if (own.practiceId !== practiceId) {
        throw new ForbiddenException(
          'You can only invite patients into your own practice',
        )
      }
      return
    }

    throw new ForbiddenException('You are not allowed to invite users')
  }

  /**
   * Scope guard for deactivate/reactivate. SUPER_ADMIN can touch any
   * user; HEALPLACE_OPS can touch admin-role users (not patients);
   * COORDINATOR can deactivate patients in their own practice only.
   */
  async assertCanDeactivate(
    caller: Actor,
    targetUser: { id: string; roles: UserRole[] },
  ): Promise<void> {
    if (caller.id === targetUser.id) {
      throw new ForbiddenException('You cannot deactivate yourself')
    }

    if (caller.roles.includes(UserRole.SUPER_ADMIN)) return

    if (caller.roles.includes(UserRole.HEALPLACE_OPS)) {
      // OPS may only deactivate admin-role users (no patients, no
      // super_admins — only SUPER can touch a SUPER).
      const targetIsPatientOnly =
        targetUser.roles.length === 0 ||
        targetUser.roles.every((r) => r === UserRole.PATIENT)
      if (targetIsPatientOnly) {
        throw new ForbiddenException(
          'HEALPLACE_OPS cannot deactivate patient accounts',
        )
      }
      if (targetUser.roles.includes(UserRole.SUPER_ADMIN)) {
        throw new ForbiddenException(
          'HEALPLACE_OPS cannot deactivate a SUPER_ADMIN',
        )
      }
      return
    }

    if (caller.roles.includes(UserRole.COORDINATOR)) {
      // Patients in own practice only.
      const onlyPatient = targetUser.roles.every((r) => r === UserRole.PATIENT)
      if (!onlyPatient) {
        throw new ForbiddenException(
          'COORDINATOR can only deactivate patient accounts',
        )
      }
      const own = await this.prisma.practiceCoordinator.findUnique({
        where: { userId: caller.id },
        select: { practiceId: true },
      })
      if (!own) {
        throw new ForbiddenException('You are not assigned to a practice')
      }
      const assignment = await this.prisma.patientProviderAssignment.findUnique(
        {
          where: { userId: targetUser.id },
          select: { practiceId: true },
        },
      )
      if (!assignment || assignment.practiceId !== own.practiceId) {
        throw new ForbiddenException(
          'You can only deactivate patients in your own practice',
        )
      }
      return
    }

    throw new ForbiddenException('You are not allowed to deactivate users')
  }

  private async assertPracticeExists(practiceId: string): Promise<void> {
    const row = await this.prisma.practice.findUnique({
      where: { id: practiceId },
      select: { id: true },
    })
    if (!row) throw new NotFoundException(`Practice ${practiceId} not found`)
  }

  // ─── Invite — single ──────────────────────────────────────────────────────

  async invite(caller: Actor, dto: InviteUserDto, ctx?: InviteContext) {
    const normalized = this.normalizeInvite(dto)
    await this.assertCanInvite(caller, normalized.role, normalized.practiceId)
    await this.assertEmailAvailable(normalized.email)

    const { invite, rawToken } = await this.createInviteRow(
      caller.id,
      normalized,
    )

    // Loud audit event for SUPER inviting SUPER — Manisha + Healplace ops
    // want a deliberately elevated-severity row to grep on.
    if (
      normalized.role === UserRole.SUPER_ADMIN &&
      caller.roles.includes(UserRole.SUPER_ADMIN)
    ) {
      await this.logEvent({
        event: 'super_admin_invited',
        userId: caller.id,
        identifier: normalized.email,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: {
          severity: 'elevated',
          inviteId: invite.id,
          targetEmail: normalized.email,
          targetName: normalized.name,
        },
        success: true,
      })
    }

    await this.logEvent({
      event: 'user_invited',
      userId: caller.id,
      identifier: normalized.email,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        inviteId: invite.id,
        targetRole: normalized.role,
        practiceId: normalized.practiceId,
      },
      success: true,
    })

    void this.dispatchActivationEmail({
      invite,
      rawToken,
      inviterName: caller.email ?? 'Your administrator',
    })

    return {
      statusCode: 201,
      message: 'Invite sent',
      data: this.serializeInvite(invite),
    }
  }

  // ─── Invite — bulk ────────────────────────────────────────────────────────

  async bulkInvite(caller: Actor, dto: BulkInviteUserDto, ctx?: InviteContext) {
    const normalizedRows = dto.entries.map((entry) =>
      this.normalizeInvite(entry),
    )
    const errors: BulkRowError[] = []

    // 1. Authorization pass — every row must pass `assertCanInvite`
    //    before we touch the DB. A single failure aborts the whole batch.
    for (let i = 0; i < normalizedRows.length; i++) {
      const row = normalizedRows[i]
      try {
        await this.assertCanInvite(caller, row.role, row.practiceId)
      } catch (err) {
        errors.push({
          index: i,
          email: row.email,
          reason: err instanceof Error ? err.message : 'authorization failed',
        })
      }
    }

    // 2. Intra-batch duplicate emails.
    const seen = new Set<string>()
    for (let i = 0; i < normalizedRows.length; i++) {
      const e = normalizedRows[i].email
      if (seen.has(e)) {
        errors.push({
          index: i,
          email: e,
          reason: 'duplicate email within batch',
        })
      }
      seen.add(e)
    }

    // 3. DB uniqueness pass — existing User or open invite for any row.
    const emails = normalizedRows.map((r) => r.email)
    const [existingUsers, openInvites] = await Promise.all([
      this.prisma.user.findMany({
        where: { email: { in: emails } },
        select: { email: true },
      }),
      this.prisma.userInvite.findMany({
        where: {
          email: { in: emails },
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { email: true },
      }),
    ])
    const takenEmails = new Set([
      ...existingUsers.map((u) => u.email).filter((e): e is string => !!e),
      ...openInvites.map((i) => i.email),
    ])

    for (let i = 0; i < normalizedRows.length; i++) {
      const e = normalizedRows[i].email
      if (takenEmails.has(e)) {
        errors.push({
          index: i,
          email: e,
          reason: 'email already has an active user or open invite',
        })
      }
    }

    if (errors.length > 0) {
      return {
        statusCode: 422,
        message: 'Bulk invite rejected — fix errors and resubmit',
        errors,
        data: null,
      }
    }

    // 4. All clear — generate tokens + create rows in one transaction.
    const prepared = normalizedRows.map((row) => {
      const rawToken = randomBytes(32).toString('hex')
      return { row, rawToken, tokenHash: sha256(rawToken) }
    })
    const expiresAt = this.computeExpiresAt()

    const created = await this.prisma.$transaction(
      prepared.map(({ row, tokenHash }) =>
        this.prisma.userInvite.create({
          data: {
            email: row.email,
            name: row.name,
            role: row.role,
            practiceId: row.practiceId,
            tokenHash,
            invitedById: caller.id,
            expiresAt,
          },
        }),
      ),
    )

    // 5. Audit + emails post-commit (don't block response on email).
    for (let i = 0; i < created.length; i++) {
      const invite = created[i]
      const rawToken = prepared[i].rawToken
      if (
        invite.role === UserRole.SUPER_ADMIN &&
        caller.roles.includes(UserRole.SUPER_ADMIN)
      ) {
        await this.logEvent({
          event: 'super_admin_invited',
          userId: caller.id,
          identifier: invite.email,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          metadata: {
            severity: 'elevated',
            inviteId: invite.id,
            targetEmail: invite.email,
            targetName: invite.name,
            bulk: true,
          },
          success: true,
        })
      }
      await this.logEvent({
        event: 'user_invited',
        userId: caller.id,
        identifier: invite.email,
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        metadata: {
          inviteId: invite.id,
          targetRole: invite.role,
          practiceId: invite.practiceId,
          bulk: true,
        },
        success: true,
      })
      void this.dispatchActivationEmail({
        invite,
        rawToken,
        inviterName: caller.email ?? 'Your administrator',
      })
    }

    return {
      statusCode: 201,
      message: 'Bulk invite created',
      data: created.map((c) => this.serializeInvite(c)),
    }
  }

  // ─── Invite — resend ──────────────────────────────────────────────────────

  async resendInvite(caller: Actor, inviteId: string, ctx?: InviteContext) {
    const invite = await this.prisma.userInvite.findUnique({
      where: { id: inviteId },
    })
    if (!invite) throw new NotFoundException('Invite not found')
    if (invite.acceptedAt) {
      throw new BadRequestException('Invite has already been accepted')
    }
    await this.assertCanInvite(caller, invite.role, invite.practiceId)

    // Revoke + recreate so the URL changes (token is sha256-of-fresh
    // bytes — never reuse the old hash).
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresAt = this.computeExpiresAt()

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.userInvite.update({
        where: { id: invite.id },
        data: { revokedAt: new Date() },
      })
      return tx.userInvite.create({
        data: {
          email: invite.email,
          name: invite.name,
          role: invite.role,
          practiceId: invite.practiceId,
          tokenHash,
          invitedById: caller.id,
          expiresAt,
        },
      })
    })

    await this.logEvent({
      event: 'user_invite_resent',
      userId: caller.id,
      identifier: updated.email,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        oldInviteId: invite.id,
        newInviteId: updated.id,
        targetRole: updated.role,
        practiceId: updated.practiceId,
      },
      success: true,
    })

    void this.dispatchActivationEmail({
      invite: updated,
      rawToken,
      inviterName: caller.email ?? 'Your administrator',
    })

    return {
      statusCode: 200,
      message: 'Invite resent',
      data: this.serializeInvite(updated),
    }
  }

  // ─── Invite — revoke ──────────────────────────────────────────────────────

  async revokeInvite(caller: Actor, inviteId: string, ctx?: InviteContext) {
    const invite = await this.prisma.userInvite.findUnique({
      where: { id: inviteId },
    })
    if (!invite) throw new NotFoundException('Invite not found')
    if (invite.acceptedAt) {
      throw new BadRequestException(
        'Cannot revoke an invite that has already been accepted',
      )
    }
    if (invite.revokedAt) {
      throw new BadRequestException('Invite is already revoked')
    }
    await this.assertCanInvite(caller, invite.role, invite.practiceId)

    const updated = await this.prisma.userInvite.update({
      where: { id: invite.id },
      data: { revokedAt: new Date() },
    })

    await this.logEvent({
      event: 'user_invite_revoked',
      userId: caller.id,
      identifier: updated.email,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        inviteId: updated.id,
        targetRole: updated.role,
        practiceId: updated.practiceId,
      },
      success: true,
    })

    return {
      statusCode: 200,
      message: 'Invite revoked',
      data: this.serializeInvite(updated),
    }
  }

  // ─── Deactivate / Reactivate ──────────────────────────────────────────────

  async deactivate(
    caller: Actor,
    targetUserId: string,
    dto: DeactivateDto,
    ctx?: InviteContext,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })
    if (!target) throw new NotFoundException('User not found')
    await this.assertCanDeactivate(caller, target)

    if (target.accountStatus === AccountStatus.DEACTIVATED) {
      throw new BadRequestException('User is already deactivated')
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { accountStatus: AccountStatus.DEACTIVATED },
      select: {
        id: true,
        email: true,
        roles: true,
        accountStatus: true,
      },
    })

    await this.logEvent({
      event: 'user_deactivated',
      userId: caller.id,
      identifier: updated.email ?? undefined,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        targetUserId: updated.id,
        targetRoles: updated.roles,
        reason: dto.reason ?? null,
      },
      success: true,
    })

    return {
      statusCode: 200,
      message: 'User deactivated',
      data: updated,
    }
  }

  async reactivate(caller: Actor, targetUserId: string, ctx?: InviteContext) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })
    if (!target) throw new NotFoundException('User not found')
    await this.assertCanDeactivate(caller, target)

    if (target.accountStatus === AccountStatus.ACTIVE) {
      throw new BadRequestException('User is already active')
    }

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { accountStatus: AccountStatus.ACTIVE },
      select: {
        id: true,
        email: true,
        roles: true,
        accountStatus: true,
      },
    })

    await this.logEvent({
      event: 'user_reactivated',
      userId: caller.id,
      identifier: updated.email ?? undefined,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        targetUserId: updated.id,
        targetRoles: updated.roles,
      },
      success: true,
    })

    return {
      statusCode: 200,
      message: 'User reactivated',
      data: updated,
    }
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async listUsers(caller: Actor, query: ListUsersQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    // Practice scope — COORDINATOR is locked to their own practice
    // server-side regardless of what they send.
    let practiceIdFilter: string | null | undefined
    if (caller.roles.includes(UserRole.COORDINATOR)) {
      const own = await this.prisma.practiceCoordinator.findUnique({
        where: { userId: caller.id },
        select: { practiceId: true },
      })
      if (!own) {
        return {
          statusCode: 200,
          message: 'Users retrieved',
          data: [],
          page,
          limit,
          total: 0,
          invites: [],
        }
      }
      practiceIdFilter = own.practiceId
    } else if (query.practiceId) {
      practiceIdFilter = query.practiceId
    }

    // Build the User where-clause first. For COORDINATOR the only
    // visible users are patients in own practice (joined via
    // PatientProviderAssignment.practiceId).
    const userWhere: Prisma.UserWhereInput = {}

    if (query.role) {
      userWhere.roles = { has: query.role }
    }
    if (query.search) {
      const term = query.search.trim()
      if (term.length > 0) {
        userWhere.OR = [
          { email: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ]
      }
    }

    if (caller.roles.includes(UserRole.COORDINATOR)) {
      // COORDINATOR sees PATIENT users only — assignment.practiceId =
      // own.practiceId. The status filter is honored but constrained.
      userWhere.roles = { has: UserRole.PATIENT }
      userWhere.providerAssignmentAsPatient = {
        is: { practiceId: practiceIdFilter as string },
      }
    } else if (practiceIdFilter) {
      // OPS / SUPER explicit practice filter — accept either a patient
      // assigned to that practice OR a staff member of that practice
      // (provider, MD, coordinator memberships).
      userWhere.OR = [
        ...((userWhere.OR as Prisma.UserWhereInput[] | undefined) ?? []),
        {
          providerAssignmentAsPatient: {
            is: { practiceId: practiceIdFilter },
          },
        },
        {
          practiceProviderMemberships: {
            some: { practiceId: practiceIdFilter },
          },
        },
        {
          practiceMedicalDirectorMemberships: {
            some: { practiceId: practiceIdFilter },
          },
        },
        {
          practiceCoordinator: { is: { practiceId: practiceIdFilter } },
        },
      ]
    }

    // Status filter — ACTIVE/BLOCKED/SUSPENDED/DEACTIVATED map straight
    // through. INVITE_PENDING is a synthetic filter: it has no User row
    // yet, so we exclude users and fetch invites instead.
    if (query.status === UserListStatus.INVITE_PENDING) {
      // Return just the invite list — no users.
      const invites = await this.fetchPendingInvites({
        caller,
        practiceIdFilter,
        role: query.role,
        search: query.search,
      })
      return {
        statusCode: 200,
        message: 'Pending invites retrieved',
        data: [],
        page,
        limit,
        total: invites.length,
        invites,
      }
    }
    // INVITE_PENDING already handled + returned above; remaining values
    // are 1:1 with AccountStatus.
    if (query.status) {
      userWhere.accountStatus = query.status as AccountStatus
    }

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where: userWhere,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          email: true,
          name: true,
          roles: true,
          accountStatus: true,
          createdAt: true,
        },
      }),
      this.prisma.user.count({ where: userWhere }),
    ])

    // For COORDINATOR — strip everything except id, name, email, status.
    // No clinical data, no roles other than 'patient'.
    if (caller.roles.includes(UserRole.COORDINATOR)) {
      return {
        statusCode: 200,
        message: 'Users retrieved',
        data: users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          status: this.derivePatientStatus(u.accountStatus),
        })),
        page,
        limit,
        total,
        invites: await this.fetchPendingInvites({
          caller,
          practiceIdFilter,
          role: UserRole.PATIENT,
          search: query.search,
        }),
      }
    }

    return {
      statusCode: 200,
      message: 'Users retrieved',
      data: users,
      page,
      limit,
      total,
      invites: await this.fetchPendingInvites({
        caller,
        practiceIdFilter,
        role: query.role,
        search: query.search,
      }),
    }
  }

  private async fetchPendingInvites(params: {
    caller: Actor
    practiceIdFilter: string | null | undefined
    role?: UserRole
    search?: string
  }) {
    const where: Prisma.UserInviteWhereInput = {
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    }
    if (params.practiceIdFilter) where.practiceId = params.practiceIdFilter
    if (params.role) where.role = params.role
    if (params.search) {
      const term = params.search.trim()
      if (term.length > 0) {
        where.OR = [
          { email: { contains: term, mode: 'insensitive' } },
          { name: { contains: term, mode: 'insensitive' } },
        ]
      }
    }
    // COORDINATOR — patients only.
    if (params.caller.roles.includes(UserRole.COORDINATOR)) {
      where.role = UserRole.PATIENT
    }

    const invites = await this.prisma.userInvite.findMany({
      where,
      orderBy: { invitedAt: 'desc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        practiceId: true,
        invitedAt: true,
        expiresAt: true,
      },
    })
    return invites
  }

  // ─── Misc helpers ─────────────────────────────────────────────────────────

  /**
   * Status label used by the COORDINATOR-scoped patient list. Maps the
   * raw AccountStatus enum down to the three buckets the front desk
   * actually cares about.
   */
  private derivePatientStatus(
    status: AccountStatus,
  ): 'Active' | 'Deactivated' | 'Blocked' {
    if (status === AccountStatus.DEACTIVATED) return 'Deactivated'
    if (status === AccountStatus.ACTIVE) return 'Active'
    return 'Blocked'
  }

  private normalizeInvite(dto: InviteUserDto): NormalizedInvite {
    return {
      email: dto.email.trim().toLowerCase(),
      name: dto.name.trim(),
      role: dto.role,
      practiceId: dto.practiceId?.trim() || null,
    }
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const [user, openInvite] = await Promise.all([
      this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      }),
      this.prisma.userInvite.findFirst({
        where: {
          email,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      }),
    ])
    if (user) {
      throw new ConflictException(
        `An account with email ${email} already exists`,
      )
    }
    if (openInvite) {
      throw new ConflictException(`An open invite already exists for ${email}`)
    }
  }

  private async createInviteRow(invitedById: string, row: NormalizedInvite) {
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresAt = this.computeExpiresAt()

    const invite = await this.prisma.userInvite.create({
      data: {
        email: row.email,
        name: row.name,
        role: row.role,
        practiceId: row.practiceId,
        tokenHash,
        invitedById,
        expiresAt,
      },
    })
    return { invite, rawToken }
  }

  private computeExpiresAt(): Date {
    const hours = Number(
      this.config.get<string | number>('USER_INVITE_TTL_HOURS', 48),
    )
    const safe = Number.isFinite(hours) && hours > 0 ? hours : 48
    return new Date(Date.now() + safe * 60 * 60 * 1000)
  }

  private serializeInvite(invite: {
    id: string
    email: string
    name: string
    role: UserRole
    practiceId: string | null
    invitedById: string
    invitedAt: Date
    expiresAt: Date
    acceptedAt: Date | null
    revokedAt: Date | null
    createdUserId: string | null
  }) {
    return {
      id: invite.id,
      email: invite.email,
      name: invite.name,
      role: invite.role,
      practiceId: invite.practiceId,
      invitedById: invite.invitedById,
      invitedAt: invite.invitedAt,
      expiresAt: invite.expiresAt,
      acceptedAt: invite.acceptedAt,
      revokedAt: invite.revokedAt,
      createdUserId: invite.createdUserId,
    }
  }

  private async dispatchActivationEmail(params: {
    invite: {
      email: string
      name: string
      role: UserRole
      expiresAt: Date
    }
    rawToken: string
    inviterName: string
  }): Promise<void> {
    try {
      const port = this.config.get<string>('PORT', '8080')
      const backendUrl = this.config.get<string>(
        'BACKEND_URL',
        `http://localhost:${port}`,
      )
      const inviteUrl = `${backendUrl}/api/v2/auth/invite/${params.rawToken}`

      const subject = `You've been invited to Cardioplace — activate your account`
      const html = activationEmailHtml({
        name: params.invite.name,
        role: params.invite.role,
        inviteUrl,
        expiresAt: params.invite.expiresAt,
        invitedBy: params.inviterName,
      })
      await this.emailService.sendEmail(params.invite.email, subject, html)
    } catch (err) {
      this.logger.error(
        `Failed to dispatch activation email to ${params.invite.email}`,
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  /**
   * Mirror of AuthService.logAuthEvent — kept local so this module
   * doesn't have to import the auth service (and pull in its full
   * dependency graph). Failures are swallowed so audit-write problems
   * never block the user-facing mutation.
   */
  private async logEvent(params: {
    event: string
    userId?: string
    identifier?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
    success: boolean
    errorCode?: string
  }): Promise<void> {
    try {
      await this.prisma.authLog.create({
        data: {
          event: params.event,
          identifier: params.identifier ?? null,
          userId: params.userId ?? null,
          ipAddress: params.ipAddress ?? null,
          userAgent: params.userAgent ?? null,
          metadata: params.metadata
            ? (JSON.parse(
                JSON.stringify(params.metadata),
              ) as Prisma.InputJsonValue)
            : (undefined as unknown as Prisma.InputJsonValue),
          success: params.success,
          errorCode: params.errorCode ?? null,
        },
      })
    } catch (err) {
      this.logger.error(
        'Failed to write AuthLog event',
        err instanceof Error ? err.stack : String(err),
      )
    }
  }

  /**
   * Helper for the COORDINATOR role-label lookup used in admin lists
   * — exported here so the controller layer can format consistently.
   */
  static formatRole(role: UserRole): string {
    return roleLabel(role)
  }
}
