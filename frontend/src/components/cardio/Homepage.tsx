'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mic, Send, Activity, Heart, MessageCircle, CheckCircle, AlertTriangle, Brain, Building2, Play, X } from 'lucide-react';
import { BsSoundwave } from "react-icons/bs";
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

// Demo walkthrough — YouTube unlisted upload.
// Source: https://www.youtube.com/watch?v=IcFdT3Kz-40
// To swap providers (e.g. back to the Drive preview at
// https://drive.google.com/file/d/155WXpSh3daRqoKoIlGgR7lO61mkzVCxI/preview),
// change this constant AND the iframe src in the modal below.
const YOUTUBE_VIDEO_ID = 'IcFdT3Kz-40';

export default function Homepage() {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  // Gate auth-dependent CTA rendering behind mount so the server-rendered
  // (logged-out) markup matches the first client paint — no hydration flash.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  const loggedIn = mounted && isAuthenticated;

  // Demo video modal state. iframe is unmounted on close so playback
  // stops; we lock body scroll, wire Esc/backdrop dismissal, and return
  // focus to the play button after close.
  const [showDemo, setShowDemo] = useState(false);
  // Cleared every time the modal opens so the spinner shows on first frame
  // and is hidden by the iframe's onLoad once YouTube finishes streaming in.
  const [videoLoaded, setVideoLoaded] = useState(false);
  const playButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!showDemo) return;
    setVideoLoaded(false);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDemo(false);
    };
    window.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
      // The play button lives in the page, not the modal — it is always
      // mounted while this effect can fire, so .current is stable across
      // the effect lifecycle.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      playButtonRef.current?.focus();
    };
  }, [showDemo]);

  const handleChatClick = () => {
    if (!isAuthenticated) return router.push('/sign-in');
    router.push('/chat');
  };

  return (
    <div className="bg-[#fef7ff] flex flex-col min-h-screen overflow-x-hidden">
      <LandingHeader activeLink="Home" />

      <main id="main" className="flex flex-col items-center pt-[64px] w-full overflow-x-hidden">
        {/* ============ HERO SECTION ============ */}
        <section className="relative w-full min-h-[calc(100vh-64px)] flex items-end lg:items-center justify-center overflow-hidden px-4 sm:px-6 md:px-8 pb-4 sm:pb-6 lg:pb-0">
          <div className="absolute inset-0">
            <Image src="/ai-healthcare.png" alt={t('home.heroImageAlt')} fill sizes="100vw" quality={500} unoptimized className="object-cover object-[center_20%] sm:object-[center_30%] md:object-center" priority />
          </div>
          {/* Dark overlay — stronger on mobile so text is readable on light image */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/20 md:from-black/60 md:via-black/30 md:to-transparent" />

          {/* Badge + Title — pinned top-left on mobile/tablet */}
          {/* Badge only — pinned top-left on mobile/tablet */}
          <div className="lg:hidden absolute top-10 left-4 sm:top-6 sm:left-6 z-20">
            <div className="bg-[#7b00e0] inline-flex items-center gap-1.5 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-full">
              <Activity className="w-3 h-3 text-white" />
              <span className="font-semibold text-white text-[9px] sm:text-[10px] md:text-xs">{t('home.heroBadge')}</span>
            </div>
          </div>

          <div className="relative z-10 max-w-[1280px] w-full py-12 md:py-20 px-2 sm:px-4 md:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-16">
              <div className="flex flex-col gap-4 md:gap-6 justify-center">
                {/* Badge — desktop only */}
                <div className="hidden lg:inline-flex bg-[#7b00e0] items-center gap-2 px-4 py-2 rounded-full w-fit">
                  <Activity className="w-3.5 h-3.5 text-white" />
                  <span className="font-semibold text-white text-sm">{t('home.heroBadge')}</span>
                </div>
                {/* Title — desktop only. Cluster-3 / B7: collapse the two
                    visual lines into a SINGLE <h1> with line-2 as a span.
                    Previously rendered as two <h1>s which the audit flagged
                    as a WCAG violation (heading-order / single-h1-per-page). */}
                <div className="hidden lg:block">
                  <h1 className="font-bold text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-[72px] leading-[1.05] tracking-tight"
                    style={{ textShadow: '0 2px 10px rgba(0,0,0,0.4)', color: '#ffffff' }}>
                    <span className="block">{t('home.heroTitle1')}</span>
                    <span
                      className="block italic mt-1"
                      style={{ textShadow: '0 2px 16px rgba(0, 0, 0, 0.3)', color: '#d4a5ff' }}
                    >
                      {t('home.heroTitle2')}
                    </span>
                  </h1>
                </div>
                <p className="hidden lg:block text-lg lg:text-xl leading-relaxed max-w-[576px]"
                  style={{ textShadow: '0 2px 10px rgba(0,0,0,0.4)', color: '#ffffff' }}>
                  {t('home.heroDesc')}
                </p>
              </div>

              <div className="flex flex-col items-center justify-end gap-3 sm:gap-4 md:gap-5 max-w-[672px] mx-auto w-full">
                {/* Title — above chat input on tablet only */}
                {/* Title — above chat input on all mobile/tablet. Single
                    visible heading per breakpoint (cluster-3 / B7). */}
                <div className="lg:hidden text-center">
                  <h2 className="font-bold text-2xl sm:text-3xl md:text-5xl leading-tight tracking-tight" style={{ color: '#ffffff', textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
                    <span className="block">{t('home.heroTitle1')}</span>
                    <span
                      className="block italic mt-0.5"
                      style={{ color: '#d4a5ff', textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}
                    >
                      {t('home.heroTitle2')}
                    </span>
                  </h2>
                </div>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleChatClick(); }}
                  className="w-full backdrop-blur-md bg-white/10 border-2 border-[rgba(92,0,169,0.2)] rounded-full p-1.5 sm:p-2.5 flex items-center shadow-2xl"
                >
                  <div className="pl-2 sm:pl-4 shrink-0">
                    <Image src="/cardioplace-icon.svg" alt={t('home.cardioplaceLogoAlt')} width={36} height={36} className="md:w-[42px] md:h-[42px]" />
                  </div>
                  <input
                    type="text"
                    readOnly
                    onFocus={handleChatClick}
                    placeholder={t('home.aiPlaceholder')}
                    aria-label={t('home.aiPlaceholder')}
                    className="flex-1 px-2 sm:px-4 py-2 sm:py-3 text-sm sm:text-base bg-transparent outline-none text-black placeholder-white min-w-0 cursor-text"
                  />
                  <button
                    type="submit"
                    aria-label="Send message"
                    className="bg-[#7b00e0] rounded-full w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center shrink-0 shadow-lg hover:bg-[#6600bc] transition-colors"
                  >
                    <Send aria-hidden="true" className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                  </button>
                </form>
                {/* Prompt chips — single row */}
                <div className="flex items-center gap-1.5 sm:gap-2 flex-nowrap overflow-x-auto">
                  <span className="text-white/70 text-[10px] sm:text-xs font-semibold uppercase tracking-wider shrink-0">Try now</span>
                  {(['home.chip1', 'home.chip2', 'home.chip3'] as const).map((key) => (
                    <button
                      key={key}
                      onClick={() => {
                        const text = t(key);
                        if (isAuthenticated) {
                          router.push(`/chat?q=${encodeURIComponent(text)}`);
                        } else {
                          router.push('/sign-in');
                        }
                      }}
                      className="backdrop-blur-md bg-white/15 border border-white/25 text-white text-[8px] sm:text-xs md:text-sm px-2.5 sm:px-3 md:px-4 py-1 sm:py-1.5 rounded-full hover:bg-white/25 transition-colors cursor-pointer shrink-0 whitespace-nowrap"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
                {/* CTA buttons — single row */}
                <div className="flex items-center gap-2 sm:gap-3 md:gap-6 flex-nowrap">
                  <Link href={loggedIn ? '/dashboard' : '/sign-in'} className="bg-[#7b00e0] text-white font-bold text-xs sm:text-sm md:text-lg px-5 sm:px-7 md:px-10 py-2.5 sm:py-3 md:py-3.5 rounded-full hover:bg-[#6600bc] transition-colors whitespace-nowrap shrink-0">
                    {loggedIn ? t('home.goToDashboard') : t('home.startCheckin')}
                  </Link>
                  <Link href="#demo" className="backdrop-blur-sm bg-white/80 border border-[#cfc2d8] text-gray-600 font-semibold text-xs sm:text-sm md:text-lg px-5 sm:px-7 md:px-10 py-2.5 sm:py-3 md:py-3.5 rounded-full hover:bg-white transition-colors whitespace-nowrap shrink-0">
                    {t('home.howItWorks')}
                  </Link>
                </div>
                {/* Description — below buttons on mobile/tablet */}
                <p className="lg:hidden text-white/80 text-xs sm:text-sm leading-relaxed max-w-[500px] text-center"
                  style={{ textShadow: '0 1px 6px rgba(0,0,0,0.3)' }}>
                  {t('home.heroDesc')}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PARTNERSHIP BANNER ============ */}
        <section className="w-full bg-[#f5eafa] border-y border-[#eedbff]">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 py-6 md:py-8 flex flex-col items-center justify-center gap-3 sm:gap-4">
            <div className="shrink-0 bg-white rounded-2xl px-4 py-2 sm:px-5 sm:py-3 shadow-md">
              <Image
                src="/DCHA-Logo.png"
                alt="DC Hospital Association"
                width={300}
                height={300}
                className="w-28 h-20 sm:w-32 sm:h-24 md:w-36 md:h-28 object-contain"
              />
            </div>
            <p className="text-[#4c4355] text-sm sm:text-base md:text-lg leading-relaxed text-left">
              {t('home.partnershipBanner')}
            </p>
          </div>
        </section>

        {/* ============ DEMO VIDEO SECTION ============ */}
        {/* White background to make the thumbnail the visual anchor against
            the adjacent #f5eafa partnership banner. scroll-mt-20 keeps the
            heading clear of the fixed 64px top nav when the hero CTA scrolls
            here. */}
        <section id="demo" className="w-full bg-white py-16 md:py-24 scroll-mt-20">
          <div className="max-w-[1200px] mx-auto px-4 sm:px-6 md:px-8">
            <div className="flex flex-col md:flex-row items-center gap-8 md:gap-12 lg:gap-16">
              {/* LEFT — title + description */}
              <div className="flex-1 flex flex-col gap-4 md:gap-5 text-center md:text-left">
                <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[42px] leading-tight tracking-tight">
                  {t('home.demoTitle')}
                </h2>
                <p className="text-[#4c4355] text-sm sm:text-base md:text-lg leading-relaxed max-w-[520px] mx-auto md:mx-0">
                  {t('home.demoDesc')}
                </p>
              </div>

              {/* RIGHT — clickable thumbnail */}
              <button
                ref={playButtonRef}
                onClick={() => setShowDemo(true)}
                aria-label={t('home.demoPlayLabel')}
                className="flex-1 relative aspect-video w-full max-w-[560px] rounded-2xl overflow-hidden shadow-xl border border-[#eedbff] group cursor-pointer focus:outline-none focus:ring-4 focus:ring-[#7b00e0]/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/maxresdefault.jpg`}
                  // YouTube returns a 120×90 placeholder for maxresdefault on
                  // videos that never had a HD frame generated yet. Swap to
                  // hqdefault on error so we still get a real thumbnail.
                  onError={(e) => {
                    const img = e.currentTarget;
                    if (!img.src.endsWith('/hqdefault.jpg')) {
                      img.src = `https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/hqdefault.jpg`;
                    }
                  }}
                  alt=""
                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/30 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                  <div className="bg-[#7b00e0] rounded-full w-16 h-16 sm:w-20 sm:h-20 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                    <Play className="w-7 h-7 sm:w-8 sm:h-8 text-white fill-white ml-1" />
                  </div>
                </div>
              </button>
            </div>
          </div>
        </section>

        {/* ============ FEATURES SECTION ============ */}
        <section id="features" className="w-full max-w-[1280px] px-4 sm:px-6 md:px-8 py-10 md:py-16 lg:py-24">
          <div className="flex flex-col items-center gap-4 md:gap-6 mb-10 md:mb-24">
            <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center tracking-tight leading-tight">
              {t('home.sanctuaryTitle')}
            </h2>
            <div className="w-24 md:w-32 h-2 bg-[#7b00e0] rounded-full" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {/* Card 1 - BP Check-ins */}
            <div className="bg-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 flex flex-col min-h-[320px] sm:min-h-[480px] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:bg-[#efe5f4] active:scale-[0.98]">
              <div className="bg-[#eedbff] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-6 sm:mb-8">
                <svg width="25" height="20" viewBox="0 0 25 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="1" y="1" width="23" height="18" rx="3" stroke="#7b00e0" strokeWidth="2" />
                  <path d="M1 7h23" stroke="#7b00e0" strokeWidth="2" />
                  <rect x="5" y="11" width="4" height="3" rx="0.5" fill="#7b00e0" />
                  <rect x="11" y="11" width="4" height="3" rx="0.5" fill="#7b00e0" />
                </svg>
              </div>
              <h3 className="text-[#1f1924] text-xl sm:text-xl font-bold leading-snug mb-3 sm:mb-4">{t('home.bpCheckins')}</h3>
              <p className="text-[#4c4355] text-sm sm:text-base leading-[1.8]">{t('home.bpCheckinsDesc')}</p>
            </div>

            {/* Card 2 - AI Assistant */}
            <div className="rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 flex flex-col min-h-[320px] sm:min-h-[480px] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:brightness-110 active:scale-[0.98]" style={{ backgroundImage: 'linear-gradient(148deg, #7b00e0 6%, #c79afd 98%)' }}>
              <div className="bg-[#c79afd] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-6 sm:mb-8">
                <MessageCircle className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-white font-bold text-xl sm:text-xl leading-snug mb-3 sm:mb-4">{t('home.aiAssistant')}</h3>
              <p className="text-white text-sm sm:text-base leading-[1.8]">{t('home.aiAssistantDesc')}</p>
              <div className="mt-auto pt-4 sm:pt-6">
                <div className="bg-white rounded-[20px] sm:rounded-[24px] p-3 sm:p-4 shadow-sm">
                  <p className="text-[#4c4355] text-xs sm:text-sm italic leading-relaxed">{t('home.aiQuote')}</p>
                </div>
              </div>
            </div>

            {/* Card 3 - Escalation (with BP Trend chart) */}
            <div className="bg-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 flex flex-col min-h-[320px] sm:min-h-[480px] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:bg-[#efe5f4] active:scale-[0.98]">
              <div>
                <div className="bg-[#eedbff] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-6 sm:mb-8">
                  <AlertTriangle className="w-6 h-6 sm:w-7 sm:h-7 text-[#D97706]" />
                </div>
                <h3 className="text-[#1f1924] text-xl sm:text-xl font-bold leading-snug mb-3 sm:mb-4">{t('home.escalation')}</h3>
                <p className="text-[#4c4355] text-sm sm:text-base leading-[1.8]">{t('home.escalationDesc')}</p>
              </div>

              {/* BP Trend chart with escalation point */}
              <div className="mt-4 sm:mt-5 rounded-xl overflow-hidden relative h-24 sm:h-28 md:h-32 lg:h-36 bg-white shadow-sm">
                <Image src="/BP Trend.png" alt="7-day BP trend with escalation point" fill sizes="(max-width: 768px) 100vw, 25vw" className="object-cover rounded-xl" />
                {/* Escalation marker */}
                <div
                  className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--brand-alert-red)' }}
                >
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-[8px] sm:text-[9px] font-bold uppercase">Alert</span>
                </div>
              </div>

              <div className="mt-3 sm:mt-4 flex gap-3">
                <div
                  className="flex-1 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3"
                  style={{
                    backgroundColor: 'var(--brand-warning-amber-light)',
                    borderLeft: '4px solid var(--brand-warning-amber)',
                  }}
                  // Marketing-page mock banner. Vibrant orange on amber-100
                  // at 10-12px = 2.51:1 (fails AA Normal). Known accepted
                  // debt; future fix is font-size bump to ≥14px bold.
                  data-axe-debt="avatar-orange-small-text"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-warning-amber)' }} />
                    <p
                      className="text-[10px] sm:text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--brand-warning-amber-text)' }}
                    >
                      Level 1
                    </p>
                  </div>
                  <p className="text-[9px] sm:text-[10px]" style={{ color: 'var(--brand-warning-amber-text)' }}>24hr care team review</p>
                </div>
                <div
                  className="flex-1 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    borderLeft: '4px solid var(--brand-alert-red)',
                  }}
                  // Marketing-page mock banner. Vibrant red on red-100 at
                  // 10-12px = 3.66:1 (fails AA Normal). Same accepted debt.
                  data-axe-debt="avatar-orange-small-text"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--brand-alert-red)' }} />
                    <p
                      className="text-[10px] sm:text-xs font-bold uppercase tracking-wider"
                      style={{ color: 'var(--brand-alert-red-text)' }}
                    >
                      Level 2
                    </p>
                  </div>
                  <p className="text-[9px] sm:text-[10px]" style={{ color: 'var(--brand-alert-red-text)' }}>Immediate 911 alert</p>
                </div>
              </div>
            </div>

            {/* Card 4 - Continuously Learning */}
            <div className="rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 flex flex-col min-h-[320px] sm:min-h-[480px] transition-all duration-300 hover:shadow-xl hover:-translate-y-1 hover:brightness-110 active:scale-[0.98]" style={{ backgroundImage: 'linear-gradient(148deg, #7b00e0 6%, #c79afd 98%)' }}>
              <div className="bg-[#c79afd] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center mb-6 sm:mb-8">
                <Brain className="w-6 h-6 sm:w-7 sm:h-7 text-white" />
              </div>
              <h3 className="text-white font-bold text-xl sm:text-xl leading-snug mb-3 sm:mb-4">{t('home.learning')}</h3>
              <p className="text-white text-sm sm:text-base leading-[1.8]">{t('home.learningDesc')}</p>
            </div>
          </div>

          {/* Silent Literacy Section */}
          <div className="mt-10 md:mt-16 bg-gradient-to-r from-[#efe5f4] to-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-12 flex flex-col lg:flex-row items-center gap-8 lg:gap-16">
            <div className="flex-1 flex flex-col gap-4 md:gap-6">
              <div className="bg-[rgba(92,0,169,0.1)] inline-flex items-center gap-2 px-5 py-3 rounded-full w-fit">
                <svg width="13" height="11" viewBox="0 0 13 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5.5h2l1.5-4L7 9.5l1.5-4H12" stroke="#5c00a9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span className="text-[#5c00a9] text-xs md:text-sm font-semibold tracking-wide">{t('home.silentLiteracy')}</span>
              </div>
              <h3 className="text-[#1f1924] text-xl sm:text-2xl md:text-3xl lg:text-4xl leading-tight">{t('home.soundTitle')}</h3>
              <div className="text-[#4c4355] text-base md:text-lg lg:text-xl leading-relaxed max-w-[672px]">
                {t('home.soundDesc').split('\n\n').map((p, i) => (
                  <p key={i} className={i > 0 ? 'mt-4' : ''}>{p}</p>
                ))}
              </div>
            </div>
            <div className="relative shrink-0">
              <div className="w-20 h-20 sm:w-20 sm:h-20 md:w-48 md:h-48 lg:w-64 lg:h-64 rounded-full flex items-center justify-center border border-black shadow-[0_0_40px_rgba(130,25,231,0.3)]" style={{ backgroundImage: 'linear-gradient(135deg, #5c00a9 0%, #7b00e0 50%, #c79afd 100%)' }}>
                <Mic className="w-6 h-6 md:w-10 md:h-10 lg:w-14 lg:h-14 text-white" />
                <div className="absolute inset-[-1px] rounded-full border-4 border-white/20" />
              </div>
            </div>
          </div>
        </section>

        {/* ============ TARGET AUDIENCE ============ */}
        <section className="w-full max-w-[1280px] px-4 sm:px-6 md:px-8 py-10 md:py-12">
          <div className="flex flex-col items-center gap-4 md:gap-6 mb-10 md:mb-20">
            <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center tracking-tight">
              {t('home.designedForEveryone')}
            </h2>
            <p className="text-[#4c4355] text-lg md:text-xl lg:text-2xl text-left md:text-center italic font-bold max-w-[672px]">{t('home.forPatientsOpening')}</p>
            <p className="text-[#4c4355] text-sm md:text-base lg:text-lg text-left leading-relaxed max-w-[720px]">
              {t('home.healthLiteracyParagraph')}
            </p>
            <p className="text-[#5c00a9] text-lg md:text-xl font-bold text-left md:text-center italic mt-6 mb-4 md:mt-10 md:mb-6">
              {t('home.builtForSilence')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {/* For Patients */}
            <div className="bg-[#f9fafb] md:bg-[#f9fafb] border border-[#e5e7eb] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
              <div className="flex items-center gap-4 sm:gap-5 mb-6 sm:mb-8">
                <div className="bg-white border border-[#ececec] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  <Image src="/patient.png" alt="" aria-hidden="true" width={32} height={32} className="object-cover" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-lg sm:text-xl md:text-2xl font-normal">{t('home.forPatients')}</h3>
                  <p className="text-[#5c00a9] text-xs sm:text-sm font-bold">{t('home.forPatientsSubtitle')}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 sm:gap-5">
                {(['home.patient1', 'home.patient2', 'home.patient3', 'home.patient4'] as const).map((key) => (
                  <div key={key} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                    <span className="text-[#1f1924] text-sm sm:text-base">{t(key)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* For Care Teams */}
            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
              <div className="flex items-center gap-4 sm:gap-5 mb-6 sm:mb-8">
                <div className="bg-white border border-[#ececec] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  <Image src="/care team.png" alt="Care Team" width={32} height={32} className="object-cover" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-lg sm:text-xl md:text-2xl font-normal">{t('home.forCareTeams')}</h3>
                  <p className="text-[#5c00a9] text-xs sm:text-sm font-bold">{t('home.forCareTeamsSubtitle')}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 sm:gap-5">
                {(['home.careTeam1', 'home.careTeam2', 'home.careTeam3', 'home.careTeam4'] as const).map((key) => (
                  <div key={key} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#5c00a9] shrink-0 mt-0.5" />
                    <span className="text-[#1f1924] text-sm sm:text-base">{t(key)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* For Health Systems */}
            <div className="bg-[#f9fafb] border border-[#e5e7eb] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
              <div className="flex items-center gap-4 sm:gap-5 mb-6 sm:mb-8">
                <div className="bg-white border border-[#ececec] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0">
                  <Building2 className="w-6 h-6 sm:w-7 sm:h-7 text-[#7b00e0]" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-lg sm:text-xl md:text-2xl font-normal">{t('home.forSystems')}</h3>
                  <p className="text-[#5c00a9] text-xs sm:text-sm font-bold">{t('home.forSystemsSubtitle')}</p>
                </div>
              </div>
              <div className="flex flex-col gap-4 sm:gap-5">
                {(['home.system1', 'home.system2', 'home.system3', 'home.system4'] as const).map((key) => (
                  <div key={key} className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-[#5c00a9] shrink-0 mt-0.5" />
                    <span className="text-[#1f1924] text-sm sm:text-base">{t(key)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section className="w-full">
          <div className="w-full p-8 sm:p-10 md:p-16 flex flex-col items-center gap-6 md:gap-8 bg-[#f5eafa]" >
            <h2 className="text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center font-semibold max-w-[1024px]">{t('home.ctaTitle')}</h2>
            <p className="text-gray-700 text-sm sm:text-base md:text-xl text-left md:text-center leading-relaxed max-w-[672px]">{t('home.ctaDesc')}</p>
            <Link href="/about" className="bg-[#7b00e0] text-white font-semibold text-base md:text-lg px-8 md:px-12 py-3 md:py-3.5 rounded-full hover:bg-[#9333ea] transition-colors mt-2">
              {t('home.ctaButton')}
            </Link>
          </div>
        </section>

        {/* Divider */}
        <div className="w-full h-px bg-white/10" />

        <LandingFooter />
      </main>

      {/* ============ DEMO VIDEO MODAL ============ */}
      {/* Conditionally mounted so the iframe is destroyed on close — that's
          how playback is stopped (no postMessage handshake needed). */}
      {showDemo && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('home.demoTitle')}
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={(e) => { if (e.target === e.currentTarget) setShowDemo(false); }}
        >
          <div className="relative w-full max-w-5xl aspect-video bg-black rounded-2xl overflow-hidden shadow-2xl">
            <button
              onClick={() => setShowDemo(false)}
              aria-label={t('home.demoCloseLabel')}
              autoFocus
              className="absolute -top-12 right-0 sm:top-3 sm:right-3 z-10 bg-white/10 hover:bg-white/20 backdrop-blur-md text-white rounded-full p-2 flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-white/60"
            >
              <X className="w-5 h-5" />
            </button>
            {/* Centered spinner while the YouTube iframe streams in. Hidden
                once `onLoad` fires (YT player UI then covers the parent's
                black background). pointer-events-none so it never eats the
                close button's click. */}
            {!videoLoaded && (
              <div
                aria-hidden="true"
                className="absolute inset-0 flex items-center justify-center pointer-events-none"
              >
                <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin" />
              </div>
            )}
            <iframe
              src={`https://www.youtube.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0&modestbranding=1`}
              title="Cardioplace — 5-minute platform walkthrough"
              width="100%"
              height="100%"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              onLoad={() => setVideoLoaded(true)}
              className="w-full h-full"
            />
          </div>
        </div>
      )}
    </div>
  );
}
