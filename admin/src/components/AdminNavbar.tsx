'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Phone, LogOut } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/patients', label: 'Patients', icon: Users },
  { href: '/scheduled-calls', label: 'Calls', icon: Phone },
];

const HIDE_ON_PATHS = new Set<string>(['/sign-in']);

export default function AdminNavbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, logout } = useAuth();

  if (HIDE_ON_PATHS.has(pathname)) return null;
  if (!isAuthenticated) return null;

  return (
    <nav
      className="sticky top-0 z-30 bg-white border-b"
      style={{ borderColor: 'var(--brand-border, #E2E8F0)' }}
    >
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className="font-bold text-[15px] mr-4"
            style={{ color: 'var(--brand-primary-purple, #7B00E0)' }}
          >
            Cardioplace Admin
          </Link>
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[13px] font-semibold transition-colors"
                style={{
                  backgroundColor: active ? 'var(--brand-primary-purple-light, #F3E8FF)' : 'transparent',
                  color: active ? 'var(--brand-primary-purple, #7B00E0)' : 'var(--brand-text-secondary, #64748B)',
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          {user?.email && (
            <span className="hidden sm:inline text-[12px]" style={{ color: 'var(--brand-text-muted, #94A3B8)' }}>
              {user.email}
            </span>
          )}
          <button
            onClick={logout}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[12px] font-semibold transition-colors hover:bg-gray-100"
            style={{ color: 'var(--brand-text-secondary, #64748B)' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
