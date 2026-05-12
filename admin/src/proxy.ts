import { NextResponse, type NextRequest } from 'next/server';

// Phase/cluster-1 (B5/B6): same model as the patient proxy. The JWT lives
// in (a) the backend's HttpOnly access_token cookie scoped to the API origin
// and (b) the React in-memory state of AuthProvider. The proxy needs to
// gate page navigation without seeing the JWT, so AuthProvider.login()
// writes two non-token marker cookies on the admin origin:
//
//   admin_auth_marker — opaque "logged in" boolean ("1" or empty)
//   admin_auth_role   — comma-separated role list (e.g. "PROVIDER,SUPER_ADMIN")
//
// They carry no credential. They're tamperable by client design — they
// only choose which page renders, not whether API calls succeed (the
// backend rejects unauthenticated requests regardless).
const MARKER_COOKIE = 'admin_auth_marker';
const ROLE_COOKIE = 'admin_auth_role';

// Any role on this list can reach the admin app. The backend `@Roles()`
// decorators on individual endpoints are the real authorization — per-tab
// restrictions (e.g. threshold editor gated to MEDICAL_DIRECTOR/SUPER_ADMIN)
// are enforced there. This proxy only decides "can you see /admin at all".
// See TESTING_FLOW_GUIDE.md §2 for the full role matrix.
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS']);

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
  return pathname.startsWith('/sign-in') || pathname.startsWith('/auth/');
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
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('reason', 'forbidden');
    return NextResponse.redirect(signInUrl);
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
