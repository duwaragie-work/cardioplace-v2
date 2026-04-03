'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Mail, Send } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

export default function LandingFooter() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !message.trim()) return;
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
      <div className="max-w-[1280px] mx-auto grid grid-cols-1 md:grid-cols-3 gap-10 md:gap-12 px-8 md:px-12 py-16 md:py-20">
        {/* Col 1 - Brand */}
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-1">
            <Image src="/logo2.png" alt="Healplace Cardio" width={42} height={42} />
            <span className="font-bold text-white text-2xl tracking-tight">
              Healplace Cardio
            </span>
          </div>
          <p className="text-white/70 text-sm leading-relaxed">
            {t('landing.copyright')}
          </p>
        </div>

        {/* Col 2 - Links */}
        <div className="grid grid-cols-2 gap-8">
          <div className="flex flex-col gap-3">
            <span className="font-bold text-white text-sm">{t('landing.company')}</span>
            <a href="#" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.mission')}</a>
            <a href="#" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.patients')}</a>
            <a href="#" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.careTeams')}</a>
          </div>
          <div className="flex flex-col gap-3">
            <span className="font-bold text-white text-sm">{t('landing.legal')}</span>
            <a href="#" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.privacy')}</a>
            <a href="#" className="text-white/70 font-medium text-sm hover:text-white transition-colors">{t('landing.terms')}</a>
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
                required
                className="w-full h-10 px-4 rounded-xl text-sm outline-none bg-white/15 backdrop-blur-sm text-white placeholder-white/50 border border-white/20 focus:border-white/50 transition"
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('landing.yourMessage')}
                required
                rows={3}
                className="w-full px-4 py-2.5 rounded-xl text-sm outline-none bg-white/15 backdrop-blur-sm text-white placeholder-white/50 border border-white/20 focus:border-white/50 transition resize-none"
              />
              <button
                type="submit"
                className="w-full h-10 rounded-xl text-sm font-bold flex items-center justify-center gap-2 bg-white text-[#5c00a9] hover:bg-white/90 transition active:scale-[0.98]"
              >
                <Send className="w-3.5 h-3.5" />
                {t('landing.sendMessage')}
              </button>
            </form>
          )}
        </div>
      </div>
    </footer>
  );
}
