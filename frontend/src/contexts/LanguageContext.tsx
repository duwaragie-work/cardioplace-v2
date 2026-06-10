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
  isLocaleSupported,
  SUPPORTED_LOCALES,
} from '@/i18n';
import { useAuth } from '@/lib/auth-context';

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
  const [locale, setLocaleState] = useState<LocaleCode>('en');
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const { user } = useAuth();

  // Read persisted locale on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED_LOCALES.includes(stored as LocaleCode)) {
        setLocaleState(stored as LocaleCode);
      }
    } catch {
      // localStorage unavailable
    }
  }, []);

  // Cluster 8 Gap 1 (Manisha 5/18/26, P0) — honor the patient's
  // `preferredLanguage` so es/am pilot patients get their language by
  // default (e.g. the angioedema emergency alert). Precedence: an explicit
  // manual pick (localStorage, written by setLocale) always wins; otherwise
  // fall back to the account's preferredLanguage; otherwise 'en'. This is
  // re-derived from the user record each session (not persisted), so it
  // never overrides a deliberate in-app language choice.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      // localStorage unavailable — fall through to preferredLanguage
    }
    const pref = user?.preferredLanguage;
    if (pref && SUPPORTED_LOCALES.includes(pref as LocaleCode)) {
      setLocaleState(pref as LocaleCode);
    }
  }, [user]);

  const setLocale = useCallback((code: LocaleCode) => {
    if (isLocaleSupported(code)) {
      setLocaleState(code);
      try {
        localStorage.setItem(STORAGE_KEY, code);
      } catch {
        // localStorage unavailable
      }
    } else {
      // Show "coming soon" toast and stay on English
      setLocaleState('en');
      try {
        localStorage.setItem(STORAGE_KEY, 'en');
      } catch {
        // localStorage unavailable
      }
      setToastMsg(getTranslation('en', 'common.comingSoonMsg'));
      setTimeout(() => setToastMsg(null), 3000);
    }
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
            fontSize: '0.8125rem',
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
