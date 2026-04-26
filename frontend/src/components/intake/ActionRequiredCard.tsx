'use client';

// A0 — surfaced on /dashboard above all other content when basic onboarding
// is COMPLETED but Clinical Intake (PatientProfile) is not yet recorded.
// Two visual states:
//   • fresh    — first time the patient sees the prompt
//   • resume   — patient saved a draft mid-flow; show "Step X of N" + Resume

'use client';

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { ClipboardList, ArrowRight } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  state:
    | { kind: 'fresh' }
    | { kind: 'resume'; stepIndex: number; total: number; stepLabel: string };
  ctaHref?: string;
}

export default function ActionRequiredCard({ state, ctaHref = '/clinical-intake' }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  const isResume = state.kind === 'resume';

  const heading = isResume
    ? t('intake.a0.headingResume')
    : t('intake.a0.headingFresh');
  const sub = isResume
    ? t('intake.a0.subResume')
        .replace('{current}', String(state.stepIndex))
        .replace('{total}', String(state.total))
        .replace('{label}', state.stepLabel)
    : t('intake.a0.subFresh');
  const cta = isResume ? t('intake.a0.ctaResume') : t('intake.a0.ctaFresh');

  const progressPct =
    isResume && state.total > 0
      ? Math.max(6, Math.min(100, Math.round((state.stepIndex / state.total) * 100)))
      : 0;

  return (
    <motion.button
      type="button"
      onClick={() => router.push(ctaHref)}
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="w-full text-left rounded-2xl p-4 md:p-5 mb-3 md:mb-4 cursor-pointer transition-all"
      style={{
        backgroundColor: 'var(--brand-warning-amber-light)',
        border: '1.5px solid #FCD34D',
        boxShadow: '0 4px 14px rgba(217,119,6,0.10)',
      }}
      whileHover={{ scale: 1.005 }}
      whileTap={{ scale: 0.995 }}
    >
      <div className="flex items-center gap-3 md:gap-4">
        <div
          className="shrink-0 rounded-xl flex items-center justify-center"
          style={{
            width: 48,
            height: 48,
            backgroundColor: 'var(--brand-warning-amber)',
            color: 'white',
          }}
        >
          <ClipboardList className="w-6 h-6" />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-wider mb-0.5"
            style={{ color: 'var(--brand-warning-amber)' }}
          >
            {t('intake.a0.actionRequired')}
          </p>
          <p
            className="text-[15px] md:text-[16px] font-bold leading-tight"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {heading}
          </p>
          <p
            className="text-[12px] md:text-[13px] mt-0.5 leading-snug"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {sub}
          </p>

          {isResume && (
            <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgba(217,119,6,0.18)' }}>
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${progressPct}%`,
                  backgroundColor: 'var(--brand-warning-amber)',
                }}
              />
            </div>
          )}
        </div>

        <div
          className="shrink-0 hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-[13px]"
          style={{
            backgroundColor: 'var(--brand-warning-amber)',
            color: 'white',
            boxShadow: '0 4px 10px rgba(217,119,6,0.25)',
          }}
        >
          {cta}
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </div>

      <div
        className="sm:hidden mt-3 w-full h-9 rounded-full flex items-center justify-center gap-1.5 font-bold text-[13px]"
        style={{
          backgroundColor: 'var(--brand-warning-amber)',
          color: 'white',
          boxShadow: '0 4px 10px rgba(217,119,6,0.25)',
        }}
      >
        {cta}
        <ArrowRight className="w-3.5 h-3.5" />
      </div>
    </motion.button>
  );
}
