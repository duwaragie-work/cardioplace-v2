'use client';

// Shared expandable alert card. Used in two places:
//
//   • patient-detail/AlertsTab — the per-patient Alerts tab. Row click
//     toggles expand; chevron mirrors that. No patient name in the row
//     (the parent is patient-scoped).
//   • NotificationsScreen — /admin/notifications full-page queue. Row
//     click navigates to the patient profile; chevron expands inline.
//     Patient name + initials show in the row.
//
// Extracted from AlertsTab.tsx so the V2-C Layer 1 spec — inline three-tier
// messages + escalation timeline + Resolve / Acknowledge — applies to both
// surfaces from one source of truth (no diverging copies).
//
// Action buttons (Resolve, Acknowledge) and the chevron all stopPropagation
// so they never trigger the row-body click handler. That keeps row-as-nav
// (NotificationsScreen) safe alongside row-as-toggle (AlertsTab).

import {
  Activity,
  AlertTriangle,
  ArrowUp,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock as ClockIcon,
  Loader2,
  Pill,
  ShieldAlert,
  Stethoscope,
  User as UserIcon,
  Users,
} from 'lucide-react';
import EscalationAuditTrail from './patient-detail/EscalationAuditTrail';
import {
  resolutionTierFor,
} from '@/lib/services/provider.service';
import { useAuth } from '@/lib/auth-context';
import { canResolveAlerts } from '@/lib/roleGates';
import type {
  PatientAlert,
} from '@/lib/services/patient-detail.service';

type TierBucket = 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3' | 'OTHER';

