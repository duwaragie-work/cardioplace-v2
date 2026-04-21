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

  const links = [
    { labelKey: 'nav.dashboard' as const, href: '/dashboard' },
    { labelKey: 'nav.checkin' as const, href: '/check-in' },
    { labelKey: 'nav.chat' as const, href: '/chat' },
  ];

  const currentLocale = ALL_LOCALES.find((l) => l.code === locale);

  return (
    <>
      <nav
        className="fixed top-0 left-0 right-0 z-50 h-16 flex items-center justify-between px-4 md:px-8"
        style={{
          background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
          boxShadow: '0 2px 12px rgba(123,0,224,0.2)',
        }}
      >
        {/* Logo */}
        <Link href="/" className="flex items-center gap-1.5 shrink-0">
          <Image
            src="/logo.svg"
            alt="Cardioplace logo"
            width={32}
            height={32}
            className="w-8 h-8 brightness-0 invert"
          />
          <span
            className="font-bold text-[14px] sm:text-base text-white"
          >
            Cardioplace
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
                  color: active ? '#ffffff' : 'rgba(255,255,255,0.7)',
                }}
              >
                {t(link.labelKey)}
                {active && (
                  <div
                    className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-white"
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
                backgroundColor: langOpen ? 'rgba(255,255,255,0.2)' : 'transparent',
                color: 'rgba(255,255,255,0.85)',
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
                    ? '#fbbf24'
                    : 'rgba(255,255,255,0.7)',
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
            className="w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm shrink-0"
            style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white', border: '1.5px solid rgba(255,255,255,0.3)' }}
          >
            {userInitials}
          </Link>

          <button
            className="md:hidden p-1"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? (
              <X className="w-6 h-6 text-white" />
            ) : (
              <Menu className="w-6 h-6 text-white" />
            )}
          </button>
        </div>
      </nav>

      {/* Mobile Menu Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 top-16 bg-white z-40 md:hidden overflow-y-auto"
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
            {/* Language selector inside mobile menu */}
            <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--brand-border)' }}>
              <div className="relative" ref={langRef}>
                <button
                  onClick={() => setLangOpen((v) => !v)}
                  className="flex items-center gap-2 w-full px-4 py-3 rounded-xl text-sm font-semibold"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  <Globe className="w-4 h-4" />
                  <span>{currentLocale?.flag} {currentLocale?.nativeName}</span>
                </button>
                {langOpen && (
                  <div className="mt-1 mx-2 bg-white rounded-xl overflow-hidden" style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.1)', border: '1px solid var(--brand-border)' }}>
                    {ALL_LOCALES.map((l) => {
                      const supported = isLocaleSupported(l.code);
                      const active = locale === l.code;
                      return (
                        <button
                          key={l.code}
                          onClick={() => { setLocale(l.code); setLangOpen(false); setMobileOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px]"
                          style={{ backgroundColor: active ? 'var(--brand-primary-purple-light)' : undefined, color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-primary)', fontWeight: active ? 700 : 500 }}
                        >
                          <span className="text-base">{l.flag}</span>
                          <span className="flex-1">{l.nativeName}</span>
                          {!supported && <span className="px-1.5 py-0.5 rounded text-[10px] font-bold" style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}>Soon</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
