import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE_NAME = 'cardioplace_admin_token';
const REQUIRED_ROLE = 'SUPER_ADMIN';

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

function hasSuperAdminRole(token: string): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload) return false;
  const roles = payload.roles;
  if (!Array.isArray(roles)) return false;
  return roles.includes(REQUIRED_ROLE);
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

  if (!hasSuperAdminRole(token)) {
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
