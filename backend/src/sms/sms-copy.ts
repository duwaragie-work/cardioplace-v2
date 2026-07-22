/**
 * L6 — SMS reminder copy (2026-07-14).
 *
 * THE ENTIRE MESSAGE. It is deliberately PHI-free and purely directional:
 * no patient name, no condition, no BP values, no programme name. It is a
 * pointer to the app, nothing more — functionally identical to the appointment
 * reminders MyChart/Klara send. This is what counsel is reviewing (packet Q1).
 *
 * DO NOT interpolate the reminder's own body here. The daily reminder escalates
 * in tone (Day 2 / Day 3) and contains the patient's first name — SMS must NOT
 * escalate and must NOT carry any of it. SMS always sends this one nudge.
 */
export type SmsLanguage = 'en' | 'es' | 'am' | 'fr' | 'de'

export const SMS_REMINDER_TEMPLATE_ID = 'sms_daily_reminder_v1'

/**
 * Per-language copy. `{link}` is replaced with the check-in URL.
 *
 * ⛔ Amharic is deliberately ABSENT. The spec is explicit: Amharic must come
 * from a native speaker and must NEVER be machine-translated (it's the only
 * non-Latin script in the set, and a literal rendering loses the warmth). Until
 * Dr. Singal's Amharic-speaking team member supplies it, an `am` patient falls
 * back to English rather than receiving a machine-translated guess.
 */
const COPY: Partial<Record<SmsLanguage, string>> = {
  en: 'You have a reminder waiting. Tap here to check in: {link}',
  es: 'Tiene un recordatorio pendiente. Toque aquí para registrarse: {link}',
  fr: 'Vous avez un rappel en attente. Appuyez ici pour vous enregistrer : {link}',
  de: 'Sie haben eine Erinnerung. Tippen Sie hier, um sich anzumelden: {link}',
  // am: PENDING native-speaker translation — do not machine-translate.
}

const SUPPORTED: readonly SmsLanguage[] = ['en', 'es', 'am', 'fr', 'de']

export function resolveSmsLanguage(pref: string | null | undefined): SmsLanguage {
  const p = (pref ?? 'en').toLowerCase() as SmsLanguage
  return SUPPORTED.includes(p) ? p : 'en'
}

/** Render the reminder SMS in the patient's language (en fallback). */
export function smsReminderBody(language: SmsLanguage, link: string): string {
  const template = COPY[language] ?? COPY.en!
  return template.replace('{link}', link)
}
