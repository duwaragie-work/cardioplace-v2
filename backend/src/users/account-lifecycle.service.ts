import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmailService } from '../email/email.service.js'
import { ConfigService } from '@nestjs/config'
import { AccountStatus, UserRole } from '../generated/prisma/enums.js'

/**
 * AccountLifecycleService — single home for the state-transition MECHANICS of
 * deactivate / reactivate / permanent-close (phase/28). Authorization (who may
 * act on whom) stays in the callers (UsersService for admin paths; the auth
 * controller enforces "own account" for patient self-service). This service
 * assumes the caller is already authorized and just performs the transition
 * atomically + writes the audit trail.
 *
 * Invariants enforced here (belong to the mechanics, not the authz layer):
 *   • deactivate / close of the LAST active SUPER_ADMIN is blocked — the system
 *     can never be left with no administrator.
 *   • every off-transition bumps User.tokenVersion (the session kill-switch)
 *     AND wipes AuthSession + RefreshToken rows, so live sessions die instantly.
 *   • permanent-close is irreversible: PII anonymised, PHI rows retained
 *     (HIPAA §164.316), account credentials destroyed, status = CLOSED.
 */

export interface LifecycleContext {
  ipAddress?: string
  userAgent?: string
}

interface OffOpts {
  /** The user id performing the action (admin, or the account holder itself). */
  actorId: string
  actorRoles?: UserRole[]
  /** true = the account holder acted on their own account (patient self-service). */
  selfService?: boolean
  reason?: string
  ctx?: LifecycleContext
}

interface ReactivateOpts {
  actorId: string
  actorRoles?: UserRole[]
  /** Only restore the pre-deactivation roles when explicitly asked (HIPAA
   *  N12 — reactivation is a fresh re-authorization, not an automatic
   *  privilege hand-back). */
  restoreRoles?: boolean
  ctx?: LifecycleContext
}

/** Purpose claim on the emailed self-close token so it can't be swapped for
 *  an access/refresh token. */
const CLOSE_TOKEN_PURPOSE = 'account_permanent_close'

