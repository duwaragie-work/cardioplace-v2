import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_ROUTES = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/terms', '/privacy', '/auth/callback', '/auth/magic-link']

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    // atob is available in Next's Edge runtime where proxy.ts executes.
    const json = atob(padded)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

// Any non-patient role belongs on the admin app. Mirrors the role set in
// admin/src/proxy.ts so a user with any of these is routed there.
const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'HEALPLACE_OPS',
])

function hasAdminRole(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload) return false
  const roles = payload.roles
  if (!Array.isArray(roles)) return false
  return roles.some((r) => typeof r === 'string' && ADMIN_ROLES.has(r))
}

function buildAdminBridgeUrl(token: string): URL {
  // Forward the access token + JWT-derived identity to the admin app's
  // sign-in handler via URL params. A bare cross-origin redirect can't
  // carry the admin cookie, so admin would re-prompt sign-in. Refresh
  // token isn't carried (lives in localStorage on the patient origin) —
  // admin re-auths on access-token expiry.
  const url = new URL('/auth/magic-link', ADMIN_URL)
  url.searchParams.set('accessToken', token)
  const payload = decodeJwtPayload(token)
  if (payload) {
    if (payload.sub) url.searchParams.set('userId', String(payload.sub))
    if (payload.email) url.searchParams.set('email', String(payload.email))
    if (Array.isArray(payload.roles)) {
      url.searchParams.set('roles', (payload.roles as string[]).join(','))
    }
  }
  return url
}

export function proxy(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )

  // Admin-role users (provider, medical director, ops, super admin) belong
  // on the admin subdomain, not the patient app.
  if (token && hasAdminRole(token)) {
    return NextResponse.redirect(buildAdminBridgeUrl(token))
  }

  // Not logged in, trying to access protected route
  if (!token && !isPublic) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // Already logged in, trying to access auth pages → redirect to dashboard
  if (token && (path === '/welcome' || path === '/sign-in')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  const response = NextResponse.next()
  // Disqualify protected pages from the browser back/forward cache so a
  // logged-out user pressing Back gets a fresh request — proxy then
  // redirects them to /sign-in instead of restoring the stale page.
  if (!isPublic) {
    response.headers.set('Cache-Control', 'no-store, must-revalidate')
  }
  return response
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|pdf)).*)',
  ],
}
