'use client';

// B2 (static-export prep) — client-side replica of admin/src/proxy.ts.
//
// Under `output: 'export'` Next middleware (proxy.ts) does NOT run, so its
// auth-gate / non-admin bounce / coordinator lockdown must also happen
// client-side. This mirrors proxy.ts EXACTLY — same cookies, same public-path
// rules, same redirects — so behaviour is identical whether served standalone
// (proxy.ts gates server-side first; this is a redundant backstop) or static
// (this is the only gate). The backend `@Roles()` decorators remain the real
// authorization; these marker cookies only pick which page renders. Keep this in
// lockstep with proxy.ts if either changes.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { AUTH_MARKER_COOKIE, AUTH_ROLE_COOKIE } from '@/lib/cookie-names';

const PATIENT_URL = process.env.NEXT_PUBLIC_PATIENT_URL || 'http://localhost:3000';

const PUBLIC_PATHS = new Set<string>([
  '/', '/home', '/about', '/sign-in', '/terms', '/privacy',
  '/auth/magic-link', '/auth/callback',
]);

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return (
    pathname.startsWith('/sign-in') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/activate/')
  );
}

const ADMIN_ROLES = new Set([
  'SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS', 'COORDINATOR',
]);
const COORDINATOR_BROADER_ROLES = new Set([
  'SUPER_ADMIN', 'HEALPLACE_OPS', 'MEDICAL_DIRECTOR', 'PROVIDER',
]);

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > -1 && part.slice(0, eq) === name) {
      return decodeURIComponent(part.slice(eq + 1));
    }
  }
  return undefined;
}

function rolesFromCookie(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map((r) => r.trim()).filter(Boolean);
}

function hasAdminRole(roles: string[]): boolean {
  return roles.some((role) => ADMIN_ROLES.has(role));
}

function isCoordinatorOnly(roles: string[]): boolean {
  if (!roles.includes('COORDINATOR')) return false;
  return !roles.some((r) => COORDINATOR_BROADER_ROLES.has(r));
}

function isCoordinatorAllowed(pathname: string): boolean {
  return (
    pathname === '/users' ||
    pathname.startsWith('/users/') ||
    pathname === '/practices' ||
    pathname.startsWith('/practices/') ||
    pathname === '/patients' ||
    pathname === '/profile' ||
    pathname === '/settings' ||
    pathname.startsWith('/settings/')
  );
}

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = isPublicPath(pathname);
  const [allowedPath, setAllowedPath] = useState<string | null>(null);

  useEffect(() => {
    if (isPublic) {
      setAllowedPath(pathname);
      return;
    }
    const marker = readCookie(AUTH_MARKER_COOKIE);
    const roles = rolesFromCookie(readCookie(AUTH_ROLE_COOKIE));

    // Not logged in → sign-in, preserving intended destination.
    if (!marker) {
      window.location.replace(`/sign-in?next=${encodeURIComponent(pathname)}`);
      return;
    }
    // Logged in but not an admin-tier role → their own app's dashboard
    // (symmetric with the patient app's admin bridge).
    if (!hasAdminRole(roles)) {
      window.location.href = `${PATIENT_URL}/dashboard`;
      return;
    }
    // Coordinator-only callers are locked to their /users surface.
    if (isCoordinatorOnly(roles) && !isCoordinatorAllowed(pathname)) {
      window.location.replace('/users');
      return;
    }
    setAllowedPath(pathname);
  }, [pathname, isPublic]);

  const cleared = isPublic || allowedPath === pathname;
  if (!cleared) return null;
  return <>{children}</>;
}
