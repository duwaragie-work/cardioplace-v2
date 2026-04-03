'use client';

import Image from 'next/image';
import { Mic, Send, Users, ShieldCheck, HeartHandshake } from 'lucide-react';
import LandingHeader from './LandingHeader';
import LandingFooter from './LandingFooter';

const principles = [
  {
    num: '01',
    title: 'Every patient deserves daily monitoring.',
    desc: "Health doesn't happen once a month. Real security comes from constant visibility.",
  },
  {
    num: '02',
    title: 'Language should never be a barrier.',
    desc: 'Care should be delivered in the tongue of the heart, ensuring clarity and comfort.',
  },
  {
    num: '03',
    title: 'Literacy should never be a barrier.',
    desc: "Complex medical jargon shouldn't keep someone from understanding their own vitality.",
  },
  {
    num: '04',
    title: 'Technology should meet people where they are.',
    desc: "We adapt to our patients' lives, not the other way around. Simple, intuitive, human.",
  },
];

export default function About() {
  return (
    <div className="bg-[#fef7ff] flex flex-col min-h-screen">
      <LandingHeader activeLink="About" />

      <main className="flex flex-col items-center pt-[64px]">
        {/* ============ HERO SECTION ============ */}
        <section className="w-full bg-[#fef7ff] flex items-center justify-center min-h-[700px] px-6 md:px-8 py-16 md:py-24 overflow-hidden">
          <div className="max-w-[1280px] w-full grid grid-cols-1 lg:grid-cols-2 gap-16">
            {/* Left - Text */}
            <div className="flex flex-col gap-8 justify-center">
              <div className="bg-[#7b00e0] inline-flex items-center justify-center px-4 py-2 rounded-full w-fit">
                <span className="font-bold text-white text-sm tracking-widest uppercase">Our Vision</span>
              </div>
              <h1 className="font-extrabold text-[#191c1d] text-4xl md:text-5xl lg:text-[72px] leading-[1.1] tracking-tight">
                Closing the<br />
                <span className="text-[#7b00e0]">Gap</span> in Heart<br />
                Care.
              </h1>
              <p className="text-[#4c4355] text-lg md:text-xl leading-relaxed max-w-[576px]">
                AI-powered conversational engagement that keeps you connected between clinic visits. No medical jargon. Just clear, compassionate support.
              </p>
            </div>

            {/* Right - Chat Interface Mockup */}
            <div className="flex items-center justify-center relative">
              {/* Blur circle */}
              <div className="absolute -right-20 -top-16 w-96 h-96 rounded-full bg-[rgba(92,0,169,0.05)] blur-[32px]" />

              <div className="relative">
                {/* Chat card */}
                <div className="bg-white border border-[rgba(207,194,216,0.2)] rounded-[40px] p-4 shadow-2xl relative z-10 w-full max-w-[448px]" style={{ transform: 'rotate(2deg)' }}>
                  <div className="bg-[#f3f4f5] rounded-[32px] p-6 min-h-[500px] flex flex-col">
                    {/* Chat header */}
                    <div className="flex items-center gap-3 pb-4 border-b border-[rgba(207,194,216,0.1)]">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundImage: 'linear-gradient(135deg, #7b00e0 0%, #5c00a9 100%)' }}>
                        <Image src="/logo2.png" alt="" width={22} height={22} />
                      </div>
                      <div>
                        <p className="font-bold text-[#191c1d] text-sm">Healplace Assistant</p>
                        <div className="flex items-center gap-1">
                          <div className="w-1.5 h-1.5 rounded-full bg-[#16a34a]" />
                          <span className="text-[#16a34a] text-[10px]">Online</span>
                        </div>
                      </div>
                    </div>

                    {/* Messages */}
                    <div className="flex flex-col gap-4 pt-6 flex-1">
                      {/* Bot message */}
                      <div className="bg-white rounded-tr-2xl rounded-br-2xl rounded-bl-2xl p-4 shadow-sm border border-[rgba(207,194,216,0.1)] max-w-[85%]">
                        <p className="text-[#191c1d] text-sm leading-relaxed">
                          Good morning, David. How is your blood pressure today?
                        </p>
                      </div>

                      {/* User message */}
                      <div className="self-end bg-[#5c00a9] rounded-tl-2xl rounded-bl-2xl rounded-br-2xl p-4 shadow-sm">
                        <p className="text-white text-sm font-medium">135/85</p>
                      </div>

                      {/* Bot reply */}
                      <div className="bg-white rounded-tr-2xl rounded-br-2xl rounded-bl-2xl p-4 shadow-sm border border-[rgba(207,194,216,0.1)] max-w-[85%]">
                        <p className="text-[#191c1d] text-sm leading-relaxed">
                          Thank you. That&apos;s slightly higher than your 7-day average of 128/82. Have you taken your Lisinopril yet?
                        </p>
                      </div>
                    </div>

                    {/* Input bar */}
                    <div className="bg-white rounded-full p-2 flex items-center gap-3 shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] mt-6" style={{ boxShadow: '0 0 0 2px rgba(92,0,169,0.2), inset 0 2px 4px rgba(0,0,0,0.05)' }}>
                      <div className="bg-[#edeeef] w-10 h-10 rounded-full flex items-center justify-center shrink-0">
                        <Mic className="w-4 h-4 text-[#4c4355]" />
                      </div>
                      <span className="text-[#4c4355]/60 text-xs flex-1">Type your message...</span>
                      <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-md" style={{ backgroundImage: 'linear-gradient(135deg, #7b00e0 0%, #5c00a9 100%)' }}>
                        <Send className="w-3 h-3 text-white" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Health Score overlay */}
                <div className="absolute -bottom-8 -left-10 bg-white rounded-3xl p-6 shadow-xl border border-[rgba(207,194,216,0.1)] z-20">
                  <p className="font-bold text-[#4c4355] text-[10px] tracking-wider uppercase mb-2">Health Score</p>
                  <div className="w-20 h-1.5 rounded-full bg-gradient-to-r from-[#5c00a9] to-[#b0003b] mb-3" />
                  <div className="flex items-end gap-2">
                    <span className="font-bold text-[#191c1d] text-3xl leading-none">92</span>
                    <span className="font-bold text-[#16a34a] text-xs mb-1">+2.4%</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============ MISSION SECTION ============ */}
        <section className="w-full bg-[#fef7ff] py-16 md:py-20">
          <div className="max-w-[1280px] mx-auto px-6 md:px-8 flex flex-col items-center gap-16 md:gap-24">
            {/* Heading + Quote */}
            <div className="max-w-[896px] flex flex-col items-center gap-8 text-center">
              <h2 className="font-semibold text-[#7b00e0] text-3xl md:text-4xl lg:text-[48px]">
                Our Mission
              </h2>
              <p className="text-[#1f1924] text-xl md:text-2xl lg:text-[30px] leading-snug">
                &quot;Healplace Cardio exists because the gap between doctor visits is where patients are most vulnerable.&quot;
              </p>
            </div>

            {/* 4 Principle Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 w-full">
              {principles.map((p) => (
                <div
                  key={p.num}
                  className="bg-white rounded-[32px] border-b-4 border-[#5c00a9] p-8 md:p-10 flex flex-col gap-4"
                >
                  <span className="text-[#7b00e0] text-4xl">{p.num}</span>
                  <h3 className="text-[#1f1924] text-xl leading-snug font-normal">{p.title}</h3>
                  <p className="text-[#4c4355] text-base leading-relaxed">{p.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ SILENT LITERACY SECTION ============ */}
        <section className="w-full px-6 md:px-8 py-16 md:py-20">
          <div className="max-w-[1280px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-16 lg:gap-20 items-center">
            {/* Left - Voice Orb */}
            <div className="lg:col-span-5 flex items-center justify-center">
              <div className="relative">
                {/* Outer ring */}
                <div className="absolute inset-[-80px] rounded-full border border-[#eedbff] opacity-10" />
                {/* Middle ring */}
                <div className="absolute inset-[-40px] rounded-full border-2 border-[#eedbff] opacity-30" />
                {/* Orb */}
                <div
                  className="w-64 h-64 md:w-80 md:h-80 rounded-full flex items-center justify-center shadow-[0_0_40px_rgba(31,25,36,0.06)]"
                  style={{ backgroundImage: 'linear-gradient(135deg, #5c00a9 0%, #7b00e0 100%)' }}
                >
                  <Mic className="w-10 h-10 md:w-14 md:h-14 text-white" />
                </div>
              </div>
            </div>

            {/* Right - Content */}
            <div className="lg:col-span-7 flex flex-col gap-8">
              <h2 className="font-semibold text-[#7b00e0] text-3xl md:text-4xl lg:text-[48px]">
                Silent Literacy
              </h2>
              <div className="flex flex-col gap-6">
                <p className="text-[#1f1924] text-lg md:text-xl leading-relaxed">
                  Our <span className="text-[#5c00a9]">Audio-First mode</span> is designed with a profound insight: medical instructions are often too dense for those struggling with health literacy.
                </p>
                <p className="text-[#4c4355] text-base md:text-lg leading-relaxed">
                  Instead of requiring patients to disclose their struggles, Healplace Cardio naturally transitions into a conversational guide. It listens, confirms, and explains using natural language—supporting users through every check-up without making them feel evaluated.
                </p>
              </div>

              {/* Feature list */}
              <div className="bg-[#f5eafa] rounded-[32px] p-8 flex flex-col gap-4">
                <div className="flex items-start gap-4">
                  <Users className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-base">Conversational AI that avoids clinical jargon.</span>
                </div>
                <div className="flex items-start gap-4">
                  <ShieldCheck className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-base">Zero disclosure required; dignity is built into the design.</span>
                </div>
                <div className="flex items-start gap-4">
                  <HeartHandshake className="w-5 h-5 text-[#7b00e0] shrink-0 mt-0.5" />
                  <span className="text-[#1f1924] text-base">Supports adherence through empathetic reminders.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <LandingFooter />
      </main>
    </div>
  );
}
