'use client';

// Top header bar for the authenticated admin shell. Shows the current
// page title (derived from the route), a hamburger button on small
// screens to open the sidebar drawer, and a right-side cluster for
// notifications + global search slot. Designed to be quiet — most of
// the workspace happens in the page content below.

import { usePathname } from 'next/navigation';
import { Menu, Bell, Search } from 'lucide-react';

const ROUTE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/patients': 'Patients',
  '/scheduled-calls': 'Scheduled calls',
  '/notifications': 'Alerts',
  '/settings': 'Settings',
};

function pageTitleFor(pathname: string): string {
  if (ROUTE_TITLES[pathname]) return ROUTE_TITLES[pathname];
  // Match prefix for nested routes like /patients/<id>
  for (const [prefix, title] of Object.entries(ROUTE_TITLES)) {
    if (pathname.startsWith(prefix + '/')) return title;
  }
  return 'Admin';
}

interface Props {
  onOpenMobileNav?: () => void;
}

export default function AdminTopBar({ onOpenMobileNav }: Props) {
  const pathname = usePathname() ?? '';
  const title = pageTitleFor(pathname);

  return (
    <header
      className="sticky top-0 z-20 bg-white"
      style={{ borderBottom: '1px solid var(--brand-border)' }}
    >
      <div className="h-14 px-4 md:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="md:hidden w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            aria-label="Open menu"
          >
            <Menu className="w-4 h-4" style={{ color: 'var(--brand-text-secondary)' }} />
          </button>
          <h1
            className="text-[15px] font-bold truncate"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {title}
          </h1>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Search slot — placeholder for cmd-K style global search */}
          <button
            type="button"
            disabled
            className="hidden md:inline-flex items-center gap-2 h-9 px-3 rounded-lg text-[12.5px] cursor-not-allowed transition-colors"
            style={{
              backgroundColor: 'var(--brand-background)',
              color: 'var(--brand-text-muted)',
              border: '1px solid var(--brand-border)',
            }}
            aria-label="Search (coming soon)"
            title="Search (coming soon)"
          >
            <Search className="w-3.5 h-3.5" />
            Search
            <span
              className="ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-text-muted)',
                border: '1px solid var(--brand-border)',
              }}
            >
              ⌘K
            </span>
          </button>
          <button
            type="button"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer transition-colors relative"
            style={{ color: 'var(--brand-text-secondary)' }}
            aria-label="Notifications"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
