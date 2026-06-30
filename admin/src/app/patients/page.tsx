'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/* Custom scrollbar styles for patient modal */
const modalScrollStyles = `
.modal-scroll::-webkit-scrollbar {
  width: 6px;
}
.modal-scroll::-webkit-scrollbar-track {
  background: transparent;
  margin: 4px 0;
}
.modal-scroll::-webkit-scrollbar-thumb {
  background: #E0D4F5;
  border-radius: 99px;
}
.modal-scroll::-webkit-scrollbar-thumb:hover {
  background: #C4B0E0;
}
.modal-scroll {
  scrollbar-width: thin;
  scrollbar-color: #E0D4F5 transparent;
}
`;

/* Alarming pulsing red ring for the "Threshold needed" filter chip when >0
   patients need attention — draws the provider's eye from across the list. */
const thresholdPulseStyles = `
@keyframes threshold-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.55); }
  50%      { box-shadow: 0 0 0 5px rgba(220, 38, 38, 0); }
}
`;
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Users,
  Search,
  X,
  Activity,
  AlertTriangle,
  Mail,
  Phone,
  Calendar,
  Heart,
  Shield,
  ShieldCheck,
  ShieldAlert,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Loader2,
  Info,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { canCompleteEnrollment, canVerifyProfile, hasAdminRole } from '@/lib/roleGates';
import { useLanguage } from '@/contexts/LanguageContext';
import { getPatients, getPatientSummary } from '@/lib/services/provider.service';
import {
  completePatientEnrollment,
  ENROLLMENT_REASON_LABELS,
  type EnrollmentGateReason,
} from '@/lib/services/practice.service';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a canonical display ID ("CPPATK8M2R4N7") with hyphens for human
 * display ("CP-PAT-K8M2R4N-7"). Defensive: if input is already hyphenated
 * or off the expected length, returns it verbatim. Mirrors the formatter
 * in DisplayIdService.formatForDisplay — kept local so the admin app
 * doesn't reach into backend internals.
 */
