import { Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import type { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UserRole } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  LEGACY_ACCESS_COOKIE,
  cookieName,
  deriveCookieScope,
} from '../cookie-scope.js'

export interface JwtPayload {
  sub: string
  email: string | null
  roles: UserRole[]
  /** Phase/practice-identity — the practice the session is acting as.
   *  Signed at issue time (sign-in / select-practice / switch-practice).
   *  Switching mints a fresh access token so the FE sees the new context
   *  on its next request without a DB hit on the auth path. */
  activePracticeId?: string | null
  iat?: number
  exp?: number
}

// Read the access token from the HttpOnly access cookie. This lets the
// frontend stop persisting the JWT in JS-readable storage (closes B6 — XSS
// can no longer exfiltrate the access token).
//
// Cookies are app-scoped (`cp_patient_*` / `cp_admin_*`) to stop the patient
// and admin apps polluting each other's session on a shared localhost host
// (see auth/cookie-scope.ts). Both cookies are sent on every request to the
// shared backend, so we MUST pick the one scoped to the *requesting* app —
// derived from the request Origin, exactly like the refresh/logout handlers.
// A fixed precedence (e.g. patient-first) would mean an admin request with no
// Bearer header (e.g. right after an admin reload, before the in-memory token
// re-hydrates) reads the patient's cookie and authenticates as the patient →
// "access denied" on admin-only routes. The pre-fix unscoped `access_token`
// stays as a fallback so legacy sessions keep working. Bearer header still
// takes precedence over this extractor.
function fromAccessCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined
  if (!cookies) return null
  const scope = deriveCookieScope(req)
  return (
    cookies[cookieName(scope, 'access')] ??
    cookies[LEGACY_ACCESS_COOKIE] ??
    null
  )
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Accept BOTH the Authorization: Bearer header AND the HttpOnly cookie.
      // Bearer takes precedence so existing API clients that send the header
      // (e.g. mobile, ad-hoc curl) keep working; the cookie is the new path
      // for browser sessions where JS no longer holds the token.
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        fromAccessCookie,
      ]),
      ignoreExpiration: false,
      // Fail closed: no fallback default. If JWT_ACCESS_SECRET is unset the
      // process must refuse to start rather than sign/verify tokens with a
      // known constant — a hardcoded fallback lets anyone who's read the
      // source forge valid access tokens (Humaira N4). getOrThrow surfaces a
      // clear "JWT_ACCESS_SECRET" error at boot.
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    })
  }

  /**
   * Phase/practice-identity (Manisha 2026-06-12 §1, Edge Case 1) — if the
   * access token carries an `activePracticeId` claim but the user is no
   * longer a member of that practice (admin removed them after sign-in),
   * the request must NOT silently succeed under the stale context. Throw
   * a 401 with a discriminated `errorCode` the FE catches on the
   * 401-refresh-retry path to bounce the user to /sign-in/select-practice
   * with a "your practice membership has changed" banner. One indexed
   * PracticeProvider lookup per request when the claim is set — skipped
   * entirely for SUPER_ADMIN / HEALPLACE_OPS / PATIENT sessions (their
   * claim is null).
   */
  async validate(payload: JwtPayload) {
    const activePracticeId = payload.activePracticeId ?? null
    if (activePracticeId) {
      // Membership can live on ANY of three relations depending on role:
      //   • PROVIDER         → PracticeProvider (compound practiceId_userId)
      //   • MEDICAL_DIRECTOR → PracticeMedicalDirector (compound practiceId_userId)
      //   • COORDINATOR      → PracticeCoordinator (1:1 by userId)
      // Earlier this only checked PracticeProvider (+ later PracticeCoordinator)
      // — that bounced every MED_DIR / COORDINATOR request with
      // PRACTICE_MEMBERSHIP_REVOKED because their activePracticeId (resolved in
      // resolvePracticeContext from PracticeMedicalDirector / PracticeCoordinator)
      // never matched a PracticeProvider row. PR #90: a MED_DIR heads a practice
      // via PracticeMedicalDirector, NOT PracticeProvider, so omitting it bounced
      // every medicalDirector to /sign-in/select-practice?reason=membership-changed
      // immediately after a successful sign-in. Probe all three: as long as ONE
      // confirms membership for the active practice, the request is authentic.
      const [asProvider, asMedDir, asCoordinator] = await Promise.all([
        this.prisma.practiceProvider.findUnique({
          where: {
            practiceId_userId: {
              practiceId: activePracticeId,
              userId: payload.sub,
            },
          },
          select: { id: true },
        }),
        this.prisma.practiceMedicalDirector.findUnique({
          where: {
            practiceId_userId: {
              practiceId: activePracticeId,
              userId: payload.sub,
            },
          },
          select: { id: true },
        }),
        this.prisma.practiceCoordinator.findUnique({
          where: { userId: payload.sub },
          select: { practiceId: true },
        }),
      ])
      const coordinatorMatch =
        asCoordinator !== null && asCoordinator.practiceId === activePracticeId
      if (!asProvider && !asMedDir && !coordinatorMatch) {
        throw new UnauthorizedException({
          message: 'Your practice membership has changed — please pick a practice again.',
          errorCode: 'PRACTICE_MEMBERSHIP_REVOKED',
        })
      }
    }
    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
      activePracticeId,
    }
  }
}
