'use client';

import { useSearchParams } from 'next/navigation';
import { Info } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

/**
 * Renders an accessible "session expired" notice on the sign-in page
 * when the URL carries `?session_expired=1` — set by `useIdleTimeout`
 * after the 15-min web / 5-min mobile idle threshold (Manisha 2026-06-12
 * Doc 3 Q7).
 *
 * Accessibility (Rengan 2026-04 spec — Tasks 2, 8, 10):
 *   • role="status" + aria-live="polite" — screen readers announce on
 *     page load without interrupting any current speech.
 *   • Icon + word "Notice" — never colour-only signalling.
 *   • Styled to the site's banner language (rounded-xl card, soft purple
 *     tint, brand-purple icon, high-contrast #170c1d title on a light bg).
 */
export default function SessionExpiredBanner() {
  const params = useSearchParams();
  const { t } = useLanguage();
  if (params?.get('session_expired') !== '1') return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mx-auto mb-6 flex w-full max-w-[640px] items-start gap-2.5 rounded-xl border border-[#e5d9f2] bg-[rgba(243,232,255,0.4)] px-4 py-3.5"
      data-testid="session-expired-banner"
    >
      <Info
        aria-hidden="true"
        className="mt-0.5 h-5 w-5 shrink-0 text-[#7B00E0]"
        strokeWidth={2.5}
      />
      <div className="flex-1 text-sm leading-relaxed text-[#4b5563]">
        <strong className="block font-semibold text-[#170c1d]">
          {t('auth.sessionExpired.title')}
        </strong>
        <span>{t('auth.sessionExpired.body')}</span>
      </div>
    </div>
  );
}
