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
import { useLanguage } from '@/contexts/LanguageContext';
import { canResolveAlerts } from '@/lib/roleGates';
import type {
  PatientAlert,
} from '@/lib/services/patient-detail.service';

/**
 * Formats a canonical display ID ("CPPATK8M2R4N7") with hyphens
 * ("CP-PAT-K8M2R4N-7"). Mirrors DisplayIdService.
 */
function formatDisplayId(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value;
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
}

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

// #81 — rules whose thresholds are ABSOLUTE: they fire as STANDARD
// regardless of the patient's monitoring stage or reading count. For these,
// the STANDARD badge does NOT mean "fewer than 7 baseline readings" — it
// means the rule itself is monitoring-stage-independent. Showing the
// "<7 readings" tooltip on e.g. Carol's 185/120 emergency (she has 15+
// readings) is factually wrong. NOTE: there is no RULE_TACHY_SEVERE —
// severe tachycardia (HR>130) fires under RULE_TACHY_HR, which is also
// the regular session-averaged tachy rule, so it is intentionally NOT in
// this set.
const ABSOLUTE_EMERGENCY_RULES = new Set<string>([
  'RULE_ABSOLUTE_EMERGENCY',
  'RULE_ACE_ANGIOEDEMA',
  'RULE_GENERIC_ANGIOEDEMA',
  'RULE_PREGNANCY_L2',
  'RULE_BRADY_ABSOLUTE',
  'RULE_SYMPTOM_OVERRIDE_GENERAL',
  'RULE_SYMPTOM_OVERRIDE_PREGNANCY',
]);

// User-flagged 2026-06-07 — contraindication rules ALSO fire as STANDARD
// regardless of reading count or personalization. They're structural rules
// (the patient is on a contraindicated drug — that doesn't change based on
// how many readings they have). The "<7 readings" fallback tooltip was
// misleading on these. Examples: James (HFrEF + Diltiazem on 9+ readings)
// or Priya (pregnant + Lisinopril). Both fire STANDARD because the rule
// itself is condition-structural, not threshold-personalized.
const CONTRAINDICATION_RULES = new Set<string>([
  'RULE_PREGNANCY_ACE_ARB',
  'RULE_NDHP_HFREF',
  // Future contraindication rules go here. Any TIER_1_CONTRAINDICATION rule.
]);

function standardBadgeTooltip(ruleId: string | null | undefined): string {
  if (ruleId && ABSOLUTE_EMERGENCY_RULES.has(ruleId)) {
    return 'Emergency thresholds are absolute (e.g., SBP ≥180 / DBP ≥120) — they fire STANDARD regardless of the patient’s monitoring stage.';
  }
  if (ruleId && CONTRAINDICATION_RULES.has(ruleId)) {
    return 'Contraindication alerts fire as STANDARD regardless of the patient’s monitoring stage or reading count — the rule is structural (the patient is on a contraindicated medication).';
  }
  // Threshold-based standard rules — STANDARD here means "evaluated against
  // standard AHA thresholds" rather than condition-personalized ones. This
  // applies whether the patient is pre-baseline (<7 readings), post-baseline
  // without a condition that warrants personalization, or post-baseline with
  // a condition that doesn't yet have provider-set personalized thresholds.
  // Note: tooltip intentionally doesn't assert reading count here because
  // the AlertCard doesn't have that data without an extra fetch — follow-on
  // ticket can pipe reading-count through so the copy can split out the
  // pre-Day-3 vs post-Day-3 cases.
  return 'This alert was evaluated against standard AHA thresholds (no condition-specific personalization applied).';
}

