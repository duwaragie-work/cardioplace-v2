'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

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
 *   • Text ≥ 18 px (1.125rem) and high contrast (#1A1A2E on #FFFBEB).
 *   • Icon + word "Warning" — never colour-only signalling (Task 8).
 *   • "Stay signed in" button is 44×44 minimum with visible focus ring
 *     using :focus-visible (Tasks 3 + 9).
 *   • Escape dismisses; the click itself counts as activity so the
 *     useIdleTimeout hook re-arms the warning timer naturally (Task 6
 *     keyboard-operable).
 */
export default function IdleWarningToast() {
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
      className="fixed inset-x-0 top-4 z-[100] mx-auto flex max-w-[min(560px,calc(100vw-2rem))] items-start gap-3 rounded-lg border-2 border-[#92400E] bg-[#FFFBEB] p-4 shadow-lg sm:items-center"
      data-testid="idle-warning-toast"
    >
      <AlertTriangle
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-[#92400E] sm:mt-0"
        size={28}
        strokeWidth={2.25}
      />
      <div className="flex-1 text-[1.125rem] leading-snug text-[#1A1A2E]">
        <strong className="block font-semibold">Warning — signing out soon</strong>
        <span>
          You will be signed out in about 60 seconds because of inactivity.
          Move the mouse or press any key to stay signed in.
        </span>
      </div>
      <button
        type="button"
        onClick={dismiss}
        className="min-h-[44px] min-w-[44px] shrink-0 rounded-md bg-[#5B2D8E] px-4 py-2 text-[1rem] font-semibold text-white hover:bg-[#46226F] focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-[#1A1A2E]"
        data-testid="idle-warning-stay-signed-in"
      >
        Stay signed in
      </button>
    </div>
  );
}
