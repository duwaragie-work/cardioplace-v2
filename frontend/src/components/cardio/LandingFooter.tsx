'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Mail, Send } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/lib/auth-context';

export default function LandingFooter() {
  const { t } = useLanguage();
  const { isAuthenticated, isLoading } = useAuth();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const [sending, setSending] = useState(false);
  // Mount gate so the server-rendered (logged-out) markup matches first paint;
  // the "Start check-in" CTA is hidden only once we know the patient is signed in.
  const [mounted, setMounted] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);
  const showStartCheckin = !(mounted && !isLoading && isAuthenticated);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim() || sending) return;
    setSending(true);
    try {
      await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, message }),
      });
    } catch {
      // still show success — email may have sent
    }
    setSending(false);
    setSent(true);
    setEmail('');
    setMessage('');
    setTimeout(() => setSent(false), 3000);
  };

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
            <p className="text-white/70 text-sm leading-relaxed">
              {t('landing.copyright')}
            </p>
          </div>
        </div>

        {/* Col 2 - Links */}
        <div className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-3">
            <span className="font-bold text-white text-sm">{t('landing.company')}</span>
            <a href="/about" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.mission')}</a>
            <a href="/about" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.ourStory')}</a>
            <a href="/about#team" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.team')}</a>
            {/* Care Teams link hidden — page section not yet built. */}
            {/* <a href="/about" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.careTeams')}</a> */}
          </div>
          <div className="flex flex-col gap-3">
            <span className="font-bold text-white text-sm">{t('landing.legal')}</span>
            <Link href="/privacy" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.privacy')}</Link>
            <Link href="/terms" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.terms')}</Link>
          </div>
        </div>

        {/* Col 3 - Contact Form */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Mail className="w-4 h-4 text-white" />
            <span className="font-bold text-white text-sm">{t('landing.getInTouch')}</span>
          </div>

          {sent ? (
            <div className="bg-white/15 backdrop-blur-sm rounded-2xl p-5 text-center">
              <div className="w-10 h-10 mx-auto mb-2 rounded-full bg-white/20 flex items-center justify-center">
                <Send className="w-4 h-4 text-white" />
              </div>
              <p className="text-white font-semibold text-sm">{t('landing.messageSent')}</p>
              <p className="text-white/70 text-xs mt-1">{t('landing.messageReply')}</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('landing.yourEmail')}
                aria-label={t('landing.yourEmail')}
                required
                className="w-full h-11 px-4 rounded-xl text-sm outline-none bg-white/15 backdrop-blur-sm text-white placeholder-white/60 border border-white/40 focus:border-white/60 transition"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('landing.yourMessage')}
                aria-label={t('landing.yourMessage')}
                required
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none bg-white/15 backdrop-blur-sm text-white placeholder-white/60 border border-white/40 focus:border-white/60 transition resize-none"
              />
              <button
                type="submit"
                disabled={sending}
                className="w-full h-11 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 bg-white text-[#5B21B6] hover:bg-white/90 transition active:scale-[0.98] disabled:opacity-60"
              >
                <Send className={`w-3.5 h-3.5 ${sending ? 'animate-pulse' : ''}`} />
                {sending ? t('landing.sending') : t('landing.sendMessage')}
              </button>
            </form>
          )}
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
