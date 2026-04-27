'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Navbar from '@/components/cardio/Navbar';

// `/auth/magic-link` is the magic-link landing page that does a brief
// `login()` then `window.location.href` redirect to `/onboarding` or
// `/dashboard`. Without it on the hide list, the navbar paints for a frame
// before the destination loads, causing a visible flash. Same reasoning
// applies to `/auth/callback`.
const HIDE_NAV_PATHS = ['/', '/home', '/about', '/contact', '/welcome', '/sign-in', '/auth/callback', '/auth/magic-link', '/onboarding'];

export default function NavbarWrapper({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showNav = !HIDE_NAV_PATHS.includes(pathname ?? '');

  return (
    <>
      {showNav && <Navbar />}
      <div className={showNav ? 'pt-16' : ''}>{children}</div>
    </>
  );
}