function tierBucket(t: string | null): TierBucket {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  // Cluster 8 — angioedema shares the Tier 1 chrome (red banner, audit
  // footer, resolution catalog) per Manisha "resolved like all Tier 1
  // alerts". Bespoke airway visuals are a post-pilot follow-up.
  if (t === 'TIER_1_CONTRAINDICATION' || t === 'TIER_1_ANGIOEDEMA') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (t === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

function bucketChrome(b: TierBucket) {
  switch (b) {
    case 'BP_L2':
      return { label: 'BP Level 2', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)', icon: <ShieldAlert className="w-3 h-3" /> };
    case 'TIER_1':
      return { label: 'Tier 1', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)', icon: <Pill className="w-3 h-3" /> };
    case 'TIER_2':
      return { label: 'Tier 2', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)', icon: <ArrowUp className="w-3 h-3" /> };
    case 'BP_L1':
      return { label: 'BP Level 1', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)', icon: <Activity className="w-3 h-3" /> };
    case 'TIER_3':
      return { label: 'Tier 3', color: 'var(--brand-accent-teal)', bg: 'var(--brand-accent-teal-light)', icon: <Bell className="w-3 h-3" /> };
    default:
      return { label: 'Other', color: 'var(--brand-text-muted)', bg: 'var(--brand-background)', icon: <AlertTriangle className="w-3 h-3" /> };
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

interface Props {
  alert: PatientAlert;
  expanded: boolean;
  /** Fires when the row body is clicked. AlertsTab passes the toggle-expand
   *  callback so the whole row stays clickable; NotificationsScreen passes
   *  a navigation callback so clicking the row jumps to the patient
   *  profile. */
  onRowClick: () => void;
  /** Fires when the chevron is clicked. Always toggles expand. On AlertsTab
   *  this is the same handler as onRowClick; on NotificationsScreen this
   *  is the only way to expand (row click navigates instead). */
  onToggleExpand: () => void;
  /** Resolve handler — opens AlertResolutionModal. Only rendered for tiers
   *  whose resolution catalog group is non-null (T1 / T2 / BP_L2) AND
   *  status === 'OPEN'. */
  onResolve: () => void;
  /** Acknowledge handler — only rendered for BP L1 (BP_LEVEL_1_HIGH /
   *  BP_LEVEL_1_LOW) with status === 'OPEN' and acknowledgedAt === null.
   *  Stops escalation ladder advancement (cron checks acknowledgedAt). */
  onAcknowledge: () => void;
  /** True while the acknowledge request is in flight — disables the button
   *  to prevent double-submit. */
  ackInFlight?: boolean;
  /** Patient name shown in the row. Pass null/undefined on AlertsTab where
   *  the parent shell already shows the patient. NotificationsScreen
   *  passes the resolved patient.name. */
  patientName?: string | null;
  /** Optional follow-up call indicator — surfaces a "Call scheduled" pill
   *  when the alert has a linked ScheduledCall. Sourced from the provider-
   *  wide endpoint's followUpScheduledAt. */
  followUpScheduledAt?: string | null;
  /** PatientProfile.heightCm — used by the 15-field audit footer in
   *  EscalationAuditTrail to compute BMI from the alert's reading weight. */
  heightCm?: number | null;
  /** When true the row body uses cursor-pointer + button semantics. Both
   *  surfaces want this — tab uses it for expand, notifications for nav. */
  rowClickable?: boolean;
}

export default function AlertCard({
  alert,
  expanded,
  onRowClick,
  onToggleExpand,
  onResolve,
  onAcknowledge,
  ackInFlight,
  patientName,
  followUpScheduledAt,
  heightCm,
  rowClickable = true,
}: Props) {
  const { user } = useAuth();
  // May 2026 access-scope — HEALPLACE_OPS sees the alert row + audit trail
  // (they receive the T+24h / T+48h notification and need context for
  // operational follow-up) but cannot close it. Hide both write buttons.
  // Backend rejects with 403 either way; this just keeps the UI honest.
  const canResolve = canResolveAlerts(user);
  const bucket = tierBucket(alert.tier);
  const chrome = bucketChrome(bucket);
  const isResolvable = resolutionTierFor(alert.tier) != null;
  const showResolve = alert.status === 'OPEN' && isResolvable && canResolve;
  const showAcknowledge =
    alert.status === 'OPEN' && bucket === 'BP_L1' && alert.acknowledgedAt == null && canResolve;

  return (
    <div>
      {/* Row */}
      <div
        data-testid={`admin-alert-row-${alert.id}`}
        role={rowClickable ? 'button' : undefined}
        tabIndex={rowClickable ? 0 : undefined}
        onClick={rowClickable ? onRowClick : undefined}
        onKeyDown={
          rowClickable
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick();
                }
              }
            : undefined
        }
        className={`w-full text-left px-4 md:px-5 py-3 flex items-center gap-3 transition-colors ${rowClickable ? 'hover:bg-gray-50 cursor-pointer' : ''}`}
      >
        {/* Avatar / icon — initials when patient name is provided
            (NotificationsScreen), tier icon otherwise (AlertsTab). */}
        {patientName ? (
          <div
            className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[10.5px]"
            style={{ backgroundColor: chrome.color }}
            aria-hidden
          >
            {initialsOf(patientName)}
          </div>
        ) : (
          <div
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white"
            style={{ backgroundColor: chrome.color }}
            aria-hidden
          >
            {chrome.icon}
          </div>
        )}

        <div className="flex-1 min-w-0">
          {/* Header line — tier badge + patient name (when present) +
              status pills. */}
          <div className="flex items-center flex-wrap gap-2">
            {patientName && (
              <span
                className="text-[13px] font-bold truncate"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {patientName}
              </span>
            )}
            <span
              data-testid={`admin-alert-tier-badge-${alert.id}`}
              className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{ backgroundColor: chrome.bg, color: chrome.color }}
            >
              {chrome.icon}
              {chrome.label}
            </span>
            {/* Mode badge — which threshold set this alert was evaluated
                against (STANDARD AHA vs PERSONALIZED provider targets). Was
                only visible in the expanded audit trail; surface it on the row
                so a clinician scanning the list can tell at a glance. */}
            {alert.mode && (
              <span
                data-testid={`admin-alert-mode-badge-${alert.id}`}
                title="Thresholds this alert was evaluated against"
                className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-surface-muted, #f1f5f9)', color: 'var(--brand-text-secondary)' }}
              >
                {alert.mode === 'PERSONALIZED' ? 'Personalized' : 'Standard'}
              </span>
            )}
            {alert.status === 'RESOLVED' && (
              <span
                data-testid={`admin-alert-status-badge-${alert.id}`}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
              >
                <CheckCircle2 className="w-2.5 h-2.5" />
                Resolved
              </span>
            )}
            {alert.status === 'ACKNOWLEDGED' && (
              <span
                data-testid={`admin-alert-status-badge-${alert.id}`}
                className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)' }}
              >
                <Check className="w-2.5 h-2.5" />
                Acknowledged
              </span>
            )}
            {alert.escalated && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
              >
                Escalated
              </span>
            )}
            {followUpScheduledAt && (
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}
              >
                Call scheduled
              </span>
            )}
          </div>

          {/* Message + reading line */}
          <p
            className="text-[12.5px] mt-0.5 line-clamp-1"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {alert.patientMessage ?? alert.type ?? 'Alert'}
            {alert.journalEntry?.systolicBP != null && alert.journalEntry?.diastolicBP != null && (
              <>
                <span className="ml-2 font-bold" style={{ color: chrome.color }}>
                  {alert.journalEntry.systolicBP}/{alert.journalEntry.diastolicBP}
                </span>
                <span
                  className="ml-1.5 text-[10px] font-semibold px-1 py-0.5 rounded"
                  style={{
                    backgroundColor:
                      alert.journalEntry.systolicBP - alert.journalEntry.diastolicBP > 60
                        ? 'var(--brand-warning-amber-light)'
                        : 'var(--brand-background)',
                    color:
                      alert.journalEntry.systolicBP - alert.journalEntry.diastolicBP > 60
                        ? 'var(--brand-warning-amber)'
                        : 'var(--brand-text-secondary)',
                  }}
                  title="Pulse pressure (SBP − DBP)"
                >
                  PP {alert.journalEntry.systolicBP - alert.journalEntry.diastolicBP}
                </span>
              </>
            )}
          </p>

          {/* Time + ruleId line */}
          <p
            className="text-[10.5px] mt-0.5 inline-flex items-center gap-1"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            <ClockIcon className="w-2.5 h-2.5" />
            {timeAgo(alert.createdAt)} · {alert.ruleId ?? '—'}
          </p>
        </div>

        {/* Action cluster — every interactive element stopPropagation so
            clicks don't fall through to the row-body handler. */}
        <div className="flex items-center gap-2 shrink-0">
          {showAcknowledge && (
            <button
              data-testid={`admin-alert-ack-button-${alert.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onAcknowledge();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              disabled={ackInFlight}
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all hover:brightness-95 cursor-pointer inline-flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
              style={{
                backgroundColor: 'white',
                color: chrome.color,
                border: `1.5px solid ${chrome.color}`,
              }}
              title="Acknowledge — stops escalation ladder advancement"
            >
              {ackInFlight ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              Acknowledge
            </button>
          )}
          {showResolve && (
            <button
              data-testid={`admin-alert-resolve-button-${alert.id}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onResolve();
              }}
              onKeyDown={(e) => e.stopPropagation()}
              className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:brightness-95 cursor-pointer inline-flex items-center gap-1"
              style={{ backgroundColor: chrome.color }}
            >
              {bucket === 'BP_L2' && <CheckCircle2 className="w-3 h-3" />}
              Resolve
            </button>
          )}
          <button
            data-testid={`admin-alert-expand-${alert.id}`}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            onKeyDown={(e) => e.stopPropagation()}
            className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer"
            aria-label={expanded ? 'Collapse alert' : 'Expand alert'}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            ) : (
              <ChevronDown className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            )}
          </button>
        </div>
      </div>

      {/* Expanded body — three-tier messages + escalation audit trail. */}
      {expanded && (
        <div
          className="px-4 md:px-5 pb-4 pt-1 space-y-3"
          style={{ backgroundColor: 'var(--brand-background)' }}
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
            <ThreeTierMessageCard
              title="Patient"
              icon={<UserIcon className="w-3 h-3" />}
              message={alert.patientMessage}
              color="var(--brand-primary-purple)"
              testId={`admin-alert-msg-patient-${alert.id}`}
            />
            <ThreeTierMessageCard
              title="Caregiver"
              icon={<Users className="w-3 h-3" />}
              message={alert.caregiverMessage}
              color="var(--brand-accent-teal)"
              testId={`admin-alert-msg-caregiver-${alert.id}`}
            />
            <ThreeTierMessageCard
              title="Physician"
              icon={<Stethoscope className="w-3 h-3" />}
              message={alert.physicianMessage}
              color="var(--brand-text-secondary)"
              testId={`admin-alert-msg-physician-${alert.id}`}
            />
          </div>

          <EscalationAuditTrail alert={alert} heightCm={heightCm} />
        </div>
      )}
    </div>
  );
}

function ThreeTierMessageCard({
  title,
  icon,
  message,
  color,
  testId,
}: {
  title: string;
  icon: React.ReactNode;
  message: string | null;
  color: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-lg p-3"
      style={{
        backgroundColor: 'white',
        border: '1px solid var(--brand-border)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center text-white"
          style={{ backgroundColor: color }}
          aria-hidden
        >
          {icon}
        </span>
        <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color }}>
          {title}
        </p>
      </div>
      <p
        className="text-[12px] leading-relaxed"
        style={{
          color: message ? 'var(--brand-text-primary)' : 'var(--brand-text-muted)',
          fontStyle: message ? 'normal' : 'italic',
        }}
      >
        {message ?? 'No message generated for this audience.'}
      </p>
    </div>
  );
}

export { tierBucket as alertTierBucket, bucketChrome as alertBucketChrome };
