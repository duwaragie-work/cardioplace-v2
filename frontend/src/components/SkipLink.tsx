'use client';

// Phase/26 accessibility (Rengan Task 11) — first focusable element on every
// page. Pressing Tab once reveals the link; Enter jumps to <main id="main">,
// skipping the navbar. Hidden until focused via the .skip-link CSS rule in
// globals.css.
import { useLanguage } from '@/contexts/LanguageContext';

export default function SkipLink() {
  const { t } = useLanguage();
  return (
    <a href="#main" className="skip-link">
      {t('accessibility.skipToMain')}
    </a>
  );
}
