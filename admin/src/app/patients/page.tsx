'use client';

import { useState, useEffect } from 'react';
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
import { useLanguage } from '@/contexts/LanguageContext';
import { getPatients, getPatientSummary } from '@/lib/services/provider.service';
import {
  completePatientOnboarding,
  ENROLLMENT_REASON_LABELS,
  type EnrollmentGateReason,
} from '@/lib/services/practice.service';

// ─── Types ────────────────────────────────────────────────────────────────────
interface Patient {
  id: string;
  name: string | null;
  email: string | null;
  riskTier: string;
  communicationPreference: string | null;
  primaryCondition: string | null;
  onboardingStatus: string;
  // Flow K — verification + per-tier alert breakdown drive the new
  // verification status column and the tier-color-coded count badge.
  profileVerificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED' | null;
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
    color: 'var(--brand-alert-red)',
    border: 'var(--brand-alert-red)',
  },
  ELEVATED: {
    bg: 'var(--brand-warning-amber-light)',
    color: 'var(--brand-warning-amber)',
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

// ─── Flow K2 — Open-alert count badge with tier color coding ────────────────

/** Highest-severity tier among the patient's open alerts. */
function highestTier(alertsByTier: Record<string, number> | undefined): string | null {
  if (!alertsByTier) return null;
  const order = [
    'BP_LEVEL_2',
    'BP_LEVEL_2_SYMPTOM_OVERRIDE',
    'TIER_1_CONTRAINDICATION',
    'TIER_2_DISCREPANCY',
    'BP_LEVEL_1_HIGH',
    'BP_LEVEL_1_LOW',
    'TIER_3_INFO',
  ];
  for (const t of order) {
    if ((alertsByTier[t] ?? 0) > 0) return t;
  }
  // Fall back to any non-zero key (catches `UNTIERED` legacy alerts).
  const fallback = Object.entries(alertsByTier).find(([, n]) => n > 0);
  return fallback ? fallback[0] : null;
}

function tierChrome(tier: string | null): { bg: string; color: string; label: string } {
  switch (tier) {
    case 'BP_LEVEL_2':
    case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
      return { bg: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)', label: 'BP L2' };
    case 'TIER_1_CONTRAINDICATION':
      return { bg: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)', label: 'Tier 1' };
    case 'TIER_2_DISCREPANCY':
      return { bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)', label: 'Tier 2' };
    case 'BP_LEVEL_1_HIGH':
    case 'BP_LEVEL_1_LOW':
      return { bg: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)', label: 'BP L1' };
    case 'TIER_3_INFO':
      return { bg: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)', label: 'Tier 3' };
    default:
      return { bg: 'var(--brand-background)', color: 'var(--brand-text-muted)', label: 'Open' };
  }
}

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
    return <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>None</span>;
  }
  const top = highestTier(alertsByTier);
  const chrome = tierChrome(top);
  // Build a hover title with the per-tier breakdown so the admin sees the
  // mix at a glance even when the badge can only show the worst offender.
  const breakdown = alertsByTier
    ? Object.entries(alertsByTier)
        .filter(([, n]) => n > 0)
        .map(([t, n]) => `${tierChrome(t).label}: ${n}`)
        .join(' · ')
    : '';
  if (compact) {
    return (
      <span
        className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
        style={{ backgroundColor: chrome.color }}
        title={breakdown}
      >
        {count}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ backgroundColor: chrome.bg, color: chrome.color }}
      title={breakdown}
    >
      <AlertTriangle className="w-3 h-3" />
      {count} {chrome.label}
    </span>
  );
}

// ─── Flow K3 — Complete onboarding CTA + 409-tooltip ────────────────────────

