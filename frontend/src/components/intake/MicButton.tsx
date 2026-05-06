'use client';

// Phase/26 silent-literacy — Web Speech API STT trigger.
//
// Sibling component to AudioButton. Patient taps the mic, dictates into a
// free-text or numeric input, and the transcript fills the field. Feature-
// detected — when the browser doesn't expose SpeechRecognition we render
// nothing, so the input still works keyboard-only.
//
// WCAG 2.2 AA per ACCESSIBILITY_SPEC §1.5:
//   - 44 × 44 px min tap target (Task 3)
//   - visible :focus-visible ring (Task 9)
//   - aria-label, aria-pressed, aria-controls (SR navigability)
//   - listening indicator NOT colour-only (Task 8) — paired with text
//   - Enter + Space activation (Task 6)

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Mic, MicOff } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import {
  getSpeechRecognition,
  wordsToDigits,
  type BrowserSpeechRecognition,
} from '@/lib/speech'

// Same locale → BCP-47 mapping AudioButton uses. Kept local so MicButton
// has zero coupling to AudioButton's internals.
const LOCALE_TO_BCP47: Record<string, string> = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  am: 'am-ET',
}

interface Props {
  /** Called once with the final transcript when the patient stops speaking. */
  onTranscript: (text: string) => void
  /**
   * The id of the input this button dictates into. Threads through as
   * aria-controls so screen readers can navigate from button to field.
   */
  inputId?: string
  /**
   * If true, post-process the transcript via wordsToDigits before invoking
   * onTranscript. Use for BP / pulse / weight dictation.
   */
  numeric?: boolean
  /** BCP-47 override; defaults to current app locale. */
  lang?: string
  /** aria-label override — defaults to "Speak to fill this field". */
  ariaLabel?: string
  className?: string
}

export default function MicButton({
  onTranscript,
  inputId,
  numeric = false,
  lang,
  ariaLabel,
  className,
}: Props) {
  const { locale, t } = useLanguage()
  const effectiveLang = lang ?? LOCALE_TO_BCP47[locale] ?? 'en-US'

  // Hydration-safe like AudioButton — server renders nothing, client takes
  // over after mount once the API check is done.
  const [mounted, setMounted] = useState(false)
  const [supported, setSupported] = useState(false)
  const [listening, setListening] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  // Hold the latest props in a ref so the recogniser's async callbacks
  // always fire against the CURRENT handler, not the closure captured at
  // start() time. Without this, intake forms saw the second-press
  // transcript routed to the first-press's onTranscript callback (which
  // had become stale relative to the parent's latest state). Refresh
  // every render so it never lags more than a render behind.
  const latestRef = useRef({ onTranscript, numeric, t })
  latestRef.current = { onTranscript, numeric, t }

  useEffect(() => {
    setMounted(true)
    const Ctor = getSpeechRecognition()
    setSupported(Ctor !== null)
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort()
        } catch {
          // Some browsers throw if abort() is called before start() — safe
          // to swallow; we only care that the recogniser stops listening.
        }
      }
    }
  }, [])

  // Auto-clear the error pill after 3.5s so the patient gets a clean slate
  // for a retry.
  useEffect(() => {
    if (!errorMsg) return
    const id = setTimeout(() => setErrorMsg(null), 3500)
    return () => clearTimeout(id)
  }, [errorMsg])

  const stop = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
      } catch {
        // see above
      }
    }
    setListening(false)
  }

  const start = () => {
    const Ctor = getSpeechRecognition()
    if (!Ctor) return

    // Abort any prior recogniser before spinning a new one. Some browsers
    // leave a previous recogniser alive past its onend; without this, the
    // second click would either throw InvalidStateError or silently route
    // the new transcript through the prior recogniser's callbacks (which
    // captured stale closures from the FIRST click's render).
    if (recognitionRef.current) {
      try { recognitionRef.current.abort() } catch {}
      recognitionRef.current = null
    }

    setErrorMsg(null)
    const r = new Ctor()
    r.lang = effectiveLang
    r.continuous = false
    r.interimResults = false
    r.maxAlternatives = 1

    r.onstart = () => setListening(true)
    r.onend = () => setListening(false)
    r.onerror = (event: { error?: string } | unknown) => {
      const code =
        typeof event === 'object' && event !== null && 'error' in event
          ? (event as { error?: string }).error ?? 'unknown'
          : 'unknown'
      // 'no-speech' / 'aborted' are benign user-facing — silent. Real errors
      // surface a text message so the listening indicator isn't colour-only.
      if (code !== 'no-speech' && code !== 'aborted') {
        setErrorMsg(latestRef.current.t('intake.audio.dictateError'))
      }
      setListening(false)
    }
    r.onresult = (event: unknown) => {
      try {
        const ev = event as {
          results: ArrayLike<ArrayLike<{ transcript: string }>>
        }
        const first = ev.results[0]?.[0]?.transcript ?? ''
        // Read latest callback / numeric / t from the ref — never the
        // closures captured at start() time, which can be one or more
        // renders behind by the time onresult fires asynchronously.
        const props = latestRef.current
        const cleaned = props.numeric ? wordsToDigits(first) : first.trim()
        if (cleaned) {
          props.onTranscript(cleaned)
        } else if (first.trim()) {
          setErrorMsg(props.t('intake.audio.dictateError'))
        }
      } catch {
        setErrorMsg(latestRef.current.t('intake.audio.dictateError'))
      }
    }

    recognitionRef.current = r
    try {
      r.start()
    } catch {
      // Calling start() while one is already running throws — flag.
      setErrorMsg(t('intake.audio.dictateError'))
      setListening(false)
    }
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!supported) return
    if (listening) {
      stop()
    } else {
      start()
    }
  }

  // Render nothing during SSR mismatch window or when STT isn't supported —
  // the input stays usable keyboard-only.
  if (!mounted || !supported) return null

  const idleLabel = ariaLabel ?? t('intake.audio.dictate')
  const stopLabel = t('intake.audio.dictateStop')

  return (
    <span className="inline-flex items-center gap-2">
      <motion.button
        type="button"
        onClick={handleClick}
        aria-label={listening ? stopLabel : idleLabel}
        aria-pressed={listening}
        aria-controls={inputId}
        className={`flex items-center justify-center rounded-full transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)] ${className ?? ''}`}
        style={{
          // 44 × 44 px min — WCAG 2.2 AA Task 3.
          width: 44,
          height: 44,
          backgroundColor: listening
            ? '#b91c1c' // red-700 — paired with text below so not colour-only
            : 'var(--brand-primary-purple-light)',
          color: listening ? 'white' : 'var(--brand-primary-purple)',
        }}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        animate={
          listening
            ? { boxShadow: ['0 0 0 0 rgba(185,28,28,0.6)', '0 0 0 8px rgba(185,28,28,0)'] }
            : undefined
        }
        transition={listening ? { duration: 1.2, repeat: Infinity } : undefined}
      >
        {listening ? <MicOff size={20} /> : <Mic size={20} />}
      </motion.button>

      {listening && (
        <span
          // role=status announces the listening state to screen readers; the
          // text label is the non-colour pairing required by WCAG 2.2 AA Task 8.
          role="status"
          className="text-[12px] font-medium"
          style={{ color: '#b91c1c' }}
        >
          {t('intake.audio.dictateListening')}
        </span>
      )}
      {errorMsg && !listening && (
        <span role="alert" className="text-[12px]" style={{ color: '#b91c1c' }}>
          {errorMsg}
        </span>
      )}
    </span>
  )
}
