// Cluster 8 §F.3 — i18n completeness gate.
//
// Backstop for the "shipped English-only" failure mode: even with
// TypeScript's `Record<TranslationKey, string>` ensuring every locale file
// has every key, a developer can still copy-paste the English value as a
// placeholder and forget to translate it. This gate scans the patient-
// + caregiver-facing keys (the surfaces clinical signed off on translating)
// and fails if any locale value is empty OR identical to the English source.
//
// Scope is intentionally narrow: only `alert.*` + `checkin.*` + the
// adherence nudge keys. UI-chrome strings (nav.*, common.*) are allowed
// to be English when the locale is just chrome-machine-translated; the
// clinical surfaces are what compliance signs off on.
//
// Update flow: if a locale legitimately needs the English value (e.g., a
// proper noun, a medical abbreviation that's identical across languages),
// add the key to KNOWN_IDENTICAL_OK with a reason.

import { readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const _filename = fileURLToPath(import.meta.url)
const _dirname = dirname(_filename)
const REPO_ROOT = resolve(_dirname, '..', '..', '..', '..')

const LOCALES = ['es', 'am'] as const
type Locale = (typeof LOCALES)[number]

/**
 * Heuristic: a key is "patient-facing" or "caregiver-facing" if its prefix
 * indicates a surface a patient sees. Cluster 8 patient-facing angioedema
 * keys are `alert.angioedema.*` + `checkin.b3.symptom*`. We also include
 * the adherence nudge body (lives in checkin/alert space).
 *
 * Excluded: UI chrome (nav.*, common.*, settings.*), error messages
 * (already MT-allowed in es/de/fr/am headers), provider-only strings.
 */
function isPatientOrCaregiverFacing(key: string): boolean {
  return (
    key.startsWith('alert.') ||
    key.startsWith('checkin.b3.symptom') ||
    key.startsWith('checkin.b3.otherLabel') ||
    key.startsWith('notification.angioedema') ||
    key.startsWith('notification.adherence') ||
    // Bug 2b (live-test 2026-06-15) — these patient-facing post-submit / modal
    // surfaces shipped untranslated (English passthrough) because the gate
    // didn't scan them. Widen to the confirmation, backdating-delay, historical
    // note, AFib state cards + leave modal, and Option D retake screens. These
    // are all read by the patient, so compliance signs off on their translation.
    key.startsWith('checkin.confirm.') ||
    key.startsWith('checkin.delay.') ||
    key.startsWith('checkin.historical.') ||
    key.startsWith('checkin.afib.') ||
    key.startsWith('checkin.optionD.') ||
    // Bug 18 (live-test 2026-06-16) — the B2 "Taken just now" summary + "Change"
    // link shipped English-only in es/de/fr/am. Scoped to these two keys (not all
    // of checkin.b2) to avoid sweeping in unrelated step-2 labels.
    key === 'checkin.b2.takenNow' ||
    key === 'checkin.b2.changeTime' ||
    // Bug 17 — bulk medication shortcuts are patient-facing.
    key === 'checkin.b4.markAllTaken' ||
    key === 'checkin.b4.markAllNotTaken' ||
    key === 'checkin.b4.bulkTally'
  )
}

/**
 * Keys whose locale value is intentionally identical to English — proper
 * nouns, medical abbreviations, etc. Each entry MUST cite why.
 */
const KNOWN_IDENTICAL_OK: Record<string, string> = {
  // 'mmHg' is the universal blood-pressure unit symbol — identical across locales.
  'es:checkin.confirm.unit': '"mmHg" is a unit symbol, identical across locales',
  'am:checkin.confirm.unit': '"mmHg" is a unit symbol, identical across locales',
}

function loadLocaleFile(locale: 'en' | Locale): Map<string, string> {
  const path = join(REPO_ROOT, 'frontend', 'src', 'i18n', `${locale}.ts`)
  const src = readFileSync(path, 'utf8')
  return parseLocaleSource(src)
}

/**
 * Parse a locale .ts file into a key → value map. Handles:
 *   'key': 'value',
 *   'key': "value",  (mixed quoting)
 *   'key':
 *     'value with, internal, commas',
 *   'key':
 *     'first line ' +
 *     'second line',
 * Strategy: anchor on the key line, then linear-scan from after the `:` to
 * the matching trailing comma OR closing-brace at top-level (depth 0),
 * counting single-quote / double-quote string literal boundaries so a `,`
 * INSIDE a string literal doesn't terminate the value. Skipped: keys whose
 * value starts with `(`, `function`, or backtick (template strings,
 * function builders).
 */
function parseLocaleSource(src: string): Map<string, string> {
  const out = new Map<string, string>()
  const KEY_HEAD = /'([a-zA-Z0-9._]+)':\s*/g
  let match: RegExpExecArray | null
  while ((match = KEY_HEAD.exec(src)) != null) {
    const key = match[1]
    let i = match.index + match[0].length
    // Peek to skip function/template values.
    const first = src[i]
    if (first === '(' || first === '`') continue
    if (src.slice(i, i + 8) === 'function') continue
    // Scan, accumulating concatenated string literals separated by `+`.
    const parts: string[] = []
    while (i < src.length) {
      // Skip whitespace + concatenation operator + comments.
      while (i < src.length && /[\s+]/.test(src[i])) i++
      const ch = src[i]
      if (ch !== "'" && ch !== '"') break
      // Walk the string literal.
      const quote = ch
      i++ // past opening quote
      let lit = ''
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          lit += src[i + 1] ?? ''
          i += 2
        } else {
          lit += src[i]
          i++
        }
      }
      i++ // past closing quote
      parts.push(lit)
    }
    if (parts.length > 0) {
      out.set(key, parts.join(''))
    }
  }
  return out
}

