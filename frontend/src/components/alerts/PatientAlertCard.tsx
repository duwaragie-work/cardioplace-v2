'use client';

// Patient-side AlertCard with admin-parity chrome. Consumes
// `getAlertPresentation({ tier, ruleId })` from ./alert-presentation so the
// per-rule overrides (currently RULE_HF_DECOMPENSATION → amber/Heart) flow
// through to every patient surface — the dashboard banner, the alert detail
// (TierAlertView), and the alerts list (this card). Before this card existed,
// the notifications-page alerts list keyed off a local TIER_META table that
// missed the rule-id overrides — HF-decomp was rendering as a blue low-BP
// card in the list even though the dashboard banner + detail page had been
// fixed.
//
// Admin parity (from `admin/src/components/AlertCard.tsx`):
//   • Tier label + icon driven by the helper (not a tier-only switch).
//   • Mode badge (Standard / Personalized).
//   • Severity chip color matches the helper's accent (one source of truth).
//   • Status chip (Open / Acknowledged / Resolved).
//   • Escalated + Reviewed-by-care-team badges.
//   • Acknowledge button gated by `dismissible !== false` (Tier 1 + BP L2
//     are non-dismissable per CLINICAL_SPEC §V2-C — the cron stops paging
//     providers once acknowledgedAt is set, so a patient tap must not silently
//     kill the ladder).
//   • Rule-id + timeAgo footer for support traceability.

import { motion } from 'framer-motion';
import Link from 'next/link';
import { CheckCircle2, Zap, Clock } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import { getAlertPresentation } from './alert-presentation';

type TFn = (key: TranslationKey) => string;

export interface PatientAlertCardAlert {
  id: string;
  tier?: string | null;
  ruleId?: string | null;
  type?: string | null;
  mode?: string | null;
  patientMessage?: string | null;
  severity?: string | null;
  magnitude?: number | null;
  baselineValue?: number | null;
  actualValue?: number | null;
  status?: string;
  escalated?: boolean;
  dismissible?: boolean;
  resolvedBy?: string | null;
  /** ISO timestamp; optional because Dashboard's local alert type carries it as
   *  optional. The timeAgo footer falls back to "—" when missing. */
  createdAt?: string;
  acknowledgedAt?: string | null;
  journalEntry?: {
    id?: string;
    /** Optional + nullable to mirror the wire DTO + the dashboard's local
     *  alert shape. The footer only renders when it's a real string. */
    measuredAt?: string | null;
    systolicBP?: number | null;
    diastolicBP?: number | null;
    weight?: number | null;
  } | null;
}

interface Props {
  alert: PatientAlertCardAlert;
  onAcknowledge: (id: string) => void;
  acknowledging: string | null;
  /** Compact variant for the dashboard recent-alerts strip — drops the body
   *  paragraph + the action button, keeps the chrome + reading + timeAgo. */
  compact?: boolean;
  /** Test-id prefix override so a list of cards can be addressed individually
   *  in tests. Defaults to `patient-alert-card`. */
  testIdPrefix?: string;
}

