'use client';

import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from 'react';
import {
  type TranslationKey,
  type LocaleCode,
  getTranslation,
} from '@/i18n';

const STORAGE_KEY = 'healplace_locale';

interface LanguageContextValue {
  locale: LocaleCode;
  setLocale: (code: LocaleCode) => void;
  t: (key: TranslationKey) => string;
}

const LanguageContext = createContext<LanguageContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Admin app is English-only — the LanguageSelector is hidden and the locale
  // is hardcoded here. Any previously-persisted preference (from when the
  // selector was visible) is wiped on mount so it cannot leak through.
  const [locale] = useState<LocaleCode>('en');
  const [toastMsg] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage unavailable
    }
  }, []);

  const setLocale = useCallback((_code: LocaleCode) => {
    // No-op: admin is English-only. Defensive — nothing in the UI calls this
    // now, but a stray caller shouldn't be able to flip the locale.
  }, []);

  const t = useCallback(
    (key: TranslationKey) => getTranslation(locale, key),
    [locale],
  );

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
      {children}
      {/* "Coming soon" toast */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            backgroundColor: '#1F2937',
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 600,
            zIndex: 9999,
            boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          {toastMsg}
        </div>
      )}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
