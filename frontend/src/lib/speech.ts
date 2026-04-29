// Phase/26 silent-literacy — Web Speech API STT helpers.
//
// The browser SpeechRecognition API ships under two names (Chrome/Edge
// prefix it as `webkitSpeechRecognition`; iOS Safari + standards-track use
// `SpeechRecognition`). TypeScript's lib.dom.d.ts has both behind feature
// detection but doesn't widen `window` for us — this file owns the typing.
//
// Pure helpers + types. No React, no i18n. MicButton consumes these.

/* eslint-disable @typescript-eslint/no-explicit-any */

// ─── TS shim ──────────────────────────────────────────────────────────────

export interface SpeechRecognitionResult {
  transcript: string
  isFinal: boolean
}

export interface BrowserSpeechRecognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: any) => void) | null
  onerror: ((event: any) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition

/**
 * Returns the browser-prefixed SpeechRecognition constructor, or null if
 * the runtime doesn't support voice input. Call only on the client.
 */
export function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor
    webkitSpeechRecognition?: SpeechRecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognition() !== null
}

// ─── numeric-transcript helper ────────────────────────────────────────────

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9,
}
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
}
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/**
 * Convert a spoken numeric phrase to digits. Handles the patterns BP/pulse
 * dictation actually produces:
 *
 *   "one forty two"   → "142"   (informal — patients say "one forty two")
 *   "one hundred forty two" → "142"
 *   "ninety eight"    → "98"
 *   "seventy-two"     → "72"    (hyphenated — Chrome Android frequently)
 *   "98 bpm"          → "98"    (recognizer adds a unit suffix)
 *   "142"             → "142"   (passes through if already digits)
 *   "120 over 80"     → "120 80"
 *
 * Returns an empty string if nothing parseable is in the input. Callers
 * should treat that as "couldn't hear the number — ask the user to retry."
 */
export function wordsToDigits(input: string): string {
  if (!input) return ''
  // Normalise: lowercase, strip leading/trailing whitespace, fold hyphens
  // between letters into spaces ("seventy-two" → "seventy two"). The fold
  // happens before the digit-only fast-path so 120-80 style strings still
  // parse cleanly via the digit regex below.
  const trimmed = input
    .trim()
    .toLowerCase()
    .replace(/(?<=[a-z])-(?=[a-z])/g, ' ')
  if (!trimmed) return ''

  // Fast path: already digits + spaces + "/" / "." / ",". If the input is
  // mostly digits with a unit suffix like "98 bpm", strip the non-digit
  // tail and return what remains.
  if (/^[\d\s/.,]+$/.test(trimmed)) return trimmed
  const digitsOnly = trimmed.match(/^\s*(\d[\d\s/.]*)/)
  if (digitsOnly) {
    const head = digitsOnly[1].trim()
    // Only short-circuit when the tail is plainly a unit/filler word —
    // protects against accidentally truncating "120 over 80" which has
    // meaningful tokens after the leading digits.
    const tail = trimmed.slice(digitsOnly[0].length).trim()
    if (!tail || /^(bpm|beats|per|minute|min|mmhg)\b/.test(tail)) {
      return head
    }
  }

  // Tokenise on whitespace + the common BP filler "over". Strip "and"
  // ("one hundred and twenty") since it's grammatical filler, not a number.
  const tokens = trimmed
    .replace(/[,]/g, ' ')
    .replace(/\bover\b/g, ' ')
    .replace(/\band\b/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  const out: string[] = []
  let pending = 0
  let havePending = false

  const flush = () => {
    if (havePending) {
      out.push(String(pending))
      pending = 0
      havePending = false
    }
  }

  for (const token of tokens) {
    // Standalone digit token — flush any pending spoken accumulation first
    // so "one forty two 80" → "142 80" not "12280".
    if (/^\d+$/.test(token)) {
      flush()
      out.push(token)
      continue
    }
    if (TEENS[token] != null) {
      pending = TEENS[token]
      havePending = true
      continue
    }
    if (TENS[token] != null) {
      // Combine with a trailing ones digit on next iteration if present.
      pending = (havePending && pending < 10 ? pending * 100 : 0) + TENS[token]
      havePending = true
      continue
    }
    if (ONES[token] != null) {
      const digit = ONES[token]
      // "one" before "forty two" should hold as a hundreds prefix —
      // stash, and let the next TENS/TEENS finish the number.
      if (!havePending) {
        pending = digit
        havePending = true
      } else if (pending < 10) {
        // "twenty" + "two" → 22  (TENS stage already set pending=20 < 100)
        pending = pending + digit
      } else if (pending < 100) {
        // already a TENS-shaped number; treating extra ONES as a new token
        flush()
        pending = digit
        havePending = true
      } else {
        // pending is already 100+ (e.g. "one twenty" → 120) — append digit.
        pending = pending + digit
      }
      continue
    }
    if (token === 'hundred') {
      pending = (havePending ? pending : 1) * 100
      havePending = true
      continue
    }
    // Unknown word — flush whatever we have so the caller still gets the
    // partial number, then drop the word.
    flush()
  }
  flush()

  return out.join(' ')
}
