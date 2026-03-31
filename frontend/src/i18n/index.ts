import en, { type TranslationKey } from './en';
import es from './es';
import fr from './fr';
import de from './de';

export type { TranslationKey };
export type LocaleCode = 'en' | 'es' | 'fr' | 'de' | 'pt' | 'zh' | 'ar' | 'ko';

/** Locales with full translations */
export const SUPPORTED_LOCALES: LocaleCode[] = ['en', 'es', 'fr', 'de'];

/** All locales shown in the dropdown (unsupported ones show "coming soon") */
export const ALL_LOCALES: { code: LocaleCode; flag: string; nativeName: string }[] = [
  { code: 'en', flag: '🇺🇸', nativeName: 'English' },
  { code: 'es', flag: '🇪🇸', nativeName: 'Español' },
  { code: 'fr', flag: '🇫🇷', nativeName: 'Français' },
  { code: 'de', flag: '🇩🇪', nativeName: 'Deutsch' },
  { code: 'pt', flag: '🇧🇷', nativeName: 'Português' },
  { code: 'zh', flag: '🇨🇳', nativeName: '中文' },
  { code: 'ar', flag: '🇸🇦', nativeName: 'العربية' },
  { code: 'ko', flag: '🇰🇷', nativeName: '한국어' },
];

const translations: Record<string, Record<TranslationKey, string>> = {
  en,
  es,
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
