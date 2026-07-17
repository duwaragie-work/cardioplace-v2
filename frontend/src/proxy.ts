import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import {
  AUTH_MARKER_COOKIE,
  AUTH_ROLE_COOKIE,
  ONBOARDED_MARKER_COOKIE,
} from '@/lib/cookie-names'

const PUBLIC_ROUTES = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/terms', '/privacy', '/auth/callback', '/auth/magic-link', '/activate', '/support/locked-out']

const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001'

// Phase/cluster-1 (B5/B6): we no longer persist the JWT in any JS-readable
// storage on the frontend origin. The JWT itself lives in (a) the backend's
// HttpOnly `access_token` cookie scoped to the API origin and (b) the React
// in-memory state of AuthProvider. The proxy needs to gate page navigation
// without seeing the JWT, so the frontend writes two non-token marker
// cookies on login:
//
//   cp_patient_auth_marker — opaque "logged in" boolean ("1" or empty). Read
//                            here.
//   cp_patient_auth_role   — comma-separated role list. Read here for the
//                            admin-app bridge. Carries no PII / no credential.
//
// The `cp_patient_` prefix scopes these to the patient app — the admin app
// uses `cp_admin_*` — so the two apps don't pollute each other's session on
// a shared localhost host (see lib/cookie-names.ts).
//
// Both are written by AuthProvider.login() via document.cookie. They're
// cleared by AuthProvider.logout(). They're tamperable from the client by
// design — they only choose which page renders, not whether API calls
// succeed (the backend rejects unauthenticated requests regardless).

// Any non-patient role belongs on the admin app. Mirrors the role set in
// admin/src/proxy.ts so a user with any of these is routed there.
// COORDINATOR added in phase/23 — they live in the admin app (invite +
// manage patients in their practice). Without them here, a Coordinator
// arriving at the patient app would dead-end on its dashboard.
const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'HEALPLACE_OPS',
  'COORDINATOR',
])

// Patient-facing surfaces that require onboarding first. Deliberately a
// list, not "everything non-public": /onboarding and /clinical-intake must
// stay reachable, and gating them would loop.
const ONBOARDING_GATED_ROUTES = [
  '/dashboard',
  '/readings',
  '/check-in',
  '/chat',
  '/profile',
  '/notifications',
]

function isOnboardingGated(path: string): boolean {
  return ONBOARDING_GATED_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )
}

function hasAdminRole(rolesCookieValue: string | undefined): boolean {
  if (!rolesCookieValue) return false
  return rolesCookieValue
    .split(',')
    .map((r) => r.trim())
    .some((r) => ADMIN_ROLES.has(r))
}

function buildAdminBridgeUrl(): URL {
  // Cookie-only handoff — no tokens in the URL (those leak via Referer +
  // browser history). The admin app on first mount calls /api/v2/auth/refresh
  // with credentials:'include', which carries the HttpOnly refresh_token
  // cookie scoped to the API origin and gets back a fresh access token.
  return new URL('/dashboard', ADMIN_URL)
}

export function proxy(request: NextRequest) {
  const marker = request.cookies.get(AUTH_MARKER_COOKIE)?.value
  const rolesValue = request.cookies.get(AUTH_ROLE_COOKIE)?.value
  const onboardedMarker = request.cookies.get(ONBOARDED_MARKER_COOKIE)?.value
  const path = request.nextUrl.pathname

  const isPublic = PUBLIC_ROUTES.some(
    (r) => path === r || path.startsWith(r + '/'),
  )

  // Admin-role users (provider, medical director, ops, super admin) belong
  // on the admin subdomain, not the patient app.
  if (marker && hasAdminRole(rolesValue)) {
    return NextResponse.redirect(buildAdminBridgeUrl())
  }

  // Not logged in, trying to access protected route
  if (!marker && !isPublic) {
    return NextResponse.redirect(new URL('/sign-in', request.url))
  }

  // Already logged in, trying to access auth pages → redirect to dashboard
  if (marker && (path === '/welcome' || path === '/sign-in')) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  // Un-onboarded patients belong on /onboarding. Without this, typing a URL
  // walked straight past onboarding into the app — including the 5-step
  // clinical check-in. The onboarding page's own client-side redirect never
  // saw those navigations.
  //
  // Explicit '0' only: an absent cookie means "unknown" (a session predating
  // this cookie), and bouncing those to /onboarding would be worse than
  // letting them through — AuthProvider writes the real bit on mount.
  // /onboarding itself is never gated, or this would loop.
  if (marker && onboardedMarker === '0' && isOnboardingGated(path)) {
    return NextResponse.redirect(new URL('/onboarding', request.url))
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
    // Cluster-3 / B8+B9: exclude robots.txt + sitemap.xml from the auth gate.
    // They're public crawler-facing files served by Next via app/robots.ts +
    // app/sitemap.ts; the proxy was redirecting them to /sign-in (text/html
    // 307) and breaking SEO indexing.
    '/((?!api|_next/static|_next/image|favicon.ico|robots\\.txt|sitemap\\.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf|otf|mp4|pdf)).*)',
  ],
}
