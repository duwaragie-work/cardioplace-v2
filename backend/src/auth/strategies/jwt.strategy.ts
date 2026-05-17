import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PassportStrategy } from '@nestjs/passport'
import type { Request } from 'express'
import { ExtractJwt, Strategy } from 'passport-jwt'
import { UserRole } from '../../generated/prisma/enums.js'

export interface JwtPayload {
  sub: string
  email: string | null
  roles: UserRole[]
  iat?: number
  exp?: number
}

// Read the access token from the HttpOnly access cookie. This lets the
// frontend stop persisting the JWT in JS-readable storage (closes B6 — XSS
// can no longer exfiltrate the access token).
//
// Cookies are app-scoped (`cp_patient_*` / `cp_admin_*`) to stop the patient
// and admin apps polluting each other's session on a shared localhost host
// (see auth/cookie-scope.ts). Auth is by JWT signature, not cookie name, so
// accepting any of the candidate names — including the pre-fix unscoped
// `access_token` — is safe and keeps legacy sessions working.
function fromAccessCookie(req: Request): string | null {
  const cookies = req?.cookies as Record<string, string> | undefined
  if (!cookies) return null
  return (
    cookies['cp_patient_access_token'] ??
    cookies['cp_admin_access_token'] ??
    cookies['access_token'] ??
    null
  )
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService) {
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
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET', 'fallback-secret'),
    })
  }

  validate(payload: JwtPayload) {
    return { id: payload.sub, email: payload.email, roles: payload.roles }
  }
}