function OnboardingCell({
  patient,
  completing,
  cachedReasons,
  onComplete,
}: {
  patient: Patient;
  completing: boolean;
  cachedReasons?: EnrollmentGateReason[];
  onComplete: () => void | Promise<void>;
}) {
  const [showTip, setShowTip] = useState(false);

  if (patient.onboardingStatus === 'COMPLETED') {
    return (
      <span
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
        style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
      >
        <CheckCircle2 className="w-2.5 h-2.5" />
        Onboarded
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
          style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
        >
          <Info className="w-3 h-3" />
        </button>
      )}
      {blocked && showTip && (
        <div
          className="absolute right-0 top-full mt-1.5 z-20 w-64 rounded-lg p-3 text-left"
          style={{
            backgroundColor: '#0F172A',
            color: 'white',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-[10px] font-bold uppercase tracking-wider mb-1.5" style={{ color: '#FCD34D' }}>
            Cannot complete · prerequisites missing
          </p>
          <ul className="space-y-1.5">
            {cachedReasons!.map((r) => (
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
              <p className="text-white/70 text-[12px]">{patient.email ?? '--'}</p>
            </div>
          </div>
          <button
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
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: 'var(--brand-warning-amber)' }} />
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
                              <span
                                className="inline-block w-2 h-2 rounded-full"
                                style={{
                                  backgroundColor: entry.medicationTaken
                                    ? 'var(--brand-success-green)'
                                    : entry.medicationTaken === false
                                    ? 'var(--brand-alert-red)'
                                    : 'var(--brand-border)',
                                }}
                              />
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

  // Load patients
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

  if (user?.email !== 'support@healplace.com') {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="text-center p-8 rounded-2xl bg-white" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
          >
            <Shield className="w-7 h-7" style={{ color: 'var(--brand-alert-red)' }} />
          </div>
          <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
            403 — Access Denied
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

          <div className="flex items-center gap-2">
            {/* Search */}
            <div
              className="flex items-center gap-2 px-3 h-9 rounded-full flex-1 sm:flex-none sm:w-56"
              style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)' }}
            >
              <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('provider.searchPatients')}
                className="flex-1 text-[12px] outline-none bg-transparent"
                style={{ color: 'var(--brand-text-primary)' }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="shrink-0">
                  <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              )}
            </div>

            {/* Risk filter */}
            <div className="relative">
              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                className="appearance-none h-9 pl-3 pr-7 rounded-full text-[12px] font-semibold outline-none cursor-pointer"
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

            {/* Flow K1 — Awaiting verification quick-toggle chip */}
            {(() => {
              const count = patients.filter((p) => p.profileVerificationStatus !== 'VERIFIED').length;
              const active = awaitingVerificationOnly;
              return (
                <button
                  type="button"
                  onClick={() => setAwaitingVerificationOnly((v) => !v)}
                  aria-pressed={active}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold transition-all cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--brand-warning-amber)' : 'var(--brand-warning-amber-light)',
                    color: active ? 'white' : 'var(--brand-warning-amber)',
                    border: `1.5px solid ${active ? 'var(--brand-warning-amber)' : 'transparent'}`,
                  }}
                >
                  <ShieldAlert className="w-3 h-3" />
                  Awaiting verification
                  <span
                    className="text-[10px] font-bold px-1.5 rounded-full"
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
                      className="w-3 h-3"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAwaitingVerificationOnly(false);
                      }}
                    />
                  )}
                </button>
              );
            })()}
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
            <div className="py-16 text-center">
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
                  <div
                    key={p.id}
                    onClick={() => router.push(`/patients/${p.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        router.push(`/patients/${p.id}`);
                      }
                    }}
                    className="w-full text-left px-5 py-3.5 flex items-center gap-4 md:grid md:gap-3 transition-colors hover:bg-[#F8F4FF] cursor-pointer group"
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
                        <p className="text-[13px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                          {p.name ?? 'Unknown'}
                        </p>
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
                        onComplete={async () => {
                          setCompletingId(p.id);
                          try {
                            await completePatientOnboarding(p.id);
                            setEnrollmentReasons((prev) => {
                              const { [p.id]: _drop, ...rest } = prev;
                              void _drop;
                              return rest;
                            });
                            setPatients((prev) =>
                              prev.map((x) =>
                                x.id === p.id ? { ...x, onboardingStatus: 'COMPLETED' } : x,
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
