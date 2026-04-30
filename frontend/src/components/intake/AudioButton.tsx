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

// Preference order for a warmer female voice per language. The browser
// returns whatever the OS has installed, so we go from most-likely-pleasant
// (Apple's neural voices, Google's online voices, Microsoft's neural
// voices) down to plain "Female" fallbacks. First match wins.
const FEMALE_VOICE_PREFERENCES: Record<string, string[]> = {
  en: [
    'Samantha',                 // macOS / iOS — the canonical "Siri-like" female
    'Ava',                      // macOS premium
    'Allison',                  // macOS
    'Susan',                    // macOS
    'Karen',                    // macOS (Australian)
    'Tessa',                    // macOS (South African)
    'Google US English',        // Chrome desktop default voice — sounds female
    'Microsoft Aria Online',    // Edge / Windows neural
    'Microsoft Jenny Online',   // Edge / Windows neural
    'Microsoft Aria',
    'Microsoft Jenny',
    'Microsoft Zira',
  ],
  es: ['Mónica', 'Paulina', 'Microsoft Helena', 'Google español'],
  fr: ['Amélie', 'Audrey', 'Marie', 'Microsoft Julie', 'Google français'],
  de: ['Anna', 'Petra', 'Microsoft Hedda', 'Microsoft Katja', 'Google Deutsch'],
  am: [],
};

/**
 * Pick the friendliest available voice for `lang`. Prefers our curated list
 * of female voices, then any voice flagged with "female" / "woman" in its
 * name, then any voice whose lang matches. Returns null if nothing fits —
 * the browser's default voice will be used.
 */
function pickFriendlyVoice(
  voices: SpeechSynthesisVoice[],
  lang: string,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const langPrefix = lang.slice(0, 2).toLowerCase();
  const matches = voices.filter((v) =>
    v.lang.toLowerCase().startsWith(langPrefix),
  );
  if (matches.length === 0) return null;

  const preferences = FEMALE_VOICE_PREFERENCES[langPrefix] ?? [];
  for (const name of preferences) {
    const exact = matches.find((v) => v.name === name);
    if (exact) return exact;
    const partial = matches.find((v) => v.name.includes(name));
    if (partial) return partial;
  }

  // Fall back to anything that self-identifies as female in its display name.
  const femaleish = matches.find((v) => /female|woman|girl/i.test(v.name));
  if (femaleish) return femaleish;

  // Last resort — first locale-matching voice.
  return matches[0];
}

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
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  useEffect(() => {
    setMounted(true);
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    setSupported(true);

    // Voice list loads asynchronously on Chrome — getVoices() returns []
    // until the engine populates the list and fires onvoiceschanged. Read
    // both eagerly and on the event so we have voices ready by first click.
    const synth = window.speechSynthesis;
    const loadVoices = () => setVoices(synth.getVoices());
    loadVoices();
    synth.addEventListener('voiceschanged', loadVoices);
    return () => {
      synth.removeEventListener('voiceschanged', loadVoices);
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
    synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = effectiveLang;
    // Pick a warmer female voice when one is available — falls back to the
    // browser default for locales we don't have a curated preference for.
    const voiceList = voices.length > 0 ? voices : synth.getVoices();
    const chosen = pickFriendlyVoice(voiceList, effectiveLang);
    if (chosen) utterance.voice = chosen;
    utterance.rate = 0.95;
    // Slight pitch lift gives the voice a warmer, less monotone feel.
    utterance.pitch = 1.05;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
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
