import type { Request } from 'express'

/**
 * App-scoped auth cookie naming.
 *
 * The patient app (localhost:3000) and admin app (localhost:3001) both talk
 * to this one backend, so the HttpOnly `access_token` / `refresh_token`
 * cookies were set on the shared API origin under a single unscoped name.
 * Browsers do NOT scope cookies by port, so signing in on one app
 * contaminated the other's session on the same browser — you needed
 * incognito / a second browser to run a patient + admin flow side by side.
 *
 * Fix: prefix the cookie names per destination app (`cp_patient_*` vs
 * `cp_admin_*`). In production the two apps are on different subdomains so
 * the cookies were already isolated there — the prefixed names are additive
 * (new names, same attributes/behavior), so prod is unaffected.
 */

export type CookieScope = 'patient' | 'admin'

// Mirrors the ADMIN_ROLES set in frontend/src/proxy.ts + admin/src/proxy.ts.
// Any of these means the user's session belongs on the admin app.
const ADMIN_ROLES: ReadonlySet<string> = new Set([
  'SUPER_ADMIN',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'HEALPLACE_OPS',
])

/**
 * Scope a *fresh* sign-in by its destination app, which is decided by role.
 *
 * Admin-role users always end up on the admin app — either by signing in on
 * the admin origin directly, or via the patient→admin sign-in bridge
 * (frontend/src/app/sign-in/page.tsx) where the verify POST originates from
 * the patient origin but the session must live in the admin app. Role is the
 * server-trusted destination signal; the request Origin alone is wrong for
 * the bridge case. This mirrors how verifyMagicLink already picks targetUrl.
 */
export function scopeForRoles(roles: readonly string[] | undefined): CookieScope {
  return (roles ?? []).some((r) => ADMIN_ROLES.has(r)) ? 'admin' : 'patient'
}

/**
 * Scope an *existing* session's cookie ops (refresh / logout) by request
 * Origin. Each app refreshes and logs out from its own origin (no cross-app
 * bridge on these paths), so Origin is reliable here. Falls back to Referer,
 * then to patient (the larger surface area).
 */
export function deriveCookieScope(req: Request): CookieScope {
  const origin =
    (req.headers.origin as string | undefined) ||
    (req.headers.referer as string | undefined) ||
    ''
  // Tolerate an optional `www.` prefix — DNS/CDN may serve the app under
  // the www. host (e.g. https://www.admin.dev.cardioplace.ai), and a plain
  // `://admin.` substring check would miss it and fall through to patient,
  // causing refresh/logout to look up the wrong scoped cookie.
  if (origin.includes(':3001') || /:\/\/(www\.)?admin\./.test(origin)) return 'admin'
  if (origin.includes(':3000') || /:\/\/(www\.)?app\./.test(origin)) return 'patient'
  return 'patient'
}

export function cookieName(
  scope: CookieScope,
  key: 'access' | 'refresh',
): string {
  return `cp_${scope}_${key === 'access' ? 'access_token' : 'refresh_token'}`
}

// Pre-fix unscoped names. Still read as a fallback (so sessions created
// before this change keep working) and cleared on logout so legacy local
// sessions wipe cleanly instead of orphaning.
export const LEGACY_ACCESS_COOKIE = 'access_token'
export const LEGACY_REFRESH_COOKIE = 'refresh_token'
