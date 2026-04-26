import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE_NAME = 'cardioplace_admin_token';

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
  '/auth/magic-link',
  '/auth/callback',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith('/sign-in') || pathname.startsWith('/auth/');
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    // atob is available in Next's Edge runtime where proxy.ts executes.
    const json = atob(padded);
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hasAdminRole(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const roles = payload.roles;
  if (!Array.isArray(roles)) return false;
  return roles.some((role) => typeof role === 'string' && ADMIN_ROLES.has(role));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;

  if (!token) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(signInUrl);
  }

  if (!hasAdminRole(token)) {
    const signInUrl = new URL('/sign-in', request.url);
    signInUrl.searchParams.set('reason', 'forbidden');
    return NextResponse.redirect(signInUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|woff2?)$).*)',
  ],
};
