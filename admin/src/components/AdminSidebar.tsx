'use client';

// Fixed left sidebar for the authenticated admin shell. Standard admin-app
// layout: brand mark at top, primary nav with icon + label, user/role
// footer pinned to the bottom. Active nav item gets a subtle purple tint
// + left accent border. Designed to read as "tool" not "patient app".

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Phone,
  Activity,
  LogOut,
  Bell,
  Settings,
  X,
  Building2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Match path prefix as well as exact (e.g. /patients/123). */
  matchPrefix?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users, matchPrefix: true },
  { href: '/practices', label: 'Practices', icon: Building2, matchPrefix: true },
  { href: '/scheduled-calls', label: 'Calls', icon: Phone },
];

const SECONDARY_NAV: NavItem[] = [
  { href: '/notifications', label: 'Alerts', icon: Bell },
  { href: '/settings', label: 'Settings', icon: Settings },
];

interface Props {
  /** When true (mobile drawer), renders an X button in the header. */
  withCloseButton?: boolean;
  onClose?: () => void;
}

function initialsFor(name?: string | null, email?: string | null): string {
  const source = (name || email || '').trim();
  if (!source) return 'A';
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function NavLink({ item, pathname }: { item: NavItem; pathname: string }) {
  const Icon = item.icon;
  const active = item.matchPrefix
    ? pathname === item.href || pathname.startsWith(item.href + '/')
    : pathname === item.href;
  return (
    <Link
      href={item.href}
      className={
        'group relative flex items-center gap-3 px-3 h-10 rounded-lg text-[13.5px] font-semibold transition-all duration-150 ' +
        (active ? '' : 'hover:bg-gray-50 hover:text-[var(--brand-text-primary)]')
      }
      style={{
        backgroundColor: active ? 'var(--brand-primary-purple-light)' : 'transparent',
        color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)',
      }}
    >
      {/* Animated left accent — slides in on active. Sits on the left edge
          of the rounded pill so it reads as "you are here". */}
      <span
        aria-hidden
        className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full transition-all duration-200"
        style={{
          backgroundColor: 'var(--brand-primary-purple)',
          opacity: active ? 1 : 0,
          transform: active ? 'scaleY(1)' : 'scaleY(0.4)',
        }}
      />
      <Icon
        className="w-4 h-4 shrink-0 transition-transform duration-150 group-hover:scale-110"
      />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}

export default function AdminSidebar({ withCloseButton, onClose }: Props) {
  const pathname = usePathname() ?? '';
  const { user, logout } = useAuth();
  const role = user?.roles?.[0] ?? 'ADMIN';

  return (
    <aside
      className="h-full w-[240px] shrink-0 flex flex-col bg-white relative"
      style={{
        borderRight: '1px solid var(--brand-border)',
        // Subtle right shadow — keeps the sidebar visually separated from
        // the main content without the harsh hard border alone.
        boxShadow: '1px 0 0 rgba(15, 23, 42, 0.02), 4px 0 16px -8px rgba(15, 23, 42, 0.04)',
      }}
    >
      {/* Brand mark */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-4 h-14"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-2 min-w-0 group"
        >
          <div
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-105"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              boxShadow: '0 2px 8px rgba(123,0,224,0.25)',
            }}
          >
            <Activity className="w-4 h-4 text-white" />
          </div>
          <div className="min-w-0">
            <p
              className="text-[13px] font-bold leading-none truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Cardioplace
            </p>
            <p
              className="text-[10px] mt-0.5 font-semibold uppercase tracking-wider truncate"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              Admin
            </p>
          </div>
        </Link>
        {withCloseButton && (
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        )}
      </div>

      {/* Primary nav */}
      <nav className="flex-1 overflow-y-auto thin-scrollbar px-2 py-3 space-y-0.5">
        <p
          className="px-3 py-1 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Workspace
        </p>
        {PRIMARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        <p
          className="px-3 pt-4 pb-1 text-[10px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          More
        </p>
        {SECONDARY_NAV.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}
      </nav>

      {/* User footer */}
      <div
        className="shrink-0 p-3"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <div
          className="flex items-center gap-2.5 p-2 rounded-lg transition-colors hover:bg-white"
          style={{ backgroundColor: 'var(--brand-background)' }}
        >
          <div
            className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white text-[12px] font-bold"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              boxShadow: '0 2px 8px rgba(123,0,224,0.25)',
            }}
          >
            {initialsFor(user?.name, user?.email)}
          </div>
          <div className="flex-1 min-w-0">
            <p
              className="text-[12.5px] font-bold leading-tight truncate"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {user?.name || 'Admin user'}
            </p>
            <p
              className="text-[10px] mt-0.5 font-semibold uppercase tracking-wider truncate"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {role.replace(/_/g, ' ')}
            </p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150 hover:bg-[var(--brand-alert-red-light)] hover:text-[var(--brand-alert-red)] cursor-pointer"
            style={{ color: 'var(--brand-text-muted)' }}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
