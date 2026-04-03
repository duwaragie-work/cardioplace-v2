'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { LayoutDashboard } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import LanguageSelector from './LanguageSelector';

interface LandingHeaderProps {
  activeLink?: string;
}

export default function LandingHeader({ activeLink = 'Home' }: LandingHeaderProps) {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const links = [
    { label: 'Home', href: '/', text: t('landing.home') },
    { label: 'About', href: '/about', text: t('landing.about') },
    { label: 'Contact', href: '#contact', text: t('landing.contact') },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-white/80 shadow-[0_1px_2px_rgba(76,29,149,0.05)]">
      <div className="max-w-[1280px] mx-auto flex items-center justify-between px-6 md:px-8 py-4">
        <Link href="/" className="flex items-center gap-1">
          <Image src="/logo.svg" alt="Healplace Cardio" width={42} height={42} />
          <span className="font-bold text-[#6b00d1] text-xl md:text-2xl tracking-tight">
            Healplace Cardio
          </span>
        </Link>
        <div className="hidden md:flex items-center gap-10">
          {links.map((link) =>
            link.href.startsWith('#') ? (
              <button
                key={link.label}
                onClick={() => document.querySelector(link.href)?.scrollIntoView({ behavior: 'smooth' })}
                className={
                  activeLink === link.label
                    ? 'font-semibold text-[#6d28d9] text-base border-b-2 border-[#6d28d9] pb-0.5'
                    : 'text-[#475569] text-base hover:text-[#6d28d9] transition-colors cursor-pointer'
                }
              >
                {link.text}
              </button>
            ) : (
              <Link
                key={link.label}
                href={link.href}
                className={
                  activeLink === link.label
                    ? 'font-semibold text-[#6d28d9] text-base border-b-2 border-[#6d28d9] pb-0.5'
                    : 'text-[#475569] text-base hover:text-[#6d28d9] transition-colors'
                }
              >
                {link.text}
              </Link>
            )
          )}
        </div>
        <div className="flex items-center gap-3">
          <LanguageSelector />
          {mounted && !isLoading && (
            isAuthenticated ? (
              <Link
                href="/dashboard"
                className="flex items-center gap-2 bg-[#6b00d1] text-white font-semibold text-sm px-4 py-2 rounded-full hover:bg-[#5a00b0] transition-colors"
              >
                <LayoutDashboard className="w-4 h-4" />
                <span className="hidden sm:inline">{t('landing.dashboard')}</span>
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className="bg-[#6b00d1] text-white font-semibold text-sm md:text-base px-5 md:px-6 py-2 rounded-full hover:bg-[#5a00b0] transition-colors"
              >
                {t('landing.getStarted')}
              </Link>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
