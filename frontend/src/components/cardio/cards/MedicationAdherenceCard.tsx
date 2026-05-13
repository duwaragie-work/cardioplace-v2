'use client';

// Phase/27 chatbot v2 — medication adherence quick-log card.
// Shown after the bot calls log_medication_adherence successfully. Big drug
// name + class + status badge + optional streak counter + audio summary.

import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Pill, Clock, Flame } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';
import type { MedicationAdherenceSummary } from '@/hooks/useVoiceSession';

interface Props {
  summary: MedicationAdherenceSummary;
  onDismiss: () => void;
}

export default function MedicationAdherenceCard({ summary, onDismiss }: Props) {
  const { t } = useLanguage();
  const statusInfo = statusFor(summary.status);

  const audio = (() => {
    if (!summary.logged) return summary.message
    const drug = summary.medication?.drugName ?? 'your medication'
    if (summary.status === 'taken') return `Logged: ${drug} taken.`
    if (summary.status === 'missed') return `Logged: ${drug} missed. Your care team will see this.`
    return `Noted: ${drug} is not due yet.`
  })()

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="mx-auto w-full max-w-md rounded-2xl my-2 overflow-hidden"
      style={{
        backgroundColor: 'white',
        border: '1.5px solid var(--brand-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.09)',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {summary.logged ? (
            <CheckCircle
              className="w-5 h-5 shrink-0"
              style={{ color: 'var(--brand-success-green)' }}
              aria-hidden="true"
            />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" aria-hidden="true" />
          )}
          <p
            className="font-bold text-[15px]"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {summary.logged ? t('chat.card.medLogged') : t('chat.card.medFailed')}
          </p>
        </div>
        <AudioButton size="sm" text={audio} lang="en" />
      </div>

      <div className="px-5 py-4">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
          >
            <Pill
              className="w-6 h-6"
              style={{ color: 'var(--brand-primary-purple)' }}
              aria-hidden="true"
            />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-[16px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {summary.medication?.drugName ?? 'Medication'}
            </p>
            {summary.medication?.drugClass && (
              <p
                className="text-[11px] uppercase tracking-wider mt-0.5"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {summary.medication.drugClass.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
          </div>
          <span
            className="px-3 py-1.5 rounded-full text-[11px] font-bold uppercase tracking-wider inline-flex items-center gap-1 shrink-0"
            style={{ backgroundColor: statusInfo.pillBg, color: statusInfo.color }}
          >
            {statusInfo.icon}
            {statusInfo.label}
          </span>
        </div>

        {summary.streakDays != null && summary.streakDays > 0 && (
          <div
            className="mt-3 flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
          >
            <Flame
              className="w-4 h-4"
              style={{ color: 'var(--brand-warning-amber-text)' }}
              aria-hidden="true"
            />
            <p
              className="text-[12px] font-semibold"
              style={{ color: 'var(--brand-warning-amber-text)' }}
            >
              {summary.streakDays}-day streak — keep it up!
            </p>
          </div>
        )}

        {!summary.logged && (
          <p
            className="text-[12px] mt-3"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {summary.message}
          </p>
        )}
      </div>

      <div
        className="px-5 py-3 flex items-center justify-end"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <button
          onClick={onDismiss}
          className="h-11 px-5 rounded-xl font-semibold text-[13px] text-white transition hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            boxShadow: '0 4px 14px rgba(123,0,224,0.28)',
          }}
        >
          {t('chat.card.done')}
        </button>
      </div>
    </motion.div>
  );
}

function statusFor(s: 'taken' | 'missed' | 'scheduled_later'): {
  label: string;
  color: string;
  pillBg: string;
  icon: React.ReactNode;
} {
  if (s === 'taken') {
    return {
      label: 'Taken',
      color: 'var(--brand-success-green)',
      pillBg: 'var(--brand-success-green-light)',
      icon: <CheckCircle className="w-3 h-3" aria-hidden="true" />,
    };
  }
  if (s === 'missed') {
    return {
      label: 'Missed',
      color: 'var(--brand-alert-red-text)',
      pillBg: 'var(--brand-alert-red-light)',
      icon: <AlertCircle className="w-3 h-3" aria-hidden="true" />,
    };
  }
  return {
    label: 'Not due yet',
    color: 'var(--brand-warning-amber-text)',
    pillBg: 'var(--brand-warning-amber-light)',
    icon: <Clock className="w-3 h-3" aria-hidden="true" />,
  };
}
