'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Navbar from '@/components/cardio/Navbar';

// `/auth/magic-link` is the magic-link landing page that does a brief
// `login()` then `window.location.href` redirect to `/onboarding` or
// `/dashboard`. Without it on the hide list, the navbar paints for a frame
// before the destination loads, causing a visible flash. Same reasoning
// applies to `/auth/callback`.
// `/support` is the adaptive hub: it serves signed-out AND signed-in visitors,
// so it renders its OWN chrome (LandingHeader/Footer when public, Navbar when
// authed) instead of taking the global one — same reasoning as the `/sign-in/*`
// pre-auth flows below. This list is exact-match, so `/support/my-tickets` and
// `/support/locked-out` are unaffected and keep their current behaviour.
const HIDE_NAV_PATHS = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/terms', '/privacy', '/auth/callback', '/auth/magic-link', '/onboarding', '/support'];

// Prefix-matched hide paths — for dynamic segments like `/activate/[token]`
// where the invitee has no session yet and the signed-in navbar would just
// confuse them (Dashboard / Check-In tabs that all redirect to /sign-in).
// `/sign-in/*` sub-steps (e.g. /sign-in/biometric) are pre-auth flows that
// render their own LandingHeader — the signed-in navbar must not paint there.
const HIDE_NAV_PREFIXES = ['/activate/', '/sign-in/'];

export default function NavbarWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const p = pathname ?? '';
  const showNav =
    !HIDE_NAV_PATHS.includes(p) &&
    !HIDE_NAV_PREFIXES.some((prefix) => p.startsWith(prefix));

  return (
    <>
      {showNav && <Navbar />}
      <div className={showNav ? 'pt-16' : ''}>{children}</div>
    </>
  );
}
