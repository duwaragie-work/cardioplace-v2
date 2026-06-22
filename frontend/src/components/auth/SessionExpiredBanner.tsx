'use client';

import { useSearchParams } from 'next/navigation';
import { Info } from 'lucide-react';

/**
 * Renders an accessible "session expired" notice on the sign-in page
 * when the URL carries `?session_expired=1` — set by `useIdleTimeout`
 * after the 15-min web / 5-min mobile idle threshold (Manisha 2026-06-12
 * Doc 3 Q7).
 *
 * Accessibility (Rengan 2026-04 spec — Tasks 2, 8, 10):
 *   • role="status" + aria-live="polite" — screen readers announce on
 *     page load without interrupting any current speech.
 *   • Text ≥ 18 px (1.125rem) with high-contrast info palette
 *     (#1E3A8A on #EFF6FF ≈ 9.6:1).
 *   • Icon + word "Notice" — never colour-only signalling.
 */
export default function SessionExpiredBanner() {
  const params = useSearchParams();
  if (params?.get('session_expired') !== '1') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mb-6 flex w-full max-w-[640px] items-start gap-3 rounded-lg border-2 border-[#1E3A8A] bg-[#EFF6FF] p-4"
      data-testid="session-expired-banner"
    >
      <Info
        aria-hidden="true"
        className="mt-0.5 shrink-0 text-[#1E3A8A]"
        size={28}
        strokeWidth={2.25}
      />
      <div className="flex-1 text-[1.125rem] leading-snug text-[#1A1A2E]">
        <strong className="block font-semibold text-[#1E3A8A]">
          Notice — you were signed out
        </strong>
        <span>
          Your session ended because there was no activity for a while.
          Please sign in again to continue.
        </span>
      </div>
    </div>
  );
}
