'use client';

// Phase/27 chatbot v2 — rich update result card. Same shape as CheckinCard
// but the header reads "Reading updated" and the action button is teal-themed.
// Reuses the same body (BP big-number, pulse/position, alert banner, etc.)
// by adapting the UpdateSummary into a CheckinSummary-shaped payload.

import { motion } from 'framer-motion';
import {
  CheckCircle,
  AlertCircle,
  Heart,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';
import type { UpdateSummary } from '@/hooks/useVoiceSession';

const STRUCTURED_SYMPTOM_LABELS: Record<string, string> = {
  severeHeadache: 'Severe headache',
  visualChanges: 'Visual changes',
  alteredMentalStatus: 'Altered mental status',
  chestPainOrDyspnea: 'Chest pain or dyspnea',
  focalNeuroDeficit: 'Focal neuro deficit',
  severeEpigastricPain: 'Severe epigastric pain',
  newOnsetHeadache: 'New-onset headache',
  ruqPain: 'RUQ pain',
  edema: 'Edema',
};

interface Props {
  summary: UpdateSummary;
  onDismiss: () => void;
}

export default function UpdateCard({ summary, onDismiss }: Props) {
  const { t } = useLanguage();
  const flaggedSymptoms = summary.structuredSymptoms
    ? Object.entries(summary.structuredSymptoms)
        .filter(([, v]) => v === true)
        .map(([k]) => STRUCTURED_SYMPTOM_LABELS[k] ?? k)
    : [];
  const positionLabel = summary.position
    ? summary.position === 'SITTING'
      ? 'Sitting'
      : summary.position === 'STANDING'
        ? 'Standing'
        : 'Lying down'
    : null;
  const audioText = buildAudio(summary);

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
          {summary.updated ? (
            <CheckCircle
              className="w-5 h-5 shrink-0"
              style={{ color: 'var(--brand-accent-teal)' }}
              aria-hidden="true"
            />
          ) : (
            <AlertCircle className="w-5 h-5 text-red-500 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0">
            <p
              className="font-bold text-[15px] leading-tight"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {summary.updated ? t('chat.card.updated') : t('chat.card.updateFailed')}
            </p>
            {summary.entryDate && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                {new Date(summary.entryDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </p>
            )}
          </div>
        </div>
        <AudioButton size="sm" text={audioText} lang="en" />
      </div>

      {summary.systolicBP != null && summary.diastolicBP != null && (
        <div className="px-5 pt-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-baseline gap-1">
              <span
                lang="en"
                className="text-[36px] font-bold leading-none"
                style={{ color: 'var(--brand-accent-teal)' }}
              >
                {summary.systolicBP}
              </span>
              <span className="text-[24px] font-light" style={{ color: 'var(--brand-text-muted)' }}>
                /
              </span>
              <span
                lang="en"
                className="text-[36px] font-bold leading-none"
                style={{ color: 'var(--brand-accent-teal)' }}
              >
                {summary.diastolicBP}
              </span>
              <span className="text-[12px] ml-1" style={{ color: 'var(--brand-text-muted)' }}>
                mmHg
              </span>
            </div>
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            {summary.pulse != null && (
              <span
                className="inline-flex items-center gap-1 text-[12px]"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                <Heart className="w-3.5 h-3.5" aria-hidden="true" />
                <span lang="en">{summary.pulse} bpm</span>
              </span>
            )}
            {positionLabel && (
              <span className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                · {positionLabel}
              </span>
            )}
          </div>
        </div>
      )}

      {summary.alert && (
        <div
          className="mx-5 mt-3 rounded-xl px-3 py-2 flex items-start gap-2"
          style={{
            backgroundColor: 'var(--brand-warning-amber-light)',
            border: '1px solid var(--brand-warning-amber)',
          }}
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
            {summary.alert.patientMessage ?? 'Your care team will see this update.'}
          </p>
        </div>
      )}

      {(summary.weight != null || summary.bmi != null) && (
        <div
          className="px-5 py-3 flex items-center gap-6"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          {summary.weight != null && (
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                Weight
              </p>
              <p
                lang="en"
                className="text-[16px] font-bold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {summary.weight} <span className="text-[11px] font-normal">lbs</span>
              </p>
            </div>
          )}
          {summary.bmi != null && (
            <div>
              <p
                className="text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                BMI
              </p>
              <p
                lang="en"
                className="text-[16px] font-bold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {summary.bmi.toFixed(1)}
              </p>
            </div>
          )}
        </div>
      )}

      <div
        className="px-5 py-3"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <p
          className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          Medications
        </p>
        <p
          className="text-[13px] font-medium"
          style={{
            color: medicationColor(summary.medicationTaken, summary.medicationScheduledLater),
          }}
        >
          {medicationLabel(summary.medicationTaken, summary.medicationScheduledLater)}
        </p>
      </div>

      {(flaggedSymptoms.length > 0 ||
        (summary.otherSymptoms && summary.otherSymptoms.length > 0)) && (
        <div
          className="px-5 py-3"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <p
            className="text-[10px] font-semibold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            Symptoms
          </p>
          <div className="flex flex-wrap gap-1.5">
            {flaggedSymptoms.map((s) => (
              <span
                key={s}
                className="text-[11px] px-2 py-1 rounded-md font-semibold inline-flex items-center gap-1"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red)',
                }}
              >
                <AlertTriangle className="w-3 h-3" aria-hidden="true" />
                {s}
              </span>
            ))}
            {(summary.otherSymptoms ?? []).map((s, i) => (
              <span
                key={`other-${i}`}
                className="text-[11px] px-2 py-1 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  color: 'var(--brand-warning-amber)',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      <div
        className="px-5 py-4 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/readings"
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-accent-teal-light)',
            color: 'var(--brand-accent-teal)',
          }}
        >
          {t('chat.card.viewOnReadings')}
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <button
          onClick={onDismiss}
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] text-white transition hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #0D9488, #14B8A6)',
            boxShadow: '0 4px 14px rgba(13,148,136,0.28)',
          }}
        >
          {t('chat.card.done')}
        </button>
      </div>
    </motion.div>
  );
}

function medicationLabel(taken?: boolean, scheduled?: boolean): string {
  if (scheduled) return 'Scheduled for later — not due yet';
  if (taken === true) return 'All taken ✓';
  if (taken === false) return 'Missed — care team has been notified';
  return 'Not changed';
}

function medicationColor(taken?: boolean, scheduled?: boolean): string {
  if (scheduled) return 'var(--brand-warning-amber)';
  if (taken === true) return 'var(--brand-success-green)';
  if (taken === false) return 'var(--brand-alert-red)';
  return 'var(--brand-text-muted)';
}

function buildAudio(s: UpdateSummary): string {
  const parts: string[] = []
  parts.push(s.updated ? 'Reading updated.' : 'Could not update reading.')
  if (s.systolicBP != null && s.diastolicBP != null) {
    let bp = `Your blood pressure is now ${s.systolicBP} over ${s.diastolicBP}`
    if (s.pulse != null) bp += `, with a pulse of ${s.pulse}`
    bp += '.'
    parts.push(bp)
  }
  if (s.medicationScheduledLater) parts.push('Medication scheduled for later.')
  else if (s.medicationTaken === true) parts.push('You took your medications.')
  else if (s.medicationTaken === false) parts.push('You missed at least one medication.')
  return parts.join(' ')
}
