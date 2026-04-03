'use client';

import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import Navbar from '@/components/cardio/Navbar';

const HIDE_NAV_PATHS = ['/', '/about', '/welcome', '/register', '/auth/callback', '/onboarding'];

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
