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
import { AccountLifecycleService } from './account-lifecycle.service.js'
import type { BulkInviteUserDto } from './dto/bulk-invite-user.dto.js'
import type { DeactivateDto } from './dto/deactivate.dto.js'
import type { PermanentCloseDto } from './dto/permanent-close.dto.js'
import type { ReactivateDto } from './dto/reactivate.dto.js'
import type { InviteUserDto } from './dto/invite-user.dto.js'
import { type ListUsersQuery, UserListStatus } from './dto/list-users.query.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Actor {
  id: string
  email: string | null
  roles: UserRole[]
  /** The practice the session is acting as (JWT claim). When set, the user
   *  roster + scoped views narrow to this practice only. Null/undefined for
   *  org-wide roles (SUPER / OPS) and legacy sessions. */
  activePracticeId?: string | null
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

export interface BulkRowError {
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

// Mirror of admin/src/lib/roleGates.ts isCoordinatorOnly — a caller whose
// only admin-tier role is COORDINATOR is the "lock practice to their own
// PracticeCoordinator membership" branch. Anyone who *also* holds a broader
// admin role (OPS / SUPER / MD / PROVIDER) keeps the explicit picker.
const COORDINATOR_BROADER_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.HEALPLACE_OPS,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.PROVIDER,
]

