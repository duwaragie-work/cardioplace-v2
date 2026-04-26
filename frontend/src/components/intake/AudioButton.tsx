'use client';

// Silent-literacy architecture (V2-E): every patient-facing text block carries
// an audio button so non-readers can hear the content. Uses the browser's
// SpeechSynthesis API — no backend dependency, works offline. Falls back to
// a no-op on browsers without speech support.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

// Maps our app locale codes to BCP-47 tags the browser's SpeechSynthesis
// engine recognises. Values picked to match the voices most commonly
// pre-installed on Chrome, Safari, and Edge.
const LOCALE_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  am: 'am-ET',
};

interface Props {
  text: string;
  /** BCP-47 language tag override. Defaults to the current app locale. */
  lang?: string;
  /** Visual size — sm for inline-with-text, md for card corners. */
  size?: 'sm' | 'md';
  /** aria-label override; defaults to the translated "Listen". */
  label?: string;
  className?: string;
}

export default function AudioButton({
  text,
  lang,
  size = 'md',
  label,
  className,
}: Props) {
  const { locale, t } = useLanguage();
  const effectiveLang = lang ?? LOCALE_TO_BCP47[locale] ?? 'en-US';
  const effectiveLabel = label ?? t('intake.audio.listen');
  const stopLabel = t('intake.audio.stop');
  const [speaking, setSpeaking] = useState(false);
  // `mounted` starts false on both server and first client paint so the markup
  // matches and React doesn't flag a hydration mismatch. After hydration we
  // swap in the real button (or render nothing if the browser lacks TTS).
  const [mounted, setMounted] = useState(false);
  const [supported, setSupported] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      setSupported(true);
    }
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!supported || typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = effectiveLang;
    utterance.rate = 0.95;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    synth.speak(utterance);
    setSpeaking(true);
  };

  // Render nothing until mounted (matches SSR) or when TTS isn't available.
  if (!mounted || !supported) return null;

  const dim = size === 'sm' ? 28 : 36;
  const icon = size === 'sm' ? 14 : 18;

  return (
    <motion.button
      type="button"
      onClick={handleClick}
      aria-label={speaking ? stopLabel : effectiveLabel}
      aria-pressed={speaking}
      className={`flex items-center justify-center rounded-full transition-colors cursor-pointer ${className ?? ''}`}
      style={{
        width: dim,
        height: dim,
        backgroundColor: speaking
          ? 'var(--brand-primary-purple)'
          : 'var(--brand-primary-purple-light)',
        color: speaking ? 'white' : 'var(--brand-primary-purple)',
      }}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.93 }}
    >
      {speaking ? <VolumeX size={icon} /> : <Volume2 size={icon} />}
    </motion.button>
  );
}