function formatDisplayId(value: string): string {
  if (value.length !== 13 || value.includes('-')) return value;
  return `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 12)}-${value.slice(12)}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient {
  id: string;
  // Permanent public-facing identifier (CP-PAT-...). Set at account
  // creation; locked forever. Surfaced under the patient name on row +
  // detail header so coordinators can quote it on calls and clinicians
  // can paste it into other systems. See
  // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
  displayId: string | null;
  name: string | null;
  email: string | null;
  riskTier: string;
  communicationPreference: string | null;
  primaryCondition: string | null;
  /** Pregnancy + preeclampsia-history flags, surfaced separately so the
   *  list / detail header can render the "Preeclampsia history" notation
   *  (CLINICAL_SPEC §3 enhanced-monitoring marker for women with a
   *  documented history, including outside pregnancy). */
  isPregnant?: boolean;
  historyHDP?: boolean;
  onboardingStatus: string;
  // Clinical enrollment state (admin-owned). `onboardingStatus` above is
  // identity onboarding only (name/DOB/timezone). See TESTING_FLOW_GUIDE §4.1.
  enrollmentStatus: string;
  // Flow K — verification + per-tier alert breakdown drive the new
  // verification status column and the tier-color-coded count badge.
  profileVerificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | null;
  /** Threshold attention signal (missing OR stale) — drives the subtle red row
   *  tint + the "Threshold needed" filter chip. Matches the detail-page banner. */
  needsThreshold?: boolean;
  latestBaseline: { baselineSystolic: number; baselineDiastolic: number } | null;
  activeAlertsCount: number;
  alertsByTier: Record<string, number>;
  lastEntryDate: string | null;
  latestBP: { systolicBP: number; diastolicBP: number; entryDate: string } | null;
  escalationLevel: string | null;
}

interface PatientSummary {
  patient: Patient;
  recentEntries: {
    id: string;
    entryDate: string;
    systolicBP: number | null;
    diastolicBP: number | null;
    weight: number | null;
    medicationTaken: boolean | null;
    symptoms: string[];
  }[];
  activeAlerts: {
    id: string;
    type: string;
    severity: string;
    magnitude: number;
    status: string;
    createdAt: string;
  }[];
  activeEscalations: {
    id: string;
    escalationLevel: string;
    reason: string | null;
    triggeredAt: string;
  }[];
  baseline: {
    baselineSystolic: number;
    baselineDiastolic: number;
    baselineWeight: number | null;
    sampleSize: number;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '--';
  }
}

function formatAlertType(type: string): string {
  return (type ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  } catch {
    return '--';
  }
}

const RISK_STYLES: Record<string, { bg: string; color: string; border: string }> = {
  HIGH: {
    bg: 'var(--brand-alert-red-light)',
    color: 'var(--brand-alert-red-text)',
    border: 'var(--brand-alert-red)',
  },
  ELEVATED: {
    bg: 'var(--brand-warning-amber-light)',
    color: 'var(--brand-warning-amber-text)',
    border: 'var(--brand-warning-amber)',
  },
  STANDARD: {
    bg: 'var(--brand-success-green-light)',
    color: 'var(--brand-success-green)',
    border: 'var(--brand-success-green)',
  },
};

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function TableSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className="animate-pulse flex items-center gap-4 px-5 py-4 rounded-xl"
          style={{ backgroundColor: '#FAFBFF' }}
        >
          <div className="w-9 h-9 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '30%' }} />
            <div className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '20%' }} />
          </div>
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 60 }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 50 }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 70 }} />
        </div>
      ))}
    </div>
  );
}

function ModalSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-2 flex-1">
          <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: '40%' }} />
          <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: '25%' }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-20 rounded-xl" style={{ backgroundColor: '#FAFBFF' }} />
        ))}
      </div>
      <div className="h-32 rounded-xl" style={{ backgroundColor: '#FAFBFF' }} />
    </div>
  );
}

// ─── Risk Badge ───────────────────────────────────────────────────────────────
function RiskBadge({ tier }: { tier: string }) {
  const s = RISK_STYLES[tier] ?? RISK_STYLES.STANDARD;
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: s.bg, color: s.color }}
    >
      {tier}
    </span>
  );
}

// ─── Flow K1 — Verification status pill ─────────────────────────────────────

function VerificationBadge({
  status,
  compact = false,
}: {
  status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | null;
  compact?: boolean;
}) {
  let label: string;
  let bg: string;
  let color: string;
  let icon: React.ReactNode;
  switch (status) {
    case 'VERIFIED':
      label = 'Verified';
      bg = 'var(--brand-success-green-light)';
      color = 'var(--brand-success-green)';
      icon = <ShieldCheck className="w-2.5 h-2.5" />;
      break;
    case 'CORRECTED':
      label = 'Corrected';
      bg = 'var(--brand-warning-amber-light)';
      color = 'var(--brand-warning-amber)';
      icon = <ShieldAlert className="w-2.5 h-2.5" />;
      break;
    case 'UNVERIFIED':
      label = 'Unverified';
      bg = 'var(--brand-alert-red-light)';
      color = 'var(--brand-alert-red)';
      icon = <ShieldAlert className="w-2.5 h-2.5" />;
      break;
    default:
      // No profile yet — patient hasn't completed intake.
      label = 'No profile';
      bg = 'var(--brand-background)';
      color = 'var(--brand-text-muted)';
      icon = <Shield className="w-2.5 h-2.5" />;
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: bg, color }}
      title={label}
    >
      {icon}
      {!compact && label}
    </span>
  );
}

// ─── Flow K2. Open-alert count badge with tier color coding ────────────────

function tierChrome(tier: string | null): {
  bg: string
  color: string
  label: string
  /** Compact 2–3 char abbreviation for cells where horizontal space is
   *  scarce (multi-tier patient-list badge). Keeps a uniform width per
   *  chip so the row height stays constant. */
  short: string
} {
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return { bg: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)', label: 'BP L2', short: 'L2' };
    case 'TIER_1_CONTRAINDICATION':
    // Cluster 8 — angioedema shares the Tier 1 chrome (red banner, "Tier 1"
    // label) for MVP. Bespoke airway visuals are a post-pilot follow-up.
    case 'TIER_1_ANGIOEDEMA':
      return { bg: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)', label: 'Tier 1', short: 'T1' };
    case 'TIER_2_DISCREPANCY':
      return { bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)', label: 'Tier 2', short: 'T2' };
    case 'BP_LEVEL_1_HIGH':
    case 'BP_LEVEL_1_LOW':
      return { bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)', label: 'BP L1', short: 'L1' };
    case 'TIER_3_INFO':
      // Manisha Open-Decisions sign-off 2026-06-06 (Decision 1) — Tier 3 = info-blue.
      return { bg: 'var(--brand-info-blue-light)', color: 'var(--brand-info-blue)', label: 'Tier 3', short: 'T3' };
    default:
      return { bg: 'var(--brand-background)', color: 'var(--brand-text-muted)', label: 'Open', short: 'OP' };
  }
}

// Tier severity order — stable across the file. Highest first so the top
// of any list / leading chip is the most-severe alert.
const TIER_SEVERITY_ORDER = [
  'BP_LEVEL_2',
  'BP_LEVEL_2_SYMPTOM_OVERRIDE',
  'TIER_1_CONTRAINDICATION',
  // Cluster 8 — angioedema sits at Tier-1 severity (airway emergency,
  // "resolved like all Tier 1 alerts"). Placed immediately after
  // TIER_1_CONTRAINDICATION so an angioedema-only patient sorts above
  // a Tier-2 / BP-L1 patient in the list.
  'TIER_1_ANGIOEDEMA',
  'TIER_2_DISCREPANCY',
  'BP_LEVEL_1_HIGH',
  'BP_LEVEL_1_LOW',
  'TIER_3_INFO',
];

/**
 * Per-tier alert badge for the patients-list "Alerts" column.
 *
 * Design — fixed width AND fixed height regardless of tier mix:
 *   [count] •••
 *
 * The leading chip shows the total open count colored by the worst tier
 * present. To its right, one tiny colored dot per tier indicates which
 * tiers are open (red = Tier 1 / BP L2, amber = Tier 2 / BP L1, teal =
 * Tier 3). Max 3 dots visible; "+N" appears when more tiers are present.
 *
 * Why this shape:
 *   • Width is bounded (~52px desktop, ~46px mobile) so the table column
 *     never grows when a patient picks up another tier.
 *   • Height is one line, locked, regardless of mix.
 *   • Color carries the per-tier signal without horizontal text labels.
 *   • Tooltip + the patient detail page surface the exact breakdown
 *     ("Tier 1: 2 · Tier 2: 2") for anyone who needs the specifics.
 */
function AlertsCell({
  alertsByTier,
  count,
  compact = false,
}: {
  alertsByTier: Record<string, number> | undefined;
  count: number;
  compact?: boolean;
}) {
  if (count === 0) {
    if (compact) return null;
    return (
      <span
        className="inline-flex items-center gap-1 h-6 text-[11px]"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: 'var(--brand-success-green)' }}
          aria-hidden
        />
        Clear
      </span>
    );
  }

  // Build per-tier segments in severity order. Anything outside the known
  // tier list (legacy "UNTIERED" rows) bubbles up as one "Open" segment so
  // the totals always reconcile with `count`.
  const segments: {
    tier: string
    label: string
    color: string
    count: number
  }[] = [];
  if (alertsByTier) {
    for (const tier of TIER_SEVERITY_ORDER) {
      const n = alertsByTier[tier] ?? 0;
      if (n > 0) {
        const c = tierChrome(tier);
        segments.push({ tier, label: c.label, color: c.color, count: n });
      }
    }
    const accountedFor = segments.reduce((s, x) => s + x.count, 0);
    if (accountedFor < count) {
      const c = tierChrome(null);
      segments.push({ tier: 'OTHER', label: 'Open', color: c.color, count: count - accountedFor });
    }
  } else {
    const c = tierChrome(null);
    segments.push({ tier: 'OTHER', label: 'Open', color: c.color, count });
  }

  const breakdown = segments.map((s) => `${s.label}: ${s.count}`).join(' · ');
  const worstColor = segments[0].color;
  const visible = segments.slice(0, 3);
  const overflow = segments.length - visible.length;

  // Same shape on desktop and mobile — only the chip dimensions differ.
  // Single-tier patients show no dots row (count alone tells the story).
  const chipSize = compact ? 'min-w-[20px] h-5 text-[10px]' : 'min-w-[22px] h-6 text-[11px]';

  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={breakdown}>
      <span
        className={`${chipSize} px-1.5 rounded-full inline-flex items-center justify-center font-bold text-white leading-none`}
        style={{ backgroundColor: worstColor }}
      >
        {count}
      </span>
      {segments.length > 1 && (
        <span className="inline-flex items-center gap-0.5">
          {visible.map((s) => (
            <span
              key={s.tier}
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
          ))}
          {overflow > 0 && (
            <span
              className="text-[9px] font-bold ml-0.5 leading-none"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              +{overflow}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

// ─── Flow K3 — Complete onboarding CTA + 409-tooltip ────────────────────────

function OnboardingCell({
  patient,
  completing,
  cachedReasons,
  canAct,
  onComplete,
}: {
  patient: Patient;
  completing: boolean;
  cachedReasons?: EnrollmentGateReason[];
  /** Caller can run the enrollment endpoint. False for HEALPLACE_OPS (May
   *  2026 access-scope decision — complete-onboarding is a clinical
   *  readiness call moved off OPS). When false we render a status pill
   *  instead of the actionable button so OPS sees the state without the
   *  403 trap on click. */
  canAct: boolean;
  onComplete: () => void | Promise<void>;
}) {
  const [showTip, setShowTip] = useState(false);

  if (patient.enrollmentStatus === 'ENROLLED') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
      >
        <CheckCircle2 className="w-2.5 h-2.5" />
        Enrolled
      </span>
    );
  }

  // Read-only "Not enrolled" pill for callers without the clinical-readiness
  // authority (HEALPLACE_OPS). Same shape as the Enrolled pill so OPS can
  // still triage the patient list at a glance; the click affordance is
  // simply absent.
  if (!canAct) {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
        title="Awaiting clinician enrollment"
      >
        <ShieldAlert className="w-2.5 h-2.5" />
        Not enrolled
      </span>
    );
  }

  // We optimistically render the button "enabled" — the gate is enforced
  // server-side, so on click we attempt completion and surface the 409
  // reasons in a tooltip if the gate rejects. Once we have cached reasons
  // for this row, the button stays disabled until something changes.
  const blocked = !!cachedReasons && cachedReasons.length > 0;

  return (
    <div className="relative inline-flex items-center gap-1.5">
      <button
        type="button"
        disabled={blocked || completing}
        onClick={(e) => {
          e.stopPropagation();
          onComplete();
        }}
        className="h-7 px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 transition-all hover:brightness-95 cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        style={{
          backgroundColor: blocked ? 'white' : 'var(--brand-primary-purple)',
          color: blocked ? 'var(--brand-text-muted)' : 'white',
          border: blocked ? '1px solid var(--brand-border)' : 'none',
        }}
      >
        {completing ? (
          <Loader2 className="w-2.5 h-2.5 animate-spin" />
        ) : blocked ? (
          <ShieldAlert className="w-2.5 h-2.5" />
        ) : (
          <CheckCircle2 className="w-2.5 h-2.5" />
        )}
        {blocked ? 'Blocked' : 'Complete'}
      </button>
      {blocked && (
        <button
          type="button"
          aria-label="Show reasons"
          onClick={(e) => {
            e.stopPropagation();
            setShowTip((v) => !v);
          }}
          onMouseEnter={() => setShowTip(true)}
          onMouseLeave={() => setShowTip(false)}
          className="w-5 h-5 rounded-full flex items-center justify-center cursor-help"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
        >
          <Info className="w-3 h-3" />
        </button>
      )}
      {blocked && showTip && cachedReasons && (
        <div
          role="tooltip"
          className="absolute right-0 top-full mt-1.5 z-20 w-64 rounded-lg p-3 text-left"
          style={{
            backgroundColor: '#0F172A',
            color: 'white',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#FCD34D' }}>
            Cannot complete · prerequisites missing
          </p>
          <ul className="space-y-1.5">
            {cachedReasons.map((r) => (
              <li key={r} className="text-[11px] leading-relaxed flex gap-1.5">
                <span style={{ color: '#FCD34D' }}>•</span>
                <span>{ENROLLMENT_REASON_LABELS[r] ?? r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Patient Detail Modal ─────────────────────────────────────────────────────
function PatientModal({
  patient,
  summary,
  loading,
  onClose,
}: {
  patient: Patient;
  summary: PatientSummary | null;
  loading: boolean;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const initials = patient.name
    ? patient.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
    : 'P';

  return (
    <>
    <style>{modalScrollStyles}</style>
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(15, 23, 42, 0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.25, ease: 'easeOut' }}
        className="bg-white rounded-2xl w-full max-w-lg max-h-[85vh] flex flex-col overflow-hidden"
        style={{ boxShadow: '0 24px 48px rgba(123,0,224,0.15)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="shrink-0 px-6 py-4 rounded-t-2xl flex items-center justify-between"
          style={{
            background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
              style={{ backgroundColor: 'rgba(255,255,255,0.2)', color: 'white' }}
            >
              {initials}
            </div>
            <div>
              <h3 className="text-white font-bold text-[16px]">{patient.name ?? 'Unknown'}</h3>
              <p className="text-white text-[12px]">{patient.email ?? '--'}</p>
              {patient.displayId ? (
                <p
                  className="text-white/80 text-[11px] font-mono mt-0.5"
                  data-testid="patient-display-id"
                  title="Cardioplace ID — quote this on support calls"
                >
                  {formatDisplayId(patient.displayId)}
                </p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:bg-white/20"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 modal-scroll">
          {loading ? (
            <ModalSkeleton />
          ) : (
            <div className="space-y-5">
              {/* Quick Stats */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Heart className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('provider.latestBP')}
                    </p>
                  </div>
                  <p className="text-[20px] font-bold" style={{ color: 'var(--brand-primary-purple)' }}>
                    {patient.latestBP
                      ? `${patient.latestBP.systolicBP}/${patient.latestBP.diastolicBP}`
                      : '--/--'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Shield className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('provider.riskTier')}
                    </p>
                  </div>
                  <RiskBadge tier={patient.riskTier} />
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <Activity className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('provider.baseline')}
                    </p>
                  </div>
                  <p className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {summary?.baseline
                      ? `${summary.baseline.baselineSystolic}/${summary.baseline.baselineDiastolic}`
                      : '--/--'}
                  </p>
                  <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {summary?.baseline ? `${summary.baseline.sampleSize} day avg` : 'mmHg'}
                  </p>
                </div>

                <div className="p-3 rounded-xl" style={{ backgroundColor: '#FAFBFF' }}>
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--brand-warning-amber-text)' }} />
                    <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('provider.activeAlerts')}
                    </p>
                  </div>
                  <p className="text-[20px] font-bold" style={{ color: patient.activeAlertsCount > 0 ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)' }}>
                    {patient.activeAlertsCount}
                  </p>
                </div>
              </div>

              {/* Patient Info */}
              <div>
                <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('provider.patientDetails')}
                </h4>
                <div className="space-y-2">
                  {[
                    { icon: Mail, label: t('provider.email'), value: patient.email ?? '--' },
                    { icon: Phone, label: t('provider.preference'), value: (patient.communicationPreference ?? 'TEXT_FIRST').replace('_', ' ') },
                    { icon: Calendar, label: t('provider.lastCheckin'), value: patient.lastEntryDate ? timeAgo(patient.lastEntryDate) : 'Never' },
                    { icon: Heart, label: t('provider.condition'), value: patient.primaryCondition ?? '--' },
                  ].map(({ icon: Icon, label, value }) => (
                    <div key={label} className="flex items-center gap-2.5 py-1.5">
                      <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                      <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>{label}</span>
                      <span className="text-[12px] font-semibold ml-auto" style={{ color: 'var(--brand-text-primary)' }}>{value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent Entries */}
              {summary && summary.recentEntries.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('provider.recentReadings')}
                  </h4>
                  <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--brand-border)' }}>
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr style={{ backgroundColor: '#FAFBFF' }}>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Date</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>BP</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Meds</th>
                          <th className="text-left px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-muted)' }}>Symptoms</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summary.recentEntries.slice(0, 7).map((entry) => (
                          <tr key={entry.id} style={{ borderTop: '1px solid var(--brand-border)' }}>
                            <td className="px-3 py-2" style={{ color: 'var(--brand-text-secondary)' }}>
                              {formatDate(entry.entryDate)}
                            </td>
                            <td className="px-3 py-2 font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                              {entry.systolicBP && entry.diastolicBP ? `${entry.systolicBP}/${entry.diastolicBP}` : '--'}
                            </td>
                            <td className="px-3 py-2">
                              {(() => {
                                // WCAG 1.4.1 — don't rely on the dot colour alone;
                                // pair it with a text label (Taken / Missed / —).
                                const meta = entry.medicationTaken
                                  ? { color: 'var(--brand-success-green)', label: 'Taken' }
                                  : entry.medicationTaken === false
                                  ? { color: 'var(--brand-alert-red)', label: 'Missed' }
                                  : { color: 'var(--brand-border)', label: '—' };
                                return (
                                  <span className="inline-flex items-center gap-1.5">
                                    <span
                                      className="inline-block w-2 h-2 rounded-full shrink-0"
                                      style={{ backgroundColor: meta.color }}
                                      aria-hidden
                                    />
                                    <span style={{ color: 'var(--brand-text-secondary)' }}>{meta.label}</span>
                                  </span>
                                );
                              })()}
                            </td>
                            <td className="px-3 py-2" style={{ color: 'var(--brand-text-muted)' }}>
                              {entry.symptoms.length > 0 ? entry.symptoms.join(', ') : 'None'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Active Alerts */}
              {summary && summary.activeAlerts.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('provider.alerts')}
                  </h4>
                  <div className="space-y-2">
                    {summary.activeAlerts.map((alert) => (
                      <div
                        key={alert.id}
                        className="p-3 rounded-xl"
                        style={{
                          backgroundColor: alert.severity === 'HIGH' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                          borderLeft: `3px solid ${alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                        }}
                      >
                        <div className="flex items-start justify-between">
                          <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                            {formatAlertType(alert.type)}
                          </p>
                          <span
                            className="text-[10px] font-bold uppercase"
                            style={{ color: alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                          >
                            {alert.severity}
                          </span>
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                          {formatDate(alert.createdAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Escalations */}
              {summary && summary.activeEscalations.length > 0 && (
                <div>
                  <h4 className="text-[13px] font-semibold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('provider.escalations')}
                  </h4>
                  <div className="space-y-2">
                    {summary.activeEscalations.map((esc) => (
                      <div
                        key={esc.id}
                        className="p-3 rounded-xl"
                        style={{ backgroundColor: '#FAFBFF', borderLeft: '3px solid var(--brand-primary-purple)' }}
                      >
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                          {(esc.escalationLevel ?? '').replace('_', ' ')}
                        </p>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                          {esc.reason ?? 'No reason recorded'} &middot; {formatDate(esc.triggeredAt)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
    </>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function PatientsPage() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();
  const router = useRouter();

  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<string>('ALL');
  // Flow K1 — quick-toggle for "show only patients with an unverified profile".
  const [awaitingVerificationOnly, setAwaitingVerificationOnly] = useState(false);
  // Threshold-attention quick-toggle — "show only patients who need a threshold
  // set or re-reviewed". Mirrors the awaiting filter; the chip pulses when >0.
  const [thresholdNeededOnly, setThresholdNeededOnly] = useState(false);

  // Flow K3 — per-row enrollment state. Loading state for the in-flight CTA
  // and a per-patient cache of 409 reasons returned by the backend gate.
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [enrollmentReasons, setEnrollmentReasons] = useState<
    Record<string, EnrollmentGateReason[]>
  >({});

  // Flow H: row click navigates to /patients/[id] for the new tabbed detail
  // view. The legacy modal state is kept temporarily so the existing detail
  // modal can still mount in an empty state — but with selectedPatient
  // permanently null since nothing sets it anymore.
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [summary, setSummary] = useState<PatientSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  // Load patients. May 2026 access-scope: the backend now derives scope
  // from the JWT roles (PROVIDER → panel, MED_DIR → practice via
  // PracticeMedicalDirector, OPS/SUPER → all). The frontend no longer
  // needs to pass `?scope=assigned` — left here only for backwards-compat
  // with older backend builds.
  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    setLoading(true);
    getPatients()
      .then((data) => setPatients(Array.isArray(data) ? data : []))
      .catch(() => setPatients([]))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isLoading]);

  // Load summary when patient selected
  useEffect(() => {
    if (!selectedPatient) {
      setSummary(null);
      return;
    }
    setSummaryLoading(true);
    getPatientSummary(selectedPatient.id)
      .then((data) => setSummary(data))
      .catch(() => setSummary(null))
      .finally(() => setSummaryLoading(false));
  }, [selectedPatient]);

  // Filter + search
  const filtered = patients.filter((p) => {
    if (riskFilter !== 'ALL' && p.riskTier !== riskFilter) return false;
    if (
      awaitingVerificationOnly &&
      p.profileVerificationStatus === 'VERIFIED'
    ) {
      return false;
    }
    if (thresholdNeededOnly && !p.needsThreshold) {
      return false;
    }
    if (search) {
      const q = search.toLowerCase();
      return (
        (p.name ?? '').toLowerCase().includes(q) ||
        (p.email ?? '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // ─── Auth guard ───────────────────────────────────────────────────────────
  if (isLoading) return null;
  // No user (logged out / mid-navigation) — render nothing so the
  // role-mismatch screen doesn't flash before window.location.href fires.
  if (!user) return null;

  if (!hasAdminRole(user)) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="text-center p-8 rounded-2xl bg-white" style={{ boxShadow: 'var(--brand-shadow-card)' }} data-testid="admin-access-denied">
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <Shield className="w-7 h-7" style={{ color: 'var(--brand-alert-red-text)' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
            403 Access Denied
          </h1>
          <p className="text-sm mb-4" style={{ color: 'var(--brand-text-muted)' }}>
            Super Admin access required
          </p>
          <Link
            href="/dashboard"
            className="inline-flex items-center px-4 py-2 rounded-full text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full" style={{ backgroundColor: '#FAFBFF' }}>
      <style>{thresholdPulseStyles}</style>
      <div className="max-w-6xl mx-auto px-4 md:px-8 py-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Users className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('provider.patientList')}
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? '...' : `${patients.length} registered patients`}
              </p>
            </div>
          </div>

          {/* Filter cluster — responsive:
             • Mobile (<sm): search bar gets its own full-width row;
               filter chips sit below in a horizontal-scroll strip so a
               350px screen never has to fit 3 controls side-by-side.
             • sm: search shrinks to fixed width and joins the filter
               row inline.
             • md+: everything sits on the same line as the title.
          */}
          <div className="flex flex-col gap-2 w-full sm:w-auto sm:flex-row sm:items-center">
            {/* Search */}
            <div
              className="flex items-center gap-2 px-3 h-9 rounded-full w-full sm:w-56"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('provider.searchPatients')}
                aria-label={t('provider.searchPatients')}
                data-testid="admin-patient-search-input"
                className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
                style={{ color: 'var(--brand-text-primary)' }}
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="shrink-0" aria-label="Clear search">
                  <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Filter chip row — on phones the three controls share the row
                width (fit-to-width) so there's no horizontal scroll; on sm+
                they revert to natural widths inline. pt-1 leaves room for the
                threshold chip's pulsing ring (a box-shadow that would clip if
                an ancestor scrolled). */}
            <div className="flex items-center gap-1.5 sm:gap-2 w-full sm:w-auto pt-1 sm:pt-0">
              {/* Risk filter */}
              <div className="relative flex-1 min-w-0 sm:flex-none">
                <select
                  value={riskFilter}
                  onChange={(e) => setRiskFilter(e.target.value)}
                  aria-label={t('provider.allTiers')}
                  data-testid="admin-patient-risk-filter"
                  className="appearance-none w-full sm:w-auto h-9 pl-3 pr-7 rounded-full text-[12px] font-semibold outline-none cursor-pointer"
                  style={{
                    backgroundColor: 'white',
                    border: '1.5px solid var(--brand-border)',
                    color: 'var(--brand-text-secondary)',
                  }}
                >
                  <option value="ALL">{t('provider.allTiers')}</option>
                  <option value="HIGH">{t('provider.high')}</option>
                  <option value="ELEVATED">{t('provider.elevated')}</option>
                  <option value="STANDARD">{t('provider.standard')}</option>
                </select>
                <ChevronDown
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none"
                  style={{ color: 'var(--brand-text-muted)' }}
                />
              </div>

              {/* Flow K1 — Awaiting verification quick-toggle chip.
                  Label collapses to "Unverified" on small screens to save
                  ~80px of horizontal space; the icon + count badge keep
                  the affordance intact.
                  Hidden for HEALPLACE_OPS — May 2026 access-scope decision
                  removed clinical-verification authority from OPS, so the
                  filter has no actionable use for them. */}
              {canVerifyProfile(user) && (() => {
                const count = patients.filter((p) => p.profileVerificationStatus !== 'VERIFIED').length;
                const active = awaitingVerificationOnly;
                return (
                  <button
                    type="button"
                    onClick={() => setAwaitingVerificationOnly((v) => !v)}
                    data-testid="admin-patient-awaiting-filter"
                    aria-pressed={active}
                    aria-label={active ? 'Showing only unverified patients' : 'Filter to unverified patients'}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full text-[12px] font-semibold transition-all cursor-pointer flex-1 min-w-0 sm:flex-none whitespace-nowrap"
                    style={{
                      backgroundColor: active ? 'var(--brand-warning-amber)' : 'var(--brand-warning-amber-light)',
                      color: active ? 'white' : 'var(--brand-warning-amber)',
                      border: `1.5px solid ${active ? 'var(--brand-warning-amber)' : 'transparent'}`,
                    }}
                  >
                    <ShieldAlert className="w-3 h-3 shrink-0" />
                    <span className="hidden md:inline">Awaiting verification</span>
                    <span className="md:hidden truncate">Unverified</span>
                    <span
                      className="text-[10px] font-bold px-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'white',
                        color: active ? 'white' : 'var(--brand-warning-amber)',
                        minWidth: 18,
                        textAlign: 'center',
                      }}
                    >
                      {count}
                    </span>
                    {active && (
                      <X
                        className="w-3 h-3 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAwaitingVerificationOnly(false);
                        }}
                      />
                    )}
                  </button>
                );
              })()}

              {/* Threshold-needed quick-toggle chip. Visible to every admin role
                  for awareness (setting/attesting stays editor-only in the
                  detail page). Pulses a red ring only when >0 patients need
                  attention; calm at zero. */}
              {(() => {
                const count = patients.filter((p) => p.needsThreshold).length;
                const active = thresholdNeededOnly;
                const alarming = count > 0;
                return (
                  <button
                    type="button"
                    onClick={() => setThresholdNeededOnly((v) => !v)}
                    data-testid="admin-patient-threshold-filter"
                    aria-pressed={active}
                    aria-label={active ? 'Showing only patients needing a threshold' : 'Filter to patients needing a threshold'}
                    className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-full text-[12px] font-semibold transition-all cursor-pointer flex-1 min-w-0 sm:flex-none whitespace-nowrap"
                    style={{
                      backgroundColor: active
                        ? 'var(--brand-alert-red)'
                        : alarming
                          ? 'var(--brand-alert-red-light)'
                          : 'var(--brand-background)',
                      color: active
                        ? 'white'
                        : alarming
                          ? 'var(--brand-alert-red-text)'
                          : 'var(--brand-text-muted)',
                      border: `1.5px solid ${active ? 'var(--brand-alert-red)' : 'transparent'}`,
                      animation: alarming && !active ? 'threshold-pulse 1.6s ease-in-out infinite' : undefined,
                    }}
                  >
                    <AlertTriangle className="w-3 h-3 shrink-0" />
                    <span className="hidden md:inline">Threshold needed</span>
                    <span className="md:hidden truncate">Threshold</span>
                    <span
                      className="text-[10px] font-bold px-1.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'white',
                        color: active ? 'white' : 'var(--brand-alert-red-text)',
                        minWidth: 18,
                        textAlign: 'center',
                      }}
                    >
                      {count}
                    </span>
                    {active && (
                      <X
                        className="w-3 h-3 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setThresholdNeededOnly(false);
                        }}
                      />
                    )}
                  </button>
                );
              })()}
            </div>
          </div>
        </div>

        {/* Table */}
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}
        >
          {/* Table header */}
          <div
            className="hidden md:grid items-center px-5 py-3 text-[10px] font-bold uppercase tracking-wider gap-3"
            style={{
              color: 'var(--brand-text-muted)',
              gridTemplateColumns: '1.8fr 0.9fr 0.9fr 1fr 1fr 1fr 1.2fr 32px',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <span>{t('provider.patientList')}</span>
            <span>{t('provider.lastBP')}</span>
            <span>{t('provider.allTiers')}</span>
            <span>Verification</span>
            <span>{t('provider.alerts')}</span>
            <span>{t('provider.lastCheckin')}</span>
            <span>Onboarding</span>
            <span></span>
          </div>

          {loading ? (
            <div className="p-4">
              <TableSkeleton />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-16 text-center" data-testid="admin-patient-list-empty">
              <Users className="w-10 h-10 mx-auto mb-3" style={{ color: 'var(--brand-border)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                {t('provider.noPatients')}
              </p>
            </div>
          ) : (
            <div>
              {filtered.map((p, idx) => {
                const initials = p.name
                  ? p.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)
                  : 'P';

                return (
                  // biome-ignore lint/a11y/useSemanticElements: row contains block-level children (grid columns), which would be invalid inside a <button>. Keyboard support handled below.
                  <div
                    key={p.id}
                    data-testid={`admin-patient-list-row-${p.id}`}
                    onClick={() => router.push(`/patients/${p.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/patients/${p.id}`);
                      }
                    }}
                    title={p.needsThreshold ? 'Threshold needed — set or re-review targets' : undefined}
                    // Whole-row subtle red tint when a threshold is missing/stale
                    // (no left stripe). The base class tints the entire row; the
                    // hover variant still wins on hover (no inline bg to clobber it).
                    className={`w-full text-left px-5 py-3.5 flex items-center gap-4 md:grid md:gap-3 transition-colors hover:bg-[#F8F4FF] cursor-pointer group ${p.needsThreshold ? 'bg-[#FDE8E8]' : ''}`}
                    style={{
                      gridTemplateColumns: '1.8fr 0.9fr 0.9fr 1fr 1fr 1fr 1.2fr 32px',
                      borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none',
                    }}
                  >
                    {/* Patient info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                        style={{
                          backgroundColor: 'var(--brand-primary-purple-light)',
                          color: 'var(--brand-primary-purple)',
                        }}
                      >
                        {initials}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                            {p.name ?? 'Unknown'}
                          </p>
                          {/* Preeclampsia-history notation per CLINICAL_SPEC §3.
                              Only when patient is NOT currently pregnant — the
                              pregnancy banner already covers active pregnancies,
                              so the value of this flag is for women with a
                              documented history outside pregnancy. */}
                          {p.historyHDP && !p.isPregnant && (
                            <span
                              role="img"
                              className="shrink-0 inline-flex items-center"
                              title="History of hypertensive disorder of pregnancy (HDP). Enhanced monitoring recommended outside pregnancy per 2025 AHA/ACC Hypertension Guideline."
                              aria-label="History of hypertensive disorder of pregnancy"
                            >
                              <Heart
                                className="w-3 h-3"
                                style={{ color: 'var(--brand-warning-amber-text)' }}
                                aria-hidden
                              />
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>
                          {p.email ?? '--'}
                        </p>
                      </div>
                    </div>

                    {/* BP */}
                    <div className="hidden md:block min-w-0">
                      <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                        {p.latestBP ? `${p.latestBP.systolicBP}/${p.latestBP.diastolicBP}` : '--/--'}
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
                    </div>

                    {/* Risk */}
                    <div className="hidden md:block min-w-0">
                      <RiskBadge tier={p.riskTier} />
                    </div>

                    {/* Verification (K1) */}
                    <div className="hidden md:block min-w-0">
                      <VerificationBadge status={p.profileVerificationStatus} />
                    </div>

                    {/* Alerts (K2 — tier-color-coded) */}
                    <div className="hidden md:block min-w-0">
                      <AlertsCell alertsByTier={p.alertsByTier} count={p.activeAlertsCount} />
                    </div>

                    {/* Last check-in */}
                    <div className="hidden md:block min-w-0">
                      <p className="text-[12px]" style={{ color: 'var(--brand-text-secondary)' }}>
                        {p.lastEntryDate ? timeAgo(p.lastEntryDate) : 'Never'}
                      </p>
                    </div>

                    {/* Onboarding (K3) */}
                    <div className="hidden md:block min-w-0">
                      <OnboardingCell
                        patient={p}
                        completing={completingId === p.id}
                        cachedReasons={enrollmentReasons[p.id]}
                        canAct={canCompleteEnrollment(user)}
                        onComplete={async () => {
                          setCompletingId(p.id);
                          try {
                            await completePatientEnrollment(p.id);
                            setEnrollmentReasons((prev) => {
                              const { [p.id]: _drop, ...rest } = prev;
                              void _drop;
                              return rest;
                            });
                            setPatients((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, enrollmentStatus: 'ENROLLED' } : x,
                              ),
                            );
                          } catch (err) {
                            const reasons = (err as { reasons?: EnrollmentGateReason[] }).reasons;
                            if (reasons) {
                              setEnrollmentReasons((prev) => ({ ...prev, [p.id]: reasons }));
                            }
                          } finally {
                            setCompletingId(null);
                          }
                        }}
                      />
                    </div>

                    {/* Arrow indicator */}
                    <div className="hidden md:flex items-center justify-center">
                      <ChevronRight
                        className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'var(--brand-text-muted)' }}
                      />
                    </div>

                    {/* Mobile: compact info */}
                    <div className="flex items-center gap-2 md:hidden ml-auto shrink-0">
                      <VerificationBadge status={p.profileVerificationStatus} compact />
                      <RiskBadge tier={p.riskTier} />
                      <AlertsCell alertsByTier={p.alertsByTier} count={p.activeAlertsCount} compact />
                      <ChevronRight
                        className="w-4 h-4 transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'var(--brand-text-muted)' }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      <AnimatePresence>
        {selectedPatient && (
          <PatientModal
            patient={selectedPatient}
            summary={summary}
            loading={summaryLoading}
            onClose={() => setSelectedPatient(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