function standardBadgeAria(ruleId: string | null | undefined): string {
  if (ruleId && ABSOLUTE_EMERGENCY_RULES.has(ruleId)) {
    return 'Emergency thresholds are absolute: this alert fires STANDARD regardless of the patient’s monitoring stage';
  }
  if (ruleId && CONTRAINDICATION_RULES.has(ruleId)) {
    return 'Contraindication alert: fires as STANDARD regardless of monitoring stage';
  }
  return 'Standard monitoring: evaluated against standard AHA thresholds';
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
      // Manisha Open-Decisions sign-off 2026-06-06 (Decision 1) — Tier 3 = info-blue.
      return { label: 'Tier 3', color: 'var(--brand-info-blue)', bg: 'var(--brand-info-blue-light)', icon: <Bell className="w-3 h-3" /> };
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
  /** Patient's permanent display ID (CP-PAT-...) shown next to the name on
   *  cross-patient surfaces (NotificationsScreen). On the per-patient
   *  AlertsTab the surrounding shell already exposes the ID. See
   *  docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md. */
  patientDisplayId?: string | null;
  /** PatientProfile.heightCm — used by the 15-field audit footer in
   *  EscalationAuditTrail to compute BMI from the alert's reading weight. */
  heightCm?: number | null;
  /** When true the row body uses cursor-pointer + button semantics. Both
   *  surfaces want this — tab uses it for expand, notifications for nav. */
  rowClickable?: boolean;
  /** F27 — true when this alert's patient is not yet ENROLLED, so escalation
   *  dispatch was deferred. Renders a "No dispatch — awaiting enrollment"
   *  badge on OPEN alerts so a provider can prioritize enrollment. */
  patientPreEnrollment?: boolean;
  /** Manisha 2026-06-12 — true when this NOT_ENROLLED patient was previously
   *  enrolled (auto-un-enrolled on serious-condition add). Dispatch still fired
   *  (was-ever-enrolled bypass), so the card shows a "threshold pending" action
   *  badge instead of the F27 "no dispatch" badge. Mutually exclusive. */
  previouslyEnrolled?: boolean;
  /** Click handler for the threshold-pending badge — navigates to the patient's
   *  threshold-editing tab. Patient-detail passes setTab('thresholds'); other
   *  surfaces may omit it (badge then renders non-interactive). */
  onThresholdAction?: () => void;
  /** P3 — suppress the per-alert pre-personalization "X of 7" note. AlertsTab
   *  hoists it to a single patient-header band (F4), so repeating it on every
   *  expanded card — three times inside one cofire group — is redundant noise.
   *  NotificationsScreen has no patient band, so it leaves this false. */
  hideDisclaimer?: boolean;
}

/** Round 2 A2 — null/empty/whitespace messages don't get a card (was rendering
 *  the italic "No message generated for this audience." placeholder).  */
