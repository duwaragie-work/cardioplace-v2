'use client';

// C3 Tier 1 contraindication, C4 BP Level 1 High, C5 BP Level 1 Low.
// Single component with three visual variants keyed off `tier`. Renders
// the patient-facing copy from `alert.patientMessage` (falls back to a
// safe default per tier when the rule engine hasn't filled it yet).

import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Pill,
  Heart,
  CheckCircle2,
} from 'lucide-react';
import type { DeviationAlertDto, AlertTier } from '@/lib/services/journal.service';
import AudioButton from '@/components/intake/AudioButton';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  alert: DeviationAlertDto;
  acknowledging: boolean;
  onAcknowledge: () => void;
}

interface Variant {
  accent: string;          // border + accent color (CSS var or hex)
  accentLight: string;     // tinted background
  icon: React.ReactNode;
  title: string;
  defaultBody: string;
  footer: string;
  followUp: string;        // what happens next
}

/**
 * When the v2 rule engine hasn't classified this alert yet (`tier` is null —
 * row created by the v1 deviation service), derive a sensible v2 tier from
 * the legacy `type` + `severity` + the actual BP reading. Order matters:
 * critical thresholds first, then BP direction, then specific types.
 */
function deriveTier(alert: DeviationAlertDto): AlertTier {
  const sbp = alert.journalEntry?.systolicBP ?? 0;
  const dbp = alert.journalEntry?.diastolicBP ?? 0;
  const type = alert.type ?? '';
  const severity = alert.severity ?? '';

  // Critical BP — caller already routes this to EmergencyAlertScreen, but
  // keep the mapping for completeness in case it ever lands here.
  if (sbp >= 180 || dbp >= 120) return 'BP_LEVEL_2';
  // Low BP
  if ((sbp > 0 && sbp < 90) || (dbp > 0 && dbp < 60)) return 'BP_LEVEL_1_LOW';
  // High BP — either explicit BP type, or HIGH severity on any BP-flavored alert
  if (type.includes('BP') || severity === 'HIGH') return 'BP_LEVEL_1_HIGH';
  // Anything else (weight, medication adherence, …) — treat as informational
  return 'TIER_3_INFO';
}

function variantFor(tier: AlertTier | null | undefined): Variant {
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return {
        accent: 'var(--brand-alert-red)',
        accentLight: 'var(--brand-alert-red-light)',
        icon: <AlertTriangle className="w-7 h-7" strokeWidth={2.4} />,
        title: 'Critical blood pressure reading.',
        defaultBody:
          'This reading was in the emergency range. If you have chest pain, severe headache, difficulty breathing, or vision changes right now, call 911.',
        footer:
          'Your care team has been notified. Please don\'t change any medicine without talking to your doctor.',
        followUp:
          'Recheck your blood pressure in 15 minutes while sitting quietly. If it stays this high or you develop symptoms, call 911.',
      };
    case 'TIER_1_CONTRAINDICATION':
      return {
        accent: 'var(--brand-alert-red)',
        accentLight: 'var(--brand-alert-red-light)',
        icon: <Pill className="w-7 h-7" strokeWidth={2.2} />,
        title: 'Important medication alert.',
        defaultBody:
          'Your reported medications and conditions look like they need a closer look. Please don\'t stop or change any medicine without talking to your doctor.',
        footer:
          'Your care team has been notified and will contact you within the day. Please don\'t stop any medicine without talking to your doctor.',
        followUp:
          'A care-team member will reach out today. Keep taking your medicines as prescribed until you hear from them.',
      };
    case 'BP_LEVEL_1_HIGH':
      return {
        accent: 'var(--brand-warning-amber)',
        accentLight: 'var(--brand-warning-amber-light)',
        icon: <ArrowUp className="w-7 h-7" strokeWidth={2.5} />,
        title: 'Your blood pressure is elevated.',
        defaultBody:
          'Your latest reading is higher than your usual range. Sit quietly for 5 minutes and take it again.',
        footer: 'Your care team will review within 24 hours.',
        followUp:
          'Stay hydrated, avoid caffeine for the next few hours, and recheck before bed.',
      };
    case 'BP_LEVEL_1_LOW':
      return {
        accent: '#3B82F6',
        accentLight: '#DBEAFE',
        icon: <ArrowDown className="w-7 h-7" strokeWidth={2.5} />,
        title: 'Your blood pressure is low.',
        defaultBody:
          'Your latest reading is lower than your usual range. If you feel dizzy or lightheaded, sit down or lie down right away.',
        footer:
          'Your care team will review this. Stand up slowly and stay hydrated.',
        followUp:
          'If you feel faint, get to a safe seated position. Eat a small salty snack and drink water.',
      };
    case 'TIER_3_INFO':
      return {
        accent: 'var(--brand-success-green)',
        accentLight: 'var(--brand-success-green-light)',
        icon: <Heart className="w-7 h-7" strokeWidth={2.2} />,
        title: 'For your information.',
        defaultBody:
          'A small note from your care team about your most recent reading.',
        footer: 'No action needed right now.',
        followUp:
          'Keep up your regular check-ins. Your care team is watching.',
      };
    default:
      return {
        accent: 'var(--brand-text-muted)',
        accentLight: 'var(--brand-background)',
        icon: <AlertCircle className="w-7 h-7" strokeWidth={2.2} />,
        title: 'Care-team notice.',
        defaultBody: 'Your care team has noted this reading.',
        footer: 'They will follow up if anything needs attention.',
        followUp: 'Continue your regular check-ins.',
      };
  }
}

