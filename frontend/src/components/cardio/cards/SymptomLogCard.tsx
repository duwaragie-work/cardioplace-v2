'use client';

// Phase/27 chatbot v2 — symptom quick-log card.
// Red-banner emphasis because every symptom-quick log fires
// BP_LEVEL_2_SYMPTOM_OVERRIDE → care team is notified immediately.

import { motion } from 'framer-motion';
import { AlertTriangle, AlertCircle, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';
import type { SymptomLogSummary } from '@/hooks/useVoiceSession';

const SYMPTOM_LABELS: Record<string, string> = {
  severeHeadache: 'Severe headache',
  visualChanges: 'Visual changes',
  alteredMentalStatus: 'Altered mental status',
  chestPainOrDyspnea: 'Chest pain or dyspnea',
  focalNeuroDeficit: 'Focal weakness or numbness',
  severeEpigastricPain: 'Severe abdominal pain',
  newOnsetHeadache: 'New-onset headache',
  ruqPain: 'Right-upper abdominal pain',
  edema: 'New swelling',
};

interface Props {
  summary: SymptomLogSummary;
  onDismiss: () => void;
}

export default function SymptomLogCard({ summary, onDismiss }: Props) {
  const { t } = useLanguage();
  const label = SYMPTOM_LABELS[summary.symptom] ?? summary.symptom;
  const audio = summary.logged
    ? `Logged: ${label}. Your care team has been notified.`
    : summary.message;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="mx-auto w-full max-w-md rounded-2xl my-2 overflow-hidden"
      style={{
        backgroundColor: 'white',
        border: `1.5px solid ${summary.logged ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
        boxShadow: '0 4px 20px rgba(220,38,38,0.18)',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{
          backgroundColor: summary.logged ? 'var(--brand-alert-red-light)' : 'transparent',
          borderBottom: '1px solid var(--brand-border)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {summary.logged ? (
            <AlertTriangle
              className="w-5 h-5 shrink-0"
              style={{ color: 'var(--brand-alert-red)' }}
              aria-hidden="true"
            />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" aria-hidden="true" />
          )}
          <p
            className="font-bold text-[15px]"
            style={{ color: summary.logged ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)' }}
          >
            {summary.logged ? t('chat.card.symptomLogged') : t('chat.card.symptomFailed')}
          </p>
        </div>
        <AudioButton size="sm" text={audio} lang="en" />
      </div>

      <div className="px-5 py-4">
        <p
          className="text-[18px] font-bold"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {label}
        </p>
        {summary.notes && (
          <p
            className="text-[13px] mt-2 leading-relaxed"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            &ldquo;{summary.notes}&rdquo;
          </p>
        )}
        {summary.logged && (
          <div
            className="mt-3 rounded-xl px-3 py-2 flex items-start gap-2"
            style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
          >
            <AlertTriangle
              className="w-4 h-4 mt-0.5 shrink-0"
              style={{ color: 'var(--brand-warning-amber)' }}
              aria-hidden="true"
            />
            <p
              className="text-[12px] leading-snug"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('chat.card.symptomCareTeamNotified')}
            </p>
          </div>
        )}
        {!summary.logged && (
          <p
            className="text-[13px] mt-2"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {summary.message}
          </p>
        )}
      </div>

      <div
        className="px-5 py-4 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/dashboard"
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-alert-red-light)',
            color: 'var(--brand-alert-red)',
          }}
        >
          {t('chat.card.viewAlerts')}
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <button
          onClick={onDismiss}
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] text-white transition hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #DC2626, #EF4444)',
            boxShadow: '0 4px 14px rgba(220,38,38,0.28)',
          }}
        >
          {t('chat.card.done')}
        </button>
      </div>
    </motion.div>
  );
}
