import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { createHash, randomBytes, randomInt } from 'crypto'
import type { Profile } from 'passport-google-oauth20'
import { POLICY_VERSION, TRAINING_ACK_VERSION } from '@cardioplace/shared'
import { EmailService } from '../email/email.service.js'
import {
  EMAIL_TEMPLATE_VERSION,
  magicLinkEmailHtml,
  otpEmailHtml,
  welcomeEmailHtml,
} from '../email/email-templates.js'
import {
  AccountStatus,
  DisplayIdClass,
  OnboardingStatus,
  UserRole,
} from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { writeAuditWithRetry } from '../common/audit/write-with-retry.js'
import { DisplayIdService } from '../users/display-id.service.js'
import { BcryptService } from './bcrypt.service.js'
import { GeolocationService } from './geolocation.service.js'
import { MfaService } from './mfa.service.js'
import { WebAuthnService } from './webauthn.service.js'
import type {
  AuthenticatorTransportFuture,
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'
import { mfaResetEmailHtml, biometricResetEmailHtml } from '../email/email-templates.js'
import type { ProfileDto } from './dto/profile.dto.js'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string
  refreshToken: string
}

export interface AuthResponse extends TokenPair {
  /** Discriminator for AuthVerifyResult. AUTHENTICATED = real token pair
   *  in the response; the FE routes to the dashboard. The selector branch
   *  uses 'PRACTICE_SELECT_REQUIRED' instead — see PracticeSelectRequired. */
  status?: 'AUTHENTICATED'
  userId: string
  email: string | null
  onboarding_required: boolean
  roles: UserRole[]
  login_method: 'otp' | 'magic_link' | 'google' | 'apple'
  name: string | null
  /** Phase/practice-identity — the practice the session is acting as. NULL
   *  for SUPER_ADMIN / HEALPLACE_OPS / PATIENT (audit captures null). */
  activePracticeId?: string | null
  /** Phase/practice-identity (PR #90 Bug A) — the resolved active practice
   *  WITH its name, so the admin chip can render "Acting as: <name>" on the
   *  fresh sign-in/select window without waiting for /auth/profile. NULL when
   *  activePracticeId is null. */
  activePractice?: { id: string; name: string } | null
  /** The user's switchable practice memberships. Mirrors /auth/profile so the
   *  selector + chip dropdown have the full list immediately after select. */
  availablePractices?: Array<{ id: string; name: string }>
  /** MFA — set true when enforcement is on and this MFA-required user has not
   *  yet enrolled TOTP. Tokens ARE issued (enrollment needs a session) but the
   *  FE redirects straight to the enrollment page instead of the dashboard,
   *  so the gate appears immediately after sign-in (Manisha 2026-06-12 §6). */
  mfaEnrollmentRequired?: boolean
  /** Practice-select handoff for a first-time-enrolling MULTI-practice provider.
   *  Enrollment needs a session, so tokens ARE issued (with activePracticeId
   *  null), but the FE must route enroll → /sign-in/select-practice → dashboard
   *  and never let a null-practice session reach the dashboard. The selector
   *  page exchanges `practiceSelectChallengeToken` (a practice_select JWT) for a
   *  fresh practice-scoped token pair. Only set in that one branch. */
  practiceSelectRequired?: boolean
  practiceSelectChallengeToken?: string
  practices?: Array<{ id: string; name: string }>
}

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1) — when a
 * multi-practice provider signs in, we don't issue tokens yet; instead the
 * verify endpoint returns this shape so the FE routes to the selector page.
 * The challenge token is a short-lived signed JWT carrying the verified
 * userId; the selector POST exchanges it for the real token pair plus the
 * chosen practice.
 */
export interface PracticeSelectRequired {
  status: 'PRACTICE_SELECT_REQUIRED'
  challengeToken: string
  practices: Array<{ id: string; name: string }>
}

/**
 * MFA (Manisha 2026-06-12 Access Control §6, HIPAA 45 CFR §164.312(d)) — when
 * an MFA-enrolled provider/admin clears the first factor (and, if applicable,
 * the practice selector) we do NOT issue tokens yet. We return this shape so
 * the FE routes to the TOTP challenge page. The challenge token is a
 * short-lived signed JWT carrying the verified userId + resolved
 * activePracticeId; POST /mfa/challenge (or /mfa/recovery) exchanges it for
 * the real token pair.
 */
export interface MfaRequired {
  status: 'MFA_REQUIRED'
  challengeToken: string
}

/**
 * Invite activation for an admin-role user (Manisha 2026-06-12 §6). The
 * account is created and made ACTIVE, but NO session is issued — admin sign-in
 * must go through OTP (and then TOTP/MFA), so auto-logging them in from the
 * invite link would bypass the second factor. The FE redirects to /sign-in
 * instead. Patients still get a session (auto-login) on activation.
 */
export interface InviteSignInRequired {
  status: 'SIGN_IN_REQUIRED'
  roles: UserRole[]
}

/**
 * Patient biometric second factor (WebAuthn / passkeys). When a patient who
 * has registered a biometric device clears the first factor (OTP / magic-link)
 * we do NOT issue tokens yet — we return this shape so the FE fetches the
 * assertion options (POST /webauthn/authenticate/options) and completes the
 * Face ID / fingerprint prompt. The challenge token is a short-lived signed JWT
 * carrying the verified userId + the WebAuthn challenge; POST
 * /webauthn/authenticate/verify exchanges it for the real token pair.
 */
export interface WebAuthnRequired {
  status: 'WEBAUTHN_REQUIRED'
  challengeToken: string
}

export type AuthVerifyResult =
  | AuthResponse
  | PracticeSelectRequired
  | MfaRequired
  | WebAuthnRequired

// June 2026 — session context piped from controller → service to populate
// AuthSession (concurrent-session limit + idle tracking). All optional —
// social/legacy paths may omit individual fields.
export interface SessionContext {
  userAgent?: string
  deviceId?: string
  ipAddress?: string
  /** 'web' | 'mobile' — resolved by controller (x-device-platform → UA fallback). */
  deviceType?: string
  /** Phase/practice-identity — the practice the session is acting as.
   *  Single-practice users auto-set on sign-in; multi-practice users get a
   *  selector challenge before tokens are issued. SUPER_ADMIN /
   *  HEALPLACE_OPS / PATIENT sessions leave this null. */
  activePracticeId?: string | null
}

interface MinimalUser {
  id: string
  email: string | null
  name: string | null
  roles: UserRole[]
  onboardingStatus: OnboardingStatus
  accountStatus: AccountStatus
}

export interface ProfileResult {
  message: string
  name: string | null
  dateOfBirth: Date | null
  communicationPreference?: string | null
  preferredLanguage?: string | null
  timezone: string | null
  onboardingStatus: OnboardingStatus
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function parseDuration(duration: string): number {
  const unit = duration.slice(-1)
  const value = parseInt(duration.slice(0, -1), 10)
  const map: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  }
  return value * (map[unit] ?? 86_400_000)
}

// Manisha 2026-06-12 Doc 2 Q1 — concurrent-session caps. Admin/provider
// users get 3 simultaneous sessions; patients get 1. The cap is enforced
// at issuance (4th login on an admin evicts the most-idle).
const ADMIN_SESSION_LIMIT = 3
const PATIENT_SESSION_LIMIT = 1
const ADMIN_ROLES: readonly UserRole[] = [
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.COORDINATOR,
  UserRole.HEALPLACE_OPS,
  UserRole.SUPER_ADMIN,
]

// Manisha 2026-06-12 Doc 3 Q7 — idle timeout. 15 min for web sessions,
// 5 min for mobile. The frontend hook drives the UX (warning toast + auto
// logout); the backend enforcement here is belt-and-suspenders so a stale
// session can't be revived via refresh even if the frontend timer was
// disabled or the request came from a non-browser client.
const IDLE_TIMEOUT_WEB_MS = 15 * 60_000
const IDLE_TIMEOUT_MOBILE_MS = 5 * 60_000

// Phase/practice-identity (Manisha 2026-06-12 Access Control §1) — roles
// for which a practice context is REQUIRED. A user with one of these roles
// who has zero PracticeProvider memberships cannot sign in (Forbidden). A
// user with two or more memberships gets the selector challenge.
// SUPER_ADMIN and HEALPLACE_OPS act org-wide and bypass the selector.
//
// COORDINATOR is INTENTIONALLY OMITTED — that role's membership lives on the
// 1:1 PracticeCoordinator relation, NOT PracticeProvider. Including them here
// caused every COORDINATOR sign-in to be blocked with "No practice membership"
// (specs 35.4 / 35.5 / 37.* / 38.1). resolvePracticeContext() handles
// COORDINATOR's auto-attribution from PracticeCoordinator below.
const MULTI_PRACTICE_ROLES: readonly UserRole[] = [
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
]

// 5-min challenge token TTL — long enough for the patient to walk through
// the selector page, short enough to bound replay risk if the token leaks.
const PRACTICE_SELECT_CHALLENGE_TTL = '5m'

// MFA (Manisha 2026-06-12 Access Control §6). Roles for which TOTP is the
// mandatory second factor. Patients are intentionally excluded — their
// (optional) biometric path is a later phase with its own table.
const MFA_REQUIRED_ROLES: readonly UserRole[] = [
  UserRole.PROVIDER,
  UserRole.MEDICAL_DIRECTOR,
  UserRole.COORDINATOR,
  UserRole.HEALPLACE_OPS,
  UserRole.SUPER_ADMIN,
]

// Short-lived MFA tokens. Challenge = post-first-factor, pre-token; enrollment
// carries the pending (not-yet-persisted) secret across the start→complete
// round-trip so we stay stateless across backend instances.
const MFA_CHALLENGE_TTL = '5m'
const MFA_ENROLL_TTL = '10m'

// Failed-attempt lockout (Manisha 2026-06-12 §6). 5 fails / 15 min → temporary
// lock (recovery code still works); 10 fails / 1 h → hard lock requiring admin
// reset. Counted from the mfa_challenge_failed AuthLog rows.
const MFA_SOFT_LOCK_THRESHOLD = 5
const MFA_SOFT_LOCK_WINDOW_MS = 15 * 60_000
const MFA_HARD_LOCK_THRESHOLD = 10
const MFA_HARD_LOCK_WINDOW_MS = 60 * 60_000

/** True if any of the user's roles makes TOTP mandatory. */
function requiresMfa(roles: UserRole[]): boolean {
  return roles.some((r) => MFA_REQUIRED_ROLES.includes(r))
}

// Patient biometric second factor (WebAuthn / passkeys). Optional + opt-in, so
// there's no enforcement flag — the gate fires only when the patient has
// registered at least one device. Short-lived tokens carry the challenge so
// the ceremony stays stateless across backend instances.
const WEBAUTHN_CHALLENGE_TTL = '5m'
const WEBAUTHN_REGISTER_TTL = '10m'

