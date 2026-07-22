'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { LifeBuoy, Mail } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';

export default function LandingFooter() {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading } = useAuth();
  // Mount gate so the server-rendered (logged-out) markup matches first paint;
  // the "Start check-in" CTA is hidden only once we know the patient is signed in.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  const showStartCheckin = !(mounted && !isLoading && isAuthenticated);

  return (
    <footer
      className="w-full"
      id="contact"
      style={{ backgroundImage: 'linear-gradient(159deg, #5c00a9 0%, #a04cee 46%, #c79afd 93%)' }}
    >
      {showStartCheckin && (
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 lg:px-12 pt-10 md:pt-16 pb-2">
          <a
            href="/sign-in"
            className="block w-full md:w-auto md:inline-flex items-center justify-center bg-white text-[#5c00a9] font-bold text-base px-8 py-3 rounded-full hover:bg-white/90 transition-colors text-center"
          >
            {t('home.startCheckin')}
          </a>
        </div>
      )}
      <div className="max-w-[1280px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-10 px-4 sm:px-6 md:px-8 lg:px-12 py-8 md:py-12">
        {/* Col 1 - Brand */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center">
            {/* Dark-background variant — purpose-designed wordmark with
                white paths baked in, so no CSS filter is needed. */}
            <Image
              src="/cardioplace-dark.svg"
              alt="Cardioplace"
              width={180}
              height={40}
              className="h-8 w-auto"
            />
          </div>
          <div className="flex items-center gap-3">
            <div className="bg-white rounded-lg px-2 py-1.5 shrink-0">
              <Image src="/DCHA-Logo.png" alt="DC Hospital Association" width={64} height={48} className="w-16 h-10 object-contain" />
            </div>
            <p className="text-white text-sm leading-relaxed">
              {t('landing.copyright')}
            </p>
          </div>
        </div>

        {/* Col 2 - Links */}
        <div className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-3">
            <span className="font-bold text-white text-sm">{t('landing.company')}</span>
            <a href="/about" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.mission')}</a>
            <a href="/about" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.ourStory')}</a>
            <a href="/about#team" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.team')}</a>
            {/* Care Teams link hidden — page section not yet built. */}
            {/* <a href="/about" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.careTeams')}</a> */}
          </div>
          <div className="flex flex-col gap-3">
            {/* The healthcare legal block the proposal asks for. The five newer
                notices are LINKED here but still carry `robots: noindex` on
                their routes and are absent from sitemap.ts — reachable for a
                patient who goes looking, not indexed while the copy is an
                explicit "being finalised" placeholder. Drop the noindex (and add
                them to the sitemap) once legal delivers the real text. */}
            <span className="font-bold text-white text-sm">{t('landing.legal')}</span>
            <Link href="/privacy" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.privacy')}</Link>
            <Link href="/terms" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.terms')}</Link>
            <Link href="/hipaa-notice" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.hipaaNotice')}</Link>
            <Link href="/cookies" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.cookiePolicy')}</Link>
            <Link href="/accessibility" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.accessibility')}</Link>
            <Link href="/nondiscrimination" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.nondiscrimination')}</Link>
            <Link href="/telehealth-consent" className="text-white font-medium text-sm hover:text-white transition-colors">{t('landing.telehealthConsent')}</Link>
          </div>
        </div>

        {/* Col 3 - Support.
            This used to be a standalone contact form posting to /api/contact.
            It was removed as part of the support consolidation: it created no
            SupportTicket (so nothing was trackable or answerable in the ops
            queue) and it swallowed every network error while still showing
            "message sent". Both problems disappear by routing people to the one
            /support hub, whose public form creates a real, tracked ticket. */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">{t('landing.getInTouch')}</span>
          </div>
          <p className="text-white/90 text-sm mb-4">{t('landing.supportBlurb')}</p>
          <Link
            href="/support"
            data-testid="footer-support-link"
            className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-[#5B21B6] transition hover:bg-white/90 active:scale-[0.98]"
          >
            <LifeBuoy className="w-3.5 h-3.5" />
            {t('landing.goToSupport')}
          </Link>
        </div>
      </div>
      <div className="py-3 text-center text-sm font-medium text-white" style={{ backgroundColor: '#7b00e0' }}>
        <a
          href="https://healplace.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:underline hover:text-gray-200 transition-colors"
        >
          {t('landing.healplaceCompany')}
        </a>
      </div>
    </footer>
  );
}
