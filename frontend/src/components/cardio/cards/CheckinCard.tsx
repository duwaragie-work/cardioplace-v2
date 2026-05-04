'use client';

// Phase/27 chatbot v2 — rich check-in result card.
//
// Bigger than the v1 2x2 grid: shows BP big-number with status pill,
// pulse + position icons, weight + BMI row, structured symptom badges,
// optional alert tier banner, and an audio button reading the saved
// summary aloud (reuses humanizeReading() prose style).

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
import type { CheckinSummary } from '@/hooks/useVoiceSession';

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
  summary: CheckinSummary;
  onDismiss: () => void;
}

export default function CheckinCard({ summary, onDismiss }: Props) {
  const { t } = useLanguage();
  const status = bpStatus(summary.systolicBP, summary.diastolicBP);
  const flaggedSymptoms = summary.structuredSymptoms
    ? Object.entries(summary.structuredSymptoms)
        .filter(([, v]) => v === true)
        .map(([k]) => STRUCTURED_SYMPTOM_LABELS[k] ?? k)
    : [];
  const measuredAtLabel = summary.measuredAt
    ? new Date(summary.measuredAt).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : null;
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
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {summary.saved ? (
            <CheckCircle
              className="w-5 h-5 shrink-0"
              style={{ color: 'var(--brand-success-green)' }}
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
              {summary.saved ? t('chat.card.checkinSaved') : t('chat.card.checkinFailed')}
            </p>
            {measuredAtLabel && (
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                {measuredAtLabel}
              </p>
            )}
          </div>
        </div>
        <AudioButton size="sm" text={audioText} lang="en" />
      </div>

      {/* BP big-number row */}
      {summary.systolicBP != null && summary.diastolicBP != null && (
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-baseline gap-1">
              <span
                lang="en"
                className="text-[42px] font-bold leading-none"
                style={{ color: status.color }}
              >
                {summary.systolicBP}
              </span>
              <span
                className="text-[28px] font-light"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                /
              </span>
              <span
                lang="en"
                className="text-[42px] font-bold leading-none"
                style={{ color: status.color }}
              >
                {summary.diastolicBP}
              </span>
              <span
                className="text-[12px] ml-1"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                mmHg
              </span>
            </div>
            <span
              className="px-3 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider"
              style={{ backgroundColor: status.pillBg, color: status.color }}
            >
              {status.label}
            </span>
          </div>
          {/* Pulse + position chips */}
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
              <span
                className="text-[12px]"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                · {positionLabel}
              </span>
            )}
            {summary.pulsePressureWide && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-accent-teal-light)',
                  color: 'var(--brand-accent-teal)',
                }}
                title="Pulse pressure (SBP − DBP) is wider than 60 mmHg — physician note only"
              >
                Wide pulse pressure
              </span>
            )}
          </div>
        </div>
      )}

      {/* Alert tier banner — only when a rule fired */}
      {summary.alert && (
        <div
          className="mx-5 mt-3 rounded-xl px-3 py-2 flex items-start gap-2"
          style={{
            backgroundColor: alertTierBg(summary.alert.tier),
            border: `1px solid ${alertTierBorder(summary.alert.tier)}`,
          }}
        >
          <AlertTriangle
            className="w-4 h-4 mt-0.5 shrink-0"
            style={{ color: alertTierBorder(summary.alert.tier) }}
            aria-hidden="true"
          />
          <p
            className="text-[12px] leading-snug"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {summary.alert.patientMessage ?? alertTierFallback(summary.alert.tier)}
          </p>
        </div>
      )}

      {/* Weight + BMI row */}
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

      {/* Medications row */}
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
            color: medicationColor(summary),
          }}
        >
          {medicationLabel(summary)}
        </p>
      </div>

      {/* Symptoms row */}
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
        {flaggedSymptoms.length === 0 &&
        (!summary.otherSymptoms || summary.otherSymptoms.length === 0) ? (
          <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
            No symptoms reported
          </p>
        ) : (
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
        )}
      </div>

      {/* Action row */}
      <div
        className="px-5 py-4 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/readings"
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light)',
            color: 'var(--brand-primary-purple)',
          }}
        >
          {t('chat.card.viewOnReadings')}
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <button
          onClick={onDismiss}
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] text-white transition hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            boxShadow: '0 4px 14px rgba(123,0,224,0.28)',
          }}
        >
          {t('chat.card.dismiss')}
        </button>
      </div>
    </motion.div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function bpStatus(
  sbp: number | undefined,
  dbp: number | undefined,
): { label: string; color: string; pillBg: string } {
  if (sbp == null || dbp == null) {
    return {
      label: 'Logged',
      color: 'var(--brand-text-primary)',
      pillBg: 'var(--brand-background)',
    };
  }
  // Patient-facing language only — actual rule classification happens
  // server-side. This pill is a quick visual cue; the real verdict is the
  // alert banner.
  if (sbp >= 180 || dbp >= 120) {
    return {
      label: 'Critical',
      color: 'var(--brand-alert-red)',
      pillBg: 'var(--brand-alert-red-light)',
    };
  }
  if (sbp >= 140 || dbp >= 90) {
    return {
      label: 'Elevated',
      color: 'var(--brand-warning-amber)',
      pillBg: 'var(--brand-warning-amber-light)',
    };
  }
  if (sbp < 90 || dbp < 60) {
    return {
      label: 'Low',
      color: 'var(--brand-warning-amber)',
      pillBg: 'var(--brand-warning-amber-light)',
    };
  }
  return {
    label: 'Within target',
    color: 'var(--brand-success-green)',
    pillBg: 'var(--brand-success-green-light)',
  };
}

