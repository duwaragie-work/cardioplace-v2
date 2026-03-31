'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, Lock, Building2, BarChart3, ClipboardCheck, Check, Pill, Globe } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { ALL_LOCALES, isLocaleSupported, type LocaleCode, type TranslationKey } from '@/i18n';


function BPCardIllustration({ className, t }: { className?: string; t: (key: TranslationKey) => string }) {
  return (
    <div className={`relative w-full md:min-h-100 flex items-center justify-center overflow-visible ${className || ''}`}>
      {/* Dot grid pattern */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgba(123, 0, 224, 0.05) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
      />

      {/* Purple radial gradient */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-100 h-100 rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(123, 0, 224, 0.2) 0%, transparent 70%)',
        }}
      />

      {/* ECG heartbeat line */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox="0 0 600 600"
        preserveAspectRatio="none"
      >
        <path
          d="M 0,300 L 150,300 L 180,250 L 200,350 L 220,300 L 600,300"
          fill="none"
          stroke="var(--brand-primary-purple)"
          strokeWidth="2"
          opacity="0.15"
        />
      </svg>

      {/* Card cluster — floating cards anchored to the main BP card */}
      <div className="relative z-10 py-4 md:py-10">
        {/* Main BP Card */}
        <div
          className="relative p-6 md:p-8 lg:p-12 w-70 md:w-75 lg:w-95"
          style={{
            backgroundColor: 'var(--brand-surface)',
            borderRadius: '20px',
            boxShadow: 'var(--brand-shadow-elevated)',
          }}
        >
          <p className="text-xs mb-2" style={{ color: 'var(--brand-text-muted)' }}>
            {t('welcome.todaysReading')}
          </p>
          <div
            className="mb-4 text-[2.5rem] md:text-[2.75rem] lg:text-[3.5rem]"
            style={{
              fontWeight: 700,
              color: 'var(--brand-primary-purple)',
              lineHeight: 1,
            }}
          >
            128 / 84
          </div>
          <p
            className="text-base mb-4"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            mmHg
          </p>
          <div
            className="inline-flex items-center gap-2 px-4 py-2"
            style={{
              backgroundColor: 'var(--brand-success-green-light)',
              color: 'var(--brand-success-green)',
              borderRadius: 'var(--brand-radius-pill)',
              fontSize: '0.875rem',
              fontWeight: 600,
            }}
          >
            <Check className="w-4 h-4" />
            {t('welcome.withinTarget')}
          </div>
        </div>

        {/* Floating Card - Top Right (anchored to BP card) */}
        <div
          className="hidden md:block absolute md:-top-4 lg:-top-20 md:-right-8 lg:-right-16 p-3 lg:p-4 w-48 lg:w-56 transform rotate-[4deg] z-20"
          style={{
            backgroundColor: 'var(--brand-surface)',
            borderRadius: 'var(--brand-radius-card)',
            boxShadow: 'var(--brand-shadow-card)',
            borderLeft: '4px solid var(--brand-accent-teal)',
          }}
        >
          <p
            className="text-xs mb-1 flex items-center gap-1.5"
            style={{ color: 'var(--brand-text-primary)', fontWeight: 700 }}
          >
            <ClipboardCheck className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
            {t('welcome.careTeamNotified')}
          </p>
          <p className="text-[0.6875rem]" style={{ color: 'var(--brand-text-muted)' }}>
            {t('welcome.minutesAgo')}
          </p>
        </div>

        {/* Floating Card - Bottom Left (anchored to BP card) */}
        <div
          className="hidden md:block absolute md:-bottom-4 lg:-bottom-20 md:-left-6 lg:-left-12 p-3 lg:p-4 w-48 lg:w-60 transform -rotate-3 z-20"
          style={{
            backgroundColor: 'var(--brand-surface)',
            borderRadius: 'var(--brand-radius-card)',
            boxShadow: 'var(--brand-shadow-card)',
            borderLeft: '4px solid var(--brand-success-green)',
          }}
        >
          <p
            className="text-xs mb-1 flex items-center gap-1.5"
            style={{ color: 'var(--brand-text-primary)', fontWeight: 700 }}
          >
            <Pill className="w-3.5 h-3.5" style={{ color: 'var(--brand-success-green)' }} />
            {t('welcome.medTaken')}
          </p>
          <p
            className="text-[0.6875rem] flex items-center gap-1"
            style={{ color: 'var(--brand-success-green)', fontWeight: 600 }}
          >
            <Check className="w-3 h-3" />
            {t('welcome.confirmed')}
          </p>
        </div>
      </div>
    </div>
  );
}