function hasTierMessage(message: string | null | undefined): boolean {
  return typeof message === 'string' && message.trim().length > 0;
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
  patientDisplayId,
  heightCm,
  rowClickable = true,
  patientPreEnrollment = false,
  previouslyEnrolled = false,
  onThresholdAction,
  hideDisclaimer = false,
}: Props) {
  const { user } = useAuth();
  const { t } = useLanguage();
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
            {patientDisplayId && (
              <span
                data-testid={`admin-alert-patient-display-id-${alert.id}`}
                className="text-[11px] font-mono tracking-tight"
                style={{ color: 'var(--brand-text-muted)' }}
                title="Cardioplace ID — permanent"
              >
                {formatDisplayId(patientDisplayId)}
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
                // F22 — "Personalized" reflects the patient's monitoring stage
                // (graduated post-7 baseline readings), NOT which rule's
                // threshold fired. A standard-axis rule can still fire while the
                // patient is in personalized mode. Spell that out on hover so a
                // clinician doesn't read the badge as "the personalized
                // threshold triggered this".
                title={
                  alert.mode === 'PERSONALIZED'
                    ? 'This patient has graduated to personalized monitoring (post-7 baseline readings). The badge reflects the patient’s monitoring stage, not necessarily which rule’s threshold fired — a standard-axis rule may have triggered this alert.'
                    : standardBadgeTooltip(alert.ruleId)
                }
                aria-label={
                  alert.mode === 'PERSONALIZED'
                    ? 'Personalized monitoring: reflects the patient’s monitoring stage, not necessarily which rule’s threshold fired'
                    : standardBadgeAria(alert.ruleId)
                }
                className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full cursor-help"
                style={{ backgroundColor: 'var(--brand-surface-muted, #f1f5f9)', color: 'var(--brand-text-secondary)' }}
              >
                {alert.mode === 'PERSONALIZED' ? 'Personalized' : 'Standard'}
              </span>
            )}
            {/* Bug 7 (live-test 2026-06-15) — trigger-source signal. A
                RULE_UNCONFIRMED_EMERGENCY alert exists because the patient logged
                an emergency-range reading but did NOT complete the confirmatory
                measurement (they declined, or the app closed and the cron
                finalized it). The patient may not realize an alert exists, so
                phone outreach is the action — flag it on the row so a provider
                scanning the list can prioritize it over routine alerts. */}
            {alert.ruleId === 'RULE_UNCONFIRMED_EMERGENCY' && (
              <span
                data-testid={`admin-alert-unconfirmed-badge-${alert.id}`}
                title="Unconfirmed emergency-range reading — the patient did not complete the confirmatory measurement (declined or app-closed). Recommend phone outreach to verify current status."
                aria-label="Unconfirmed emergency-range reading — recommend phone outreach"
                className="inline-flex items-center text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full cursor-help"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light, #fef3c7)',
                  color: 'var(--brand-warning-amber-text, #92400e)',
                }}
              >
                Unconfirmed
              </span>
            )}
            {/* F27 + Manisha 2026-06-12 — pre-enrollment dispatch
                transparency, now two-state. A NOT_ENROLLED patient who was
                NEVER enrolled had ALL dispatch deferred → "no dispatch" badge.
                A NOT_ENROLLED patient who was PREVIOUSLY enrolled (auto-un-
                enrolled on serious-condition add) DID get dispatched via the
                was-ever-enrolled bypass — so the "no dispatch" badge would lie.
                They get an amber "threshold pending" action badge instead,
                routing the provider to set the personalized threshold + review.
                Mutually exclusive — never both. */}
            {patientPreEnrollment && alert.status === 'OPEN' && (
              previouslyEnrolled ? (
                <button
                  type="button"
                  data-testid={`admin-alert-threshold-pending-badge-${alert.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onThresholdAction?.();
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  title="Set this patient's personalized threshold, then review the alert"
                  className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${onThresholdAction ? 'cursor-pointer hover:brightness-95' : 'cursor-default'}`}
                  style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
                >
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {t('alerts.badge.thresholdPending')}
                </button>
              ) : (
                <span
                  data-testid={`admin-alert-no-dispatch-badge-${alert.id}`}
                  title="Escalation dispatch is deferred until this patient is enrolled"
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
                >
                  <ShieldAlert className="w-2.5 h-2.5" />
                  No dispatch — awaiting enrollment
                </span>
              )
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
          {/* Manual-test round 2 Group A2 — short-circuit empty tier cards
              instead of rendering the "No message generated for this audience."
              placeholder. A Tier-3 caregiver/physician-only alert now shows
              Caregiver + Physician cards only — no empty Patient panel. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
            {hasTierMessage(alert.patientMessage) && (
              <ThreeTierMessageCard
                title="Patient"
                icon={<UserIcon className="w-3 h-3" />}
                message={alert.patientMessage}
                color="var(--brand-primary-purple)"
                testId={`admin-alert-msg-patient-${alert.id}`}
              />
            )}
            {hasTierMessage(alert.caregiverMessage) && (
              <ThreeTierMessageCard
                title="Caregiver"
                icon={<Users className="w-3 h-3" />}
                message={alert.caregiverMessage}
                color="var(--brand-accent-teal)"
                testId={`admin-alert-msg-caregiver-${alert.id}`}
              />
            )}
            {hasTierMessage(alert.physicianMessage) && (
              <ThreeTierMessageCard
                title="Physician"
                icon={<Stethoscope className="w-3 h-3" />}
                message={alert.physicianMessage}
                color="var(--brand-text-secondary)"
                testId={`admin-alert-msg-physician-${alert.id}`}
              />
            )}
          </div>

          {/* Manisha 5/24 Q3 — pre-personalization "X of 7" note. Standard
              thresholds are used until the patient has 7 baseline readings;
              surface the progress so a provider reads the alert in context. */}
          {!hideDisclaimer && alert.preDay3 && alert.personalizationThreshold != null && (
            <p
              data-testid={`admin-alert-prepersonalization-${alert.id}`}
              className="text-[11.5px] leading-relaxed px-3 py-2 rounded-lg"
              style={{
                backgroundColor: 'var(--brand-surface-muted, #f1f5f9)',
                color: 'var(--brand-text-secondary)',
              }}
            >
              Standard threshold — personalization begins after{' '}
              {alert.personalizationThreshold} readings. This patient has completed{' '}
              {alert.baselineReadingCount ?? 0} of {alert.personalizationThreshold}{' '}
              baseline readings.
            </p>
          )}

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
