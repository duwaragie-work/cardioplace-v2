'use client';

// Phase/26 accessibility (Rengan Task 11) — first focusable element on every
// page. Pressing Tab once reveals the link; Enter jumps to <main id="main">,
// skipping the navbar. Hidden until focused via the .skip-link CSS rule in
// globals.css.
import { useLanguage } from '@/contexts/LanguageContext';

export default function SkipLink() {
  const { t } = useLanguage();
  // Move *focus* (not just scroll) into <main> so keyboard/SR users land
  // there. <main> isn't focusable by default, so make it focusable on the
  // fly — works regardless of whether the page's <main> declares tabIndex.
  const handleActivate = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const main = document.getElementById('main');
    if (!main) return;
    e.preventDefault();
    if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
    main.focus();
    main.scrollIntoView();
  };
  return (
    <a href="#main" onClick={handleActivate} className="skip-link">
      {t('accessibility.skipToMain')}
    </a>
  );
}
