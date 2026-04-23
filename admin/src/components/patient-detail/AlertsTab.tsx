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


export default function AlertsTab({ alerts, loading, onResolved }: Props) {
  const [tierFilter, setTierFilter] = useState<TierBucket>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<PatientAlert | null>(null);

  const counts = useMemo(() => {
    const acc: Record<TierBucket, number> = { ALL: 0, BP_L2: 0, TIER_1: 0, TIER_2: 0, BP_L1: 0, TIER_3: 0, OTHER: 0 };
    for (const a of alerts) {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) continue;
      acc.ALL++;
      acc[tierBucket(a.tier)]++;
    }
    return acc;
  }, [alerts, statusFilter]);

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (statusFilter !== 'ALL' && a.status !== statusFilter) return false;
      if (tierFilter !== 'ALL' && tierBucket(a.tier) !== tierFilter) return false;
      return true;
    });
  }, [alerts, tierFilter, statusFilter]);

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

        {/* Tier filter chips */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['ALL', 'All'],
            ['BP_L2', 'BP L2'],
            ['TIER_1', 'Tier 1'],
            ['TIER_2', 'Tier 2'],
            ['BP_L1', 'BP L1'],
            ['TIER_3', 'Tier 3'],
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
                        <span className="ml-2 font-bold" style={{ color: chrome.color }}>
                          {a.journalEntry.systolicBP}/{a.journalEntry.diastolicBP}
                        </span>
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
                    <EscalationAuditTrail alert={a} />
                  </div>
                )}
              </div>
            );
          })}
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

