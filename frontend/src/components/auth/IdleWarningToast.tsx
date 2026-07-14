'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * June 2026 — idle-timeout warning surface (Manisha 2026-06-12 Doc 3 Q7).
 * Listens for the `auth:idle-warning` CustomEvent that `useIdleTimeout`
 * dispatches at T-1-min, renders an accessible banner with a "Stay
 * signed in" action, and auto-dismisses on real user activity or when
 * the session-expired timeout fires.
 *
 * Accessibility (Rengan 2026-04 spec — Tasks 2, 3, 6, 8, 9, 10):
 *   • role="alert" + aria-live="assertive" — screen readers announce
 *     immediately, no Tab navigation required to discover it.
 *   • Icon + word "Warning" — never colour-only signalling (Task 8).
 *   • Styled to the site's banner language (rounded-xl card, amber warning
 *     palette, brand-purple pill action), with high-contrast #170c1d text.
 *   • "Stay signed in" button is 44 px-tall minimum with a visible
 *     :focus-visible ring (Tasks 3 + 9).
 *   • Escape dismisses; the click itself counts as activity so the
 *     useIdleTimeout hook re-arms the warning timer naturally (Task 6
 *     keyboard-operable).
 */
export default function IdleWarningToast() {
  const { t } = useLanguage();
  const [visible, setVisible] = useState(false);

  const dismiss = useCallback(() => setVisible(false), []);

  useEffect(() => {
    function handleWarning() {
      setVisible(true);
    }
    function handleSessionExpired() {
      setVisible(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setVisible(false);
    }
    window.addEventListener('auth:idle-warning', handleWarning);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('auth:idle-warning', handleWarning);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
      window.removeEventListener('keydown', handleEscape);
    };
  }, []);

  // Auto-dismiss on real activity (the hook would re-arm anyway, but
  // hiding the banner the moment the user moves the mouse makes the UX
  // feel immediate rather than waiting for the next render tick).
  useEffect(() => {
    if (!visible) return;
    function handleActivity() {
      setVisible(false);
    }
    window.addEventListener('mousedown', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('touchstart', handleActivity);
    return () => {
      window.removeEventListener('mousedown', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('touchstart', handleActivity);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="fixed inset-x-0 top-4 z-[100] mx-auto flex max-w-[min(560px,calc(100vw-2rem))] flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5 shadow-[0px_12px_30px_rgba(123,0,224,0.12)]"
      data-testid="idle-warning-toast"
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 h-5 w-5 shrink-0 text-amber-600"
          strokeWidth={2.5}
        />
        <div className="flex-1 text-sm leading-relaxed text-[#4b5563]">
          <strong className="block font-semibold text-amber-800">
            {t('auth.idleWarning.title')}
          </strong>
          <span>{t('auth.idleWarning.body')}</span>
        </div>
      </div>
      {/* Action pinned to the bottom so the toast height is predictable no
          matter how the message text wraps. Full-width on phones, natural
          width and right-aligned from sm+. */}
      <button
        type="button"
        onClick={dismiss}
        className="min-h-[44px] w-full rounded-full bg-[#7B00E0] px-5 py-2 text-sm font-semibold text-white shadow-[0px_10px_15px_rgba(123,0,224,0.25)] transition-colors hover:bg-[#6600BC] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7B00E0] sm:w-auto sm:self-end"
        data-testid="idle-warning-stay-signed-in"
      >
        {t('auth.idleWarning.stay')}
      </button>
    </div>
  );
}
