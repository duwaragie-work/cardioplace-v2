'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Mic, Send, Activity, Heart, MessageCircle, CheckCircle } from 'lucide-react';
import { BsSoundwave } from "react-icons/bs";
import { useLanguage } from '@/contexts/LanguageContext';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

export default function Homepage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [chatInput, setChatInput] = useState('');

  return (
    <div className="bg-[#fef7ff] flex flex-col min-h-screen">
      <LandingHeader activeLink="Home" />

      <main className="flex flex-col items-center pt-[64px]">
        {/* ============ HERO SECTION ============ */}
        <section className="relative w-full h-[calc(100vh-64px)] flex items-start lg:items-center justify-center overflow-hidden px-6 md:px-8">
          <div className="absolute inset-0">
            <Image src="/ai-healthcare 2.jpg" alt="" fill sizes="100vw" className="object-cover" priority />
          </div>
          <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(240deg, rgba(46, 45, 46, 0) 14%,  rgb(10, 10, 10) 83%)' }} />

          <div className="relative z-10 max-w-[1280px] w-full grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 py-16 md:py-20 px-4 md:px-8">
            <div className="flex flex-col gap-6 justify-center">
              <div className="bg-[#7b00e0] inline-flex items-center gap-2 px-4 py-2 rounded-full w-fit">
                <Activity className="w-3.5 h-3.5 text-white" />
                <span className="font-semibold text-white text-sm">{t('home.heroBadge')}</span>
              </div>
              <div>
                <h1 className="text-white font-bold text-4xl md:text-5xl lg:text-[72px] leading-[1] tracking-tight">
                  {t('home.heroTitle1')}
                </h1>
                <h1 className="font-bold italic text-4xl md:text-5xl lg:text-[72px] leading-[1] tracking-tight mt-1]"
                  style={{ textShadow: '0 -2px 10px rgba(228, 197, 255, 0.68)',color: '#ead8ff' }}
                >
                  {t('home.heroTitle2')}
                </h1>
              </div>
              <p className="text-white text-base md:text-lg lg:text-xl leading-relaxed max-w-[576px]">
                {t('home.heroDesc')}
              </p>
            </div>

            <div className="flex flex-col items-center justify-center gap-6 max-w-[672px] mx-auto w-full">
              <form
                onSubmit={(e) => { e.preventDefault(); if (chatInput.trim()) router.push(`/chat?q=${encodeURIComponent(chatInput.trim())}`); }}
                className="w-full backdrop-blur-md bg-white/80 border-2 border-[rgba(92,0,169,0.2)] rounded-full p-2.5 flex items-center shadow-2xl"
              >
                <div className="pl-4 shrink-0">
                  <Image src="/logo.svg" alt="" width={42} height={42} />
                </div>
                <input
                  type="text"
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder={t('home.aiPlaceholder')}
                  className="flex-1 px-4 py-3 text-base bg-transparent outline-none text-black placeholder-black/50"
                />
                <button
                  type="submit"
                  className="bg-[#7b00e0] rounded-full w-14 h-14 flex items-center justify-center shrink-0 shadow-lg hover:bg-[#6600bc] transition-colors"
                >
                  <Send className="w-5 h-5 text-white" />
                </button>
              </form>
              <div className="flex flex-wrap items-center justify-center gap-4 md:gap-6">
                <Link href="/sign-in" className="bg-[#7b00e0] text-white font-bold text-base md:text-lg px-8 md:px-10 py-3.5 rounded-full hover:bg-[#6600bc] transition-colors">
                  {t('home.startCheckin')}
                </Link>
                <Link href="#features" className="backdrop-blur-sm bg-white/80 border border-[#cfc2d8] text-black font-semibold text-base md:text-lg px-8 md:px-10 py-3.5 rounded-full hover:bg-white transition-colors">
                  {t('home.howItWorks')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ FEATURES SECTION ============ */}
        <section id="features" className="w-full max-w-[1280px] px-6 md:px-8 py-12 md:py-16 lg:py-24">
          <div className="flex flex-col items-center gap-6 mb-16 md:mb-24">
            <h2 className="font-semibold text-[#7b00e0] text-3xl md:text-4xl lg:text-[48px] text-center tracking-tight leading-tight">
              {t('home.sanctuaryTitle')}
            </h2>
            <div className="w-32 h-2 bg-[#7b00e0] rounded-full" />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Card 1 */}
            <div className="bg-[#f5eafa] rounded-[48px] p-8 md:p-10 flex flex-col justify-between min-h-[480px]">
              <div>
                <div className="bg-[#eedbff] w-16 h-16 rounded-full flex items-center justify-center mb-8">
                  <svg width="25" height="20" viewBox="0 0 25 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="1" y="1" width="23" height="18" rx="3" stroke="#7b00e0" strokeWidth="2"/>
                    <path d="M1 7h23" stroke="#7b00e0" strokeWidth="2"/>
                    <rect x="5" y="11" width="4" height="3" rx="0.5" fill="#7b00e0"/>
                    <rect x="11" y="11" width="4" height="3" rx="0.5" fill="#7b00e0"/>
                  </svg>
                </div>
                <h3 className="text-[#1f1924] text-2xl leading-snug mb-4">{t('home.bpCheckins')}</h3>
                <p className="text-[#4c4355] text-lg leading-relaxed">{t('home.bpCheckinsDesc')}</p>
              </div>
              <div className="flex justify-center mt-8">
                <Heart className="w-24 h-24 text-[#7b00e0] opacity-20" strokeWidth={1} />
              </div>
            </div>

            {/* Card 2 */}
            <div className="rounded-[48px] p-8 md:p-10 flex flex-col min-h-[480px]" style={{ backgroundImage: 'linear-gradient(148deg, #7b00e0 6%, #c79afd 98%)' }}>
              <div className="bg-[#c79afd] w-16 h-16 rounded-full flex items-center justify-center mb-8">
                <MessageCircle className="w-7 h-7 text-white" />
              </div>
              <h3 className="text-white font-semibold text-2xl leading-snug mb-4">{t('home.aiAssistant')}</h3>
              <p className="text-white text-lg leading-relaxed">{t('home.aiAssistantDesc')}</p>
              <div className="mt-auto pt-10">
                <div className="bg-white rounded-[32px] p-6 shadow-sm">
                  <p className="text-[#4c4355] text-base italic leading-relaxed">{t('home.aiQuote')}</p>
                </div>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-[#f5eafa] rounded-[48px] p-8 md:p-10 flex flex-col justify-between min-h-[480px]">
              <div>
                <div className="bg-[#eedbff] w-16 h-16 rounded-full flex items-center justify-center mb-8">
                  <Activity className="w-6 h-6 text-[#7b00e0]" />
                </div>
                <h3 className="text-[#1f1924] text-2xl leading-snug mb-4">{t('home.smartTrend')}</h3>
                <p className="text-[#4c4355] text-lg leading-relaxed">{t('home.smartTrendDesc')}</p>
              </div>
              <div className="mt-8 rounded-lg overflow-hidden relative h-40">
                <Image src="/BP Trend.png" alt="BP Trend chart" fill sizes="(max-width: 768px) 100vw, 50vw" className="object-cover rounded-lg" />
              </div>
            </div>
          </div>

          {/* Audio-First Section */}
          <div className="mt-16 bg-gradient-to-r from-[#efe5f4] to-[#f5eafa] rounded-[48px] p-8 md:p-12 flex flex-col lg:flex-row items-center gap-10 lg:gap-16">
            <div className="flex-1 flex flex-col gap-6">
              <div className="bg-[rgba(92,0,169,0.1)] inline-flex items-center gap-2 px-4 py-2 rounded-full w-fit">
                <svg width="13" height="11" viewBox="0 0 13 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M1 5.5h2l1.5-4L7 9.5l1.5-4H12" stroke="#5c00a9" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-[#5c00a9] text-sm font-normal">{t('home.silentLiteracy')}</span>
              </div>
              <h3 className="text-[#1f1924] text-2xl md:text-3xl lg:text-4xl leading-tight">{t('home.soundTitle')}</h3>
              <p className="text-[#4c4355] text-lg md:text-xl leading-relaxed max-w-[672px]">{t('home.soundDesc')}</p>
            </div>
            <div className="relative shrink-0">
              <div className="w-48 h-48 md:w-64 md:h-64 rounded-full flex items-center justify-center border border-black shadow-[0_0_40px_rgba(130,25,231,0.3)]" style={{ backgroundImage: 'linear-gradient(135deg, #5c00a9 0%, #7b00e0 50%, #c79afd 100%)' }}>
                <Mic className="w-10 h-10 md:w-14 md:h-14 text-white" />
                <div className="absolute inset-[-1px] rounded-full border-4 border-white/20" />
              </div>
              <div className="absolute -top-4 -right-4 bg-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg">
                <BsSoundwave className="w-5 h-5 text-[#7b00e0]" />
              </div>
            </div>
          </div>
        </section>

        {/* ============ TARGET AUDIENCE ============ */}
        <section className="w-full max-w-[1280px] px-6 md:px-8 py-12 ">
          <div className="flex flex-col items-center gap-6 mb-16 md:mb-20">
            <h2 className="font-semibold text-[#7b00e0] text-3xl md:text-4xl lg:text-[48px] text-center tracking-tight">
              {t('home.designedForEveryone')}
            </h2>
            <p className="text-[#4c4355] text-lg md:text-xl text-center italic">{t('home.designedSubtitle')}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-12">
            {/* For Patients */}
            <div className="bg-[#f5eafa] rounded-[48px] p-8 md:p-12 shadow-sm">
              <div className="flex items-center gap-6 mb-8">
                <div className="bg-white border border-[#ececec] w-20 h-20 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  <Image src="/patient.png" alt="Patient" width={58} height={58} className="object-cover" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-2xl md:text-[30px] font-normal">{t('home.forPatients')}</h3>
                  <p className="text-[#5c00a9] text-base">{t('home.forPatientsSubtitle')}</p>
                </div>
              </div>
              <div className="flex flex-col gap-6">
                {(['home.patient1', 'home.patient2', 'home.patient3'] as const).map((key) => (
                  <div key={key} className="flex items-start gap-4">
                    <CheckCircle className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                    <span className="text-[#1f1924] text-lg">{t(key)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* For Care Teams */}
            <div className="bg-[#f5eafa] rounded-[48px] p-8 md:p-12 shadow-sm">
              <div className="flex items-center gap-6 mb-8">
                <div className="bg-white border border-[#ececec] w-20 h-20 rounded-full flex items-center justify-center shrink-0 overflow-hidden">
                  <Image src="/care team.png" alt="Care Team" width={44} height={44} className="object-cover" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-2xl md:text-[30px] font-normal">{t('home.forCareTeams')}</h3>
                  <p className="text-[#5c00a9] text-base font-bold">{t('home.forCareTeamsSubtitle')}</p>
                </div>
              </div>
              <div className="flex flex-col gap-6">
                {(['home.careTeam1', 'home.careTeam2', 'home.careTeam3'] as const).map((key) => (
                  <div key={key} className="flex items-start gap-4">
                    <CheckCircle className="w-5 h-5 text-[#5c00a9] shrink-0 mt-0.5" />
                    <span className="text-[#1f1924] text-lg">{t(key)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ CTA ============ */}
        <section className="w-full px-6 md:px-8 pb-16 md:pb-20 flex justify-center">
          <div className="max-w-[1024px] w-full rounded-[48px] p-10 md:p-16 flex flex-col items-center gap-8 overflow-hidden" style={{ backgroundImage: 'linear-gradient(153deg, #5c00a9 0%, #a04cee 46%, #c79afd 93%)' }}>
            <h2 className="text-white text-3xl md:text-4xl lg:text-[48px] text-center font-normal">{t('home.ctaTitle')}</h2>
            <p className="text-[#eedbff] text-base md:text-xl text-center leading-relaxed max-w-[672px]">{t('home.ctaDesc')}</p>
            <Link href="/sign-in" className="bg-white text-[#5c00a9] font-bold text-lg px-12 py-3.5 rounded-full hover:bg-[#f5eafa] transition-colors mt-2">
              {t('landing.getStarted')}
            </Link>
          </div>
        </section>

        <LandingFooter />
      </main>
    </div>
  );
}