function medicationLabel(s: CheckinSummary): string {
  if (s.medicationScheduledLater) return 'Scheduled for later — not due yet';
  if (s.medicationTaken === true) return 'All taken ✓';
  if (s.medicationTaken === false) return 'Missed — care team has been notified';
  return 'Not reported';
}

function medicationColor(s: CheckinSummary): string {
  if (s.medicationScheduledLater) return 'var(--brand-warning-amber)';
  if (s.medicationTaken === true) return 'var(--brand-success-green)';
  if (s.medicationTaken === false) return 'var(--brand-alert-red)';
  return 'var(--brand-text-muted)';
}

function alertTierBg(tier: string): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE' || tier === 'TIER_1_CONTRAINDICATION') {
    return 'var(--brand-alert-red-light)';
  }
  if (tier === 'BP_LEVEL_1_HIGH' || tier === 'BP_LEVEL_1_LOW') {
    return 'var(--brand-warning-amber-light)';
  }
  return 'var(--brand-accent-teal-light)';
}

function alertTierBorder(tier: string): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE' || tier === 'TIER_1_CONTRAINDICATION') {
    return 'var(--brand-alert-red)';
  }
  if (tier === 'BP_LEVEL_1_HIGH' || tier === 'BP_LEVEL_1_LOW') {
    return 'var(--brand-warning-amber)';
  }
  return 'var(--brand-accent-teal)';
}

function alertTierFallback(tier: string): string {
  // Fallback when alert.patientMessage is missing — clinical-spec-aligned
  // patient-facing phrasing per shared/alert-messages.ts conventions.
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return 'Your reading is in the urgent range. If you have severe symptoms, call 911 now. Otherwise contact your care team today.';
    case 'TIER_1_CONTRAINDICATION':
      return 'Your care team needs to review this — please contact them today before your next dose.';
    case 'BP_LEVEL_1_HIGH':
      return 'Your reading is higher than your goal. Your care team will review.';
    case 'BP_LEVEL_1_LOW':
      return 'Your reading is lower than your goal. Your care team will review.';
    default:
      return 'Your care team will see this reading.';
  }
}

function buildAudio(s: CheckinSummary): string {
  const parts: string[] = [];
  if (s.saved) {
    parts.push('Reading saved.');
  } else {
    parts.push('Could not save your reading.');
  }
  if (s.systolicBP != null && s.diastolicBP != null) {
    let bp = `Your blood pressure was ${s.systolicBP} over ${s.diastolicBP}`;
    if (s.pulse != null) bp += `, with a pulse of ${s.pulse}`;
    bp += '.';
    parts.push(bp);
  }
  if (s.medicationScheduledLater) parts.push('Medication scheduled for later.');
  else if (s.medicationTaken === true) parts.push('You took your medications.');
  else if (s.medicationTaken === false) parts.push('You missed at least one medication.');
  const flagged =
    s.structuredSymptoms &&
    Object.entries(s.structuredSymptoms).some(([, v]) => v === true);
  if (flagged) {
    parts.push('You reported symptoms — your care team has been notified.');
  } else {
    parts.push('You reported no symptoms.');
  }
  return parts.join(' ');
}
