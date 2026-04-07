'use client';

import { useState, useEffect, useRef } from 'react';
import { Globe } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ALL_LOCALES, isLocaleSupported } from '@/i18n';

export default function LanguageSelector() {
  const { locale, setLocale, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const current = ALL_LOCALES.find((l) => l.code === locale);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 sm:gap-1.5 h-8 sm:h-9 px-2 sm:px-3 rounded-full text-[12px] sm:text-[13px] font-semibold transition hover:opacity-80"
        style={{
          backgroundColor: open ? 'var(--brand-primary-purple-light)' : 'rgba(0,0,0,0.05)',
          color: open ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)',
        }}
      >
        <Globe className="w-4 h-4" />
        <span>{current?.flag}</span>
        <span className="hidden sm:inline">{current?.nativeName}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl overflow-hidden z-50"
          style={{ boxShadow: '0 8px 32px rgba(0,0,0,0.12)', border: '1px solid var(--brand-border)' }}
        >
          {ALL_LOCALES.map((l) => {
            const supported = isLocaleSupported(l.code);
            const active = locale === l.code;
            return (
              <button
                key={l.code}
                onClick={() => { setLocale(l.code); setOpen(false); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-[13px] transition hover:bg-gray-50"
                style={{
                  backgroundColor: active ? 'var(--brand-primary-purple-light)' : undefined,
                  color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-primary)',
                  fontWeight: active ? 700 : 500,
                }}
              >
                <span className="text-base">{l.flag}</span>
                <span className="flex-1">{l.nativeName}</span>
                {!supported && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}>
                    {t('common.comingSoon')}
                  </span>
                )}
                {active && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-primary-purple)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
