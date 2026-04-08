'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mic, Send, Activity, Heart, MessageCircle, CheckCircle, AlertTriangle, Brain, Building2 } from 'lucide-react';
import { BsSoundwave } from "react-icons/bs";
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

export default function Homepage() {
  const { t } = useLanguage();
  const { isAuthenticated, user } = useAuth();
  const router = useRouter();
  const isAdmin = user?.roles?.includes('SUPER_ADMIN');

  const handleChatClick = () => {
    if (!isAuthenticated) return router.push('/sign-in');
    router.push(isAdmin ? '/provider/dashboard' : '/chat');
  };

  return (
    <div className="bg-[#fef7ff] flex flex-col min-h-screen overflow-x-hidden">
      <LandingHeader activeLink="Home" />

      <main className="flex flex-col items-center pt-[64px] w-full overflow-x-hidden">
        {/* ============ HERO SECTION ============ */}
        <section className="relative w-full min-h-[calc(100vh-64px)] flex items-center justify-center overflow-hidden px-4 sm:px-6 md:px-8">
          <div className="absolute inset-0">
            <Image src="/ai-healthcare.png" alt="" fill sizes="100vw" quality={500} unoptimized className="object-cover" priority />
          </div>
          {/* Dark overlay — stronger on mobile so text is readable on light image */}
          <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/20 md:from-black/60 md:via-black/30 md:to-transparent" />

          <div className="relative z-10 max-w-[1280px] w-full py-12 md:py-20 px-2 sm:px-4 md:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-16">
            <div className="flex flex-col gap-4 md:gap-6 justify-center">
              {/* Badge */}
              <div className="bg-[#7b00e0] inline-flex items-center gap-2 px-3 py-1.5 lg:px-4 lg:py-2 rounded-full w-fit">
                <Activity className="w-3.5 h-3.5 text-white" />
                <span className="font-semibold text-white text-xs sm:text-sm">{t('home.heroBadge')}</span>
              </div>
              {/* Title */}
              <div>
                <h1 className="font-bold text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-[72px] leading-[1.05] tracking-tight"
                 style={{ textShadow: '0 2px 10px rgba(0,0,0,0.4)', color: '#ffffff' }}>
                  {t('home.heroTitle1')}
                </h1>
                <h1 className="font-bold italic text-2xl sm:text-3xl md:text-4xl lg:text-5xl xl:text-[72px] leading-[1.05] tracking-tight mt-1"
                  style={{ textShadow: '0 2px 16px rgba(0, 0, 0, 0.3)', color: '#d4a5ff' }}>
                  {t('home.heroTitle2')}
                </h1>
              </div>
              <p className="text-sm sm:text-base md:text-lg lg:text-xl leading-relaxed max-w-[576px]"
               style={{ textShadow: '0 2px 10px rgba(0,0,0,0.4)', color: '#ffffff' }}>
                {t('home.heroDesc')}
              </p>
            </div>

            <div className="flex flex-col items-center justify-center gap-5 md:gap-6 max-w-[672px] mx-auto w-full">
              <form
                onSubmit={(e) => { e.preventDefault(); handleChatClick(); }}
                className="w-full backdrop-blur-md bg-white/10 border-2 border-[rgba(92,0,169,0.2)] rounded-full p-1.5 sm:p-2.5 flex items-center shadow-2xl"
              >
                <div className="pl-2 sm:pl-4 shrink-0">
                  <Image src="/logo.svg" alt="" width={36} height={36} className="md:w-[42px] md:h-[42px]" />
                </div>
                <input
                  type="text"
                  readOnly
                  onFocus={handleChatClick}
                  placeholder={t('home.aiPlaceholder')}
                  className="flex-1 px-2 sm:px-4 py-2 sm:py-3 text-sm sm:text-base bg-transparent outline-none text-black placeholder-white min-w-0 cursor-text"
                />
                <button
                  type="submit"
                  className="bg-[#7b00e0] rounded-full w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center shrink-0 shadow-lg hover:bg-[#6600bc] transition-colors"
                >
                  <Send className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                </button>
              </form>
              {/* Prompt chips */}
              <div className="flex flex-wrap items-center justify-center gap-2">
                {(['home.chip1', 'home.chip2', 'home.chip3'] as const).map((key) => (
                  <button
                    key={key}
                    onClick={handleChatClick}
                    className="backdrop-blur-md bg-white/20 border border-white/30 text-white text-xs sm:text-sm px-3 sm:px-4 py-1.5 sm:py-2 rounded-full hover:bg-white/30 transition-colors cursor-pointer"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3 md:gap-6">
                <Link href="/sign-in" className="bg-[#7b00e0] text-white font-bold text-sm sm:text-base md:text-lg px-6 sm:px-8 md:px-10 py-3 md:py-3.5 rounded-full hover:bg-[#6600bc] transition-colors">
                  {t('home.startCheckin')}
                </Link>
                <Link href="#features" className="backdrop-blur-sm bg-white/80 border border-[#cfc2d8] text-gray-600 font-semibold text-sm sm:text-base md:text-lg px-6 sm:px-8 md:px-10 py-3 md:py-3.5 rounded-full hover:bg-white transition-colors">
                  {t('home.howItWorks')}
                </Link>
              </div>
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
                  <rect x="1" y="1" width="23" height="18" rx="3" stroke="#7b00e0" strokeWidth="2"/>
                  <path d="M1 7h23" stroke="#7b00e0" strokeWidth="2"/>
                  <rect x="5" y="11" width="4" height="3" rx="0.5" fill="#7b00e0"/>
                  <rect x="11" y="11" width="4" height="3" rx="0.5" fill="#7b00e0"/>
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
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-[#DC2626] px-2 py-0.5 rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                  <span className="text-white text-[8px] sm:text-[9px] font-bold uppercase">Alert</span>
                </div>
              </div>

              <div className="mt-3 sm:mt-4 flex gap-3">
                <div className="flex-1 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3" style={{ backgroundColor: '#FEF3C7', borderLeft: '4px solid #F59E0B' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                    <p className="text-[#B45309] text-[10px] sm:text-xs font-bold uppercase tracking-wider">Level 1</p>
                  </div>
                  <p className="text-[#92400E] text-[9px] sm:text-[10px]">24hr care team review</p>
                </div>
                <div className="flex-1 rounded-2xl px-3 sm:px-4 py-2.5 sm:py-3" style={{ backgroundColor: '#FEE2E2', borderLeft: '4px solid #DC2626' }}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <div className="w-2 h-2 rounded-full bg-[#DC2626] animate-pulse" />
                    <p className="text-[#DC2626] text-[10px] sm:text-xs font-bold uppercase tracking-wider">Level 2</p>
                  </div>
                  <p className="text-[#991B1B] text-[9px] sm:text-[10px]">Immediate 911 alert</p>
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
                  <path d="M1 5.5h2l1.5-4L7 9.5l1.5-4H12" stroke="#5c00a9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
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
            <p className="text-[#4c4355] text-lg md:text-xl lg:text-2xl text-center italic font-bold max-w-[672px]">{t('home.forPatientsOpening')}</p>
            <p className="text-[#4c4355] text-sm md:text-base lg:text-lg text-left leading-relaxed max-w-[720px]">
              {t('home.healthLiteracyParagraph')}
            </p>
            <p className="text-[#5c00a9] text-base md:text-lg lg:text-xl text-center italic font-semibold">
              {t('home.builtForSilence')}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            {/* For Patients */}
            <div className="bg-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
              <div className="flex items-center gap-4 sm:gap-5 mb-6 sm:mb-8">
                <div className="bg-white border border-[#ececec] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  <Image src="/patient.png" alt="Patient" width={32} height={32} className="object-cover" />
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
            <div className="bg-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
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
            <div className="bg-[#f5eafa] rounded-[32px] sm:rounded-[48px] p-6 sm:p-8 md:p-10 shadow-sm">
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
        <section className="w-full px-4 sm:px-6 md:px-8 pb-12 md:pb-20 flex justify-center">
          <div className="max-w-[1024px] w-full rounded-[32px] sm:rounded-[48px] p-8 sm:p-10 md:p-16 flex flex-col items-center gap-6 md:gap-8 overflow-hidden" style={{ backgroundImage: 'linear-gradient(153deg, #5c00a9 0%, #a04cee 46%, #c79afd 93%)' }}>
            <h2 className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center font-normal">{t('home.ctaTitle')}</h2>
            <p className="text-[#eedbff] text-sm sm:text-base md:text-xl text-left leading-relaxed max-w-[672px]">{t('home.ctaDesc')}</p>
            <Link href="/about" className="bg-white text-[#5c00a9] font-bold text-base md:text-lg px-8 md:px-12 py-3 md:py-3.5 rounded-full hover:bg-[#f5eafa] transition-colors mt-2">
              {t('home.ctaButton')}
            </Link>
          </div>
        </section>

        <LandingFooter />
      </main>
    </div>
  );
}