@Injectable()
export class AccountLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailService,
    private readonly config: ConfigService,
  ) {}

  // ─── Session kill-switch ──────────────────────────────────────────────────

  /**
   * Wipe every AuthSession + RefreshToken row for a user in one transaction.
   * AuthSession carries a FK to RefreshToken, so sessions are deleted first.
   * Returns the number of refresh tokens removed (for logging).
   */
  async revokeAllSessions(userId: string): Promise<number> {
    const [, refresh] = await this.prisma.$transaction([
      this.prisma.authSession.deleteMany({ where: { userId } }),
      this.prisma.refreshToken.deleteMany({ where: { userId } }),
    ])
    return refresh.count
  }

  // ─── Deactivate (reversible) ──────────────────────────────────────────────

  async deactivate(targetUserId: string, opts: OffOpts) {
    const target = await this.loadTarget(targetUserId)

    if (target.accountStatus === AccountStatus.CLOSED) {
      throw new BadRequestException('Account is permanently closed')
    }
    if (target.accountStatus === AccountStatus.DEACTIVATED) {
      throw new BadRequestException('User is already deactivated')
    }
    await this.assertNotLastSuperAdmin(target)

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: {
        accountStatus: AccountStatus.DEACTIVATED,
        // Kill-switch: invalidate every token minted before this instant.
        tokenVersion: { increment: 1 },
        // Capture roles so a later reactivate(restoreRoles) can hand them back.
        terminationSnapshot: { roles: target.roles, capturedAt: new Date().toISOString() },
      },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })

    await this.revokeAllSessions(target.id)
    await this.writeClosureLog({
      userId: target.id,
      displayId: target.displayId,
      action: 'DEACTIVATE',
      opts,
      snapshot: { roles: target.roles },
    })
    return updated
  }

  // ─── Reactivate ───────────────────────────────────────────────────────────

  async reactivate(targetUserId: string, opts: ReactivateOpts) {
    const target = await this.loadTarget(targetUserId)

    if (target.accountStatus === AccountStatus.CLOSED) {
      throw new BadRequestException('A permanently closed account cannot be reactivated')
    }
    if (target.accountStatus === AccountStatus.ACTIVE) {
      throw new BadRequestException('User is already active')
    }

    // restoreRoles → hand back the captured roles verbatim. Otherwise strip
    // privileged (staff) roles and keep only the base PATIENT role, so a
    // reactivated staff account comes back with NO powers until an admin
    // explicitly re-grants them (fresh re-authorization).
    const snapshotRoles = this.snapshotRoles(target.terminationSnapshot) ?? target.roles
    const roles = opts.restoreRoles
      ? snapshotRoles
      : snapshotRoles.filter((r) => r === UserRole.PATIENT)

    const updated = await this.prisma.user.update({
      where: { id: target.id },
      data: { accountStatus: AccountStatus.ACTIVE, roles },
      select: { id: true, email: true, roles: true, accountStatus: true },
    })

    await this.writeClosureLog({
      userId: target.id,
      displayId: target.displayId,
      action: 'REACTIVATE',
      opts: { actorId: opts.actorId, actorRoles: opts.actorRoles, ctx: opts.ctx },
      snapshot: { restoredRoles: roles, restoreRoles: !!opts.restoreRoles },
    })
    return updated
  }

  // ─── Permanent close (irreversible tombstone) ─────────────────────────────

  async permanentClose(targetUserId: string, opts: OffOpts) {
    const target = await this.loadTarget(targetUserId)

    if (target.accountStatus === AccountStatus.CLOSED) {
      throw new BadRequestException('Account is already closed')
    }
    await this.assertNotLastSuperAdmin(target)

    await this.prisma.$transaction(async (tx) => {
      // Anonymise PII on the User row; RETAIN all PHI rows (journal entries,
      // alerts, medications, thresholds) per HIPAA §164.316.
      await tx.user.update({
        where: { id: target.id },
        data: {
          email: null,
          name: null,
          dateOfBirth: null,
          pwdhash: null,
          roles: [],
          accountStatus: AccountStatus.CLOSED,
          tombstonedAt: new Date(),
          tombstonedById: opts.actorId,
          closureReason: opts.reason ?? null,
          tokenVersion: { increment: 1 },
          terminationSnapshot: {
            roles: target.roles,
            closedAt: new Date().toISOString(),
          },
        },
      })
      // Destroy authenticators — a closed account must have no way back in.
      await tx.totpCredential.deleteMany({ where: { userId: target.id } })
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: target.id } })
      await tx.webAuthnCredential.deleteMany({ where: { userId: target.id } })
      // Detach the DisplayId ledger (userId → null) per its tombstone design;
      // the User.displayId column is kept as a non-PII audit handle.
      await tx.displayId.updateMany({
        where: { userId: target.id },
        data: { userId: null },
      })
      await tx.authSession.deleteMany({ where: { userId: target.id } })
      await tx.refreshToken.deleteMany({ where: { userId: target.id } })
    })

    await this.writeClosureLog({
      userId: target.id,
      displayId: target.displayId,
      action: 'PERMANENT_CLOSE',
      opts,
      snapshot: { roles: target.roles },
    })
    return { id: target.id, accountStatus: AccountStatus.CLOSED }
  }

  // ─── Emailed self-close token (patient anti-impulse gate) ─────────────────

  /** Sign a single-use, 1-hour token and email the patient a confirmation
   *  link. The token is the ONLY way to reach permanent-close/confirm. */
  async requestSelfClose(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, accountStatus: true },
    })
    if (!user) throw new NotFoundException('User not found')
    if (user.accountStatus === AccountStatus.CLOSED) {
      throw new BadRequestException('Account is already closed')
    }
    if (!user.email) {
      throw new BadRequestException('No email on file to confirm closure')
    }

    const token = await this.jwt.signAsync(
      { sub: user.id, purpose: CLOSE_TOKEN_PURPOSE },
      { expiresIn: '1h' },
    )
    const base = this.config.get<string>('WEB_APP_URL', 'http://localhost:3000')
      .split(',')[0]
      .trim()
    const link = `${base}/settings/close-account?token=${encodeURIComponent(token)}`
    await this.email.sendEmail(
      user.email,
      'Confirm you want to permanently close your Cardioplace account',
      selfCloseEmailHtml(user.name ?? '', link),
    )
  }

  /** Verify an emailed self-close token; returns the user id it authorises. */
  async verifySelfCloseToken(token: string): Promise<string> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; purpose?: string }>(token)
      if (payload.purpose !== CLOSE_TOKEN_PURPOSE || !payload.sub) {
        throw new UnauthorizedException('Invalid closure link')
      }
      return payload.sub
    } catch {
      throw new UnauthorizedException('This closure link is invalid or has expired')
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async loadTarget(userId: string) {
    const target = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayId: true,
        roles: true,
        accountStatus: true,
        terminationSnapshot: true,
      },
    })
    if (!target) throw new NotFoundException('User not found')
    return target
  }

  /** Block turning off / closing the last remaining active SUPER_ADMIN. */
  private async assertNotLastSuperAdmin(target: {
    id: string
    roles: UserRole[]
  }): Promise<void> {
    if (!target.roles.includes(UserRole.SUPER_ADMIN)) return
    const otherAdmins = await this.prisma.user.count({
      where: {
        id: { not: target.id },
        roles: { has: UserRole.SUPER_ADMIN },
        accountStatus: AccountStatus.ACTIVE,
      },
    })
    if (otherAdmins === 0) {
      throw new ForbiddenException(
        'Cannot deactivate or close the last active Super Admin',
      )
    }
  }

  private snapshotRoles(snapshot: unknown): UserRole[] | null {
    if (
      snapshot &&
      typeof snapshot === 'object' &&
      'roles' in snapshot &&
      Array.isArray((snapshot as { roles: unknown }).roles)
    ) {
      return (snapshot as { roles: UserRole[] }).roles
    }
    return null
  }

  private async writeClosureLog(args: {
    userId: string
    displayId: string | null
    action: 'DEACTIVATE' | 'REACTIVATE' | 'PERMANENT_CLOSE'
    opts: {
      actorId: string
      actorRoles?: UserRole[]
      selfService?: boolean
      reason?: string
      ctx?: LifecycleContext
    }
    snapshot?: unknown
  }): Promise<void> {
    await this.prisma.accountClosureLog.create({
      data: {
        userId: args.userId,
        displayId: args.displayId,
        action: args.action,
        performedById: args.opts.actorId,
        performedByRole: args.opts.actorRoles?.join(',') ?? null,
        selfService: args.opts.selfService ?? false,
        reason: args.opts.reason ?? null,
        snapshot: (args.snapshot ?? null) as never,
        ipAddress: args.opts.ctx?.ipAddress ?? null,
        userAgent: args.opts.ctx?.userAgent ?? null,
      },
    })
  }
}

function selfCloseEmailHtml(name: string, link: string): string {
  const greeting = name ? `Hi ${name},` : 'Hi,'
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; color: #1f2937;">
      <h2 style="color: #7B00E0;">Confirm account closure</h2>
      <p>${greeting}</p>
      <p>You asked to <strong>permanently close</strong> your Cardioplace account.
         This cannot be undone — you will lose access to your dashboard and history.</p>
      <p>If this was you, confirm within the next hour:</p>
      <p>
        <a href="${link}" style="display:inline-block;background:#B91C1C;color:#fff;
           padding:12px 20px;border-radius:9999px;text-decoration:none;font-weight:600;">
          Permanently close my account
        </a>
      </p>
      <p style="color:#6B7280;font-size:13px;">
        If you did not request this, ignore this email — your account stays exactly as it is.
        This link expires in 1 hour.
      </p>
    </div>
  `
}
