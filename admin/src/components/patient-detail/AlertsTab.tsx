'use client';

// Flow H3 — per-patient alerts tab.
//
// • Tier filter chips (All / BP L2 / Tier 1 / Tier 2 / BP L1 / Tier 3)
// • Status filter (All / Open / Resolved)
// • Each row expands to show three-tier messages (patient / caregiver /
//   physician) and the escalation ladder for that alert.
// • Resolve button (only on OPEN alerts whose tier maps to a catalog group)
//   opens the Flow G AlertResolutionModal.

import { useMemo, useState } from 'react';
import {
  Bell,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock as ClockIcon,
  Pill,
  ArrowUp,
  ShieldAlert,
  Activity,
  AlertTriangle,
  User as UserIcon,
  Users,
  Stethoscope,
} from 'lucide-react';
import AlertResolutionModal, { type ResolvableAlert } from '@/components/AlertResolutionModal';
import EscalationAuditTrail from './EscalationAuditTrail';
import {
  resolutionTierFor,
  type AlertTier,
} from '@/lib/services/provider.service';
import type {
  PatientAlert,
} from '@/lib/services/patient-detail.service';

interface Props {
  alerts: PatientAlert[];
  loading: boolean;
  onResolved: () => void;
  /** PatientProfile.heightCm — passed through to EscalationAuditTrail
   *  so the resolution audit footer can compute BMI alongside PP. */
  heightCm?: number | null;
}

type TierBucket = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3' | 'OTHER';
type StatusFilter = 'ALL' | 'OPEN' | 'RESOLVED';

