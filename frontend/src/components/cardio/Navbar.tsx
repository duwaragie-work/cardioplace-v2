'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Bell, Menu, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAlerts } from '@/lib/services/journal.service';

const BASE_LINKS = [
  { label: 'Home', href: '/dashboard' },
  { label: 'Check-In', href: '/check-in' },
  { label: 'Chat', href: '/chat' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    getAlerts()
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        setAlertCount(arr.filter((a: { status: string }) => a.status === 'OPEN').length);
      })
      .catch(() => {});
  }, [isAuthenticated]);

  const userInitials =
    user?.name
      ?.split(' ')
      .map((n: string) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) ?? 'U';

  const links = [
    ...BASE_LINKS,
    ...(user?.roles?.includes('SUPER_ADMIN')
      ? [
          { label: 'Provider', href: '/provider/dashboard' },
          { label: 'Patients', href: '/provider/patients' },
        ]
      : []),
  ];

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 h-16 bg-white flex items-center justify-between px-4 md:px-8"
        style={{
          borderBottom: '1px solid var(--brand-border)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}
      >
        {/* Logo */}
        <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
          <Image
            src="/logo.svg"
            alt="Healplace logo"
            width={36}
            height={36}
            className="w-9 h-9"
          />
          <span
            className="font-bold text-base hidden sm:block"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            Healplace Cardio
          </span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-7">
          {links.map((link) => {
            const active =
              pathname === link.href ||
              (link.href !== '/dashboard' && pathname?.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-semibold relative pb-1"
                style={{
                  color: active
                    ? 'var(--brand-primary-purple)'
                    : 'var(--brand-text-secondary)',
                }}
              >
                {link.label}
                {active && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Right: Bell + Avatar + Hamburger */}
        <div className="flex items-center gap-3">
          <Link href="/notifications" className="relative p-1" aria-label="Alerts">
            <Bell
              className="w-5 h-5"
              style={{
                color:
                  alertCount > 0
                    ? 'var(--brand-warning-amber)'
                    : 'var(--brand-text-muted)',
              }}
            />
            {alertCount > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                style={{ backgroundColor: 'var(--brand-warning-amber)' }}
              >
                {alertCount > 9 ? '9+' : alertCount}
              </span>
            )}
          </Link>

          <Link
            href="/profile"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-sm shrink-0"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            {userInitials}
          </Link>

          <button
            className="md:hidden p-1"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="w-6 h-6" style={{ color: 'var(--brand-text-primary)' }} />
            ) : (
              <Menu className="w-6 h-6" style={{ color: 'var(--brand-text-primary)' }} />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 top-16 bg-white z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <nav className="p-4" onClick={(e) => e.stopPropagation()}>
            {links.map((link) => {
              const active = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="flex items-center px-4 py-3 rounded-xl mb-1 text-sm font-semibold"
                  style={{
                    backgroundColor: active
                      ? 'var(--brand-primary-purple-light)'
                      : 'transparent',
                    color: active
                      ? 'var(--brand-primary-purple)'
                      : 'var(--brand-text-secondary)',
                  }}
                  onClick={() => setMobileOpen(false)}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