function formatBp(alert: DeviationAlertDto): string | null {
  const sys = alert.journalEntry?.systolicBP;
  const dia = alert.journalEntry?.diastolicBP;
  if (sys == null || dia == null) return null;
  return `${sys}/${dia} mmHg`;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export default function TierAlertView({ alert, acknowledging, onAcknowledge }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  // Use the rule engine's tier when present; otherwise derive one from the
  // legacy fields so v1 alerts still render meaningfully.
  const effectiveTier = alert.tier ?? deriveTier(alert);
  const v = variantFor(effectiveTier);
  const body = (alert.patientMessage?.trim() || v.defaultBody);
  const bp = formatBp(alert);
  const measuredAtLabel = alert.journalEntry?.measuredAt
    ? formatTime(alert.journalEntry.measuredAt)
    : formatTime(alert.createdAt);
  const isResolved = alert.status === 'ACKNOWLEDGED' || alert.status === 'RESOLVED';
  const audioText = `${v.title} ${body} ${v.footer}`;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 space-y-5">
        {/* Top: back to dashboard */}
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold cursor-pointer"
          style={{ color: 'var(--brand-text-secondary)' }}
        >
          <ArrowLeft className="w-4 h-4" /> {t('alerts.tier.back')}
        </button>

        {/* Banner */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25 }}
          className="rounded-2xl overflow-hidden"
          style={{
            backgroundColor: v.accentLight,
            border: `2px solid ${v.accent}`,
          }}
        >
          <div className="p-5 sm:p-6">
            <div className="flex items-start gap-4">
              <div
                className="shrink-0 rounded-2xl flex items-center justify-center"
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: v.accent,
                  color: 'white',
                }}
                aria-hidden
              >
                {v.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  {/* lang="en" + AudioButton lang="en-US": tier title/body/footer/followUp
                      are the English clinical fallbacks that mirror shared/alert-messages.ts.
                      Until Dr. Singal signs off per-locale, they stay English so screen
                      readers and TTS don't try to pronounce English as the page locale. */}
                  <h1
                    lang="en"
                    className="text-[20px] sm:text-[22px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
                  >
                    {v.title}
                  </h1>
                  <div className="shrink-0">
                    <AudioButton text={audioText} lang="en-US" />
                  </div>
                </div>

                {bp && (
                  <p className="text-[13px] mt-1" style={{ color: v.accent, fontWeight: 600 }}>
                    {bp}
                    <span className="opacity-80 font-medium" style={{ color: 'var(--brand-text-muted)' }}>
                      {' · '}
                      {measuredAtLabel}
                    </span>
                  </p>
                )}

                <p
                  lang="en"
                  className="text-[14.5px] sm:text-[15px] mt-3 leading-relaxed"
                  style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
                >
                  {body}
                </p>
              </div>
            </div>
          </div>

          {/* Footer message inside banner */}
          <div
            lang="en"
            className="px-5 sm:px-6 py-4 text-[13px] sm:text-[13.5px] leading-relaxed"
            style={{
              backgroundColor: 'rgba(255,255,255,0.6)',
              color: 'var(--brand-text-secondary)',
              borderTop: `1px solid ${v.accent}`,
            }}
          >
            {v.footer}
          </div>
        </motion.div>

        {/* What happens next */}
        <div
          className="rounded-2xl p-4 sm:p-5"
          style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
        >
          <p
            className="text-[12px] font-bold uppercase tracking-wider mb-1.5"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            {t('alerts.tier.whatNext')}
          </p>
          <p
            lang="en"
            className="text-[13.5px] leading-relaxed"
            style={{ color: 'var(--brand-text-secondary)', wordBreak: 'break-word' }}
          >
            {v.followUp}
          </p>
        </div>

        {/* Acknowledge / resolved state */}
        {isResolved ? (
          <div
            className="rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ backgroundColor: 'var(--brand-success-green-light)' }}
          >
            <CheckCircle2
              className="w-5 h-5 shrink-0"
              style={{ color: 'var(--brand-success-green)' }}
            />
            <p className="text-[13px]" style={{ color: 'var(--brand-success-green)' }}>
              {t('alerts.tier.seenResolved')}
            </p>
          </div>
        ) : (
          <motion.button
            type="button"
            onClick={onAcknowledge}
            disabled={acknowledging}
            className="w-full h-12 rounded-full text-white font-bold text-[14px] flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer transition"
            style={{
              backgroundColor: 'var(--brand-primary-purple)',
              boxShadow: 'var(--brand-shadow-button)',
            }}
            whileTap={{ scale: 0.98 }}
          >
            {acknowledging ? t('alerts.tier.saving') : t('alerts.tier.ackButton')}
          </motion.button>
        )}
      </div>
    </div>
  );
}
