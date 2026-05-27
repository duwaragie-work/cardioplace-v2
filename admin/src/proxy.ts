import { NextResponse, type NextRequest } from 'next/server';
import { AUTH_MARKER_COOKIE, AUTH_ROLE_COOKIE } from '@/lib/cookie-names';

// Phase/cluster-1 (B5/B6): same model as the patient proxy. The JWT lives
// in (a) the backend's HttpOnly access_token cookie scoped to the API origin
// and (b) the React in-memory state of AuthProvider. The proxy needs to
// gate page navigation without seeing the JWT, so AuthProvider.login()
// writes two non-token marker cookies on the admin origin:
//
//   cp_admin_auth_marker — opaque "logged in" boolean ("1" or empty)
//   cp_admin_auth_role   — comma-separated role list (e.g. "PROVIDER,SUPER_ADMIN")
//
// They carry no credential. They're tamperable by client design — they
// only choose which page renders, not whether API calls succeed (the
// backend rejects unauthenticated requests regardless). The `cp_admin_`
// prefix scopes them to the admin app so the patient app (`cp_patient_*`)
// can't pollute the admin session on a shared localhost host.
const MARKER_COOKIE = AUTH_MARKER_COOKIE;
const ROLE_COOKIE = AUTH_ROLE_COOKIE;

// Any role on this list can reach the admin app. The backend `@Roles()`
// decorators on individual endpoints are the real authorization — per-tab
// restrictions (e.g. threshold editor gated to MEDICAL_DIRECTOR/SUPER_ADMIN)
// are enforced there. This proxy only decides "can you see /admin at all".
// See TESTING_FLOW_GUIDE.md §2 for the full role matrix.
// COORDINATOR added in phase/23 — they reach the admin app to invite +
// manage patients in their own practice via /users. Page-level guards
// (e.g. patients/page.tsx) and the backend's @Roles() decorators are
// what actually restrict what they can do once they're in.
const ADMIN_ROLES = new Set([
  'SUPER_ADMIN',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'HEALPLACE_OPS',
  'COORDINATOR',
]);

// Where a logged-in NON-admin (e.g. a PATIENT whose shared API refresh-token
// cookie rehydrated an admin marker) gets bounced to — their own app's
// dashboard. Mirror of the patient proxy's admin-bridge redirect, so the two
// apps cross-redirect symmetrically instead of dead-ending on a blank
// /sign-in?reason=forbidden page (which looped: sign-in → /dashboard → proxy
// → /sign-in …).
const PATIENT_URL = process.env.NEXT_PUBLIC_PATIENT_URL || 'http://localhost:3000';

const PUBLIC_PATHS = new Set<string>([
  '/',
  '/home',
  '/about',
  '/sign-in',
  '/terms',
  '/privacy',
  '/auth/magic-link',
  '/auth/callback',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/activate/')
  );
}

function rolesFromCookie(value: string | undefined): string[] {
  if (!value) return [];
  try {
    return decodeURIComponent(value)
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasAdminRole(roles: string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role));
}

// COORDINATOR is admin-app-eligible but non-clinical — they only have the
// /users surface. Mirror of isCoordinatorOnly() in admin/src/lib/roleGates.ts.
const COORDINATOR_BROADER_ROLES = new Set([
  'SUPER_ADMIN',
  'HEALPLACE_OPS',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
]);

function isCoordinatorOnly(roles: string[]): boolean {
  if (!roles.includes('COORDINATOR')) return false;
  return !roles.some((r) => COORDINATOR_BROADER_ROLES.has(r));
}

// Paths a coordinator-only caller is allowed to navigate to. Everything else
// in the admin app is clinical or operational chrome (Dashboard, Patients,
// Practices, Alerts) that bounces them to /users.
function isCoordinatorAllowed(pathname: string): boolean {
  return pathname === '/users' || pathname.startsWith('/users/');
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const marker = request.cookies.get(MARKER_COOKIE)?.value;
  const roles = rolesFromCookie(request.cookies.get(ROLE_COOKIE)?.value);

  if (!marker) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (!hasAdminRole(roles)) {
    // Logged in, but not an admin-tier role — send them to their own app's
    // dashboard instead of a dead-end /sign-in?reason=forbidden (which looped
    // to a blank page). The patient proxy does the symmetric redirect for
    // admin-role users landing on the patient app.
    return NextResponse.redirect(new URL('/dashboard', PATIENT_URL));
  }

  // Coordinator-only callers are locked to /users — single page-level
  // guard so we don't have to sprinkle role checks in every other page.
  if (isCoordinatorOnly(roles) && !isCoordinatorAllowed(pathname)) {
    return NextResponse.redirect(new URL('/users', request.url));
  }

  const response = NextResponse.next();
  // Disqualify protected pages from the browser back/forward cache so a
  // logged-out admin pressing Back gets a fresh request — proxy then
  // redirects them to /sign-in instead of restoring the stale dashboard.
  response.headers.set('Cache-Control', 'no-store, must-revalidate');
  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)',
  ],
};
