import { SUPPORTED_LOCALES } from './index';
import en from './en';
import es from './es';
import am from './am';
import fr from './fr';
import de from './de';

/**
 * Key-parity guard across every supported locale.
 *
 * `TranslationKey` is `keyof typeof en`, but i18n/index.ts casts the other
 * locales with `as Record<TranslationKey, string>`. That cast SILENCES the
 * compiler: a key present in `en` and missing from `es`/`am`/`fr`/`de` is
 * invisible to tsc, and `getTranslation` then quietly falls back to English
 * (`dict[key] ?? translations.en[key] ?? key`). So the failure mode is a
 * locale that looks translated but isn't — nothing crashes, nothing warns, and
 * a Spanish-speaking patient just gets English on that one string.
 *
 * Adding copy means touching five files by hand; this is what makes forgetting
 * one a test failure instead of a silent regression in production.
 */
const LOCALES: Record<string, Record<string, string>> = { en, es, am, fr, de };

const enKeys = Object.keys(en).sort();

describe('i18n locale parity', () => {
  it('exposes a dictionary for every supported locale', () => {
    const withoutDictionary = SUPPORTED_LOCALES.filter((code) => !LOCALES[code]);
    expect(withoutDictionary).toEqual([]);
  });

  describe.each(SUPPORTED_LOCALES.filter((c) => c !== 'en'))('%s', (code) => {
    const dict = LOCALES[code];

    it('has no keys missing relative to en', () => {
      const missing = enKeys.filter((k) => !(k in dict));
      // Named explicitly so a failure tells you exactly what to add, rather
      // than just "expected 812 to be 809".
      expect(missing).toEqual([]);
    });

    it('has no keys that no longer exist in en', () => {
      const orphans = Object.keys(dict).filter((k) => !(k in en));
      expect(orphans).toEqual([]);
    });

    it('never blanks out a string that en actually has copy for', () => {
      // A blank is only a defect when English has content — some keys (e.g.
      // about.teamSubtitle) are deliberately empty in EVERY locale because the
      // slot is intentionally unused. Comparing against en distinguishes
      // "translation dropped" from "intentionally blank everywhere".
      const dropped = Object.entries(dict)
        .filter(([k, v]) => {
          const enValue = (en as Record<string, string>)[k];
          const enHasCopy = typeof enValue === 'string' && enValue.trim() !== '';
          const localeBlank = typeof v !== 'string' || v.trim() === '';
          return enHasCopy && localeBlank;
        })
        .map(([k]) => k);
      expect(dropped).toEqual([]);
    });
  });

  // The support surface is the newest and largest block of hand-added copy, so
  // it gets an explicit assertion rather than relying on the generic sweep.
  it('covers the whole support.* surface in every locale', () => {
    const supportKeys = enKeys.filter((k) => k.startsWith('support.'));
    expect(supportKeys.length).toBeGreaterThan(0);
    // Reported as {locale: [missing keys]} so a failure names both the locale
    // and the exact keys, instead of just the first one that trips.
    const gaps: Record<string, string[]> = {};
    for (const code of SUPPORTED_LOCALES) {
      const missing = supportKeys.filter((k) => !(k in LOCALES[code]));
      if (missing.length) gaps[code] = missing;
    }
    expect(gaps).toEqual({});
  });
});
