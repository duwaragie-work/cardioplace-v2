'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';

// Admin is an internal provider/care-team tool, so the footer is a thin
// utility bar (brand + legal + support) rather than the patient app's
// marketing footer with a contact form — but it shares the patient app's
// purple gradient for brand consistency.
const INFO_EMAIL = 'info@cardioplace.ai';

export default function LandingFooter() {
  const { t } = useLanguage();

  return (
    <footer
      id="contact"
      className="w-full"
      style={{ backgroundImage: 'linear-gradient(159deg, #5c00a9 0%, #a04cee 46%, #c79afd 93%)' }}
    >
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        {/* Brand + Admin tag */}
        <div className="flex items-center gap-2.5">
          {/* Dark-background variant — white wordmark baked in. */}
          <Image src="/cardioplace-dark.svg" alt="Cardioplace" width={150} height={32} className="h-6 w-auto" />
          <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-white text-[#6b00d1]">
            Admin
          </span>
        </div>

        {/* Legal + support */}
        <div className="flex items-center gap-4 text-[12px]">
          <Link href="/privacy" className="text-white/70 hover:text-white transition-colors">
            {t('landing.privacy')}
          </Link>
          <Link href="/terms" className="text-white/70 hover:text-white transition-colors">
            {t('landing.terms')}
          </Link>
          <a href={`mailto:${INFO_EMAIL}`} className="text-white/70 hover:text-white transition-colors">
            {INFO_EMAIL}
          </a>
        </div>
      </div>

      {/* Purple accent bar */}
      <div className="py-3 text-center text-sm font-medium text-white" style={{ backgroundColor: '#7b00e0' }}>
        <a
          href="https://healplace.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline hover:text-gray-200 transition-colors"
        >
          A Healplace Company
        </a>
      </div>
    </footer>
  );
}