function tierBucket(t: string | null): TierBucket {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  if (t === 'TIER_1_CONTRAINDICATION') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (t === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

function bucketChrome(b: TierBucket) {
  switch (b) {
    case 'BP_L2': return { label: 'BP Level 2', color: 'var(--brand-alert-red)', bg: 'var(--brand-alert-red-light)', icon: <ShieldAlert className="w-3 h-3" /> };
    case 'TIER_1': return { label: 'Tier 1', color: 'var(--brand-alert-red)', bg: 'var(--brand-alert-red-light)', icon: <Pill className="w-3 h-3" /> };
    case 'TIER_2': return { label: 'Tier 2', color: 'var(--brand-warning-amber)', bg: 'var(--brand-warning-amber-light)', icon: <ArrowUp className="w-3 h-3" /> };
    case 'BP_L1': return { label: 'BP Level 1', color: 'var(--brand-warning-amber)', bg: 'var(--brand-warning-amber-light)', icon: <Activity className="w-3 h-3" /> };
    case 'TIER_3': return { label: 'Tier 3', color: 'var(--brand-accent-teal)', bg: 'var(--brand-accent-teal-light)', icon: <Bell className="w-3 h-3" /> };
    default: return { label: 'Other', color: 'var(--brand-text-muted)', bg: 'var(--brand-background)', icon: <AlertTriangle className="w-3 h-3" /> };
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


export default function AlertsTab({ alerts, loading, onResolved, heightCm }: Props) {
  const [tierFilter, setTierFilter] = useState<TierBucket>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<PatientAlert | null>(null);

  // Tier 3 (TIER_3_INFO) is informational physician-only context per
  // CLINICAL_SPEC V2-C Layer 1 — it should NOT mix with safety-critical
  // alerts in the main queue. Surface it in the dedicated "Physician
  // notes" section below the main list instead.
  const tier3Alerts = useMemo(
    () => alerts.filter((a) => tierBucket(a.tier) === 'TIER_3'),
    [alerts],
  );
  const nonTier3Alerts = useMemo(
    () => alerts.filter((a) => tierBucket(a.tier) !== 'TIER_3'),
    [alerts],
  );

  const counts = useMemo(() => {
    const acc: Record<TierBucket, number> = { ALL: 0, BP_L2: 0, TIER_1: 0, TIER_2: 0, BP_L1: 0, TIER_3: 0, OTHER: 0 };
    for (const a of nonTier3Alerts) {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) continue;
      acc.ALL++;
      acc[tierBucket(a.tier)]++;
    }
    return acc;
  }, [nonTier3Alerts, statusFilter]);

  const filtered = useMemo(() => {
    return nonTier3Alerts.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (tierFilter !== 'ALL' && tierBucket(a.tier) !== tierFilter) return false;
      return true;
    });
  }, [nonTier3Alerts, tierFilter, statusFilter]);

  const resolvable: ResolvableAlert | null = useMemo(() => {
    if (!resolving) return null;
    return {
      id: resolving.id,
      tier: resolving.tier as AlertTier | null,
      patient: { name: null },
      patientMessage: resolving.patientMessage,
      journalEntry: resolving.journalEntry
        ? {
          systolicBP: resolving.journalEntry.systolicBP,
          diastolicBP: resolving.journalEntry.diastolicBP,
          entryDate: resolving.journalEntry.measuredAt,
        }
        : null,
      createdAt: resolving.createdAt,
    };
  }, [resolving]);

  if (loading && alerts.length === 0) {
    return (
      <div className="bg-white rounded-2xl p-6 animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        <div className="h-4 w-48 rounded-full mb-4" style={{ backgroundColor: '#EDE9F6' }} />
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: '#F3EEFB' }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters card */}
      <div className="bg-white rounded-2xl p-4 md:p-5 space-y-3" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        {/* Status segmented control */}
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
            Status
          </span>
          <div
            className="inline-flex p-1 rounded-full"
            style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
          >
            {(['OPEN', 'RESOLVED', 'ALL'] as StatusFilter[]).map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className="px-2.5 h-6 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer"
                  style={{
                    backgroundColor: active ? 'white' : 'transparent',
                    color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                    boxShadow: active ? 'var(--brand-shadow-card)' : 'none',
                  }}
                >
                  {s === 'OPEN' ? 'Open' : s === 'RESOLVED' ? 'Resolved' : 'All'}
                </button>
              );
            })}
          </div>
        </div>

        {/* Tier filter chips — Tier 3 omitted; rendered separately in the
            "Physician notes" section below since it's informational. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['ALL', 'All'],
            ['BP_L2', 'BP L2'],
            ['TIER_1', 'Tier 1'],
            ['TIER_2', 'Tier 2'],
            ['BP_L1', 'BP L1'],
          ] as [TierBucket, string][]).map(([key, label]) => {
            const active = tierFilter === key;
            const chrome = key === 'ALL'
              ? { color: 'var(--brand-primary-purple)', bg: 'var(--brand-primary-purple-light)' }
              : bucketChrome(key);
            const count = counts[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => setTierFilter(key)}
                className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer"
                style={{
                  backgroundColor: active ? chrome.color : chrome.bg,
                  color: active ? 'white' : chrome.color,
                  border: `1.5px solid ${active ? chrome.color : 'transparent'}`,
                }}
              >
                {label}
                <span
                  className="text-[10px] font-bold px-1.5 rounded-full"
                  style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'white',
                    color: active ? 'white' : chrome.color,
                    minWidth: 18,
                    textAlign: 'center',
                  }}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <CheckCircle2 className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-success-green)' }} />
          <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
            No alerts match your filter
          </p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
            Try widening the status or tier filters above.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          {filtered.map((a, idx) => {
            const bucket = tierBucket(a.tier);
            const chrome = bucketChrome(bucket);
            const expanded = expandedId === a.id;
            const canResolve = a.status === 'OPEN' && resolutionTierFor(a.tier) != null;
            return (
              <div
                key={a.id}
                style={{
                  borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none',
                }}
              >
                {/* Row */}
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : a.id)}
                  className="w-full text-left px-4 md:px-5 py-3 flex items-center gap-3 transition-colors hover:bg-gray-50 cursor-pointer"
                >
                  <div
                    className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-white"
                    style={{ backgroundColor: chrome.color }}
                    aria-hidden
                  >
                    {chrome.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center flex-wrap gap-2">
                      <span
                        className="text-[10px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: chrome.bg, color: chrome.color }}
                      >
                        {chrome.label}
                      </span>
                      {a.status === 'RESOLVED' && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}
                        >
                          <CheckCircle2 className="w-2.5 h-2.5" />
                          Resolved
                        </span>
                      )}
                      {a.escalated && (
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red)' }}
                        >
                          Escalated
                        </span>
                      )}
                    </div>
                    <p className="text-[12.5px] mt-0.5 line-clamp-1" style={{ color: 'var(--brand-text-primary)' }}>
                      {a.patientMessage ?? a.type ?? 'Alert'}
                      {a.journalEntry?.systolicBP != null && a.journalEntry?.diastolicBP != null && (
                        <>
                          <span className="ml-2 font-bold" style={{ color: chrome.color }}>
                            {a.journalEntry.systolicBP}/{a.journalEntry.diastolicBP}
                          </span>
                          {/* Pulse pressure inline — clinical signal admins
                              scan for at a glance. Not shown to patients. */}
                          <span
                            className="ml-1.5 text-[10px] font-semibold px-1 py-0.5 rounded"
                            style={{
                              backgroundColor:
                                a.journalEntry.systolicBP - a.journalEntry.diastolicBP > 60
                                  ? 'var(--brand-warning-amber-light)'
                                  : 'var(--brand-background)',
                              color:
                                a.journalEntry.systolicBP - a.journalEntry.diastolicBP > 60
                                  ? 'var(--brand-warning-amber)'
                                  : 'var(--brand-text-secondary)',
                            }}
                            title="Pulse pressure (SBP − DBP)"
                          >
                            PP {a.journalEntry.systolicBP - a.journalEntry.diastolicBP}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="text-[10.5px] mt-0.5 inline-flex items-center gap-1" style={{ color: 'var(--brand-text-muted)' }}>
                      <ClockIcon className="w-2.5 h-2.5" />
                      {timeAgo(a.createdAt)} · {a.ruleId ?? '—'}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canResolve && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setResolving(a);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setResolving(a);
                          }
                        }}
                        className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:brightness-95 cursor-pointer inline-flex items-center"
                        style={{ backgroundColor: chrome.color }}
                      >
                        Resolve
                      </span>
                    )}
                    {expanded ? (
                      <ChevronUp className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
                    ) : (
                      <ChevronDown className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
                    )}
                  </div>
                </button>

                {/* Expanded body */}
                {expanded && (
                  <div className="px-4 md:px-5 pb-4 pt-1 space-y-3" style={{ backgroundColor: 'var(--brand-background)' }}>
                    {/* Three-tier messages */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-3">
                      <ThreeTierMessageCard
                        title="Patient"
                        icon={<UserIcon className="w-3 h-3" />}
                        message={a.patientMessage}
                        color="var(--brand-primary-purple)"
                      />
                      <ThreeTierMessageCard
                        title="Caregiver"
                        icon={<Users className="w-3 h-3" />}
                        message={a.caregiverMessage}
                        color="var(--brand-accent-teal)"
                      />
                      <ThreeTierMessageCard
                        title="Physician"
                        icon={<Stethoscope className="w-3 h-3" />}
                        message={a.physicianMessage}
                        color="var(--brand-text-secondary)"
                      />
                    </div>

                    {/* Flow I — vertical escalation audit trail (T+0 → T+48h)
                        with per-step recipients, channels, ack timestamps,
                        and the 15-field resolution audit footer. Replaces
                        the prior horizontal pill ladder + standalone
                        resolution receipt. */}
                    <EscalationAuditTrail alert={a} heightCm={heightCm} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Physician notes — Tier 3 informational alerts. Visually separated
          from the main alert list so they don't compete with safety-critical
          tiers for attention. Quiet teal palette + Stethoscope icon signals
          "context for the clinician" rather than "action required". Per
          CLINICAL_SPEC V2-C Layer 1 these are physician-only and have no
          patientMessage / caregiverMessage. */}
      {tier3Alerts.length > 0 && (
        <div
          className="bg-white rounded-2xl overflow-hidden"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <div
            className="px-4 md:px-5 py-2.5 flex items-center gap-2"
            style={{
              backgroundColor: 'var(--brand-accent-teal-light)',
              borderBottom: '1px solid var(--brand-border)',
            }}
          >
            <Stethoscope className="w-3.5 h-3.5" style={{ color: 'var(--brand-accent-teal)' }} />
            <p
              className="text-[11px] font-bold uppercase tracking-wider"
              style={{ color: 'var(--brand-accent-teal)' }}
            >
              Physician notes
            </p>
            <span
              className="text-[10px] font-bold px-1.5 rounded-full ml-auto"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-accent-teal)',
                minWidth: 18,
                textAlign: 'center',
              }}
            >
              {tier3Alerts.length}
            </span>
          </div>
          {tier3Alerts.map((a, idx) => (
            <div
              key={a.id}
              className="px-4 md:px-5 py-3"
              style={{ borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none' }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-accent-teal)' }}
                  aria-hidden
                >
                  <Bell className="w-3 h-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10.5px] mb-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                    {a.ruleId ?? '—'} · {timeAgo(a.createdAt)}
                  </p>
                  <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--brand-text-primary)' }}>
                    {a.physicianMessage ?? a.patientMessage ?? a.type ?? 'Physician note'}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolution modal — re-uses the Flow G modal */}
      <AlertResolutionModal
        alert={resolvable}
        open={!!resolvable}
        onClose={() => setResolving(null)}
        onResolved={() => {
          setResolving(null);
          onResolved();
        }}
      />
    </div>
  );
}

function ThreeTierMessageCard({
  title,
  icon,
  message,
  color,
}: {
  title: string;
  icon: React.ReactNode;
  message: string | null;
  color: string;
}) {
  return (
    <div
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

