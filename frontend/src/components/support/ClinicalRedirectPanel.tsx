'use client';

import Link from 'next/link';
import { HeartPulse, PhoneCall } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';

/**
 * The clinical-vs-operational split, rendered.
 *
 * The single most important healthcare rule in the support system: a medical
 * question must reach the care team, never the ops queue. This panel is shown
 * INSTEAD of a submittable form the moment clinical intent is detected, so the
 * ticket is never created in the first place. (The server also refuses a
 * CLINICAL create with 422 CLINICAL_DEFLECTED — this is the friendly half of a
 * defense-in-depth pair, not the only guard.)
 *
 * Destination differs by auth state because a signed-out visitor has no
 * care-team channel at all: signed-in → /chat, whose flag_emergency path
 * dispatches to the care team; signed-out → sign in first.
 *
 * ⚠ The body copy is PLACEHOLDER pending Dr. Singal's sign-off (patient-safety
 * wording, same bar as the alert messages). The 911 sentence is the already
 * approved line reused from register.medicalDisclaimer (Handoff 4 A1).
 */
export default function ClinicalRedirectPanel({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const { t } = useLanguage();

  return (
    <div
      data-testid="clinical-redirect"
      className="rounded-2xl border border-purple-200 bg-purple-50/60 p-5"
    >
      <div className="flex items-start gap-3">
        <HeartPulse className="w-5 h-5 mt-0.5 shrink-0 text-[#7B00E0]" />
        <div className="min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-slate-800">
              {t('support.clinical.title')}
            </h3>
            {/* This is the highest-stakes copy on the support surface — it tells
                someone with a medical question where to go, and carries the 911
                carve-out. It must not be reading-dependent. */}
            <AudioButton
              text={`${t('support.clinical.title')}. ${t('support.clinical.body')} ${t('support.clinical.emergency')}`}
              size="sm"
            />
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-slate-600">
            {t('support.clinical.body')}
          </p>

          <Link
            href={isAuthenticated ? '/chat' : '/sign-in'}
            data-testid="clinical-redirect-cta"
            className="mt-3 inline-flex h-10 items-center rounded-full bg-[#7B00E0] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6600BC]"
          >
            {isAuthenticated
              ? t('support.clinical.ctaChat')
              : t('support.clinical.ctaSignedOut')}
          </Link>

          {/* Emergency carve-out — must stay visually prominent and must never
              be gated behind auth state. */}
          <p className="mt-3 flex items-center gap-1.5 text-[13px] font-semibold text-red-700">
            <PhoneCall className="w-3.5 h-3.5 shrink-0" />
            {t('support.clinical.emergency')}
          </p>
        </div>
      </div>
    </div>
  );
}
