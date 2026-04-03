'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Mic, Send, Users, ShieldCheck, HeartHandshake, Eye } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

export default function About() {
  const { t } = useLanguage();

  const principles = [
    { num: '01', title: t('about.principle1Title'), desc: t('about.principle1Desc') },
    { num: '02', title: t('about.principle2Title'), desc: t('about.principle2Desc') },
    { num: '03', title: t('about.principle3Title'), desc: t('about.principle3Desc') },
    { num: '04', title: t('about.principle4Title'), desc: t('about.principle4Desc') },
    { num: '05', title: t('about.principle5Title'), desc: t('about.principle5Desc') },
  ];

  const timeline = [
    { title: t('about.timeline2024Title'), desc: t('about.timeline2024Desc') },
    { title: t('about.timelineEarly2025Title'), desc: t('about.timelineEarly2025Desc') },
    { title: t('about.timelineLate2025Title'), desc: t('about.timelineLate2025Desc') },
    { title: t('about.timelineJan2026Title'), desc: t('about.timelineJan2026Desc') },
    { title: t('about.timelineMar2026Title'), desc: t('about.timelineMar2026Desc') },
    { title: t('about.timelineApr2026Title'), desc: t('about.timelineApr2026Desc') },
    { title: t('about.timelineNextTitle'), desc: t('about.timelineNextDesc') },
  ];

  const dchaStats = [
    t('about.dchaStat1'),
    t('about.dchaStat2'),
    t('about.dchaStat3'),
    t('about.dchaStat4'),
  ];

  return (
    <div className="bg-[#fef7ff] flex flex-col min-h-screen overflow-x-hidden">
      <LandingHeader activeLink="About" />

      <main className="flex flex-col items-center pt-[64px] w-full overflow-x-hidden">
        {/* ============ HERO SECTION ============ */}
        <section className="w-full bg-[#fef7ff] flex items-start lg:items-center justify-center min-h-[calc(100vh-64px)] px-4 sm:px-6 md:px-8 py-10 md:py-16 overflow-hidden">
          <div className="max-w-[1280px] w-full grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
            <div className="flex flex-col gap-4 md:gap-5 justify-center">
              <div className="bg-[#7b00e0] inline-flex items-center justify-center px-4 py-1.5 md:py-2 rounded-full w-fit">
                <span className="font-bold text-white text-xs md:text-sm tracking-widest uppercase">{t('about.visionBadge')}</span>
              </div>
              <h1 className="font-bold text-[#191c1d] text-3xl sm:text-4xl md:text-5xl lg:text-[64px] leading-[1.1] tracking-tight">
                {t('about.heroTitle').split(t('about.heroTitleHighlight')).map((part, i, arr) => (
                  <span key={i}>
                    {part}
                    {i < arr.length - 1 && <span className="text-[#7b00e0]">{t('about.heroTitleHighlight')}</span>}
                  </span>
                ))}
              </h1>
              <p className="text-[#4c4355] text-base sm:text-lg md:text-xl leading-relaxed max-w-[576px]">
                {t('about.heroDesc')}
              </p>
            </div>

            {/* Chat Mockup */}
            <div className="flex items-center justify-center relative">
              <div className="absolute -right-20 -top-16 w-96 h-96 rounded-full bg-[rgba(92,0,169,0.05)] blur-[32px]" />
              <div className="relative">
                <div className="bg-white border border-[rgba(207,194,216,0.2)] rounded-[32px] sm:rounded-[40px] p-3 sm:p-4 shadow-2xl relative z-10 w-full max-w-[448px]" style={{ transform: 'rotate(2deg)' }}>
                  <div className="bg-[#f3f4f5] rounded-[24px] sm:rounded-[32px] p-4 sm:p-6 min-h-[400px] sm:min-h-[500px] flex flex-col">
                    <div className="flex items-center gap-3 pb-4 border-b border-[rgba(207,194,216,0.1)]">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundImage: 'linear-gradient(135deg, #7b00e0 0%, #5c00a9 100%)' }}>
                        <Image src="/logo2.png" alt="" width={22} height={22} />
                      </div>
                      <div>
                        <p className="font-bold text-[#191c1d] text-sm">{t('about.assistantName')}</p>
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                          <span className="text-[#16a34a] text-[10px]">{t('about.online')}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col gap-3 sm:gap-4 pt-4 sm:pt-6 flex-1">
                      <div className="bg-white rounded-tr-2xl rounded-br-2xl rounded-bl-2xl p-3 sm:p-4 shadow-sm border border-[rgba(207,194,216,0.1)] max-w-[85%]">
                        <p className="text-[#191c1d] text-xs sm:text-sm leading-relaxed">{t('about.chatGreeting')}</p>
                      </div>
                      <div className="self-end bg-[#5c00a9] rounded-tl-2xl rounded-bl-2xl rounded-br-2xl p-3 sm:p-4 shadow-sm">
                        <p className="text-white text-xs sm:text-sm font-medium">{t('about.chatUserMsg')}</p>
                      </div>
                      <div className="bg-white rounded-tr-2xl rounded-br-2xl rounded-bl-2xl p-3 sm:p-4 shadow-sm border border-[rgba(207,194,216,0.1)] max-w-[85%]">
                        <p className="text-[#191c1d] text-xs sm:text-sm leading-relaxed">{t('about.chatReply')}</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-full p-2 flex items-center gap-3 mt-4 sm:mt-6" style={{ boxShadow: '0 0 0 2px rgba(92,0,169,0.2), inset 0 2px 4px rgba(0,0,0,0.05)' }}>
                      <div className="bg-[#edeeef] w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0">
                        <Mic className="w-3 h-3 sm:w-4 sm:h-4 text-[#4c4355]" />
                      </div>
                      <span className="text-[#4c4355]/60 text-[10px] sm:text-xs flex-1">{t('about.chatPlaceholder')}</span>
                      <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center shrink-0 shadow-md" style={{ backgroundImage: 'linear-gradient(135deg, #7b00e0 0%, #5c00a9 100%)' }}>
                        <Send className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="absolute -bottom-6 sm:-bottom-8 -left-6 sm:-left-10 bg-white rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-xl border border-[rgba(207,194,216,0.1)] z-20">
                  <p className="font-bold text-[#4c4355] text-[9px] sm:text-[10px] tracking-wider uppercase mb-2">{t('about.healthScoreLabel')}</p>
                  <div className="w-16 sm:w-20 h-1.5 rounded-full bg-gradient-to-r from-[#5c00a9] to-[#7b00e0] mb-3" />
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#dc2626] animate-pulse" />
                    <span className="text-[#5c00a9] text-xs font-semibold">Active</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ PARTNERSHIP SECTION ============ */}
        <section className="w-full bg-[#f5eafa] py-12 md:py-24">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8">
            <div className="flex flex-col items-center gap-4 md:gap-6 mb-10 md:mb-16">
              <div className="bg-white rounded-2xl p-3 shadow-sm border border-[#eedbff]">
                <Image src="/DCHA-Logo.png" alt="DC Hospital Association" width={120} height={48} className="object-contain" style={{ width: 'auto', height: 'auto' }} />
              </div>
              <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center">{t('about.partnershipTitle')}</h2>
            </div>

            <div className="max-w-[896px] mx-auto flex flex-col gap-5 md:gap-6">
              <p className="text-[#4c4355] text-base md:text-lg leading-relaxed">{t('about.partnershipDesc1')}</p>
              <p className="text-[#4c4355] text-base md:text-lg leading-relaxed">{t('about.partnershipDesc2')}</p>
              <p className="text-[#4c4355] text-base md:text-lg leading-relaxed">{t('about.partnershipDesc3')}</p>

              {/* DCHA Stats */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 my-6 md:my-8">
                {dchaStats.map((stat, i) => (
                  <div key={i} className="bg-white rounded-2xl p-4 sm:p-6 border border-[#eedbff] shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-1 hover:border-[#7b00e0]/30 active:scale-[0.98]">
                    <p className="text-[#1f1924] text-sm sm:text-base leading-relaxed">{stat}</p>
                  </div>
                ))}
              </div>

              <p className="text-[#4c4355] text-base md:text-lg leading-relaxed">{t('about.partnershipDesc4')}</p>
            </div>
          </div>
        </section>

        {/* ============ MISSION SECTION ============ */}
        <section className="w-full bg-[#fef7ff] py-12 md:py-24">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8 flex flex-col items-center gap-10 md:gap-24">
            <div className="max-w-[896px] flex flex-col items-center gap-6 md:gap-8 text-center">
              <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px]">{t('about.missionTitle')}</h2>
              <blockquote className="text-[#1f1924] text-lg sm:text-xl md:text-2xl lg:text-[28px] leading-snug italic">
                {t('about.missionQuote')}
              </blockquote>
              <p className="text-[#5c00a9] text-sm sm:text-base font-medium">{t('about.missionQuoteAuthor')}</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 w-full">
              {principles.map((p) => (
                <div key={p.num} className="bg-white rounded-[24px] sm:rounded-[32px] border-b-4 border-[#5c00a9] p-6 sm:p-8 md:p-10 flex flex-col gap-3 sm:gap-4">
                  <span className="text-[#7b00e0] text-3xl sm:text-4xl">{p.num}</span>
                  <h3 className="text-[#1f1924] text-base sm:text-lg leading-snug font-semibold">{p.title}</h3>
                  <p className="text-[#4c4355] text-sm sm:text-base leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ SILENT LITERACY SECTION ============ */}
        <section className="w-full px-4 sm:px-6 md:px-8 py-12 md:py-24 bg-gradient-to-b from-[#fef7ff] to-[#f5eafa]">
          <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-20 items-center">
            <div className="lg:col-span-5 flex items-center justify-center">
              <div className="relative">
                <div className="hidden sm:block absolute inset-[-80px] rounded-full border border-[#eedbff] opacity-10" />
                <div className="hidden sm:block absolute inset-[-40px] rounded-full border-2 border-[#eedbff] opacity-30" />
                <div className="w-48 h-48 sm:w-64 sm:h-64 md:w-80 md:h-80 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(31,25,36,0.06)]" style={{ backgroundImage: 'linear-gradient(135deg, #5c00a9 0%, #7b00e0 100%)' }}>
                  <Mic className="w-8 h-8 sm:w-10 sm:h-10 md:w-14 md:h-14 text-white" />
                </div>
              </div>
            </div>
            <div className="lg:col-span-7 flex flex-col gap-6 md:gap-8">
              <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px]">{t('about.silentLiteracyTitle')}</h2>
              <div className="flex flex-col gap-4 md:gap-6">
                <div className="text-[#1f1924] text-base sm:text-lg md:text-xl leading-relaxed">
                  {t('about.silentLiteracyDesc1').split('\n\n').map((p, i) => (
                    <p key={i} className={i > 0 ? 'mt-4' : ''}>{p}</p>
                  ))}
                </div>
                <p className="text-[#5c00a9] text-base sm:text-lg md:text-xl leading-relaxed font-medium italic">{t('about.silentLiteracyDesc2')}</p>
              </div>
              <div className="bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 flex flex-col gap-4 shadow-sm">
                <div className="flex items-start gap-3 sm:gap-4">
                  <Eye className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-sm sm:text-base">{t('about.silentFeature1')}</span>
                </div>
                <div className="flex items-start gap-3 sm:gap-4">
                  <Users className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-sm sm:text-base">{t('about.silentFeature2')}</span>
                </div>
                <div className="flex items-start gap-3 sm:gap-4">
                  <ShieldCheck className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-sm sm:text-base">{t('about.silentFeature3')}</span>
                </div>
                <div className="flex items-start gap-3 sm:gap-4">
                  <HeartHandshake className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-sm sm:text-base">{t('about.silentFeature4')}</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TIMELINE SECTION ============ */}
        <section className="w-full bg-[#fef7ff] py-12 md:py-24">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8">
            <div className="flex flex-col items-center gap-4 md:gap-6 mb-10 md:mb-20">
              <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center">{t('about.timelineTitle')}</h2>
              <div className="w-24 md:w-32 h-2 bg-[#7b00e0] rounded-full" />
            </div>

            <div className="relative max-w-[896px] mx-auto">
              {/* Vertical line */}
              <div className="absolute left-4 sm:left-6 md:left-8 top-0 bottom-0 w-0.5 bg-gradient-to-b from-[#7b00e0] to-[#c79afd]" />

              <div className="flex flex-col gap-8 sm:gap-12">
                {timeline.map((item, i) => (
                  <div key={i} className="relative pl-12 sm:pl-16 md:pl-20">
                    {/* Dot */}
                    <div className={`absolute left-2 sm:left-4 md:left-6 top-1 w-4 h-4 rounded-full border-4 ${i === timeline.length - 1 ? 'border-[#c79afd] bg-[#fef7ff] animate-pulse' : 'border-[#7b00e0] bg-white'}`} />
                    <h3 className="text-[#1f1924] text-base sm:text-lg md:text-xl font-semibold mb-2">{item.title}</h3>
                    <p className="text-[#4c4355] text-sm sm:text-base leading-relaxed">{item.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ TEAM SECTION ============ */}
        <section className="w-full bg-[#f5eafa] py-12 md:py-24">
          <div className="max-w-[1280px] mx-auto px-4 sm:px-6 md:px-8">
            <div className="flex flex-col items-center gap-4 md:gap-6 mb-10 md:mb-20 text-center">
              <h2 className="font-semibold text-[#7b00e0] text-2xl sm:text-3xl md:text-4xl lg:text-[48px]">{t('about.teamTitle')}</h2>
              <p className="text-[#4c4355] text-base sm:text-lg md:text-xl leading-relaxed max-w-[896px]">{t('about.teamSubtitle')}</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8 mb-8 md:mb-12">
              {/* Gayle */}
              <div className="bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 flex flex-col items-center text-center shadow-sm border border-[#eedbff]">
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden mb-4 sm:mb-6 border-4 border-[#eedbff]">
                  <Image src="/Gayle.jpeg" alt="Gayle Olano Hurt" width={128} height={128} className="object-cover w-full h-full" />
                </div>
                <h3 className="text-[#1f1924] text-lg sm:text-xl font-semibold">Gayle Olano Hurt</h3>
                <p className="text-[#7b00e0] text-xs sm:text-sm mt-1">{t('about.gayleCredentials')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm font-medium mt-2">{t('about.gayleRole')}</p>
                <p className="text-[#5c00a9] text-[10px] sm:text-xs mt-0.5">{t('about.gayleOrg')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm leading-relaxed mt-4 sm:mt-5">{t('about.gayleBio')}</p>
              </div>

              {/* Manisha */}
              <div className="bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 flex flex-col items-center text-center shadow-sm border border-[#eedbff]">
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden mb-4 sm:mb-6 border-4 border-[#eedbff]">
                  <Image src="/Manisha.jpeg" alt="Dr. Manisha Singal" width={128} height={128} className="object-cover w-full h-full" />
                </div>
                <h3 className="text-[#1f1924] text-lg sm:text-xl font-semibold">Dr. Manisha Singal</h3>
                <p className="text-[#7b00e0] text-xs sm:text-sm mt-1">{t('about.manishaCredentials')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm font-medium mt-2">{t('about.manishaRole')}</p>
                <p className="text-[#5c00a9] text-[10px] sm:text-xs mt-0.5">{t('about.manishaOrg')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm leading-relaxed mt-4 sm:mt-5">{t('about.manishaBio')}</p>
              </div>

              {/* Rengan */}
              <div className="bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 flex flex-col items-center text-center shadow-sm border border-[#eedbff]">
                <div className="w-24 h-24 sm:w-32 sm:h-32 rounded-full overflow-hidden mb-4 sm:mb-6 border-4 border-[#eedbff]">
                  <Image src="/Rengan.jpeg" alt="Rengan Rajaratnam" width={128} height={128} className="object-cover w-full h-full" />
                </div>
                <h3 className="text-[#1f1924] text-lg sm:text-xl font-semibold">Rengan Rajaratnam</h3>
                <p className="text-[#7b00e0] text-xs sm:text-sm mt-1">{t('about.renganCredentials')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm font-medium mt-2">{t('about.renganRole')}</p>
                <p className="text-[#4c4355] text-xs sm:text-sm leading-relaxed mt-4 sm:mt-5">{t('about.renganBio')}</p>
              </div>
            </div>

            {/* Engineering Team */}
            <div className="bg-white rounded-[24px] sm:rounded-[32px] p-6 sm:p-8 md:p-10 border border-[#eedbff] shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6 mb-4 sm:mb-6">
                <div className="bg-[#eedbff] w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center shrink-0">
                  <Users className="w-6 h-6 sm:w-7 sm:h-7 text-[#7b00e0]" />
                </div>
                <div>
                  <h3 className="text-[#1f1924] text-lg sm:text-xl font-semibold">{t('about.engTeamTitle')}</h3>
                  <p className="text-[#5c00a9] text-xs sm:text-sm mt-1">{t('about.engTeamSubtitle')}</p>
                </div>
              </div>
              <p className="text-[#4c4355] text-sm sm:text-base leading-relaxed">{t('about.engTeamDesc')}</p>
            </div>
          </div>
        </section>

        {/* ============ CLOSING SECTION ============ */}
        <section className="w-full px-4 sm:px-6 md:px-8 py-12 md:py-24 flex justify-center">
          <div className="max-w-[1024px] w-full rounded-[32px] sm:rounded-[48px] p-8 sm:p-10 md:p-16 flex flex-col items-center gap-6 md:gap-8 overflow-hidden" style={{ backgroundImage: 'linear-gradient(153deg, #5c00a9 0%, #a04cee 46%, #c79afd 93%)' }}>
            <h2 className="text-white text-2xl sm:text-3xl md:text-4xl lg:text-[48px] text-center font-semibold">{t('about.closingTitle')}</h2>
            <div className="text-[#eedbff] text-sm sm:text-base md:text-xl text-center leading-relaxed max-w-[672px]">
              {t('about.closingDesc').split('\n\n').map((p, i) => (
                <p key={i} className={i > 0 ? 'mt-4' : ''}>{p}</p>
              ))}
            </div>
            <Link href="#contact" className="bg-white text-[#5c00a9] font-bold text-base md:text-lg px-8 md:px-12 py-3 md:py-3.5 rounded-full hover:bg-[#f5eafa] transition-colors mt-2">
              {t('about.closingButton')}
            </Link>
            <p className="text-white/50 text-xs sm:text-sm mt-2 sm:mt-4 text-center">{t('about.closingFooter')}</p>
          </div>
        </section>

        <LandingFooter />
      </main>
    </div>
  );
}