function LanguageSelector() {
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
        className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[13px] font-semibold transition hover:opacity-80"
        style={{
          backgroundColor: open ? 'var(--brand-primary-purple-light)' : 'rgba(0,0,0,0.05)',
          color: open ? 'var(--brand-primary-purple)' : 'var(--brand-text-secondary)',
        }}
      >
        <Globe className="w-4 h-4" />
        <span>{current?.flag} {current?.nativeName}</span>
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

export default function Welcome() {
  const { t } = useLanguage();
  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {/* Language selector — top right */}
      <div className="flex justify-end px-4 md:px-8 pt-4">
        <LanguageSelector />
      </div>

      <div className="max-w-300 mx-auto px-4 md:px-8 py-4 md:py-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-16 items-center overflow-visible">
          {/* LEFT COLUMN */}
          <div className="flex flex-col space-y-8">
            {/* Logo + Wordmark */}
            <div className="flex items-center gap-3">
              <Image src="/logo.svg" alt="Healplace logo" width={48} height={48} className="w-12 h-12" />
              <span
                className="text-2xl font-bold"
                style={{ color: 'var(--brand-primary-purple)' }}
              >
                {t('welcome.title')}
              </span>
            </div>

            {/* Heading */}
            <h1
              className="text-[2rem] md:text-[2.25rem] lg:text-[3rem] leading-tight"
              style={{
                color: 'var(--brand-text-primary)',
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {t('welcome.headline')}
            </h1>

            {/* Body text */}
            <p
              className="text-base lg:text-lg max-w-120 md:max-w-full"
              style={{ color: 'var(--brand-text-secondary)', lineHeight: 1.6 }}
            >
              {t('welcome.description')}
            </p>

            {/* Mobile illustration */}
            <div className="lg:hidden md:my-0 lg:my-8">
              <BPCardIllustration t={t} />
            </div>

            {/* CTA Button */}
            <Link
              href="/register"
              className="w-full lg:w-[320px] py-4 px-8 flex items-center justify-center gap-2 transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--brand-primary-purple)',
                color: '#FFFFFF',
                borderRadius: 'var(--brand-radius-pill)',
                boxShadow: 'var(--brand-shadow-button)',
                fontWeight: 700,
                fontSize: '1.0625rem',
              }}
            >
              {t('welcome.continueEmail')}
              <ArrowRight className="w-5 h-5" />
            </Link>

            {/* Trust Badges */}
            <div className="flex flex-wrap gap-3">
              <div
                className="flex items-center gap-2 px-4 py-2"
                style={{
                  backgroundColor: '#F1F5F9',
                  borderRadius: '8px',
                  fontSize: '0.8125rem',
                  color: 'var(--brand-text-primary)',
                  fontWeight: 500,
                }}
              >
                <Lock className="w-4 h-4" />
                {t('welcome.hipaa')}
              </div>
              <div
                className="flex items-center gap-2 px-4 py-2"
                style={{
                  backgroundColor: '#F1F5F9',
                  borderRadius: '8px',
                  fontSize: '0.8125rem',
                  color: 'var(--brand-text-primary)',
                  fontWeight: 500,
                }}
              >
                <Building2 className="w-4 h-4" />
                {t('welcome.careTeam')}
              </div>
              <div
                className="flex items-center gap-2 px-4 py-2"
                style={{
                  backgroundColor: '#F1F5F9',
                  borderRadius: '8px',
                  fontSize: '0.8125rem',
                  color: 'var(--brand-text-primary)',
                  fontWeight: 500,
                }}
              >
                <BarChart3 className="w-4 h-4" />
                {t('welcome.rpmBilling')}
              </div>
            </div>

            {/* Footer Partner Text */}
            <p
              className="text-xs"
              style={{ color: 'var(--brand-text-muted)', lineHeight: 1.5 }}
            >
              {t('welcome.trustedBy')}
            </p>
          </div>

          {/* RIGHT COLUMN - Desktop illustration */}
          <div className="hidden lg:flex relative w-full min-h-100 items-center justify-center overflow-visible">
            <BPCardIllustration t={t} />
          </div>
        </div>
      </div>
    </div>
  );
}