type PracticeResolution =
  | { kind: 'auto'; activePracticeId: string }
  | { kind: 'select'; practices: Array<{ id: string; name: string }> }
  | { kind: 'none' }
  | { kind: 'blocked' }

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private config: ConfigService,
    private bcryptService: BcryptService,
    private emailService: EmailService,
    private geolocation: GeolocationService,
    private mfaService: MfaService,
    private webAuthnService: WebAuthnService,
    private displayIdService: DisplayIdService,
  ) {}

  /**
   * Sends the one-shot welcome email after a User row is first created.
   * Carries the patient's permanent display ID so they have it handy for
   * support calls. Fire-and-forget — EmailService.sendEmail already
   * swallows transport failures, so we don't await this on the auth path.
   * See docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §5.
   */
  private dispatchWelcomeEmail(user: {
    id: string
    email: string | null
    name: string | null
    displayId: string | null
    roles: UserRole[]
  }): void {
    if (!user.email || !user.displayId) return
    const formatted = DisplayIdService.formatForDisplay(user.displayId)
    const isPatient = user.roles.includes(UserRole.PATIENT)
    void this.emailService.sendEmail(
      user.email,
      'Welcome to Cardioplace — your account ID',
      welcomeEmailHtml(user.name ?? '', formatted, isPatient),
      {
        template: 'welcome',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: user.id,
        metadata: { hasDisplayId: true },
      },
    )
  }

  // ─── Token Issuance ─────────────────────────────────────────────────────────

  async issueAccessToken(
    user: MinimalUser,
    activePracticeId?: string | null,
  ): Promise<string> {
    const expiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m')
    // phase/28 — stamp the account's current tokenVersion so jwt.strategy can
    // reject this token the instant the version is bumped (deactivate / close /
    // role removal). One PK read at issue time (sign-in / refresh only).
    const account = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { tokenVersion: true },
    })
    // @ts-expect-error - NestJS JWT accepts string for expiresIn despite type definition
    return await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        roles: user.roles,
        // Phase/practice-identity — null for SUPER_ADMIN / HEALPLACE_OPS /
        // PATIENT / no-practice users. Switching mints a fresh access
        // token so the FE picks up the new context immediately.
        activePracticeId: activePracticeId ?? null,
        tokenVersion: account?.tokenVersion ?? 0,
      },
      { expiresIn },
    )
  }

  /**
   * Issue a refresh token AND a paired AuthSession row in one transaction.
   * AuthSession is the canonical "active session" record used by the
   * concurrent-session cap (Phase 3) and the idle timeout (Phase 2).
   */
  async issueRefreshToken(
    userId: string,
    context?: SessionContext,
  ): Promise<string> {
    const rawToken = randomBytes(40).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d')
    const expiresAt = new Date(Date.now() + parseDuration(expiresIn))

    await this.prisma.$transaction(async (tx) => {
      const token = await tx.refreshToken.create({
        data: {
          tokenHash,
          expiresAt,
          userAgent: context?.userAgent,
          userId,
        },
      })
      await tx.authSession.create({
        data: {
          userId,
          refreshTokenId: token.id,
          deviceType: context?.deviceType ?? null,
          deviceId: context?.deviceId ?? null,
          userAgent: context?.userAgent ?? null,
          ipAddress: context?.ipAddress ?? null,
          geohash: this.geolocation.computeGeohash(context?.ipAddress ?? null),
          ipCountry: this.geolocation.lookupCountry(context?.ipAddress ?? null),
          // Phase/practice-identity — set on sign-in for single-/auto-set
          // and multi-practice (post-selector) paths; null for
          // SUPER_ADMIN / HEALPLACE_OPS / PATIENT.
          activePracticeId: context?.activePracticeId ?? null,
          expiresAt,
        },
      })
    })

    return rawToken
  }

  async rotateRefreshToken(
    rawToken: string,
    context?: SessionContext,
  ): Promise<TokenPair & { user: MinimalUser }> {
    const tokenHash = sha256(rawToken)

    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash },
      include: { user: true, authSession: true },
    })

    if (!existing || existing.revokedAt || existing.expiresAt < new Date()) {
      await this.logAuthEvent({
        event: 'refresh_failed',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_or_expired_token',
      })
      throw new UnauthorizedException('Invalid or expired refresh token')
    }

    if (existing.user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is ${existing.user.accountStatus.toLowerCase()}`,
      )
    }

    // Manisha 2026-06-12 Doc 3 Q7 — idle timeout. If the paired
    // AuthSession's lastActivityAt is older than the per-device-type
    // threshold, revoke the chain and force re-auth. Frontend hook
    // (useIdleTimeout) drives the UX side; this is the belt-and-suspenders
    // backend gate so a non-browser client or a disabled hook can't keep
    // a stale session alive. Legacy sessions (authSession === null,
    // issued before this migration) skip the check — they get one more
    // refresh-grace and are upgraded to a tracked session by the rotate
    // path below.
    if (existing.authSession) {
      const idleLimit =
        existing.authSession.deviceType === 'mobile'
          ? IDLE_TIMEOUT_MOBILE_MS
          : IDLE_TIMEOUT_WEB_MS
      const idleMs =
        Date.now() - existing.authSession.lastActivityAt.getTime()
      if (idleMs > idleLimit) {
        await this.prisma.$transaction([
          this.prisma.refreshToken.update({
            where: { id: existing.id },
            data: { revokedAt: new Date() },
          }),
          this.prisma.authSession.delete({
            where: { id: existing.authSession.id },
          }),
        ])
        await this.logAuthEvent({
          event: 'idle_timeout',
          userId: existing.user.id,
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            idleMs,
            deviceType: existing.authSession.deviceType ?? 'web',
          },
          success: false,
          errorCode: 'idle_timeout',
        })
        throw new UnauthorizedException('Session idle timeout')
      }
    }

    // Rotation: revoke the old token, issue a new one, and re-point the
    // AuthSession (same logical session, fresh tokens). lastActivityAt
    // updates via @updatedAt — Phase 2's idle check above reads it.
    const expiresIn = this.config.get<string>('JWT_REFRESH_EXPIRES_IN', '30d')
    const newExpiresAt = new Date(Date.now() + parseDuration(expiresIn))
    const newRawToken = randomBytes(40).toString('hex')
    const newTokenHash = sha256(newRawToken)

    // Manisha 2026-06-12 Doc 2 Q1 — geolocation anomaly check. Compare the
    // request's current geohash against the stored value; if both are
    // non-null and differ, write a `geolocation_anomaly` audit row to
    // AuthLog. Audit-only — the rotation always proceeds.
    const currentGeohash = this.geolocation.computeGeohash(context?.ipAddress ?? null)
    const currentCountry = this.geolocation.lookupCountry(context?.ipAddress ?? null)
    const storedGeohash = existing.authSession?.geohash ?? null
    const storedCountry = existing.authSession?.ipCountry ?? null
    const anomaly = this.geolocation.isAnomaly(storedGeohash, currentGeohash)

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      })
      const newToken = await tx.refreshToken.create({
        data: {
          tokenHash: newTokenHash,
          expiresAt: newExpiresAt,
          userAgent: context?.userAgent,
          userId: existing.userId,
        },
      })
      if (existing.authSession) {
        await tx.authSession.update({
          where: { id: existing.authSession.id },
          data: {
            refreshTokenId: newToken.id,
            expiresAt: newExpiresAt,
            userAgent: context?.userAgent ?? existing.authSession.userAgent,
            ipAddress: context?.ipAddress ?? existing.authSession.ipAddress,
            deviceId: context?.deviceId ?? existing.authSession.deviceId,
            geohash: currentGeohash ?? existing.authSession.geohash,
            ipCountry: currentCountry ?? existing.authSession.ipCountry,
          },
        })
      } else {
        // Defensive: legacy refresh tokens issued before the AuthSession
        // model existed don't have a paired session row. Create one now so
        // the session-cap accounting stays consistent on the next login.
        await tx.authSession.create({
          data: {
            userId: existing.userId,
            refreshTokenId: newToken.id,
            deviceType: context?.deviceType ?? null,
            deviceId: context?.deviceId ?? null,
            userAgent: context?.userAgent ?? null,
            ipAddress: context?.ipAddress ?? null,
            geohash: currentGeohash,
            ipCountry: currentCountry,
            expiresAt: newExpiresAt,
          },
        })
      }
    })

    if (anomaly) {
      await this.logAuthEvent({
        event: 'geolocation_anomaly',
        userId: existing.user.id,
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          authSessionId: existing.authSession?.id,
          storedGeohash,
          currentGeohash,
          storedCountry,
          currentCountry,
        },
        success: true,
      })
    }

    // Phase/practice-identity rehydrate-fix root cause (smoke 2026-06-18) —
    // the new access token MUST carry the AuthSession's activePracticeId
    // claim. Without it, every browser refresh quietly strips the practice
    // context: the FE's rehydrate() got a JWT with activePracticeId=null,
    // /auth/profile via @ActiveContext() got null, getProfile resolved
    // activePractice=null, ZeroPracticeModal fired (or for the multi-
    // practice provider's audited writes, practiceContext silently NULL'd).
    // The AuthSession row preserves activePracticeId across rotation —
    // the rotation just wasn't propagating it to the new JWT. Source of
    // truth is the (now-just-updated) session; legacy refresh tokens with
    // no paired session simply get null (no practice context to preserve).
    const accessToken = await this.issueAccessToken(
      existing.user,
      existing.authSession?.activePracticeId ?? null,
    )

    await this.logAuthEvent({
      event: 'refresh_success',
      userId: existing.user.id,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    return {
      accessToken,
      refreshToken: newRawToken,
      user: existing.user,
    }
  }

  async revokeRefreshToken(
    rawToken: string,
    context?: SessionContext,
  ): Promise<void> {
    const tokenHash = sha256(rawToken)
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null },
      include: { user: true, authSession: true },
    })
    if (!existing) return

    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      })
      if (existing.authSession) {
        await tx.authSession.delete({
          where: { id: existing.authSession.id },
        })
      }
    })

    await this.logAuthEvent({
      event: 'logout',
      userId: existing.userId,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
  }

  /**
   * Manisha 2026-06-12 Doc 2 Q1 — cap concurrent sessions. PATIENT users
   * get 1 active session (a new login evicts the prior one); admin/
   * provider users get 3 (4th login evicts the most-idle, ordered by
   * AuthSession.lastActivityAt). Called from issueTokenPair before token
   * creation so the new session always lands inside the limit.
   */
  private async enforceSessionLimit(
    userId: string,
    roles: UserRole[],
  ): Promise<void> {
    const limit = roles.some((r) => ADMIN_ROLES.includes(r))
      ? ADMIN_SESSION_LIMIT
      : PATIENT_SESSION_LIMIT

    const sessions = await this.prisma.authSession.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
        refreshToken: { revokedAt: null },
      },
      orderBy: { lastActivityAt: 'asc' },
      select: { id: true, refreshTokenId: true },
    })

    if (sessions.length < limit) return

    // Evict the (sessions.length - limit + 1) most-idle so the incoming
    // login fits under the cap. For the patient (limit=1) case this
    // revokes the single prior session; for admins it's usually just
    // the oldest.
    const toEvict = sessions.slice(0, sessions.length - limit + 1)
    for (const session of toEvict) {
      await this.prisma.$transaction([
        this.prisma.refreshToken.update({
          where: { id: session.refreshTokenId },
          data: { revokedAt: new Date() },
        }),
        this.prisma.authSession.delete({ where: { id: session.id } }),
      ])
      await this.logAuthEvent({
        event: 'session_evicted',
        userId,
        success: true,
        metadata: {
          reason: 'role-limit-exceeded',
          evictedSessionId: session.id,
          limit,
        },
      })
    }
  }

  private async issueTokenPair(
    user: MinimalUser,
    context?: SessionContext,
  ): Promise<TokenPair> {
    await this.enforceSessionLimit(user.id, user.roles)
    const accessToken = await this.issueAccessToken(user, context?.activePracticeId ?? null)
    const refreshToken = await this.issueRefreshToken(user.id, context)
    return { accessToken, refreshToken }
  }

  /**
   * Phase/practice-identity — determines what to do about the active
   * practice context at sign-in time:
   *   • 'auto'    — single PracticeProvider membership; auto-set that id.
   *   • 'select'  — multiple memberships AND the user has at least one of
   *                 the MULTI_PRACTICE_ROLES; caller must return a
   *                 PRACTICE_SELECT_REQUIRED challenge.
   *   • 'blocked' — has a MULTI_PRACTICE_ROLE but zero memberships; refuse
   *                 sign-in (Forbidden).
   *   • 'none'    — SUPER_ADMIN / HEALPLACE_OPS / PATIENT or any non-multi
   *                 role; AuthSession.activePracticeId stays null.
   * Reuses the same `prisma.practiceProvider.findMany` shape the prior
   * RBAC work uses in patient-access.service.ts (Phase 1 commit a8111d6).
   */
  async resolvePracticeContext(
    userId: string,
    roles: UserRole[],
  ): Promise<PracticeResolution> {
    const isMultiPracticeRole = roles.some((r) =>
      MULTI_PRACTICE_ROLES.includes(r),
    )
    const isOrgWide =
      roles.includes(UserRole.SUPER_ADMIN) || roles.includes(UserRole.HEALPLACE_OPS)
    // Org-wide roles bypass selector even if they happen to have PracticeProvider
    // memberships — they act across the whole org. Patients + any non-multi
    // role also bypass.
    if (isOrgWide) return { kind: 'none' }

    // COORDINATOR — at-most-one practice via the 1:1 PracticeCoordinator
    // relation, never the multi-row PracticeProvider table. Auto-set the
    // activePracticeId so their audit attribution (practiceContext) is
    // populated, but never block sign-in or surface a selector. If the
    // COORDINATOR row is missing, fall through to 'none' so legacy accounts
    // can still sign in (the role-routing layer above gates what they can do).
    if (roles.includes(UserRole.COORDINATOR)) {
      const coord = await this.prisma.practiceCoordinator.findUnique({
        where: { userId },
        select: { practiceId: true },
      })
      if (coord) return { kind: 'auto', activePracticeId: coord.practiceId }
      // No PracticeCoordinator row: don't block (only PROVIDER / MED_DIR get
      // blocked for missing practice membership — Manisha 2026-06-12 §1
      // applies to clinical-decision roles, not front-desk roles).
      if (!isMultiPracticeRole) return { kind: 'none' }
    }

    if (!isMultiPracticeRole) return { kind: 'none' }

    // A clinical role's practice membership can live on EITHER relation:
    //   • PROVIDER        → PracticeProvider (provider-member of the practice)
    //   • MEDICAL_DIRECTOR → PracticeMedicalDirector (heads the practice) — and
    //     optionally PracticeProvider too if they also see patients directly.
    // Probe both and union by practiceId so a MED_DIR who heads a practice but
    // isn't a provider-member isn't wrongly blocked at sign-in. Mirrors the
    // COORDINATOR dual-relation fix (ba522f3) + resolvePracticeBundle. Manisha
    // §1 STILL blocks a clinical role with ZERO membership across BOTH
    // relations — the refusal rule is unchanged, only the lookup is corrected.
    const isMedDir = roles.includes(UserRole.MEDICAL_DIRECTOR)
    const [providerRows, medDirRows] = await Promise.all([
      this.prisma.practiceProvider.findMany({
        where: { userId },
        select: { practice: { select: { id: true, name: true } } },
      }),
      isMedDir
        ? this.prisma.practiceMedicalDirector.findMany({
            where: { userId },
            select: { practice: { select: { id: true, name: true } } },
          })
        : Promise.resolve([] as { practice: { id: string; name: string } }[]),
    ])
    const byId = new Map<string, { id: string; name: string }>()
    for (const r of [...providerRows, ...medDirRows]) {
      if (r.practice) byId.set(r.practice.id, r.practice)
    }
    const practices = Array.from(byId.values())
    if (practices.length === 0) return { kind: 'blocked' }
    if (practices.length === 1) {
      return { kind: 'auto', activePracticeId: practices[0].id }
    }
    return { kind: 'select', practices }
  }

  /**
   * Sign a short-lived JWT carrying the verified userId so the FE selector
   * page can echo it back without re-doing OTP verification. The `kind`
   * claim narrows accepted tokens to ones we issued for THIS flow — a
   * regular access token can't be replayed as a challenge.
   */
  private async signPracticeSelectChallenge(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, kind: 'practice_select' },
      { expiresIn: PRACTICE_SELECT_CHALLENGE_TTL },
    )
  }

  /**
   * Shared first-factor finalizer (Manisha 2026-06-12 §1 + §6). Ordering:
   * authenticate the PERSON fully (second factor) BEFORE they pick a practice
   * context, then hand off to the selector. So the sequence is:
   *   first factor (OTP / magic-link) → MFA (challenge or forced enroll)
   *     → practice select → dashboard.
   *
   * Returns one of:
   *   • MFA_REQUIRED        — enrolled MFA role; FE → /sign-in/mfa-challenge.
   *                           For a multi-practice user the challenge carries a
   *                           null practiceId; the post-MFA finalizer re-resolves
   *                           and returns PRACTICE_SELECT_REQUIRED.
   *   • WEBAUTHN_REQUIRED   — patient with a registered biometric.
   *   • AuthResponse(+enroll)— forced first-time enrollment. Tokens issued so the
   *                           enroll endpoints work; if a practice pick is still
   *                           pending we also mint a practice_select challenge and
   *                           flag it so the FE goes enroll → select-practice.
   *   • PRACTICE_SELECT_REQUIRED — no second factor needed, multi-practice.
   *   • AuthResponse        — fully resolved; tokens issued.
   */
  private async resolveSecondFactorOrTokens(
    user: MinimalUser,
    context: SessionContext | undefined,
    loginMethod: 'otp' | 'magic_link',
  ): Promise<AuthVerifyResult> {
    const resolution = await this.resolvePracticeContext(user.id, user.roles)
    if (resolution.kind === 'blocked') {
      throw new ForbiddenException(
        'No practice membership — contact your admin to be added to a practice before signing in.',
      )
    }
    const resolvedPracticeId =
      resolution.kind === 'auto' ? resolution.activePracticeId : null
    const pendingPracticeSelect = resolution.kind === 'select'

    // 1) MFA challenge (enrolled MFA-required role) — runs BEFORE practice
    //    selection. The resolved practiceId (null for multi-practice) rides in
    //    the challenge; mfaChallenge/mfaRecovery re-resolve when it's null.
    if (await this.shouldChallengeMfa(user.id, user.roles)) {
      const challengeToken = await this.signMfaChallenge(user.id, resolvedPracticeId)
      return { status: 'MFA_REQUIRED', challengeToken }
    }

    // 2) Patient biometric second factor (WebAuthn). Patients resolve to the
    //    'none' practice kind, so no selector follows.
    if (await this.shouldChallengeWebAuthn(user.id, user.roles)) {
      const challengeToken = await this.startWebAuthnAuthentication(
        user.id,
        resolvedPracticeId,
      )
      return { status: 'WEBAUTHN_REQUIRED', challengeToken }
    }

    // 3) Forced first-time enrollment (enforcement on, MFA role, not enrolled).
    //    Tokens are issued (enrollment needs a session) but the FE redirects to
    //    TOTP setup. For a multi-practice user the session is null-practice and
    //    we hand off a practice_select challenge so the post-enroll step is the
    //    selector — the PracticeRequiredGuard blocks the dashboard until it's set.
    if (await this.shouldForceMfaEnrollment(user.id, user.roles)) {
      const tokens = await this.issueTokenPair(user, {
        ...context,
        activePracticeId: resolvedPracticeId,
      })
      const resp = this.buildAuthResponse(tokens, user, loginMethod)
      if (pendingPracticeSelect) {
        const challengeToken = await this.signPracticeSelectChallenge(user.id)
        return {
          ...resp,
          activePracticeId: null,
          // activePractice stays null (none chosen yet) but expose the
          // memberships so the FE knows this is a multi-practice session with a
          // pending choice — the header hides the Dashboard button until one is
          // picked (and the chip dropdown has its list ready post-select).
          availablePractices: resolution.practices,
          mfaEnrollmentRequired: true,
          practiceSelectRequired: true,
          practiceSelectChallengeToken: challengeToken,
          practices: resolution.practices,
        }
      }
      // Bundle so the admin chip renders on first paint without the
      // /auth/profile rehydrate race (mirrors select/switch-practice).
      const bundle = await this.resolvePracticeBundle(user, resolvedPracticeId)
      return {
        ...resp,
        activePracticeId: resolvedPracticeId,
        activePractice: bundle.activePractice,
        availablePractices: bundle.availablePractices,
        mfaEnrollmentRequired: true,
      }
    }

    // 4) No second factor pending. Multi-practice users still pick a practice.
    if (pendingPracticeSelect) {
      const challengeToken = await this.signPracticeSelectChallenge(user.id)
      return {
        status: 'PRACTICE_SELECT_REQUIRED',
        challengeToken,
        practices: resolution.practices,
      }
    }
    const tokens = await this.issueTokenPair(user, {
      ...context,
      activePracticeId: resolvedPracticeId,
    })
    const resp = this.buildAuthResponse(tokens, user, loginMethod)
    // Bundle so the FE sets activePractice + availablePractices synchronously
    // on login() — no chip flash waiting for /auth/profile.
    const bundle = await this.resolvePracticeBundle(user, resolvedPracticeId)
    return {
      ...resp,
      activePracticeId: resolvedPracticeId,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
    }
  }

  /**
   * Post-second-factor finalizer for the MFA challenge/recovery paths. The
   * challenge token carries the practiceId resolved at first-factor time; for a
   * multi-practice provider that was null, so re-resolve now and route to the
   * selector instead of issuing tokens. Single-practice (auto) and org-wide
   * (none) users issue tokens directly.
   */
  private async finalizeAfterSecondFactor(
    user: MinimalUser,
    challengePracticeId: string | null,
    context: SessionContext | undefined,
    loginMethod: 'otp' | 'magic_link',
  ): Promise<AuthResponse | PracticeSelectRequired> {
    let activePracticeId = challengePracticeId
    if (activePracticeId === null) {
      const resolution = await this.resolvePracticeContext(user.id, user.roles)
      if (resolution.kind === 'blocked') {
        throw new ForbiddenException(
          'No practice membership — contact your admin to be added to a practice before signing in.',
        )
      }
      if (resolution.kind === 'select') {
        const challengeToken = await this.signPracticeSelectChallenge(user.id)
        return {
          status: 'PRACTICE_SELECT_REQUIRED',
          challengeToken,
          practices: resolution.practices,
        }
      }
      if (resolution.kind === 'auto') {
        activePracticeId = resolution.activePracticeId
      }
      // 'none' (org-wide) → activePracticeId stays null by design.
    }
    const tokens = await this.issueTokenPair(user, { ...context, activePracticeId })
    const resp = this.buildAuthResponse(tokens, user, loginMethod)
    // Bundle so the chip renders on first paint after the MFA step, no rehydrate race.
    const bundle = await this.resolvePracticeBundle(user, activePracticeId)
    return {
      ...resp,
      activePracticeId,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
    }
  }

  /**
   * Exchange a practice-select challenge for the real token pair. Verifies
   * the challenge JWT (TTL + kind), confirms the chosen practiceId is in
   * the user's memberships, then issues tokens with `activePracticeId` set
   * on the new AuthSession row.
   */
  async selectPractice(
    challengeToken: string,
    practiceId: string,
    context?: SessionContext,
  ): Promise<AuthResponse> {
    let payload: { sub: string; kind: string }
    try {
      payload = await this.jwtService.verifyAsync(challengeToken)
    } catch {
      throw new UnauthorizedException('Practice-select challenge invalid or expired')
    }
    if (payload.kind !== 'practice_select') {
      throw new UnauthorizedException('Practice-select challenge invalid or expired')
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, name: true, roles: true,
        onboardingStatus: true, accountStatus: true,
      },
    })
    if (!user) throw new UnauthorizedException('User not found')
    this.assertAccountActive(user)
    if (!(await this.isPracticeMember(user.id, practiceId))) {
      throw new ForbiddenException('Not a member of that practice')
    }
    // MFA already happened upstream (Manisha 2026-06-12 §6) — the second factor
    // now precedes the practice selector, so by the time we reach here the
    // person is fully authenticated and we just issue practice-scoped tokens.
    const tokens = await this.issueTokenPair(user, {
      ...context,
      activePracticeId: practiceId,
    })
    await this.logAuthEvent({
      event: 'practice_selected',
      userId: user.id,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { practiceId },
      practiceContext: practiceId,
      success: true,
    })
    const resp = this.buildAuthResponse(tokens, user, 'otp')
    // PR #90 Bug A — carry the resolved practice name + memberships so the
    // admin chip renders "Acting as: <name>" on the fresh select window
    // (pre-fix it fell back to the "Acting as practice" placeholder until
    // /auth/profile resolved the name post-refresh). The MFA second factor now
    // runs BEFORE this step, so an enrolled user is already past it; the
    // mfaEnrollmentRequired flag below only stays true for an enforcement-on
    // user who reached the selector without finishing setup — the FE bounces
    // them back to /sign-in/mfa-enroll.
    const bundle = await this.resolvePracticeBundle(user, practiceId)
    const mfaEnrollmentRequired = await this.shouldForceMfaEnrollment(
      user.id,
      user.roles,
    )
    return {
      ...resp,
      activePracticeId: practiceId,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
      mfaEnrollmentRequired,
    }
  }

  /**
   * Mid-session practice switch. Updates the active AuthSession's
   * `activePracticeId` (no new tokens issued — refresh-token stays the
   * same; new context takes effect on the next request via the JWT
   * strategy's per-request AuthSession lookup). Writes an AuthLog row.
   */
  /**
   * Controller-friendly wrapper around `switchPractice`. Resolves the raw
   * refresh-token cookie value to its RefreshToken row (and thereby to the
   * paired AuthSession), then delegates. Throws Unauthorized if the cookie
   * doesn't match an active refresh-token for `userId` (defends against a
   * stale cookie left over from a revoked session).
   */
  async switchPracticeByRefreshToken(
    userId: string,
    rawRefreshToken: string,
    practiceId: string,
    context?: SessionContext,
  ): Promise<{
    activePracticeId: string
    accessToken: string
    activePractice: { id: string; name: string } | null
    availablePractices: Array<{ id: string; name: string }>
  }> {
    const tokenHash = sha256(rawRefreshToken)
    const existing = await this.prisma.refreshToken.findFirst({
      where: { tokenHash, userId, revokedAt: null },
      select: { id: true },
    })
    if (!existing) {
      throw new UnauthorizedException('Refresh token invalid or revoked')
    }
    return this.switchPractice(userId, existing.id, practiceId, context)
  }

  async switchPractice(
    userId: string,
    refreshTokenId: string,
    practiceId: string,
    context?: SessionContext,
  ): Promise<{
    activePracticeId: string
    accessToken: string
    activePractice: { id: string; name: string } | null
    availablePractices: Array<{ id: string; name: string }>
  }> {
    if (!(await this.isPracticeMember(userId, practiceId))) {
      throw new ForbiddenException('Not a member of that practice')
    }
    const prior = await this.prisma.authSession.findUnique({
      where: { refreshTokenId },
      select: { activePracticeId: true },
    })
    const session = await this.prisma.authSession.update({
      where: { refreshTokenId },
      data: { activePracticeId: practiceId },
      select: {
        user: {
          select: {
            id: true, email: true, name: true, roles: true,
            onboardingStatus: true, accountStatus: true,
          },
        },
      },
    })
    // Mint a fresh access token carrying the new activePracticeId claim
    // so the FE sees the new context on its very next request — no need
    // to wait for the next refresh. Refresh token itself doesn't rotate
    // (the user is still in the same session, just acting differently).
    const accessToken = await this.issueAccessToken(session.user, practiceId)
    await this.logAuthEvent({
      event: 'practice_switched',
      userId,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { fromPracticeId: prior?.activePracticeId ?? null, toPracticeId: practiceId },
      practiceContext: practiceId,
      success: true,
    })
    const bundle = await this.resolvePracticeBundle(session.user, practiceId)
    return {
      activePracticeId: practiceId,
      accessToken,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
    }
  }

  /**
   * Phase/practice-identity (PR #90 Bug A) — resolve the active practice
   * (with name) + the user's switchable memberships for a given
   * activePracticeId. Mirrors the logic /auth/profile uses so select /
   * switch responses carry the same shape the rehydrate path returns —
   * which is what lets the admin chip render "Acting as: <name>" on the
   * fresh sign-in window instead of the "Acting as practice" placeholder.
   *
   * Probes BOTH membership relations (PracticeProvider 1:N for PROVIDER /
   * MED_DIR, PracticeCoordinator 1:1 for COORDINATOR) — same dual-relation
   * pattern as resolvePracticeContext() and JwtStrategy.validate().
   * Org-wide roles (SUPER_ADMIN / HEALPLACE_OPS) get null/[].
   */
  /**
   * Whether `userId` holds membership in `practiceId` via EITHER the
   * PracticeProvider (PROVIDER) or PracticeMedicalDirector (MED_DIR) relation.
   * Gates select-practice / switch-practice. PR #90: a MED_DIR heads a
   * practice via PracticeMedicalDirector, so probing only PracticeProvider
   * wrongly rejected a multi-practice MED_DIR picking a practice they head.
   * (COORDINATOR is 1:1 + auto-resolved, so it never reaches select/switch.)
   */
  private async isPracticeMember(
    userId: string,
    practiceId: string,
  ): Promise<boolean> {
    const [asProvider, asMedDir] = await Promise.all([
      this.prisma.practiceProvider.findUnique({
        where: { practiceId_userId: { practiceId, userId } },
        select: { id: true },
      }),
      this.prisma.practiceMedicalDirector.findUnique({
        where: { practiceId_userId: { practiceId, userId } },
        select: { id: true },
      }),
    ])
    return asProvider !== null || asMedDir !== null
  }

  private async resolvePracticeBundle(
    user: { id: string; roles: UserRole[] },
    activePracticeId: string | null,
  ): Promise<{
    activePractice: { id: string; name: string } | null
    availablePractices: Array<{ id: string; name: string }>
  }> {
    const isOrgWide =
      user.roles.includes(UserRole.SUPER_ADMIN) ||
      user.roles.includes(UserRole.HEALPLACE_OPS)
    const isCoordinator = user.roles.includes(UserRole.COORDINATOR)
    const isMedDir = user.roles.includes(UserRole.MEDICAL_DIRECTOR)

    const availablePractices: Array<{ id: string; name: string }> = []
    if (!isOrgWide) {
      // PR #90: probe ALL three membership relations. A MED_DIR heads a
      // practice via PracticeMedicalDirector (not PracticeProvider) — omitting
      // it left availablePractices empty + activePractice null on /auth/profile,
      // which fired the FE ZeroPracticeModal on every medical-director page and
      // its overlay swallowed all clicks.
      const [providerRows, medDirRows, coordinatorRow] = await Promise.all([
        this.prisma.practiceProvider.findMany({
          where: { userId: user.id },
          select: { practice: { select: { id: true, name: true } } },
        }),
        isMedDir
          ? this.prisma.practiceMedicalDirector.findMany({
              where: { userId: user.id },
              select: { practice: { select: { id: true, name: true } } },
            })
          : Promise.resolve([] as { practice: { id: string; name: string } }[]),
        isCoordinator
          ? this.prisma.practiceCoordinator.findUnique({
              where: { userId: user.id },
              select: { practice: { select: { id: true, name: true } } },
            })
          : Promise.resolve(null),
      ])
      const seen = new Set<string>()
      for (const r of [...providerRows, ...medDirRows]) {
        if (r.practice && !seen.has(r.practice.id)) {
          availablePractices.push(r.practice)
          seen.add(r.practice.id)
        }
      }
      if (coordinatorRow?.practice && !seen.has(coordinatorRow.practice.id)) {
        availablePractices.push(coordinatorRow.practice)
      }
    }

    const activePractice = activePracticeId
      ? availablePractices.find((p) => p.id === activePracticeId) ?? null
      : null

    return { activePractice, availablePractices }
  }

  // ─── MFA — TOTP second factor (Manisha 2026-06-12 §6) ─────────────────────

  /** Whether this user must clear a TOTP challenge before tokens are issued —
   *  true only for MFA-required roles that have completed enrollment. Un-
   *  enrolled users sign in normally; the force-enrollment guard (gated by
   *  MFA_ENFORCEMENT_ENABLED) pushes them to enroll afterward. */
  private async shouldChallengeMfa(
    userId: string,
    roles: UserRole[],
  ): Promise<boolean> {
    if (!requiresMfa(roles)) return false
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { enrolledAt: true },
    })
    return cred?.enrolledAt != null
  }

  /** Whether enforcement is on and this MFA-required user has NOT enrolled —
   *  i.e. they should be redirected to TOTP setup immediately after sign-in.
   *  Mirrors the MfaRequiredGuard's runtime check, but evaluated at verify
   *  time so the FE redirects up front instead of after a 403 round-trip. */
  private async shouldForceMfaEnrollment(
    userId: string,
    roles: UserRole[],
  ): Promise<boolean> {
    if (this.config.get<string>('MFA_ENFORCEMENT_ENABLED') !== 'true') {
      return false
    }
    if (!requiresMfa(roles)) return false
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { enrolledAt: true },
    })
    return cred?.enrolledAt == null
  }

  private async signMfaChallenge(
    userId: string,
    activePracticeId: string | null,
  ): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, kind: 'mfa_challenge', activePracticeId: activePracticeId ?? null },
      { expiresIn: MFA_CHALLENGE_TTL },
    )
  }

  private async verifyMfaChallenge(
    token: string,
  ): Promise<{ userId: string; activePracticeId: string | null }> {
    let payload: { sub: string; kind: string; activePracticeId?: string | null }
    try {
      payload = await this.jwtService.verifyAsync(token)
    } catch {
      throw new UnauthorizedException('MFA challenge invalid or expired')
    }
    if (payload.kind !== 'mfa_challenge') {
      throw new UnauthorizedException('MFA challenge invalid or expired')
    }
    return { userId: payload.sub, activePracticeId: payload.activePracticeId ?? null }
  }

  private async signEnrollmentToken(
    userId: string,
    secret: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, kind: 'mfa_enroll', secret },
      { expiresIn: MFA_ENROLL_TTL },
    )
  }

  private async verifyEnrollmentToken(
    token: string,
    expectedUserId: string,
  ): Promise<string> {
    let payload: { sub: string; kind: string; secret: string }
    try {
      payload = await this.jwtService.verifyAsync(token)
    } catch {
      throw new BadRequestException('Enrollment session expired — restart MFA setup')
    }
    if (payload.kind !== 'mfa_enroll' || payload.sub !== expectedUserId) {
      throw new BadRequestException('Enrollment session invalid — restart MFA setup')
    }
    return payload.secret
  }

  /** Enrollment step 1 — generate a secret + QR. The secret is NOT persisted;
   *  it rides back inside a signed enrollment token (the QR already exposes it
   *  to the client, so this leaks nothing new) and is stored only once the
   *  first code is verified in completeTotpEnrollment. Stateless, so it works
   *  across multiple backend instances. */
  async startTotpEnrollment(
    userId: string,
    context?: SessionContext,
  ): Promise<{
    provisioningUri: string
    qrCodeDataUrl: string
    enrollmentToken: string
  }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, roles: true },
    })
    if (!user) throw new NotFoundException('User not found')
    if (!requiresMfa(user.roles)) {
      throw new ForbiddenException('MFA enrollment does not apply to this account')
    }
    const issuer = this.config.get<string>('MFA_TOTP_ISSUER', 'Cardioplace')
    const secret = this.mfaService.generateSecret()
    const provisioningUri = this.mfaService.buildProvisioningUri(
      user.email ?? userId,
      secret,
      issuer,
    )
    const qrCodeDataUrl = await this.mfaService.buildQrDataUrl(provisioningUri)
    const enrollmentToken = await this.signEnrollmentToken(userId, secret)
    await this.logAuthEvent({
      event: 'mfa_enrollment_started',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { provisioningUri, qrCodeDataUrl, enrollmentToken }
  }

  /** Enrollment step 2 — verify the first code, persist the encrypted secret +
   *  hashed recovery codes, mark enrolled. Returns the 10 recovery codes ONCE
   *  (plaintext, never stored). */
  async completeTotpEnrollment(
    userId: string,
    enrollmentToken: string,
    code: string,
    context?: SessionContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const secret = await this.verifyEnrollmentToken(enrollmentToken, userId)
    if (!this.mfaService.verifyCode(secret, code)) {
      await this.logAuthEvent({
        event: 'mfa_enrollment_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_code',
      })
      throw new BadRequestException(
        'That code is incorrect — check your authenticator app and try again',
      )
    }
    const { plain, hashes } = await this.mfaService.generateRecoveryCodes()
    const secretEncrypted = this.mfaService.encryptSecret(secret)
    const now = new Date()
    await this.prisma.$transaction(async (tx) => {
      await tx.totpCredential.upsert({
        where: { userId },
        create: { userId, secretEncrypted, enrolledAt: now },
        update: { secretEncrypted, enrolledAt: now, mfaResetByAdminAt: null },
      })
      // Replace ALL prior codes (used + unused) so a fresh enrollment always
      // starts at exactly 10 — otherwise old used rows linger and inflate the
      // total (e.g. "10 of 11 remaining" after a re-enroll).
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } })
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      })
    })
    await this.logAuthEvent({
      event: 'mfa_enrollment_completed',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { recoveryCodes: plain }
  }

  /** Generate a fresh set of recovery codes for an already-enrolled user,
   *  invalidating every prior code. Returns the new codes ONCE (plaintext,
   *  never stored). Reached from the profile "Security" surface. */
  async regenerateRecoveryCodes(
    userId: string,
    context?: SessionContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { enrolledAt: true },
    })
    if (cred?.enrolledAt == null) {
      throw new BadRequestException(
        'Set up two-factor authentication before generating recovery codes',
      )
    }
    const { plain, hashes } = await this.mfaService.generateRecoveryCodes()
    await this.prisma.$transaction(async (tx) => {
      // Invalidate ALL prior codes (used + unused) — the new set fully replaces
      // them so an old printout can never be reused.
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } })
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      })
    })
    await this.logAuthEvent({
      event: 'mfa_recovery_regenerated',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { recoveryCodes: plain }
  }

  private async countRecentFailedMfa(
    userId: string,
    sinceMs: number,
  ): Promise<number> {
    return this.prisma.authLog.count({
      where: {
        userId,
        event: 'mfa_challenge_failed',
        createdAt: { gt: new Date(Date.now() - sinceMs) },
      },
    })
  }

  /** Throw if the user is currently locked out. Hard lock (10/h) demands an
   *  admin reset; soft lock (5/15min) is temporary (recovery code still works). */
  private async assertNotMfaLocked(userId: string): Promise<void> {
    if (
      (await this.countRecentFailedMfa(userId, MFA_HARD_LOCK_WINDOW_MS)) >=
      MFA_HARD_LOCK_THRESHOLD
    ) {
      await this.logAuthEvent({
        event: 'mfa_locked',
        userId,
        method: 'otp',
        metadata: { tier: 'hard' },
        success: false,
        errorCode: 'mfa_locked_admin',
      })
      throw new ForbiddenException({
        message:
          'Too many failed attempts. Contact an administrator to reset your MFA.',
        errorCode: 'mfa_locked_admin',
      })
    }
    if (
      (await this.countRecentFailedMfa(userId, MFA_SOFT_LOCK_WINDOW_MS)) >=
      MFA_SOFT_LOCK_THRESHOLD
    ) {
      throw new ForbiddenException({
        message:
          'Too many attempts. Wait a few minutes or use a recovery code.',
        errorCode: 'mfa_locked_temporary',
      })
    }
  }

  private async loadActiveUser(userId: string): Promise<MinimalUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        roles: true,
        onboardingStatus: true,
        accountStatus: true,
      },
    })
    if (!user) throw new UnauthorizedException('User not found')
    this.assertAccountActive(user)
    return user
  }

  /** Exchange an MFA challenge + 6-digit code for the real token pair — or, for
   *  a multi-practice provider, a PRACTICE_SELECT_REQUIRED handoff (the practice
   *  is chosen AFTER the second factor). */
  async mfaChallenge(
    challengeToken: string,
    code: string,
    context?: SessionContext,
  ): Promise<AuthResponse | PracticeSelectRequired> {
    const { userId, activePracticeId } =
      await this.verifyMfaChallenge(challengeToken)
    await this.assertNotMfaLocked(userId)
    const cred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { secretEncrypted: true, enrolledAt: true },
    })
    if (!cred?.enrolledAt || !cred.secretEncrypted) {
      throw new BadRequestException('MFA is not set up for this account')
    }
    const secret = this.mfaService.decryptSecret(cred.secretEncrypted)
    if (!this.mfaService.verifyCode(secret, code)) {
      await this.logAuthEvent({
        event: 'mfa_challenge_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        practiceContext: activePracticeId,
        success: false,
        errorCode: 'invalid_code',
      })
      throw new UnauthorizedException('Invalid code')
    }
    const user = await this.loadActiveUser(userId)
    await this.logAuthEvent({
      event: 'mfa_challenge_succeeded',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      practiceContext: activePracticeId,
      success: true,
    })
    // Second factor cleared. A multi-practice provider (null challenge practice)
    // now picks a practice; everyone else gets tokens.
    return this.finalizeAfterSecondFactor(user, activePracticeId, context, 'otp')
  }

  /** Sign in with a one-time recovery code. Standard backup-login behaviour:
   *  the code is burned (one-time) but the authenticator is left intact — no
   *  reset, no forced re-enrollment. A user who has actually lost their app
   *  re-enrolls themselves from settings; losing the codes too is an admin
   *  reset. (Manisha 2026-06-12 §6.) */
  async mfaRecovery(
    challengeToken: string,
    recoveryCode: string,
    context?: SessionContext,
  ): Promise<AuthResponse | PracticeSelectRequired> {
    const { userId, activePracticeId } =
      await this.verifyMfaChallenge(challengeToken)
    const unused = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    })
    let matchedId: string | null = null
    for (const row of unused) {
      if (await this.mfaService.verifyRecoveryCode(recoveryCode, row.codeHash)) {
        matchedId = row.id
        break
      }
    }
    if (!matchedId) {
      await this.logAuthEvent({
        event: 'mfa_challenge_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { via: 'recovery_code' },
        practiceContext: activePracticeId,
        success: false,
        errorCode: 'invalid_recovery_code',
      })
      throw new UnauthorizedException('Invalid or already-used recovery code')
    }
    await this.prisma.mfaRecoveryCode.update({
      where: { id: matchedId },
      data: { usedAt: new Date() },
    })
    const user = await this.loadActiveUser(userId)
    await this.logAuthEvent({
      event: 'mfa_recovery_code_used',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      practiceContext: activePracticeId,
      success: true,
    })
    // Backup second factor cleared — same practice-select handoff as the TOTP path.
    return this.finalizeAfterSecondFactor(user, activePracticeId, context, 'otp')
  }

  /** Admin MFA reset — SUPER_ADMIN / HEALPLACE_OPS only; never self-reset.
   *  Clears the secret + enrollment, deletes unused recovery codes, stamps
   *  mfaResetByAdminAt, audits with resetter + reason, and emails the user. */
  async adminResetMfa(
    actorId: string,
    targetUserId: string,
    reason: string,
    context?: SessionContext,
  ): Promise<{ message: string }> {
    if (actorId === targetUserId) {
      throw new ForbiddenException(
        'You cannot reset your own MFA — ask another administrator',
      )
    }
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true },
    })
    if (!target) throw new NotFoundException('User not found')
    await this.prisma.$transaction(async (tx) => {
      // Keep the row (preserves mfaResetByAdminAt for audit); blank the secret
      // + clear enrolledAt so the next sign-in routes through enrollment.
      await tx.totpCredential.updateMany({
        where: { userId: targetUserId },
        data: { secretEncrypted: '', enrolledAt: null, mfaResetByAdminAt: new Date() },
      })
      await tx.mfaRecoveryCode.deleteMany({
        where: { userId: targetUserId, usedAt: null },
      })
    })
    await this.logAuthEvent({
      event: 'mfa_reset_by_admin',
      userId: targetUserId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { resetBy: actorId, reason },
      success: true,
    })
    if (target.email) {
      await this.emailService.sendEmail(
        target.email,
        'Your Cardioplace two-factor authentication was reset',
        mfaResetEmailHtml(target.name ?? null),
        {
          template: 'mfa_reset',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: targetUserId,
          metadata: { resetBy: actorId, reason },
        },
      )
    }
    return {
      message:
        'MFA reset. The user will set up two-factor authentication again on next sign-in.',
    }
  }

  // ─── WebAuthn — patient biometric second factor (Face ID / fingerprint) ─────
  //
  // OPTIONAL, opt-in from patient settings. OTP / magic-link stays the first
  // factor; this only adds a second step once a patient has registered a
  // device. Patients with no registered credential are completely unaffected,
  // so this doesn't change sign-in for anyone else. Registration requires an
  // existing session (JwtAuthGuard), so a not-yet-signed-in user is never
  // shown setup — they enable it later from settings.

  /** Whether this sign-in must clear a biometric second factor — true only for
   *  a PATIENT who has registered at least one device. */
  private async shouldChallengeWebAuthn(
    userId: string,
    roles: UserRole[],
  ): Promise<boolean> {
    if (!roles.includes(UserRole.PATIENT)) return false
    const count = await this.prisma.webAuthnCredential.count({
      where: { userId },
    })
    return count > 0
  }

  private async signWebAuthnAuthToken(
    userId: string,
    challenge: string,
    activePracticeId: string | null,
  ): Promise<string> {
    return this.jwtService.signAsync(
      {
        sub: userId,
        kind: 'webauthn_auth',
        challenge,
        activePracticeId: activePracticeId ?? null,
      },
      { expiresIn: WEBAUTHN_CHALLENGE_TTL },
    )
  }

  private async verifyWebAuthnAuthToken(token: string): Promise<{
    userId: string
    challenge: string
    activePracticeId: string | null
  }> {
    let payload: {
      sub: string
      kind: string
      challenge: string
      activePracticeId?: string | null
    }
    try {
      payload = await this.jwtService.verifyAsync(token)
    } catch {
      throw new UnauthorizedException('Biometric challenge invalid or expired')
    }
    if (payload.kind !== 'webauthn_auth') {
      throw new UnauthorizedException('Biometric challenge invalid or expired')
    }
    return {
      userId: payload.sub,
      challenge: payload.challenge,
      activePracticeId: payload.activePracticeId ?? null,
    }
  }

  private async signWebAuthnRegToken(
    userId: string,
    challenge: string,
  ): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, kind: 'webauthn_reg', challenge },
      { expiresIn: WEBAUTHN_REGISTER_TTL },
    )
  }

  private async verifyWebAuthnRegToken(
    token: string,
    expectedUserId: string,
  ): Promise<string> {
    let payload: { sub: string; kind: string; challenge: string }
    try {
      payload = await this.jwtService.verifyAsync(token)
    } catch {
      throw new BadRequestException(
        'Biometric setup expired — start setup again',
      )
    }
    if (payload.kind !== 'webauthn_reg' || payload.sub !== expectedUserId) {
      throw new BadRequestException('Biometric setup invalid — start again')
    }
    return payload.challenge
  }

  /** Sign-in gate helper — mint the challenge token returned as
   *  WEBAUTHN_REQUIRED. The actual assertion options are fetched separately
   *  (webAuthnAuthenticationOptions) so the OTP and magic-link paths share one
   *  small response shape. */
  private async startWebAuthnAuthentication(
    userId: string,
    activePracticeId: string | null,
  ): Promise<string> {
    const challenge = this.webAuthnService.randomChallenge()
    return this.signWebAuthnAuthToken(userId, challenge, activePracticeId)
  }

  /** Build the navigator.credentials.get() options for a pending second factor.
   *  allowCredentials is the patient's registered devices, so the browser only
   *  prompts on a device that holds one of them. */
  async webAuthnAuthenticationOptions(challengeToken: string) {
    const { userId, challenge } =
      await this.verifyWebAuthnAuthToken(challengeToken)
    const creds = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    })
    if (creds.length === 0) {
      throw new BadRequestException('No biometric devices registered')
    }
    return this.webAuthnService.buildAuthenticationOptions({
      challenge,
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
    })
  }

  /** Complete the biometric second factor — verify the assertion, bump the
   *  signature counter, and issue the real token pair. */
  async webAuthnAuthenticate(
    challengeToken: string,
    response: AuthenticationResponseJSON,
    context?: SessionContext,
  ): Promise<AuthResponse> {
    const { userId, challenge, activePracticeId } =
      await this.verifyWebAuthnAuthToken(challengeToken)
    const cred = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: response.id },
    })
    if (!cred || cred.userId !== userId) {
      await this.logAuthEvent({
        event: 'webauthn_auth_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        practiceContext: activePracticeId,
        success: false,
        errorCode: 'unknown_credential',
      })
      throw new UnauthorizedException('Biometric device not recognized')
    }
    let verification: Awaited<
      ReturnType<WebAuthnService['verifyAuthentication']>
    >
    try {
      verification = await this.webAuthnService.verifyAuthentication({
        response,
        challenge,
        credential: {
          id: cred.credentialId,
          publicKey: cred.publicKey,
          counter: cred.counter,
          transports: cred.transports as AuthenticatorTransportFuture[],
        },
      })
    } catch {
      verification = { verified: false } as typeof verification
    }
    if (!verification.verified) {
      await this.logAuthEvent({
        event: 'webauthn_auth_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        practiceContext: activePracticeId,
        success: false,
        errorCode: 'assertion_failed',
      })
      throw new UnauthorizedException('Biometric verification failed')
    }
    // Persist the new signature counter (replay-protection) + last-used stamp.
    await this.prisma.webAuthnCredential.update({
      where: { id: cred.id },
      data: {
        counter: verification.authenticationInfo.newCounter,
        lastUsedAt: new Date(),
      },
    })
    const user = await this.loadActiveUser(userId)
    const tokens = await this.issueTokenPair(user, {
      ...context,
      activePracticeId,
    })
    await this.logAuthEvent({
      event: 'webauthn_auth_succeeded',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      practiceContext: activePracticeId,
      success: true,
    })
    const resp = this.buildAuthResponse(tokens, user, 'otp')
    // Symmetric with the other auth-issuing paths — patients resolve to a null
    // practice (no chip), but the response shape stays consistent.
    const bundle = await this.resolvePracticeBundle(user, activePracticeId)
    return {
      ...resp,
      activePracticeId,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
    }
  }

  /** Generate + persist a fresh set of recovery codes for a user, replacing
   *  any prior ones. Returns the plaintext to show ONCE. Reuses the same
   *  MfaRecoveryCode table + MfaService codec the provider TOTP path uses —
   *  a patient is never also a provider, so the rows never collide. */
  private async issueRecoveryCodes(userId: string): Promise<string[]> {
    const { plain, hashes } = await this.mfaService.generateRecoveryCodes()
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } })
      await tx.mfaRecoveryCode.createMany({
        data: hashes.map((codeHash) => ({ userId, codeHash })),
      })
    })
    return plain
  }

  /** Recovery-code sign-in — the ONLY fallback when a patient can't use their
   *  biometric on this device (e.g. a desktop passkey that can't travel to a
   *  phone). The challenge token proves the first factor (OTP / magic-link)
   *  already passed. We consume ONLY the one code (the rest stay valid — no
   *  wasteful regenerate), and return how many remain so the FE can tell the
   *  patient. They regenerate from Settings when running low. */
  async webAuthnRecoverySignIn(
    challengeToken: string,
    recoveryCode: string,
    context?: SessionContext,
  ): Promise<AuthResponse & { recoveryRemaining: number }> {
    const { userId, activePracticeId } =
      await this.verifyWebAuthnAuthToken(challengeToken)
    const unused = await this.prisma.mfaRecoveryCode.findMany({
      where: { userId, usedAt: null },
      select: { id: true, codeHash: true },
    })
    let matchedId: string | null = null
    for (const row of unused) {
      if (await this.mfaService.verifyRecoveryCode(recoveryCode, row.codeHash)) {
        matchedId = row.id
        break
      }
    }
    if (!matchedId) {
      await this.logAuthEvent({
        event: 'webauthn_recovery_code_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        practiceContext: activePracticeId,
        success: false,
        errorCode: 'invalid_recovery_code',
      })
      throw new UnauthorizedException('Invalid or already-used recovery code')
    }
    // Burn only this one code; the others remain valid.
    await this.prisma.mfaRecoveryCode.update({
      where: { id: matchedId },
      data: { usedAt: new Date() },
    })
    const recoveryRemaining = await this.prisma.mfaRecoveryCode.count({
      where: { userId, usedAt: null },
    })
    const user = await this.loadActiveUser(userId)
    const tokens = await this.issueTokenPair(user, {
      ...context,
      activePracticeId,
    })
    await this.logAuthEvent({
      event: 'webauthn_recovery_code_used',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      practiceContext: activePracticeId,
      metadata: { remaining: recoveryRemaining },
      success: true,
    })
    // Symmetric with the other auth-issuing paths (patients have no chip).
    const bundle = await this.resolvePracticeBundle(user, activePracticeId)
    return {
      ...this.buildAuthResponse(tokens, user, 'otp'),
      activePracticeId,
      activePractice: bundle.activePractice,
      availablePractices: bundle.availablePractices,
      recoveryRemaining,
    }
  }

  /** Settings — how many backup codes remain + whether biometric is on. */
  async patientRecoveryStatus(
    userId: string,
  ): Promise<{ remaining: number; hasBiometric: boolean }> {
    const [remaining, deviceCount] = await Promise.all([
      this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
      this.prisma.webAuthnCredential.count({ where: { userId } }),
    ])
    return { remaining, hasBiometric: deviceCount > 0 }
  }

  /** Settings — regenerate the recovery codes (invalidates the old set). */
  async regeneratePatientRecoveryCodes(
    userId: string,
    context?: SessionContext,
  ): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = await this.issueRecoveryCodes(userId)
    await this.logAuthEvent({
      event: 'webauthn_recovery_codes_regenerated',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { recoveryCodes }
  }

  /** Admin support — reset a patient who lost BOTH their biometric devices and
   *  their recovery codes. Wipes all passkeys + recovery codes so the patient
   *  re-enrolls (and gets fresh codes) on next sign-in. Audited with the actor
   *  + reason; the patient is emailed. SUPER_ADMIN / HEALPLACE_OPS only. */
  async adminResetPatientBiometric(
    actorId: string,
    targetUserId: string,
    reason: string,
    context?: SessionContext,
  ): Promise<{ message: string }> {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, name: true, roles: true },
    })
    if (!target) throw new NotFoundException('User not found')
    if (!target.roles.includes(UserRole.PATIENT)) {
      throw new BadRequestException('This account is not a patient')
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.webAuthnCredential.deleteMany({ where: { userId: targetUserId } })
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: targetUserId } })
    })
    await this.logAuthEvent({
      event: 'webauthn_reset_by_admin',
      userId: targetUserId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: { resetBy: actorId, reason },
      success: true,
    })
    if (target.email) {
      await this.emailService.sendEmail(
        target.email,
        'Your Cardioplace biometric sign-in was reset',
        biometricResetEmailHtml(target.name ?? null),
        {
          template: 'biometric_reset',
          templateVersion: EMAIL_TEMPLATE_VERSION,
          patientUserId: targetUserId,
          metadata: { resetBy: actorId, reason },
        },
      )
    }
    return {
      message:
        'Biometric reset. The patient will set up Face ID / fingerprint again on next sign-in.',
    }
  }

  /** Max biometric devices a patient may register. */
  private static readonly MAX_WEBAUTHN_DEVICES = 3

  /** Settings — start biometric registration (patient only). Returns the
   *  create() options + a stateless registration token carrying the challenge.
   *  The secret material never touches the server until verify.
   *
   *  `mode` picks the authenticator: 'platform' = this device's Face ID /
   *  fingerprint; 'cross-platform' = another device via the browser's QR /
   *  use-a-phone flow. Capped at MAX_WEBAUTHN_DEVICES total. */
  async startWebAuthnRegistration(
    userId: string,
    mode: 'platform' | 'cross-platform' = 'platform',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, roles: true },
    })
    if (!user) throw new NotFoundException('User not found')
    if (!user.roles.includes(UserRole.PATIENT)) {
      throw new ForbiddenException(
        'Biometric sign-in is only available for patient accounts',
      )
    }
    const existing = await this.prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    })
    if (existing.length >= AuthService.MAX_WEBAUTHN_DEVICES) {
      throw new BadRequestException(
        `You can register up to ${AuthService.MAX_WEBAUTHN_DEVICES} devices. Remove one first.`,
      )
    }
    const challenge = this.webAuthnService.randomChallenge()
    const options = await this.webAuthnService.buildRegistrationOptions({
      userId,
      userName: user.email ?? userId,
      userDisplayName: user.name ?? user.email ?? 'Patient',
      challenge,
      attachment: mode,
      excludeCredentials: existing.map((c) => ({
        id: c.credentialId,
        transports: c.transports as AuthenticatorTransportFuture[],
      })),
    })
    const registrationToken = await this.signWebAuthnRegToken(userId, challenge)
    await this.logAuthEvent({
      event: 'webauthn_registration_started',
      userId,
      method: 'otp',
      success: true,
    })
    return { options, registrationToken }
  }

  /** Settings — finish registration: verify the attestation and persist the
   *  credential. The patient can now use biometric as a second factor. */
  async completeWebAuthnRegistration(
    userId: string,
    registrationToken: string,
    response: RegistrationResponseJSON,
    deviceName: string | undefined,
    context?: SessionContext,
  ): Promise<{
    id: string
    deviceName: string | null
    /** Present ONLY on the first passkey — the account-wide backup codes to
     *  show + save once. Omitted when adding a 2nd/3rd device. */
    recoveryCodes?: string[]
  }> {
    const challenge = await this.verifyWebAuthnRegToken(
      registrationToken,
      userId,
    )
    let verification: Awaited<ReturnType<WebAuthnService['verifyRegistration']>>
    try {
      verification = await this.webAuthnService.verifyRegistration({
        response,
        challenge,
      })
    } catch {
      verification = { verified: false } as typeof verification
    }
    if (!verification.verified || !verification.registrationInfo) {
      await this.logAuthEvent({
        event: 'webauthn_registration_failed',
        userId,
        method: 'otp',
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'attestation_failed',
      })
      throw new BadRequestException('Biometric setup could not be verified')
    }
    const info = verification.registrationInfo
    // Guard the unique constraint with a friendly message (same device already
    // registered, possibly to another account).
    const dup = await this.prisma.webAuthnCredential.findUnique({
      where: { credentialId: info.credential.id },
      select: { id: true },
    })
    if (dup) {
      throw new BadRequestException('This device is already registered')
    }
    const saved = await this.prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId: info.credential.id,
        publicKey: this.webAuthnService.encodePublicKey(info.credential.publicKey),
        counter: info.credential.counter,
        transports: info.credential.transports ?? [],
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        deviceName: deviceName?.trim() || null,
      },
      select: { id: true, deviceName: true },
    })
    await this.logAuthEvent({
      event: 'webauthn_registration_completed',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    // First passkey for this patient → mint the account-wide recovery codes
    // (the only fallback if they later can't use biometric). count === 1 means
    // the row we just created is the only one. Adding more devices later does
    // NOT reset the codes.
    const deviceCount = await this.prisma.webAuthnCredential.count({
      where: { userId },
    })
    let recoveryCodes: string[] | undefined
    if (deviceCount === 1) {
      recoveryCodes = await this.issueRecoveryCodes(userId)
    }
    return { ...saved, recoveryCodes }
  }

  /** Settings — list the patient's registered biometric devices. */
  async listWebAuthnCredentials(userId: string): Promise<
    Array<{
      id: string
      credentialId: string
      deviceName: string | null
      deviceType: string | null
      backedUp: boolean
      createdAt: Date
      lastUsedAt: Date | null
    }>
  > {
    // credentialId is included so the FE can recognise "this device" (it's the
    // same public id the browser returns on register/login; not a secret).
    return this.prisma.webAuthnCredential.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        credentialId: true,
        deviceName: true,
        deviceType: true,
        backedUp: true,
        createdAt: true,
        lastUsedAt: true,
      },
    })
  }

  /** Settings — rename a registered device (cosmetic label only; not used in
   *  any auth check). Scoped to the caller's own credentials. */
  async renameWebAuthnCredential(
    userId: string,
    id: string,
    deviceName: string,
    context?: SessionContext,
  ): Promise<{ id: string; deviceName: string }> {
    const name = deviceName.trim()
    const res = await this.prisma.webAuthnCredential.updateMany({
      where: { id, userId },
      data: { deviceName: name },
    })
    if (res.count === 0) {
      throw new NotFoundException('Device not found')
    }
    await this.logAuthEvent({
      event: 'webauthn_credential_renamed',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { id, deviceName: name }
  }

  /** Settings — remove a registered device (disable biometric on it). When the
   *  last one is removed, the patient simply signs in with OTP again. */
  async deleteWebAuthnCredential(
    userId: string,
    id: string,
    context?: SessionContext,
  ): Promise<{ removed: true }> {
    const res = await this.prisma.webAuthnCredential.deleteMany({
      where: { id, userId },
    })
    if (res.count === 0) {
      throw new NotFoundException('Device not found')
    }
    await this.logAuthEvent({
      event: 'webauthn_credential_removed',
      userId,
      method: 'otp',
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })
    return { removed: true }
  }

  private buildAuthResponse(
    tokens: TokenPair,
    user: MinimalUser,
    login_method: 'otp' | 'magic_link' | 'google' | 'apple',
  ): AuthResponse {
    return {
      ...tokens,
      userId: user.id,
      email: user.email ?? null,
      onboarding_required: user.onboardingStatus !== OnboardingStatus.COMPLETED,
      roles: user.roles,
      login_method,
      name: user.name,
    }
  }

  // ─── Account Status Guard ───────────────────────────────────────────────────

  private assertAccountActive(
    user: Pick<MinimalUser, 'accountStatus'>,
    context?: { event?: string; identifier?: string },
  ): void {
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      throw new ForbiddenException(
        `Account is ${user.accountStatus.toLowerCase()}`,
      )
    }
  }

  // ─── Auth Logging ───────────────────────────────────────────────────────────

  private async logAuthEvent(params: {
    event: string
    identifier?: string
    userId?: string
    method?: 'otp' | 'google' | 'apple'
    deviceId?: string
    ipAddress?: string
    userAgent?: string
    metadata?: Record<string, unknown>
    success: boolean
    errorCode?: string
    /** Phase/practice-identity — the activePracticeId on the actor's
     *  AuthSession at event time. NULL for org-wide roles and pre-policy
     *  events. */
    practiceContext?: string | null
  }): Promise<void> {
    // N1 (2026-07-08) — bounded retry + OTEL failure span. Was a swallowed
    // try/catch; now writeAuditWithRetry gives us 3 attempts + a loud signal
    // on exhaust (audit.write.failed span + structured JSON error) so an
    // AuthLog write-outage becomes observable. Still fire-and-forget from the
    // auth flow's perspective — the wrapper never rethrows, so a failed
    // write never breaks sign-in.
    await writeAuditWithRetry(
      () =>
        this.prisma.authLog.create({
          data: {
            event: params.event,
            identifier: params.identifier ?? null,
            userId: params.userId ?? null,
            method: params.method ?? null,
            deviceId: params.deviceId ?? null,
            ipAddress: params.ipAddress ?? null,
            userAgent: params.userAgent ?? null,
            metadata: params.metadata
              ? JSON.parse(JSON.stringify(params.metadata))
              : null,
            success: params.success,
            errorCode: params.errorCode ?? null,
            practiceContext: params.practiceContext ?? null,
          },
        }),
      {
        kind: 'auth-log',
        event: params.event,
        userId: params.userId ?? null,
        identifier: params.identifier ?? null,
      },
    )
  }

  // ─── Policy / Consent Acknowledgment ─────────────────────────────────────────
  // Records that a patient agreed to the Terms + Privacy Policy as a dedicated
  // event on the existing AuthLog audit trail — no separate table. Captures who
  // (userId / identifier), when (createdAt), which version + channel (metadata),
  // and IP / userAgent. logAuthEvent already swallows its own errors, so a
  // failed audit write never breaks the login flow.
  private async logConsent(params: {
    userId?: string
    identifier?: string
    policyVersion?: string | null
    ipAddress?: string
    userAgent?: string
    via: string
  }): Promise<void> {
    if (!params.policyVersion?.trim()) return
    await this.logAuthEvent({
      event: 'policy_acknowledged',
      identifier: params.identifier,
      userId: params.userId,
      method: 'otp',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      metadata: {
        policyType: 'TERMS_AND_PRIVACY',
        policyVersion: params.policyVersion,
        via: params.via,
      },
      success: true,
    })
  }

  // Public entry point used by the post-login consent gate (onboarding privacy
  // step). Records the patient's Terms + Privacy agreement once, on the AuthLog
  // audit trail (no new table). Idempotent in spirit — a returning user who
  // already consented never reaches the gate, so it isn't called again.
  async recordConsent(
    userId: string,
    policyVersion: string,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ recorded: boolean }> {
    await this.logConsent({
      userId,
      policyVersion,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      via: 'onboarding',
    })
    return { recorded: true }
  }

  // ─── Training / Rules-of-Behavior Acknowledgment (HIPAA L1, §164.312(b)) ──────
  // Before the audit-review console (L2) lets a care-team reviewer in, they must
  // acknowledge the Rules of Behavior. Recorded as a `training_acknowledged`
  // event on the existing AuthLog audit trail — mirrors consent exactly, no new
  // table / migration. Who (userId), when (createdAt), which ROB version
  // (metadata.version), and IP / userAgent are all captured.

  async recordTrainingAck(
    userId: string,
    context?: { ipAddress?: string; userAgent?: string },
  ): Promise<{ recorded: boolean; version: string }> {
    await this.logAuthEvent({
      event: 'training_acknowledged',
      userId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        policyType: 'RULES_OF_BEHAVIOR',
        version: TRAINING_ACK_VERSION,
        via: 'audit-console',
      },
      success: true,
    })
    return { recorded: true, version: TRAINING_ACK_VERSION }
  }

  // Whether the reviewer has acknowledged the CURRENT ROB version. Reads the
  // latest `training_acknowledged` AuthLog event and compares its recorded
  // version — a stale acknowledgment (older version) reports as un-acknowledged,
  // so a ROB text change re-gates every reviewer.
  async getTrainingAckStatus(
    userId: string,
  ): Promise<{ acknowledged: boolean; version: string; ackedAt: Date | null }> {
    const latest = await this.prisma.authLog.findFirst({
      where: { event: 'training_acknowledged', userId, success: true },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, metadata: true },
    })
    const ackedVersion =
      latest && typeof latest.metadata === 'object' && latest.metadata !== null
        ? (latest.metadata as { version?: unknown }).version
        : undefined
    const acknowledged = ackedVersion === TRAINING_ACK_VERSION
    return {
      acknowledged,
      version: TRAINING_ACK_VERSION,
      ackedAt: acknowledged && latest ? latest.createdAt : null,
    }
  }

  // ─── Timezone Auto-Update ───────────────────────────────────────────────────

  private async silentlyUpdateTimezone(
    userId: string,
    timezone?: string,
  ): Promise<void> {
    if (!timezone || !timezone.includes('/')) return
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { timezone },
      })
    } catch (error) {
      console.error('Failed to update timezone:', error)
    }
  }

  // ─── Google Web Flow ────────────────────────────────────────────────────────

  async googleLogin(
    profile: Profile,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const rawEmail = profile.emails?.[0]?.value ?? null
    const emailVerified =
      (profile.emails?.[0] as { verified?: boolean })?.verified ?? false

    try {
      const user = await this.upsertSocialUser(
        'google',
        providerId,
        rawEmail,
        emailVerified,
        profile.displayName,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, {
        userAgent: context?.userAgent,
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        deviceType: context?.deviceType,
      })

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: rawEmail ?? undefined,
        userId: user.id,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'google')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: rawEmail ?? undefined,
          method: 'google',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId },
          success: false,
          errorCode: 'google_login_error',
        })
      }
      throw err
    }
  }

  // ─── Google Mobile Flow ─────────────────────────────────────────────────────

  async googleMobileLogin(
    idToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthResponse> {
    const res = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`,
    )

    if (!res.ok) {
      await this.logAuthEvent({
        event: 'social_login_failed',
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_google_token',
      })
      throw new UnauthorizedException('Invalid Google token')
    }

    const claims = (await res.json()) as {
      sub: string
      email?: string
      email_verified?: string
      name?: string
      aud: string
    }

    const expectedAud = this.config.get<string>('GOOGLE_CLIENT_ID')
    if (claims.aud !== expectedAud) {
      await this.logAuthEvent({
        event: 'social_login_failed',
        identifier: claims.email,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: false,
        errorCode: 'audience_mismatch',
      })
      throw new UnauthorizedException('Google token audience mismatch')
    }

    try {
      const emailVerified = claims.email_verified === 'true'
      const user = await this.upsertSocialUser(
        'google',
        claims.sub,
        claims.email ?? null,
        emailVerified,
        claims.name,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, {
        userAgent: context?.userAgent,
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        deviceType: context?.deviceType,
      })

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: claims.email,
        userId: user.id,
        method: 'google',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'google')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: claims.email,
          method: 'google',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId: claims.sub },
          success: false,
          errorCode: 'google_mobile_login_error',
        })
      }
      throw err
    }
  }

  // ─── Apple Mobile Flow ──────────────────────────────────────────────────────

  async appleLogin(
    identityToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthResponse> {
    const appleSignin = await import('apple-signin-auth')
    const clientId = this.config.get<string>('APPLE_CLIENT_ID', '')

    let claims: { sub: string; email?: string }
    try {
      claims = await appleSignin.default.verifyIdToken(identityToken, {
        audience: clientId,
        ignoreExpiration: false,
      })
    } catch {
      await this.logAuthEvent({
        event: 'social_login_failed',
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_apple_token',
      })
      throw new UnauthorizedException('Invalid Apple token')
    }

    try {
      const user = await this.upsertSocialUser(
        'apple',
        claims.sub,
        claims.email ?? null,
        false,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, {
        userAgent: context?.userAgent,
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        deviceType: context?.deviceType,
      })

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: claims.email,
        userId: user.id,
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId: claims.sub },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'apple')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: claims.email,
          method: 'apple',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId: claims.sub },
          success: false,
          errorCode: 'apple_login_error',
        })
      }
      throw err
    }
  }

  // ─── Apple Web Flow ─────────────────────────────────────────────────────────

  async appleWebLogin(
    profile: {
      id: string
      email?: string
      name?: { firstName?: string; lastName?: string }
    },
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthResponse> {
    const providerId = profile.id
    const email = profile.email ?? null
    const fullName = profile.name
      ? `${profile.name.firstName ?? ''} ${profile.name.lastName ?? ''}`.trim()
      : undefined

    try {
      const user = await this.upsertSocialUser(
        'apple',
        providerId,
        email,
        false,
        fullName,
      )
      this.assertAccountActive(user)
      await this.silentlyUpdateTimezone(user.id, context?.timezone)
      const tokens = await this.issueTokenPair(user, {
        userAgent: context?.userAgent,
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        deviceType: context?.deviceType,
      })

      await this.logAuthEvent({
        event: 'social_login_success',
        identifier: email ?? undefined,
        userId: user.id,
        method: 'apple',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { providerId },
        success: true,
      })

      return this.buildAuthResponse(tokens, user, 'apple')
    } catch (err) {
      if (!(err instanceof ForbiddenException)) {
        await this.logAuthEvent({
          event: 'social_login_failed',
          identifier: email ?? undefined,
          method: 'apple',
          deviceId: context?.deviceId,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: { providerId },
          success: false,
          errorCode: 'apple_web_login_error',
        })
      }
      throw err
    }
  }

  // ─── Shared Social Upsert ───────────────────────────────────────────────────

  private async upsertSocialUser(
    provider: 'google' | 'apple',
    providerId: string,
    email: string | null,
    emailVerified: boolean,
    name?: string,
  ): Promise<MinimalUser> {
    const existingAccount = await this.prisma.account.findUnique({
      where: { provider_providerId: { provider, providerId } },
      include: { user: true },
    })
    if (existingAccount) return existingAccount.user

    if (provider === 'google' && email && emailVerified) {
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
      })
      if (existingUser) {
        await this.prisma.account.create({
          data: { provider, providerId, email, userId: existingUser.id },
        })
        return existingUser
      }
    }

    // Pre-generate the permanent DisplayId and include it in the User
    // INSERT — Postgres checks User.displayId's NOT NULL constraint at
    // INSERT-statement-end. The service handles collision retry around
    // the whole step. See docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §3.
    const user = await this.prisma.$transaction((tx) =>
      this.displayIdService.issueForCreate(
        tx,
        DisplayIdClass.PATIENT,
        'google_oauth',
        (displayId) =>
          tx.user.create({
            data: {
              email: email ?? null,
              name: name ?? null,
              isVerified: emailVerified,
              roles: [UserRole.PATIENT],
              displayId,
              accounts: {
                create: { provider, providerId, email },
              },
            },
          }),
      ),
    )
    // First-touch welcome email for the just-created social user.
    this.dispatchWelcomeEmail(user)
    return user
  }

  // ─── Email OTP — Send ───────────────────────────────────────────────────────

  async sendOtp(
    email: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      appContext?: 'admin' | 'patient'
    },
  ): Promise<{ message: string }> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Admin-app gate: reject unknown emails AND patient-only accounts BEFORE
    // sending an OTP. The admin app must never auto-create a PATIENT user.
    if (context?.appContext === 'admin') {
      await this.assertAdminAccessAllowed(normalizedEmail)
    }

    // Demo accounts use pre-seeded, non-expiring OTPs — skip generation and email
    const preSeeded = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        expiresAt: { gt: new Date('2098-01-01') },
      },
    })
    if (preSeeded) {
      return { message: 'OTP sent successfully' }
    }

    // Check account status for existing users before sending OTP
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { accountStatus: true },
    })
    // System-principal accounts (audit registry) can NEVER sign in. Return the
    // generic success shape WITHOUT creating/sending an OTP — info-disclosure-
    // safe (don't reveal the account exists or that it's a reserved system row).
    // No OTP is ever minted, so the verify path can never succeed either.
    if (existingUser && existingUser.accountStatus === AccountStatus.SYSTEM) {
      await this.logAuthEvent({
        event: 'otp_blocked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_system_principal',
      })
      return { message: 'OTP sent successfully' }
    }
    if (existingUser && existingUser.accountStatus !== AccountStatus.ACTIVE) {
      await this.logAuthEvent({
        event: 'otp_blocked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      // Silent success — return the happy-path shape WITHOUT generating or
      // sending an OTP, so we never disclose to an unauthenticated requester
      // that this email exists-but-is-inactive (info-disclosure). The block is
      // still audited above; a non-ACTIVE user who somehow holds a valid code
      // is still stopped at verifyOtp.
      return { message: 'OTP sent successfully' }
    }

    // Check for recent OTP request (rate limiting)
    const recentOtp = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (recentOtp) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting a new OTP',
      )
    }

    const otp = randomInt(100_000, 1_000_000).toString()
    const codeHash = await this.bcryptService.hash(otp)
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000) // 10 minutes

    await this.prisma.otpCode.create({
      data: { email: normalizedEmail, codeHash, expiresAt },
    })

    this.sendOtpEmail(normalizedEmail, otp) // fire-and-forget — don't block response

    // Log the OTP request event
    await this.logAuthEvent({
      event: 'otp_requested',
      identifier: normalizedEmail,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    return { message: 'OTP sent successfully' }
  }

  // ─── Email OTP — Verify ─────────────────────────────────────────────────────

  async verifyOtp(
    email: string,
    code: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      appContext?: 'admin' | 'patient'
      deviceType?: string
    },
  ): Promise<AuthVerifyResult> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Admin-app gate: same role check as sendOtp. Defense-in-depth — the
    // OTP could still verify even if a malicious caller skipped the send
    // step (or if the seed perma-OTP shortcut was used).
    if (context?.appContext === 'admin') {
      await this.assertAdminAccessAllowed(normalizedEmail)
    }

    // Find the most recent unexpired OTP
    const otpRecord = await this.prisma.otpCode.findFirst({
      where: {
        email: normalizedEmail,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    })

    if (!otpRecord) {
      await this.logAuthEvent({
        event: 'otp_expired',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'otp_not_found_or_expired',
      })
      throw new BadRequestException('OTP not found or expired')
    }

    // Check if max attempts reached
    if (otpRecord.attempts >= 5) {
      await this.logAuthEvent({
        event: 'otp_locked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { attempts: otpRecord.attempts },
        success: false,
        errorCode: 'max_attempts_exceeded',
      })
      // Delete the locked OTP
      await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })
      throw new BadRequestException(
        'Too many incorrect attempts. Request a new OTP.',
      )
    }

    // Verify the code
    const valid = await this.bcryptService.compare(code, otpRecord.codeHash)
    if (!valid) {
      // Increment attempt counter
      const updatedOtp = await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: otpRecord.attempts + 1 },
      })

      await this.logAuthEvent({
        event: 'otp_failed',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: { attempts: updatedOtp.attempts },
        success: false,
        errorCode: 'invalid_code',
      })

      throw new BadRequestException('Invalid OTP')
    }

    // OTP is valid - upsert user
    let user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    })

    if (!user) {
      // Pre-generate the permanent DisplayId and include it in the User
      // INSERT — see docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §3.
      user = await this.prisma.$transaction((tx) =>
        this.displayIdService.issueForCreate(
          tx,
          DisplayIdClass.PATIENT,
          'otp',
          (displayId) =>
            tx.user.create({
              data: {
                email: normalizedEmail,
                isVerified: true,
                roles: [UserRole.PATIENT],
                displayId,
              },
            }),
        ),
      )
      // First-touch welcome email — only fires on this new-user branch.
      this.dispatchWelcomeEmail(user)
    } else if (!user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      })
    }

    // Enforce account status before issuing tokens
    if (user.accountStatus !== AccountStatus.ACTIVE) {
      const isPreSeededBlocked = otpRecord.expiresAt > new Date('2098-01-01')
      if (!isPreSeededBlocked) {
        await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })
      }
      await this.logAuthEvent({
        event: 'otp_blocked',
        identifier: normalizedEmail,
        userId: user.id,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      throw new ForbiddenException(
        `Account is ${user.accountStatus.toLowerCase()}`,
      )
    }

    // Preserve pre-seeded demo OTPs so they can be reused; delete for all others
    const isPreSeeded = otpRecord.expiresAt > new Date('2098-01-01')
    if (isPreSeeded) {
      await this.prisma.otpCode.update({
        where: { id: otpRecord.id },
        data: { attempts: 0 },
      })
    } else {
      await this.prisma.otpCode.delete({ where: { id: otpRecord.id } })
    }

    // Update timezone on every successful login (silently)
    await this.silentlyUpdateTimezone(user.id, context?.timezone)

    // Log successful verification
    await this.logAuthEvent({
      event: 'otp_verified',
      identifier: normalizedEmail,
      userId: user.id,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    // Phase/practice-identity + MFA (Manisha 2026-06-12 §1 + §6). Authenticate
    // the person fully (second factor) BEFORE the practice selector, then issue
    // tokens. See resolveSecondFactorOrTokens for the full ordering.
    return this.resolveSecondFactorOrTokens(user, context, 'otp')
  }

  // ─── Device Tracking ────────────────────────────────────────────────────────

  /**
   * Upsert the Device hardware record, then create/ensure a UserDevice link
   * between that device and the given user.
   *
   * Called after every successful non-guest login so the device history is
   * always tracked in the join table regardless of which user logged in.
   */
  async upsertOrTrackDevice(opts: {
    deviceId: string
    userId?: string
    platform?: string
    deviceType?: string
    deviceName?: string
    userAgent?: string
  }): Promise<void> {
    // 1. Upsert the Device (hardware fingerprint — no userId field anymore)
    const device = await this.prisma.device.upsert({
      where: { deviceId: opts.deviceId },
      create: {
        deviceId: opts.deviceId,
        platform: opts.platform,
        deviceType: opts.deviceType,
        deviceName: opts.deviceName,
        userAgent: opts.userAgent,
      },
      update: {
        lastSeenAt: new Date(),
        platform: opts.platform ?? undefined,
        deviceType: opts.deviceType ?? undefined,
        deviceName: opts.deviceName ?? undefined,
        userAgent: opts.userAgent ?? undefined,
      },
    })

    // 2. If a userId is provided, ensure a UserDevice link exists
    if (opts.userId) {
      await this.prisma.userDevice.upsert({
        where: {
          userId_deviceId: { userId: opts.userId, deviceId: device.id },
        },
        create: { userId: opts.userId, deviceId: device.id },
        update: {}, // link already exists — nothing to update
      })
    }
  }

  // ─── Profile — Submit (POST: initial onboarding or first-time save) ──────────

  async submitProfile(userId: string, dto: ProfileDto): Promise<ProfileResult> {
    const patch = this.buildProfilePatch(dto)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { ...patch, onboardingStatus: OnboardingStatus.COMPLETED },
      select: {
        name: true,
        dateOfBirth: true,
        communicationPreference: true,
        preferredLanguage: true,
        timezone: true,
        onboardingStatus: true,
      },
    })

    return { message: 'Profile saved', ...updated }
  }

  // ─── Profile — Patch (PATCH: edit existing profile) ──────────────────────────

  async patchProfile(userId: string, dto: ProfileDto): Promise<ProfileResult> {
    const patch = this.buildProfilePatch(dto)

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: patch,
      select: {
        name: true,
        dateOfBirth: true,
        communicationPreference: true,
        preferredLanguage: true,
        timezone: true,
        onboardingStatus: true,
      },
    })

    return { message: 'Profile updated', ...updated }
  }

  private buildProfilePatch(dto: ProfileDto) {
    const patch: Record<string, unknown> = {}

    if (dto.name !== undefined) patch.name = dto.name
    if (dto.dateOfBirth !== undefined) {
      patch.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null
    }
    if (dto.timezone !== undefined) patch.timezone = dto.timezone
    if (dto.preferredLanguage !== undefined)
      patch.preferredLanguage = dto.preferredLanguage
    if (dto.communicationPreference !== undefined)
      patch.communicationPreference = dto.communicationPreference

    return patch
  }

  // ─── Profile — Get ────────────────────────────────────────────────────────────

  async getProfile(
    userId: string,
    ctx?: { practiceId: string | null },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayId: true,
        email: true,
        name: true,
        roles: true,
        isVerified: true,
        onboardingStatus: true,
        // F27 — the escalation pipeline DEFERS all alert dispatch until a
        // patient is ENROLLED. The patient app needs this so the alert detail
        // surfaces can tell the patient the truth ("enrollment pending") instead
        // of a false "your care team has been notified".
        enrollmentStatus: true,
        accountStatus: true,
        dateOfBirth: true,
        communicationPreference: true,
        preferredLanguage: true,
        timezone: true,
        createdAt: true,
      },
    })

    if (!user) {
      throw new NotFoundException('User not found')
    }

    // MFA status for the profile "Security" surface. mfaEnabled mirrors the
    // shouldChallengeMfa check (a TotpCredential row with enrolledAt set);
    // mfaRequired tells the FE whether the role is under the enforced-MFA
    // policy (so it can show "Required" and hide any disable affordance).
    const totpCred = await this.prisma.totpCredential.findUnique({
      where: { userId },
      select: { enrolledAt: true },
    })
    const mfaEnabled = totpCred?.enrolledAt != null
    const mfaRequired = requiresMfa(user.roles)
    // Recovery-code counts power the Settings "fallback" card (how many are
    // left vs used). Only queried when enrolled — patients/non-enrolled users
    // have none, so we skip the round-trip.
    let recoveryCodesTotal = 0
    let recoveryCodesRemaining = 0
    if (mfaEnabled) {
      const [total, remaining] = await Promise.all([
        this.prisma.mfaRecoveryCode.count({ where: { userId } }),
        this.prisma.mfaRecoveryCode.count({ where: { userId, usedAt: null } }),
      ])
      recoveryCodesTotal = total
      recoveryCodesRemaining = remaining
    }

    // Phase/practice-identity rehydrate fix (Manisha 2026-06-12 §1, smoke
    // 2026-06-18) — surface activePracticeId + activePractice + the user's
    // available memberships so admin's rehydrate() can restore practice
    // context after a browser refresh. Without these fields, F5 dropped
    // every PROVIDER/MED_DIR/COORDINATOR into the ZeroPracticeModal even
    // though their AuthSession + JWT still carried activePracticeId.
    //
    // Probe BOTH membership relations — the dual-relation pattern mirrors
    // resolvePracticeContext() and JwtStrategy.validate(). COORDINATOR
    // membership is 1:1 on PracticeCoordinator; PROVIDER / MED_DIR is 1:N
    // on PracticeProvider. SUPER_ADMIN / HEALPLACE_OPS are unscoped and
    // get null/[].
    // activePractice is the row matching the JWT's activePracticeId — if
    // the JWT carries a stale id (practice deleted after sign-in) we
    // return null + leave the FE to surface the ZeroPracticeModal
    // correctly (this case = genuinely no practice). Shared with
    // selectPractice / switchPractice via resolvePracticeBundle (PR #90).
    const activePracticeIdFromCtx = ctx?.practiceId ?? null
    const { activePractice, availablePractices } =
      await this.resolvePracticeBundle(
        { id: user.id, roles: user.roles },
        activePracticeIdFromCtx,
      )

    return {
      id: user.id,
      // Permanent public-facing identifier (CP-PAT-... / CP-STF-...).
      // Patients quote this on support calls. See
      // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
      displayId: user.displayId,
      email: user.email,
      name: user.name,
      roles: user.roles,
      emailVerified: user.isVerified,
      accountStatus: user.accountStatus.toLowerCase(),
      createdAt: user.createdAt.toISOString(),
      dateOfBirth: user.dateOfBirth
        ? user.dateOfBirth.toISOString().slice(0, 10)
        : null,
      communicationPreference: user.communicationPreference,
      preferredLanguage: user.preferredLanguage,
      timezone: user.timezone,
      onboardingStatus: user.onboardingStatus,
      enrollmentStatus: user.enrollmentStatus,
      // MFA status (additive) — drives the profile Security pill.
      mfaEnabled,
      mfaRequired,
      recoveryCodesTotal,
      recoveryCodesRemaining,
      // Practice-identity rehydrate fields (additive — pre-fix consumers
      // ignore them).
      activePracticeId: activePractice ? activePractice.id : null,
      activePractice,
      availablePractices,
    }
  }

  // ─── Magic Link — Send ───────────────────────────────────────────────────────

  async sendMagicLink(
    email: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
    },
  ): Promise<{ message: string }> {
    if (!email?.trim()) {
      throw new BadRequestException('Email is required')
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Check account status for existing users
    const existingUser = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { accountStatus: true },
    })
    // System-principal accounts can never sign in. Generic success, no link
    // minted — info-disclosure-safe (see sendOtp for the rationale).
    if (existingUser && existingUser.accountStatus === AccountStatus.SYSTEM) {
      await this.logAuthEvent({
        event: 'magic_link_blocked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_system_principal',
      })
      return { message: 'Magic link sent successfully' }
    }
    if (existingUser && existingUser.accountStatus !== AccountStatus.ACTIVE) {
      await this.logAuthEvent({
        event: 'magic_link_blocked',
        identifier: normalizedEmail,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      // Silent success — same as sendOtp: return the happy-path shape without
      // creating or sending a magic link, so we never disclose that the account
      // exists-but-is-inactive. The block is audited above.
      return { message: 'Magic link sent successfully' }
    }

    // Rate limiting: 1 magic link per email per 60s
    const recentLink = await this.prisma.magicLink.findFirst({
      where: {
        email: normalizedEmail,
        createdAt: { gt: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: 'desc' },
    })
    if (recentLink) {
      throw new BadRequestException(
        'Please wait 60 seconds before requesting a new magic link',
      )
    }

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256(rawToken)
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000) // 30 minutes

    await this.prisma.magicLink.create({
      data: { email: normalizedEmail, tokenHash, expiresAt },
    })

    const port = this.config.get<string>('PORT', '8080')
    const backendUrl = this.config.get<string>(
      'BACKEND_URL',
      `http://localhost:${port}`,
    )
    const magicUrl = `${backendUrl}/api/v2/auth/magic-link/verify?token=${rawToken}`

    this.sendMagicLinkEmail(normalizedEmail, magicUrl) // fire-and-forget

    await this.logAuthEvent({
      event: 'magic_link_requested',
      identifier: normalizedEmail,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    return { message: 'Magic link sent successfully' }
  }

  // ─── Magic Link — Verify ──────────────────────────────────────────────────────

  async verifyMagicLink(
    token: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthVerifyResult> {
    if (!token?.trim()) {
      throw new BadRequestException('Token is required')
    }

    const tokenHash = sha256(token.trim())

    const record = await this.prisma.magicLink.findFirst({
      where: {
        tokenHash,
        expiresAt: { gt: new Date() },
        usedAt: null,
      },
    })

    if (!record) {
      await this.logAuthEvent({
        event: 'magic_link_failed',
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_or_expired_token',
      })
      throw new BadRequestException('Magic link is invalid or expired')
    }

    // Mark as used
    await this.prisma.magicLink.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    })

    // Upsert user (same logic as OTP verify)
    let user = await this.prisma.user.findUnique({
      where: { email: record.email },
    })

    if (!user) {
      // Same pre-generate pattern as OTP path — see
      // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §3.
      user = await this.prisma.$transaction((tx) =>
        this.displayIdService.issueForCreate(
          tx,
          DisplayIdClass.PATIENT,
          'magic_link',
          (displayId) =>
            tx.user.create({
              data: {
                email: record.email,
                isVerified: true,
                roles: [UserRole.PATIENT],
                displayId,
              },
            }),
        ),
      )
      // First-touch welcome email — only fires on this new-user branch.
      this.dispatchWelcomeEmail(user)
    } else if (!user.isVerified) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { isVerified: true },
      })
    }

    if (user.accountStatus !== AccountStatus.ACTIVE) {
      await this.logAuthEvent({
        event: 'magic_link_blocked',
        identifier: record.email,
        userId: user.id,
        method: 'otp',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'account_not_active',
      })
      throw new ForbiddenException(
        `Account is ${user.accountStatus.toLowerCase()}`,
      )
    }

    await this.silentlyUpdateTimezone(user.id, context?.timezone)

    await this.logAuthEvent({
      event: 'magic_link_verified',
      identifier: record.email,
      userId: user.id,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      success: true,
    })

    // Phase/practice-identity + MFA — symmetric with verifyOtp. Second factor
    // (where applicable) BEFORE the practice selector. Magic-link is patient-
    // only (admin app is OTP-only), so in practice this resolves the patient
    // WebAuthn / no-second-factor branches.
    return this.resolveSecondFactorOrTokens(user, context, 'magic_link')
  }

  // ─── Admin-app role gate ────────────────────────────────────────────────────
  // Used by sendOtp + verifyOtp when called from the admin app. The admin
  // app must NEVER auto-create a PATIENT user — only existing users with at
  // least one admin role may sign in.
  private static readonly ADMIN_ALLOWED_ROLES: UserRole[] = [
    UserRole.PROVIDER,
    UserRole.MEDICAL_DIRECTOR,
    UserRole.COORDINATOR,
    UserRole.HEALPLACE_OPS,
    UserRole.SUPER_ADMIN,
  ]

  private async assertAdminAccessAllowed(
    normalizedEmail: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { roles: true, accountStatus: true },
    })
    if (!user) {
      throw new ForbiddenException(
        'No admin account exists for this email. Please contact your administrator.',
      )
    }
    const allowed = user.roles.some((r) =>
      AuthService.ADMIN_ALLOWED_ROLES.includes(r),
    )
    if (!allowed) {
      throw new ForbiddenException(
        'This account is not authorized to access the admin app.',
      )
    }
  }

  // ─── User Invites — Lookup ──────────────────────────────────────────────────
  //
  // The activation flow is a thin wrapper around magic-link verify — the
  // raw token in the URL is a one-time secret that creates the User row
  // (if absent), creates the practice-membership row appropriate to the
  // invite's role, marks the invite accepted, and issues a session.
  //
  // `lookupInvite` is the GET-side probe used by the activation page to
  // render "Activate as <name>, <role> at <practice>" before the user
  // clicks the confirm button.

  async lookupInvite(rawToken: string): Promise<{
    email: string
    name: string
    role: UserRole
    practiceName: string | null
    expiresAt: Date
  }> {
    if (!rawToken?.trim()) {
      throw new BadRequestException('Token is required')
    }
    const tokenHash = sha256(rawToken.trim())
    const invite = await this.prisma.userInvite.findUnique({
      where: { tokenHash },
      include: { practice: { select: { name: true } } },
    })
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date()
    ) {
      throw new BadRequestException('Invite is invalid or expired')
    }
    return {
      email: invite.email,
      name: invite.name,
      role: invite.role,
      practiceName: invite.practice?.name ?? null,
      expiresAt: invite.expiresAt,
    }
  }

  // ─── User Invites — Accept ──────────────────────────────────────────────────

  async acceptInvite(
    rawToken: string,
    context?: {
      deviceId?: string
      ipAddress?: string
      userAgent?: string
      timezone?: string
      deviceType?: string
    },
  ): Promise<AuthResponse | InviteSignInRequired> {
    if (!rawToken?.trim()) {
      throw new BadRequestException('Token is required')
    }
    const tokenHash = sha256(rawToken.trim())

    // Single-step validation + claim so two concurrent clicks can't both
    // create a user. We re-check `acceptedAt`/`revokedAt`/`expiresAt`
    // inside the transaction below.
    const invite = await this.prisma.userInvite.findUnique({
      where: { tokenHash },
    })
    if (
      !invite ||
      invite.acceptedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date()
    ) {
      await this.logAuthEvent({
        event: 'invite_accept_failed',
        deviceId: context?.deviceId,
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        success: false,
        errorCode: 'invalid_or_expired_token',
      })
      throw new BadRequestException('Invite is invalid or expired')
    }

    // Run the user-create + invite-claim + membership-create in one
    // transaction so a duplicate accept races cleanly.
    const result = await this.prisma.$transaction(async (tx) => {
      // Re-read invite for SELECT FOR UPDATE-style guard (Prisma doesn't
      // expose row locks portably — the unique constraint on createdUserId
      // is the final safety net).
      const fresh = await tx.userInvite.findUnique({
        where: { id: invite.id },
      })
      if (
        !fresh ||
        fresh.acceptedAt ||
        fresh.revokedAt ||
        fresh.expiresAt <= new Date()
      ) {
        throw new BadRequestException('Invite is invalid or expired')
      }

      // Find-or-create the User. If a User already exists with this
      // email (e.g. invite went to a known patient who used OTP first),
      // we add the invite's role to the existing user rather than
      // duplicating accounts.
      const existing = await tx.user.findUnique({
        where: { email: fresh.email },
      })

      // Invite-driven activation skips the patient app's onboarding/
      // privacy gate entirely — the inviter (coordinator / admin) has
      // already collected the basics, and the patient should land on the
      // dashboard on the first click. We mark `onboardingStatus = COMPLETED`
      // here; the matching `policy_acknowledged` AuthLog event is written
      // post-commit below.
      let userRow: typeof existing
      let userWasCreated = false
      if (existing) {
        const merged = Array.from(new Set([...existing.roles, fresh.role]))
        userRow = await tx.user.update({
          where: { id: existing.id },
          data: {
            isVerified: true,
            roles: merged,
            name: existing.name ?? fresh.name,
            onboardingStatus: OnboardingStatus.COMPLETED,
          },
        })
      } else {
        // Pre-generate DisplayId so the User INSERT can satisfy NOT NULL.
        // Class derives from the invited role: PATIENT invites → PAT
        // prefix; staff invites → STF. See
        // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md §3.
        userRow = await this.displayIdService.issueForCreate(
          tx,
          fresh.role === UserRole.PATIENT
            ? DisplayIdClass.PATIENT
            : DisplayIdClass.STAFF,
          'invite_accept',
          (displayId) =>
            tx.user.create({
              data: {
                email: fresh.email,
                name: fresh.name,
                isVerified: true,
                roles: [fresh.role],
                onboardingStatus: OnboardingStatus.COMPLETED,
                displayId,
              },
            }),
        )
        userWasCreated = true
      }

      if (userRow.accountStatus !== AccountStatus.ACTIVE) {
        throw new ForbiddenException(
          `Account is ${userRow.accountStatus.toLowerCase()}`,
        )
      }

      // Practice-membership row for staff roles. PATIENT is skipped
      // here — the full PatientProviderAssignment row requires primary
      // provider / backup provider / MD ids that the inviter didn't
      // supply. That assignment lands in a follow-up step (Provider
      // Verify / Admin onboarding) post-activation.
      if (fresh.practiceId) {
        switch (fresh.role) {
          case UserRole.PROVIDER:
            await tx.practiceProvider.upsert({
              where: {
                practiceId_userId: {
                  practiceId: fresh.practiceId,
                  userId: userRow.id,
                },
              },
              create: {
                practiceId: fresh.practiceId,
                userId: userRow.id,
              },
              update: {},
            })
            break
          case UserRole.MEDICAL_DIRECTOR:
            await tx.practiceMedicalDirector.upsert({
              where: {
                practiceId_userId: {
                  practiceId: fresh.practiceId,
                  userId: userRow.id,
                },
              },
              create: {
                practiceId: fresh.practiceId,
                userId: userRow.id,
              },
              update: {},
            })
            break
          case UserRole.COORDINATOR:
            // One practice per coordinator — enforced by @unique on
            // userId. If a row exists we update it (re-invite into a
            // different practice).
            await tx.practiceCoordinator.upsert({
              where: { userId: userRow.id },
              create: {
                practiceId: fresh.practiceId,
                userId: userRow.id,
              },
              update: { practiceId: fresh.practiceId },
            })
            break
          // PATIENT, HEALPLACE_OPS, SUPER_ADMIN — no membership row.
          default:
            break
        }
      }

      // Claim the invite (fails on the @unique constraint if a race lost).
      const claimedInvite = await tx.userInvite.update({
        where: { id: fresh.id },
        data: {
          acceptedAt: new Date(),
          createdUserId: userRow.id,
        },
      })

      return { user: userRow, invite: claimedInvite, userWasCreated }
    })

    // First-touch welcome email for the just-created invitee. The
    // returning-user branch already has a displayId from their previous
    // OTP/magic-link sign-in, so we skip them here to avoid spam.
    if (result.userWasCreated) {
      this.dispatchWelcomeEmail(result.user)
    }

    await this.silentlyUpdateTimezone(result.user.id, context?.timezone)

    await this.logAuthEvent({
      event: 'invite_accepted',
      identifier: result.invite.email,
      userId: result.user.id,
      method: 'otp',
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      metadata: {
        inviteId: result.invite.id,
        role: result.invite.role,
        practiceId: result.invite.practiceId,
      },
      success: true,
    })

    // Auto-acknowledge the current Terms + Privacy version on the audit
    // trail. The invitee never sees the privacy step (onboarding is
    // pre-completed above), so we record consent here with via:
    // 'invite_accept' to keep the audit log honest about how it landed.
    await this.logConsent({
      userId: result.user.id,
      identifier: result.invite.email,
      policyVersion: POLICY_VERSION,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      via: 'invite_accept',
    })

    // Admin-role invitees do NOT get an auto-login session — they sign in via
    // OTP (then TOTP/MFA) so the second factor isn't bypassed. The account is
    // already created + ACTIVE above; the FE redirects them to /sign-in.
    const isAdminInvite = result.user.roles.some((r) =>
      AuthService.ADMIN_ALLOWED_ROLES.includes(r),
    )
    if (isAdminInvite) {
      return { status: 'SIGN_IN_REQUIRED', roles: result.user.roles }
    }

    const tokens = await this.issueTokenPair(result.user, {
      userAgent: context?.userAgent,
      deviceId: context?.deviceId,
      ipAddress: context?.ipAddress,
      deviceType: context?.deviceType,
    })
    return this.buildAuthResponse(tokens, result.user, 'magic_link')
  }

  // ─── Email Helpers ──────────────────────────────────────────────────────────

  private async sendOtpEmail(email: string, otp: string): Promise<void> {
    // N6 — OTP is pre-auth: the identifier may not resolve to a User row yet
    // (new sign-up flow). patientUserId stays null; identifier goes in metadata
    // so the §164.528 trail still records which email was targeted.
    await this.emailService.sendEmail(
      email,
      'Your Cardioplace verification code',
      otpEmailHtml(otp),
      {
        template: 'otp',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: null,
        metadata: { identifier: email },
      },
    )
  }

  private async sendMagicLinkEmail(email: string, url: string): Promise<void> {
    // N6 — same reasoning as sendOtpEmail (pre-auth, identifier may not resolve).
    await this.emailService.sendEmail(
      email,
      'Sign in to Cardioplace',
      magicLinkEmailHtml(url),
      {
        template: 'magic_link',
        templateVersion: EMAIL_TEMPLATE_VERSION,
        patientUserId: null,
        metadata: { identifier: email },
      },
    )
  }
}