function isCoordinatorCaller(caller: Actor): boolean {
  if (!caller.roles.includes(UserRole.COORDINATOR)) return false
  return !caller.roles.some((r) => COORDINATOR_BROADER_ROLES.includes(r))
}

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
    private readonly lifecycle: AccountLifecycleService,
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

    if (caller.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      // MED_DIR (2026-07-01) — practice-scoped admin authority. Invites into
      // practices they head only (PracticeMedicalDirector, many-to-many).
      // Allowed targets: PROVIDER, COORDINATOR, MEDICAL_DIRECTOR (peer MDs —
      // a practice can have more than one), and PATIENT (they're the clinical
      // owner of the practice's roster). NOT HEALPLACE_OPS / SUPER_ADMIN —
      // org-level roles stay with OPS + SUPER. Placed before the COORDINATOR
      // branch so an MD who also holds COORDINATOR gets the broader MD scope.
      const mdAllowed: UserRole[] = [
        UserRole.PROVIDER,
        UserRole.COORDINATOR,
        UserRole.MEDICAL_DIRECTOR,
        UserRole.PATIENT,
      ]
      if (!mdAllowed.includes(targetRole)) {
        throw new ForbiddenException(
          `MEDICAL_DIRECTOR cannot invite a ${targetRole}`,
        )
      }
      if (!practiceId) {
        throw new BadRequestException(
          `practiceId is required for MEDICAL_DIRECTOR invites`,
        )
      }
      const headed = await this.prisma.practiceMedicalDirector.findMany({
        where: { userId: caller.id },
        select: { practiceId: true },
      })
      const headedIds = headed.map((p) => p.practiceId)
      if (!headedIds.includes(practiceId)) {
        throw new ForbiddenException(
          'MEDICAL_DIRECTOR can only invite into practices they head',
        )
      }
      return
    }

    if (caller.roles.includes(UserRole.COORDINATOR)) {
      // COORDINATOR can invite PATIENT, PROVIDER, and MEDICAL_DIRECTOR — but
      // ONLY into their own practice. PracticeCoordinator is the source of
      // truth for "their" practice (one practice per coordinator by @unique).
      // They cannot mint COORDINATOR / HEALPLACE_OPS / SUPER_ADMIN accounts
      // (org-level / cross-practice roles stay with OPS + SUPER_ADMIN).
      const coordinatorAllowed: UserRole[] = [
        UserRole.PATIENT,
        UserRole.PROVIDER,
        UserRole.MEDICAL_DIRECTOR,
      ]
      if (!coordinatorAllowed.includes(targetRole)) {
        throw new ForbiddenException(`COORDINATOR cannot invite a ${targetRole}`)
      }
      if (!practiceId) {
        throw new BadRequestException(
          `practiceId is required for COORDINATOR invites`,
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
          'You can only invite users into your own practice',
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

    if (caller.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
      // MED_DIR (2026-07-01) — practice-scoped. May deactivate/reactivate any
      // staff member OR patient whose practice is one they head. Cannot touch
      // org-level roles (SUPER_ADMIN / HEALPLACE_OPS). Placed before the
      // COORDINATOR branch so an MD who also holds COORDINATOR gets MD scope.
      if (targetUser.roles.includes(UserRole.SUPER_ADMIN)) {
        throw new ForbiddenException(
          'MEDICAL_DIRECTOR cannot deactivate a SUPER_ADMIN',
        )
      }
      if (targetUser.roles.includes(UserRole.HEALPLACE_OPS)) {
        throw new ForbiddenException(
          'MEDICAL_DIRECTOR cannot deactivate HEALPLACE_OPS',
        )
      }
      const headed = await this.prisma.practiceMedicalDirector.findMany({
        where: { userId: caller.id },
        select: { practiceId: true },
      })
      const headedIds = headed.map((p) => p.practiceId)
      const targetPractices = await this.resolveTargetPractices(targetUser.id)
      const overlap = targetPractices.some((p) => headedIds.includes(p))
      if (!overlap) {
        throw new ForbiddenException(
          'MEDICAL_DIRECTOR can only act on users in practices they head',
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
      // Two possible practice links for a patient:
      //   1. PatientProviderAssignment (full clinical care team — populated
      //      by Provider Verify, may not exist yet for a freshly-activated
      //      invite).
      //   2. UserInvite.practiceId via the createdUserId back-reference
      //      (set the moment a patient accepts the invite — exists for
      //      every invite-driven patient).
      // Either one matching the coordinator's own practice is enough.
      const [assignment, invite] = await Promise.all([
        this.prisma.patientProviderAssignment.findUnique({
          where: { userId: targetUser.id },
          select: { practiceId: true },
        }),
        this.prisma.userInvite.findUnique({
          where: { createdUserId: targetUser.id },
          select: { practiceId: true },
        }),
      ])
      const inPractice =
        assignment?.practiceId === own.practiceId ||
        invite?.practiceId === own.practiceId
      if (!inPractice) {
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

  /**
   * Union of every practice a user is tied to, across all four membership
   * sources: staff paths (PracticeProvider / PracticeMedicalDirector /
   * PracticeCoordinator) + the patient path (PatientProviderAssignment).
   * Used by the MED_DIR branch of `assertCanDeactivate` to decide whether the
   * target overlaps a practice the caller heads. De-duplicated.
   */
  private async resolveTargetPractices(userId: string): Promise<string[]> {
    const [providers, mds, coordinator, assignment] = await Promise.all([
      this.prisma.practiceProvider.findMany({
        where: { userId },
        select: { practiceId: true },
      }),
      this.prisma.practiceMedicalDirector.findMany({
        where: { userId },
        select: { practiceId: true },
      }),
      this.prisma.practiceCoordinator.findUnique({
        where: { userId },
        select: { practiceId: true },
      }),
      this.prisma.patientProviderAssignment.findUnique({
        where: { userId },
        select: { practiceId: true },
      }),
    ])
    const ids = new Set<string>()
    for (const p of providers) ids.add(p.practiceId)
    for (const m of mds) ids.add(m.practiceId)
    if (coordinator) ids.add(coordinator.practiceId)
    if (assignment) ids.add(assignment.practiceId)
    return Array.from(ids)
  }

  /**
   * Look up the coordinator's own practiceId (one per coordinator, enforced
   * by @unique on PracticeCoordinator.userId). Returns null for any caller
   * who isn't an active coordinator. The result is intentionally lazy —
   * the bulk path resolves it once and passes it to every row.
   */
  private async resolveCallerCoordinatorPracticeId(
    callerId: string,
  ): Promise<string | null> {
    const row = await this.prisma.practiceCoordinator.findUnique({
      where: { userId: callerId },
      select: { practiceId: true },
    })
    return row?.practiceId ?? null
  }

  /**
   * For COORDINATOR callers the practice is implicit — the UI does not show
   * a picker and the frontend sends `practiceId: undefined`. We auto-fill
   * server-side BEFORE `assertCanInvite` runs so the validation step sees
   * a populated practiceId. Mutates the row in place.
   *
   * Pass `coordinatorPracticeId` when known (bulk path resolves once and
   * reuses); leave undefined to resolve on demand (single-invite path).
   */
  private async applyImplicitCoordinatorPractice(
    caller: Actor,
    row: NormalizedInvite,
    coordinatorPracticeId?: string | null,
  ): Promise<void> {
    if (row.practiceId) return
    if (!isCoordinatorCaller(caller)) return
    const resolved =
      coordinatorPracticeId === undefined
        ? await this.resolveCallerCoordinatorPracticeId(caller.id)
        : coordinatorPracticeId
    if (resolved) row.practiceId = resolved
  }

  // ─── Invite — single ──────────────────────────────────────────────────────

  async invite(caller: Actor, dto: InviteUserDto, ctx?: InviteContext) {
    const normalized = this.normalizeInvite(dto)
    await this.applyImplicitCoordinatorPractice(caller, normalized)
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

    // Resolve the COORDINATOR caller's practiceId once and apply it to every
    // row that came in without one. This mirrors the single-invite path —
    // the frontend deliberately omits practiceId for coordinator callers
    // because the picker is hidden in their UI.
    const coordinatorPracticeId = isCoordinatorCaller(caller)
      ? await this.resolveCallerCoordinatorPracticeId(caller.id)
      : null
    for (const row of normalizedRows) {
      await this.applyImplicitCoordinatorPractice(
        caller,
        row,
        coordinatorPracticeId,
      )
    }

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

    // Mechanics (status flip + session kill-switch + snapshot + audit) live in
    // AccountLifecycleService, which also blocks the last-Super-Admin case and
    // throws when the account is already deactivated / closed.
    const updated = await this.lifecycle.deactivate(target.id, {
      actorId: caller.id,
      actorRoles: caller.roles,
      selfService: false,
      reason: dto.reason,
      ctx,
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

    return { statusCode: 200, message: 'User deactivated', data: updated }
  }

  async reactivate(
    caller: Actor,
    targetUserId: string,
    dto: ReactivateDto,
    ctx?: InviteContext,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })
    if (!target) throw new NotFoundException('User not found')
    await this.assertCanDeactivate(caller, target)

    // Default to restoring the pre-deactivation roles: admin deactivate is a
    // reversible pause ("not a delete" — see the deactivate modal copy), so
    // reactivate must hand the staff role back or the user returns powerless.
    // An admin can still pass restoreRoles:false for a fresh re-authorization.
    const restoreRoles = dto.restoreRoles ?? true
    const updated = await this.lifecycle.reactivate(target.id, {
      actorId: caller.id,
      actorRoles: caller.roles,
      restoreRoles,
      ctx,
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
        restoreRoles,
      },
      success: true,
    })

    return { statusCode: 200, message: 'User reactivated', data: updated }
  }

  /** Admin permanent-close — irreversible tombstone, gated by an anti-typo
   *  DisplayID confirmation. Cannot be used on your own account. */
  async permanentClose(
    caller: Actor,
    targetUserId: string,
    dto: PermanentCloseDto,
    ctx?: InviteContext,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: {
        id: true,
        email: true,
        displayId: true,
        roles: true,
        accountStatus: true,
      },
    })
    if (!target) throw new NotFoundException('User not found')
    if (caller.id === target.id) {
      throw new ForbiddenException(
        'You cannot permanently close your own account from the admin console',
      )
    }
    await this.assertCanDeactivate(caller, target)
    if (dto.confirmDisplayId !== target.displayId) {
      throw new BadRequestException(
        'confirmDisplayId does not match the target account',
      )
    }

    const result = await this.lifecycle.permanentClose(target.id, {
      actorId: caller.id,
      actorRoles: caller.roles,
      selfService: false,
      reason: dto.reason,
      ctx,
    })

    await this.logEvent({
      event: 'user_permanently_closed',
      userId: caller.id,
      identifier: target.email ?? undefined,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        targetUserId: target.id,
        targetRoles: target.roles,
        reason: dto.reason ?? null,
      },
      success: true,
    })

    return { statusCode: 200, message: 'Account permanently closed', data: result }
  }

  /** Remove a single role from a staff account. Bumps the token version +
   *  kills live sessions so the dropped privilege stops working immediately. */
  async removeRole(
    caller: Actor,
    targetUserId: string,
    role: UserRole,
    ctx?: InviteContext,
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })
    if (!target) throw new NotFoundException('User not found')
    // Removing a role is at least as privileged as deactivating the account.
    await this.assertCanDeactivate(caller, target)
    if (
      role === UserRole.SUPER_ADMIN &&
      !caller.roles.includes(UserRole.SUPER_ADMIN)
    ) {
      throw new ForbiddenException(
        'Only a Super Admin can remove the Super Admin role',
      )
    }
    if (!target.roles.includes(role)) {
      throw new BadRequestException(`User does not have role ${role}`)
    }
    if (role === UserRole.SUPER_ADMIN) {
      const others = await this.prisma.user.count({
        where: {
          id: { not: target.id },
          roles: { has: UserRole.SUPER_ADMIN },
          accountStatus: AccountStatus.ACTIVE,
        },
      })
      if (others === 0) {
        throw new ForbiddenException(
          'Cannot remove the last active Super Admin role',
        )
      }
    }

    const nextRoles = target.roles.filter((r) => r !== role)
    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { roles: { set: nextRoles }, tokenVersion: { increment: 1 } },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })
    await this.lifecycle.revokeAllSessions(target.id)

    await this.logEvent({
      event: 'user_role_removed',
      userId: caller.id,
      identifier: updated.email ?? undefined,
      ipAddress: ctx?.ipAddress,
      userAgent: ctx?.userAgent,
      metadata: {
        targetUserId: updated.id,
        removedRole: role,
        remainingRoles: updated.roles,
      },
      success: true,
    })

    return { statusCode: 200, message: `Role ${role} removed`, data: updated }
  }

  // ─── List ─────────────────────────────────────────────────────────────────

  async listUsers(caller: Actor, query: ListUsersQuery) {
    const page = query.page ?? 1
    const limit = query.limit ?? 50
    const skip = (page - 1) * limit

    // Practice scope. Priority (widest first): OPS/SUPER unscoped →
    // MEDICAL_DIRECTOR headed practices → COORDINATOR own practice →
    // explicit query filter for the org-wide roles. Scoped roles are
    // locked server-side regardless of what they send, and can never be
    // widened past their memberships. `scopePracticeIds === null` means
    // no practice filter (org-wide). Also pulled here so the response can
    // carry the practice name for COORDINATOR (they can't list practices
    // to resolve it client-side — that endpoint is gated to OPS/SUPER).
    let scopePracticeIds: string[] | null = null
    let coordinatorScope: { id: string; name: string } | null = null

    const isOrgWide =
      caller.roles.includes(UserRole.SUPER_ADMIN) ||
      caller.roles.includes(UserRole.HEALPLACE_OPS)

    if (isOrgWide) {
      // OPS / SUPER — unscoped; honor an explicit practice filter if sent.
      if (query.practiceId) scopePracticeIds = [query.practiceId]
    } else {
      // Scoped roles (MED_DIR / PROVIDER / COORDINATOR) — the roster is limited
      // to the practices they belong to, then narrowed to the ACTIVE (selected)
      // practice carried on the session. A single-practice user is effectively
      // already narrowed; a multi-practice user must switch practice (header
      // dropdown) to see another practice's roster. Zero memberships → empty
      // array → zero rows (safe). PROVIDER is read-only (controller GET @Roles);
      // they see the roster but every write is blocked at the guard.
      const membership = new Set<string>()
      if (caller.roles.includes(UserRole.MEDICAL_DIRECTOR)) {
        const headed = await this.prisma.practiceMedicalDirector.findMany({
          where: { userId: caller.id },
          select: { practiceId: true },
        })
        for (const r of headed) membership.add(r.practiceId)
      }
      if (caller.roles.includes(UserRole.PROVIDER)) {
        const memberOf = await this.prisma.practiceProvider.findMany({
          where: { userId: caller.id },
          select: { practiceId: true },
        })
        for (const r of memberOf) membership.add(r.practiceId)
      }
      if (caller.roles.includes(UserRole.COORDINATOR)) {
        const own = await this.prisma.practiceCoordinator.findUnique({
          where: { userId: caller.id },
          select: { practice: { select: { id: true, name: true } } },
        })
        if (own) {
          membership.add(own.practice.id)
          coordinatorScope = { id: own.practice.id, name: own.practice.name }
        }
      }
      let ids = Array.from(membership)
      // Narrow to the active/selected practice when the session carries one and
      // it is a real membership — never widen past it (stale/forged claim is
      // ignored). Single-practice users are unaffected (their active id equals
      // their only membership).
      if (caller.activePracticeId && ids.includes(caller.activePracticeId)) {
        ids = [caller.activePracticeId]
      }
      scopePracticeIds = ids
    }

    // Build the User where-clause. The filters compose as AND of three
    // independent groups so search and practice never bleed into the
    // same OR (which used to make `?search=foo&practiceId=bar` match
    // "name like foo OR email like foo OR has practice bar" — too loose).
    //
    //   role     → top-level `roles: { has: ... }`
    //   search   → AND-group: OR of name+email match
    //   practice → AND-group: OR of all valid practice memberships
    const userWhere: Prisma.UserWhereInput = {}
    const andGroups: Prisma.UserWhereInput[] = []

    if (query.role) {
      userWhere.roles = { has: query.role }
    }

    if (query.search) {
      const term = query.search.trim()
      if (term.length > 0) {
        andGroups.push({
          OR: [
            { email: { contains: term, mode: 'insensitive' } },
            { name: { contains: term, mode: 'insensitive' } },
          ],
        })
      }
    }

    if (scopePracticeIds) {
      // Practice-scoped roster — for an explicit OPS / SUPER practice filter
      // AND for COORDINATOR (own practice) / MED_DIR (headed practices),
      // locked above. Accept any of: a patient assigned to those practices,
      // a patient invited into them (assignment-pending), or a staff member
      // of them (provider, MD, coordinator memberships) — so the caller sees
      // the patients PLUS the providers, medical directors, and coordinators.
      // The invite back-reference matters because a patient invited by the
      // coordinator has no PatientProviderAssignment until Provider Verify
      // runs — without it they'd be invisible to the coordinator who invited
      // them. An optional `query.role` further narrows the set (handled above).
      // An empty array yields `{ in: [] }` → zero rows (safe deny).
      andGroups.push({
        OR: [
          {
            providerAssignmentAsPatient: {
              is: { practiceId: { in: scopePracticeIds } },
            },
          },
          {
            userInviteCreated: {
              is: { practiceId: { in: scopePracticeIds } },
            },
          },
          {
            practiceProviderMemberships: {
              some: { practiceId: { in: scopePracticeIds } },
            },
          },
          {
            practiceMedicalDirectorMemberships: {
              some: { practiceId: { in: scopePracticeIds } },
            },
          },
          {
            practiceCoordinator: { is: { practiceId: { in: scopePracticeIds } } },
          },
        ],
      })
    }

    if (andGroups.length > 0) {
      userWhere.AND = andGroups
    }

    // Status filter — ACTIVE/BLOCKED/SUSPENDED/DEACTIVATED map straight
    // through. INVITE_PENDING is a synthetic filter: it has no User row
    // yet, so we exclude users and fetch invites instead.
    if (query.status === UserListStatus.INVITE_PENDING) {
      // Return just the invite list — no users.
      const invites = await this.fetchPendingInvites({
        caller,
        practiceIds: scopePracticeIds,
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
      // UserListStatus has no SYSTEM value, so a specific status filter can
      // never surface a system-principal row.
      userWhere.accountStatus = query.status as AccountStatus
    } else {
      // Hide permanently-closed accounts by default — they're anonymized
      // tombstones (no name/email/roles), so they'd render as blank, non-
      // actionable rows. Their history lives in AccountClosureLog. An explicit
      // ?status=CLOSED still fetches them if ever needed.
      //
      // Also hide SYSTEM principals (audit registry, 2026-07-03): reserved
      // non-login rows that must never appear in the human user roster.
      userWhere.accountStatus = { notIn: [AccountStatus.CLOSED, AccountStatus.SYSTEM] }
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
          displayId: true,
          roles: true,
          accountStatus: true,
          createdAt: true,
          // Practice associations — flattened to a single `practiceId`
          // below so the admin /users list can show the practice column
          // for activated users (not just pending invites). One relation
          // per role; the first-matching wins in role priority order.
          //
          // PATIENT note — accept-invite doesn't create the full
          // PatientProviderAssignment (it needs primary provider /
          // backup / MD ids the inviter didn't supply). Until Provider
          // Verify fills those in, the practice the patient was invited
          // into only lives on UserInvite.practiceId, reachable through
          // the back-reference `userInviteCreated` (User @unique on the
          // join side). Falling back to it keeps the practice column
          // honest for accepted patient invites.
          providerAssignmentAsPatient: { select: { practiceId: true } },
          practiceCoordinator: { select: { practiceId: true } },
          // When the roster is scoped to a practice (or the active/selected
          // one), filter the many-to-many memberships to that scope so the
          // flattened practice column reflects the practice the row matched on
          // — NOT an arbitrary other practice the user also belongs to. A
          // multi-practice provider viewed under practice B must show "B", not
          // whichever membership happens to be first. Unscoped (OPS / SUPER)
          // keeps the take-1 arbitrary primary membership.
          practiceProviderMemberships: {
            where: scopePracticeIds
              ? { practiceId: { in: scopePracticeIds } }
              : undefined,
            select: { practiceId: true },
            take: 1,
          },
          practiceMedicalDirectorMemberships: {
            where: scopePracticeIds
              ? { practiceId: { in: scopePracticeIds } }
              : undefined,
            select: { practiceId: true },
            take: 1,
          },
          userInviteCreated: { select: { practiceId: true } },
          // MFA enrollment state (Manisha 2026-06-12 §6) — drives the "Reset
          // MFA" action: only shown for users who actually have an enrolled
          // authenticator. enrolledAt is nulled on admin reset, so the button
          // disappears after a reset (once the list refetches).
          totpCredential: { select: { enrolledAt: true } },
          // Patient biometric (WebAuthn) — drives the "Reset biometric" support
          // action, shown only for patients who have a registered passkey.
          _count: { select: { webAuthnCredentials: true } },
        },
      }),
      this.prisma.user.count({ where: userWhere }),
    ])

    const withPractice = users.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      displayId: u.displayId,
      roles: u.roles,
      accountStatus: u.accountStatus,
      createdAt: u.createdAt,
      mfaEnrolled: u.totpCredential?.enrolledAt != null,
      biometricEnrolled: u._count.webAuthnCredentials > 0,
      practiceId:
        u.providerAssignmentAsPatient?.practiceId ??
        u.practiceCoordinator?.practiceId ??
        u.practiceProviderMemberships[0]?.practiceId ??
        u.practiceMedicalDirectorMemberships[0]?.practiceId ??
        u.userInviteCreated?.practiceId ??
        null,
    }))

    // COORDINATOR — return the same rich rows as OPS/SUPER (incl. roles) so the
    // table can show the practice's patients, providers, medical directors, and
    // the coordinator themselves. The set is already scoped to their practice
    // by the where-clause. `scopePractice` surfaces the coordinator's own
    // practice (id + name) for the header — they can't list practices to
    // resolve the name client-side. Row-level actions stay restricted by the
    // existing role checks (a coordinator can still only deactivate patients).
    if (caller.roles.includes(UserRole.COORDINATOR)) {
      return {
        statusCode: 200,
        message: 'Users retrieved',
        data: withPractice,
        page,
        limit,
        total,
        invites: await this.fetchPendingInvites({
          caller,
          practiceIds: scopePracticeIds,
          role: query.role,
          search: query.search,
        }),
        scopePractice: coordinatorScope,
      }
    }

    return {
      statusCode: 200,
      message: 'Users retrieved',
      data: withPractice,
      page,
      limit,
      total,
      invites: await this.fetchPendingInvites({
        caller,
        practiceIds: scopePracticeIds,
        role: query.role,
        search: query.search,
      }),
    }
  }

  private async fetchPendingInvites(params: {
    caller: Actor
    practiceIds: string[] | null
    role?: UserRole
    search?: string
  }) {
    const where: Prisma.UserInviteWhereInput = {
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    }
    if (params.practiceIds) where.practiceId = { in: params.practiceIds }
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
    // COORDINATOR / MED_DIR are already scoped to their practice(s) via
    // practiceIds above; they now manage patients, providers, AND medical
    // directors, so we
    // no longer force PATIENT-only here (the optional `role` param still
    // narrows it when a role filter is applied).

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
      // PATIENT activations land on the patient app; every other role is
      // an admin-app user (mirrors admin/src/proxy.ts ADMIN_ROLES, which
      // includes COORDINATOR). The link is the frontend route — the page
      // itself calls GET /api/v2/auth/invite/:token to render details and
      // POST /accept to claim, so this URL should never point at the API.
      const baseUrlConfigKey =
        params.invite.role === UserRole.PATIENT
          ? 'PATIENT_BASE_URL'
          : 'ADMIN_BASE_URL'
      const baseUrl = this.config.get<string>(
        baseUrlConfigKey,
        params.invite.role === UserRole.PATIENT
          ? 'http://localhost:3000'
          : 'http://localhost:3001',
      )
      const inviteUrl = `${baseUrl}/activate/${params.rawToken}`

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
