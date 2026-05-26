'use client';

// Silent-literacy architecture (V2-E): every patient-facing text block carries
// an audio button so non-readers can hear the content. Uses the browser's
// SpeechSynthesis API — no backend dependency, works offline. Falls back to
// a no-op on browsers without speech support.

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { applyFriendlyVoice } from '@/lib/tts-voice';

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
  /** data-testid override; defaults to "audio-button". */
  testId?: string;
}

export default function AudioButton({
  text,
  lang,
  size = 'md',
  label,
  className,
  testId = 'audio-button',
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
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    // Voice list loads asynchronously on Chrome — getVoices() returns []
    // until the engine populates the list and fires onvoiceschanged. Force
    // an early read here so applyFriendlyVoice has voices on first click.
    const synth = window.speechSynthesis;
    synth.getVoices();
    const onVoicesChanged = () => synth.getVoices();
    synth.addEventListener('voiceschanged', onVoicesChanged);
    return () => {
      synth.removeEventListener('voiceschanged', onVoicesChanged);
      synth.cancel();
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
    // Nothing to read — don't arm a button that would play silence.
    if (!text.trim()) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[AudioButton] empty text — nothing to speak');
      }
      return;
    }
    synth.cancel();
    // Chrome can leave the engine in a paused state after a prior cancel (or
    // its ~15s auto-pause), which silently drops the next speak(). resume() is
    // a no-op when not paused, so it's safe to call defensively here.
    synth.resume();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = effectiveLang;
    utterance.rate = 0.95;
    // Pick a warmer female voice + slight pitch lift via the shared helper
    // so AudioButton, EmergencyAlertScreen, ChoiceCard, and the inline TTS
    // in CheckIn all sound consistent.
    applyFriendlyVoice(utterance);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    // Fail loudly in dev when the OS has no usable voice so a silent no-op is
    // visible instead of looking like a broken button.
    if (
      process.env.NODE_ENV !== 'production' &&
      synth.getVoices().length === 0
    ) {
      console.warn(
        '[AudioButton] no SpeechSynthesis voices available — playback may be silent on this device',
      );
    }
    synth.speak(utterance);
    setSpeaking(true);
  };

  // Render nothing until mounted (matches SSR) or when TTS isn't available.
  if (!mounted || !supported) return null;

  // WCAG 2.2 AA Task 3 — 44 × 44 px minimum tap target. The visible icon
  // stays small for compact placement, but the button hit-box is full size.
  const dim = 44;
  const icon = size === 'sm' ? 16 : 20;

  return (
    <motion.button
      type="button"
      data-testid={testId}
      onClick={handleClick}
      aria-label={speaking ? stopLabel : effectiveLabel}
      aria-pressed={speaking}
      className={`flex items-center justify-center rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)] ${className ?? ''}`}
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