function formatTime(dt: Date): string {
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}`;
}

function formatAlertDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
}

function timeAgo(dateStr: string, t: TFn): string {
  // Mirrors the existing timeAgo() in notifications/page.tsx so the patient
  // sees the same "3h ago" / "2d ago" wording across both surfaces.
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('notifications.time.justNow');
    if (mins < 60) return t('notifications.time.minsAgo').replace('{mins}', String(mins));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('notifications.time.hrsAgo').replace('{hrs}', String(hrs));
    const days = Math.floor(hrs / 24);
    return t('notifications.time.daysAgo').replace('{days}', String(days));
  } catch {
    return '';
  }
}

export default function PatientAlertCard({
  alert,
  onAcknowledge,
  acknowledging,
  compact = false,
  testIdPrefix = 'patient-alert-card',
}: Props) {
  const { t } = useLanguage();
  const v = getAlertPresentation({
    tier: (alert.tier as Parameters<typeof getAlertPresentation>[0]['tier']) ?? null,
    ruleId: alert.ruleId ?? null,
  });
  const { Icon } = v;
  const isOpen = alert.status === 'OPEN';
  const canAck = isOpen && alert.dismissible !== false;
  const isAcking = acknowledging === alert.id;
  const isBpAlert =
    alert.type === 'BP_COMBINED' ||
    (alert.type ?? '').includes('BP') ||
    (alert.tier ?? '').includes('BP_LEVEL');

  return (
    <motion.div
      layout
      data-testid={`${testIdPrefix}-${alert.id}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${v.accent}`,
        backgroundColor: 'white',
        boxShadow: `0 2px 16px ${v.accentLight}`,
      }}
    >
      {/* Top accent strip — gives each card a clear visual rail keyed on the
          helper's accent (so HF-decomp gets the amber rail, not the blue one). */}
      <div className="h-1 w-full" style={{ backgroundColor: v.accent, opacity: 0.7 }} />

      <div className={compact ? 'p-3' : 'p-4'}>
        <div className="flex items-start gap-3">
          {/* Helper-driven icon. The Icon component renders SVG with
              currentColor stroke, so we color it via the wrapper div's
              `color` style — that's how TierAlertView + the dashboard banner
              consume the helper too. */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: v.accentLight, color: v.accent }}
          >
            <Icon className="w-5 h-5" />
          </div>

          <div className="flex-1 min-w-0">
            {/* Tier label + mode badge + escalated + reviewed badges */}
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                data-testid={`${testIdPrefix}-title-${alert.id}`}
                lang="en"
                className="text-[14px] font-bold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {v.title.replace(/\.$/, '')}
              </span>

              {/* Severity-chip color follows the helper's accent so the chip
                  always matches the rail/icon (was previously a separate
                  TIER_META → SEVERITY_META mapping that could drift). */}
              <span
                data-testid={`${testIdPrefix}-severity-${alert.id}`}
                className="px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0"
                style={{ backgroundColor: v.accentLight, color: v.accentText }}
              >
                {v.key === 'emergency'
                  ? t('alert.urgent')
                  : v.key === 'tier1'
                    ? t('alert.urgent')
                    : v.key === 'attention'
                      ? t('alert.moderate')
                      : v.key === 'high' || v.key === 'low'
                        ? t('alert.moderate')
                        : t('alert.low')}
              </span>

              {/* Mode badge — admin parity. STANDARD vs PERSONALIZED tells the
                  patient (and a support agent reading their screen) which
                  threshold set fired the alert. */}
              {alert.mode && (
                <span
                  data-testid={`${testIdPrefix}-mode-${alert.id}`}
                  title="Thresholds this alert was evaluated against"
                  className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0"
                  style={{
                    backgroundColor: 'var(--brand-surface-muted, #f1f5f9)',
                    color: 'var(--brand-text-secondary)',
                  }}
                >
                  {alert.mode === 'PERSONALIZED' ? 'Personalized' : 'Standard'}
                </span>
              )}

              {alert.escalated && (
                <span
                  data-testid={`${testIdPrefix}-escalated-${alert.id}`}
                  className="px-2 py-0.5 rounded-full text-[11px] font-bold text-white shrink-0 flex items-center gap-1"
                  style={{ backgroundColor: 'var(--brand-alert-red)' }}
                >
                  <Zap className="w-3 h-3" />
                  {t('notifications.escalated')}
                </span>
              )}

              {alert.resolvedBy && (
                <span
                  data-testid={`${testIdPrefix}-reviewed-${alert.id}`}
                  className="px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0 flex items-center gap-1"
                  style={{
                    backgroundColor: 'var(--brand-success-green-light)',
                    color: 'var(--brand-success-green)',
                  }}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  {t('alerts.reviewedByCareTeam')}
                </span>
              )}
            </div>

            {/* Patient message — verbatim from the rule engine. Suppressed on
                the compact dashboard variant so the strip stays scannable. */}
            {!compact && alert.patientMessage && (
              <p
                data-testid={`${testIdPrefix}-message-${alert.id}`}
                className="text-[12.5px] mb-1 leading-relaxed"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {alert.patientMessage}
              </p>
            )}

            {/* BP reading row */}
            {alert.journalEntry && isBpAlert && (
              <p
                data-testid={`${testIdPrefix}-reading-${alert.id}`}
                className="text-[12px] mb-1"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('alert.recorded')}{' '}
                <span className="font-semibold" style={{ color: v.accentText }}>
                  {alert.journalEntry.systolicBP ?? '—'}/{alert.journalEntry.diastolicBP ?? '—'} mmHg
                </span>
              </p>
            )}

            {/* Measured-at + rule-id footer (admin parity). The rule id is
                muted but visible — useful for support to triage exactly which
                engine rule fired. */}
            {alert.journalEntry?.measuredAt && (
              <p
                data-testid={`${testIdPrefix}-date-${alert.id}`}
                className="text-[11px] inline-flex items-center gap-1.5"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                <Clock className="w-3 h-3" />
                {formatAlertDate(alert.journalEntry.measuredAt)}{' '}
                <span className="font-semibold">{formatTime(new Date(alert.journalEntry.measuredAt))}</span>
                {alert.ruleId && (
                  <span className="opacity-70"> · {alert.ruleId}</span>
                )}
              </p>
            )}

            {!alert.journalEntry?.measuredAt && alert.createdAt && (
              <p
                data-testid={`${testIdPrefix}-date-${alert.id}`}
                className="text-[11px] inline-flex items-center gap-1.5"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                <Clock className="w-3 h-3" />
                {timeAgo(alert.createdAt, t)}
                {alert.ruleId && <span className="opacity-70"> · {alert.ruleId}</span>}
              </p>
            )}
          </div>

          {/* Resolved/Acknowledged status badge */}
          {!isOpen && (
            <div
              data-testid={`${testIdPrefix}-status-${alert.id}`}
              className="shrink-0 flex items-center gap-1"
              style={{ color: '#16A34A' }}
            >
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-[11px] font-semibold">{t('notifications.done')}</span>
            </div>
          )}
        </div>

        {/* Action row — only on the full (non-compact) card. */}
        {!compact && (
          <div className="mt-3 flex items-center gap-2">
            {canAck && (
              <motion.button
                data-testid={`${testIdPrefix}-ack-${alert.id}`}
                onClick={() => onAcknowledge(alert.id)}
                disabled={isAcking}
                className="flex-1 h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 text-white transition disabled:opacity-60 cursor-pointer"
                style={{ backgroundColor: v.accent }}
              >
                {isAcking ? t('notifications.acknowledging') : t('notifications.acknowledge')}
              </motion.button>
            )}
            <Link
              data-testid={`${testIdPrefix}-detail-${alert.id}`}
              href={`/alerts/${alert.id}`}
              aria-label={t('notifications.viewDetailsAria')}
              className="flex-1 h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition cursor-pointer"
              style={{
                backgroundColor: 'white',
                color: v.accentText,
                border: `1.5px solid ${v.accent}`,
              }}
            >
              {t('notifications.viewDetails')}
            </Link>
          </div>
        )}
      </div>
    </motion.div>
  );
}
