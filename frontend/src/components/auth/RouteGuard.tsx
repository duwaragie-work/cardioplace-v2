'use client';

// B2 (static-export prep) — client-side replica of proxy.ts.
//
// Under `output: 'export'` Next middleware (proxy.ts) does NOT run, so its
// auth-gate / admin-bridge / onboarding-gate must also happen client-side. This
// guard mirrors proxy.ts EXACTLY — same cookies, same route lists, same
// redirects — so behaviour is identical whether the app is served:
//   • standalone: proxy.ts gates server-side FIRST; this is a redundant backstop
//   • static export: proxy.ts is absent; this is the only gate
// The backend remains the real authorization — these marker cookies are
// tamperable and only choose which page renders, never whether an API call
// succeeds. Keep this in lockstep with proxy.ts if either changes.
//
// The `Cache-Control: no-store` that proxy.ts sets on protected pages is a CDN
// concern under static hosting (see docs/CLOUDFRONT_SECURITY_HEADERS.md) — it
// cannot be reproduced from JS.

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import {
  AUTH_MARKER_COOKIE,
  AUTH_ROLE_COOKIE,
  ONBOARDED_MARKER_COOKIE,
} from '@/lib/cookie-names';

const PUBLIC_ROUTES = [
  '/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/terms',
  '/privacy', '/auth/callback', '/auth/magic-link', '/activate',
  '/support/locked-out',
];
const ONBOARDING_GATED_ROUTES = [
  '/dashboard', '/readings', '/check-in', '/chat', '/profile', '/notifications',
];
const ADMIN_ROLES = new Set([
  'SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS', 'COORDINATOR',
]);
const ADMIN_URL = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';

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

function isMatch(path: string, routes: string[]): boolean {
  return routes.some((r) => path === r || path.startsWith(r + '/'));
}

function hasAdminRole(rolesValue: string | undefined): boolean {
  if (!rolesValue) return false;
  return rolesValue.split(',').map((r) => r.trim()).some((r) => ADMIN_ROLES.has(r));
}

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isPublic = isMatch(pathname, PUBLIC_ROUTES);
  // Which path the guard has cleared. Public routes are cleared synchronously
  // (nothing to leak); non-public routes render only after the effect clears
  // THIS path, so a logged-out visitor never flashes protected content. Keyed
  // by path so a client-side navigation re-gates.
  const [allowedPath, setAllowedPath] = useState<string | null>(null);

  useEffect(() => {
    const marker = readCookie(AUTH_MARKER_COOKIE);
    const roles = readCookie(AUTH_ROLE_COOKIE);
    const onboarded = readCookie(ONBOARDED_MARKER_COOKIE);

    // 1. Admin-role users belong on the admin app (checked on every path first,
    //    mirroring proxy.ts). Cookie-only bridge — no tokens in the URL.
    if (marker && hasAdminRole(roles)) {
      window.location.href = `${ADMIN_URL}/dashboard`;
      return;
    }
    // 2. Logged in on an auth page → dashboard.
    if (marker && (pathname === '/welcome' || pathname === '/sign-in')) {
      window.location.replace('/dashboard');
      return;
    }
    // Public routes are otherwise fine.
    if (isPublic) {
      setAllowedPath(pathname);
      return;
    }
    // 3. Not logged in on a protected route → sign-in.
    if (!marker) {
      window.location.replace('/sign-in');
      return;
    }
    // 4. Un-onboarded patient on a gated route → onboarding. Explicit '0' only:
    //    an ABSENT cookie means "unknown" and must fail open (see cookie-names).
    if (onboarded === '0' && isMatch(pathname, ONBOARDING_GATED_ROUTES)) {
      window.location.replace('/onboarding');
      return;
    }
    setAllowedPath(pathname);
  }, [pathname, isPublic]);

  const cleared = isPublic || allowedPath === pathname;
  if (!cleared) return null;
  return <>{children}</>;
}