describe('Cluster 8 §F.3 — i18n completeness gate', () => {
  const en = loadLocaleFile('en')
  const localized: Record<Locale, Map<string, string>> = {
    es: loadLocaleFile('es'),
    am: loadLocaleFile('am'),
  }

  it('parser found a meaningful number of i18n keys (sanity)', () => {
    // Guard against a regex-break that would silently return an empty map
    // and false-pass the gate.
    expect(en.size).toBeGreaterThanOrEqual(50)
    expect(localized.es.size).toBeGreaterThanOrEqual(50)
    expect(localized.am.size).toBeGreaterThanOrEqual(50)
  })

  it('every patient-/caregiver-facing key is present in es + am', () => {
    const missing: string[] = []
    for (const key of en.keys()) {
      if (!isPatientOrCaregiverFacing(key)) continue
      for (const locale of LOCALES) {
        if (!localized[locale].has(key)) {
          missing.push(`${locale}: ${key}`)
        }
      }
    }
    if (missing.length > 0) {
      throw new Error(
        `Missing locale entries for patient-/caregiver-facing keys:\n  ${missing.join('\n  ')}`,
      )
    }
    expect(missing).toEqual([])
  })

  it('no patient-/caregiver-facing key has an EMPTY value in es + am', () => {
    const empties: string[] = []
    for (const locale of LOCALES) {
      for (const [key, value] of localized[locale]) {
        if (!isPatientOrCaregiverFacing(key)) continue
        if (value.trim() === '') empties.push(`${locale}: ${key}`)
      }
    }
    if (empties.length > 0) {
      throw new Error(
        `Empty translations for patient-/caregiver-facing keys:\n  ${empties.join('\n  ')}`,
      )
    }
    expect(empties).toEqual([])
  })

  it('no patient-/caregiver-facing key has the IDENTICAL English value in es + am (forgotten translation)', () => {
    const copies: string[] = []
    for (const locale of LOCALES) {
      for (const [key, value] of localized[locale]) {
        if (!isPatientOrCaregiverFacing(key)) continue
        if (KNOWN_IDENTICAL_OK[`${locale}:${key}`] != null) continue
        const enValue = en.get(key)
        if (enValue == null) continue
        if (enValue.trim() === value.trim()) {
          copies.push(`${locale}: ${key}`)
        }
      }
    }
    if (copies.length > 0) {
      throw new Error(
        `Locale value identical to English (forgotten translation? add to KNOWN_IDENTICAL_OK if intentional):\n  ${copies.join('\n  ')}`,
      )
    }
    expect(copies).toEqual([])
  })

  // Cluster 8-specific assertions — the 5 angioedema keys Niva translated.
  // These are the §0-doc-cited "P0 pilot blocker" surfaces that compliance
  // expects in es + am from day 1.
  const CLUSTER_8_ANGIOEDEMA_KEYS = [
    'checkin.b3.symptomFaceSwelling',
    'checkin.b3.symptomThroatTightness',
    'alert.angioedema.patientAce',
    'alert.angioedema.patientGeneric',
    'alert.angioedema.caregiver',
  ]

  for (const key of CLUSTER_8_ANGIOEDEMA_KEYS) {
    it(`Cluster 8 angioedema — ${key} is present + translated in es + am`, () => {
      const enValue = en.get(key)
      if (enValue == null) throw new Error(`en missing key: ${key}`)
      for (const locale of LOCALES) {
        const value = localized[locale].get(key)
        if (value == null) throw new Error(`${locale} missing key: ${key}`)
        if (value.trim().length === 0) {
          throw new Error(`${locale} empty value for ${key}`)
        }
        if (value.trim() === enValue.trim()) {
          throw new Error(
            `${locale} value is identical to English for ${key} — forgotten translation`,
          )
        }
      }
      expect(true).toBe(true)
    })
  }
})
