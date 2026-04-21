import en, { type TranslationKey } from './en';
import es from './es';
import am from './am';
import fr from './fr';
import de from './de';

export type { TranslationKey };
export type LocaleCode = 'en' | 'es' | 'am' | 'fr' | 'de' | 'pt' | 'zh' | 'vi' | 'ar' | 'ko' | 'ht';

/** Locales with full translations */
export const SUPPORTED_LOCALES: LocaleCode[] = ['en', 'es', 'am', 'fr', 'de'];

/** All locales shown in the dropdown, ordered by deployment phase priority */
export const ALL_LOCALES: { code: LocaleCode; flag: string; nativeName: string }[] = [
  // Phase 1 — Wards 7 & 8 launch
  { code: 'en', flag: '🇺🇸', nativeName: 'English' },
  { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
  // Phase 2 — DC expansion
  { code: 'am', flag: '🇪🇹', nativeName: 'አማርኛ' },
  { code: 'fr', flag: '🇫🇷', nativeName: 'Français' },
  // Existing
  { code: 'de', flag: '🇩🇪', nativeName: 'Deutsch' },
  { code: 'pt', flag: '🇧🇷', nativeName: 'Português' },
  // Phase 3 — National
  { code: 'zh', flag: '🇨🇳', nativeName: '中文' },
  { code: 'vi', flag: '🇻🇳', nativeName: 'Tiếng Việt' },
  { code: 'ar', flag: '🇸🇦', nativeName: 'العربية' },
  { code: 'ko', flag: '🇰🇷', nativeName: '한국어' },
  { code: 'ht', flag: '🇭🇹', nativeName: 'Kreyòl Ayisyen' },
];

const translations: Record<string, Record<TranslationKey, string>> = {
  en,
  es,
  am: am as Record<TranslationKey, string>,
  fr,
  de,
};

export function getTranslation(locale: string, key: TranslationKey): string {
  const dict = translations[locale] ?? translations.en;
  return dict[key] ?? translations.en[key] ?? key;
}

export function isLocaleSupported(locale: string): boolean {
  return SUPPORTED_LOCALES.includes(locale as LocaleCode);
}
