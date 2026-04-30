// Shared female-voice selector for SpeechSynthesis. Used by AudioButton and
// any other site that constructs SpeechSynthesisUtterance directly so every
// patient-facing TTS call lands on the same warm voice profile.

// Preference order for a warmer female voice per language. The browser
// returns whatever the OS has installed, so we go from most-likely-pleasant
// (Apple's neural voices, Google's online voices, Microsoft's neural
// voices) down to plain "Female" fallbacks. First match wins.
const FEMALE_VOICE_PREFERENCES: Record<string, string[]> = {
  en: [
    'Samantha',                 // macOS / iOS, the canonical "Siri-like" female
    'Ava',                      // macOS premium
    'Allison',                  // macOS
    'Susan',                    // macOS
    'Karen',                    // macOS (Australian)
    'Tessa',                    // macOS (South African)
    'Google US English',        // Chrome desktop default voice, sounds female
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
 * of female voices, then any voice flagged with "female" / "woman" / "girl"
 * in its name, then any voice whose lang matches. Returns null if nothing
 * fits — the browser's default voice will be used.
 */
export function pickFriendlyVoice(
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

  // Last resort, first locale-matching voice.
  return matches[0];
}

/**
 * Mutate `utterance` to use a friendly female voice + warm pitch. Reads the
 * voice list synchronously from the SpeechSynthesis engine; on Chrome the
 * first call before `voiceschanged` fires returns [] and we leave the
 * default voice in place. Pitch / rate are bumped together so every TTS
 * call sounds the same.
 */
export function applyFriendlyVoice(utterance: SpeechSynthesisUtterance): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const voices = window.speechSynthesis.getVoices();
  const chosen = pickFriendlyVoice(voices, utterance.lang || 'en-US');
  if (chosen) utterance.voice = chosen;
  utterance.pitch = 1.05;
  if (!utterance.rate) utterance.rate = 0.95;
}
