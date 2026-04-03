'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { Bell, Menu, X, Globe } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getAlerts, getNotifications } from '@/lib/services/journal.service';
import { useLanguage } from '@/contexts/LanguageContext';
import { ALL_LOCALES, isLocaleSupported, type LocaleCode } from '@/i18n';

export default function Navbar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading } = useAuth();
  const { locale, setLocale, t } = useLanguage();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const [langOpen, setLangOpen] = useState(false);
  const langRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isAuthenticated) return;
    Promise.all([
      getAlerts().catch(() => []),
      getNotifications('unread').catch(() => []),
    ]).then(([alertData, notifData]) => {
      const alerts = Array.isArray(alertData) ? alertData : [];
      const notifs = Array.isArray(notifData) ? notifData : [];

      // Consolidate alerts by journal entry (same as notifications page)
      const byEntry = new Map<string, typeof alerts>();
      for (const a of alerts.filter((a: { status: string }) => a.status === 'OPEN')) {
        const key = a.journalEntry?.id ?? a.id;
        if (!byEntry.has(key)) byEntry.set(key, []);
        byEntry.get(key)!.push(a);
      }
      const consolidatedAlertCount = byEntry.size;

      // Only count PUSH notifications (EMAIL is for tracking)
      const pushNotifCount = notifs.filter((n: { channel?: string }) =>
        !n.channel || n.channel === 'PUSH',
      ).length;

      setAlertCount(consolidatedAlertCount + pushNotifCount);
    });
  }, [isAuthenticated]);

  // Close language dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (langRef.current && !langRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    }
    if (langOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [langOpen]);

  const userInitials = isLoading
    ? ''
    : user?.name
        ?.split(' ')
        .map((n: string) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2) ?? 'U';

  const isProviderOnly = user?.email === 'support@healplace.com';

  const PROVIDER_LINKS = [
    { labelKey: 'nav.provider' as const, href: '/provider/dashboard' },
    { labelKey: 'nav.patients' as const, href: '/provider/patients' },
    { labelKey: 'nav.calls' as const, href: '/provider/scheduled-calls' },
  ];

  const BASE_LINKS = [
    { labelKey: 'nav.dashboard' as const, href: '/dashboard' },
    { labelKey: 'nav.checkin' as const, href: '/check-in' },
    { labelKey: 'nav.chat' as const, href: '/chat' },
  ];

  const links = isProviderOnly
    ? PROVIDER_LINKS
    : [
        ...BASE_LINKS,
        ...(user?.roles?.includes('SUPER_ADMIN') ? PROVIDER_LINKS : []),
      ];

  const currentLocale = ALL_LOCALES.find((l) => l.code === locale);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 h-16 bg-white flex items-center justify-between px-4 md:px-8"
        style={{
          borderTop: '3px solid var(--brand-primary-purple)',
          borderBottom: '1px solid var(--brand-border)',
          boxShadow: '0 1px 6px rgba(0,0,0,0.06)',
        }}
      >
        {/* Logo */}
        <Link href={isProviderOnly ? '/provider/dashboard' : '/dashboard'} className="flex items-center gap-1.5 shrink-0">
          <Image
            src="/logo.svg"
            alt="Healplace logo"
            width={32}
            height={32}
            className="w-8 h-8"
          />
          <span
            className="font-bold text-[14px] sm:text-base"
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
                {t(link.labelKey)}
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

        {/* Right: Lang + Bell + Avatar + Hamburger */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Language Dropdown */}
          <div className="relative" ref={langRef}>
            <button
              onClick={() => setLangOpen((v) => !v)}
              className="flex items-center gap-1 h-8 px-2 rounded-lg text-[12px] font-semibold transition hover:opacity-80"
              style={{
                backgroundColor: langOpen ? 'var(--brand-primary-purple-light)' : 'transparent',
                color: langOpen ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
              }}
              aria-label="Change language"
            >
              <Globe className="w-4 h-4" />
              <span className="hidden sm:inline uppercase">{locale}</span>
            </button>

            {langOpen && (
              <div
                className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl overflow-hidden z-50"
                style={{
                  boxShadow: '0 8px 32px rgba(0,0,0,0.12)',
                  border: '1px solid var(--brand-border)',
                }}
              >
                {ALL_LOCALES.map((l) => {
                  const supported = isLocaleSupported(l.code);
                  const active = locale === l.code;
                  return (
                    <button
                      key={l.code}
                      onClick={() => {
                        setLocale(l.code);
                        setLangOpen(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition hover:bg-gray-50"
                      style={{
                        backgroundColor: active ? 'var(--brand-primary-purple-light)' : undefined,
                        color: active
                          ? 'var(--brand-primary-purple)'
                          : 'var(--brand-text-primary)',
                        fontWeight: active ? 700 : 500,
                      }}
                    >
                      <span className="text-base">{l.flag}</span>
                      <span className="flex-1">{l.nativeName}</span>
                      {!supported && (
                        <span
                          className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                          style={{
                            backgroundColor: 'var(--brand-warning-amber-light)',
                            color: 'var(--brand-warning-amber)',
                          }}
                        >
                          {t('common.comingSoon')}
                        </span>
                      )}
                      {active && (
                        <span
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
                  {t(link.labelKey)}
                </Link>
              );
            })}
          </nav>
        </div>
      )}
    </>
  );
}
