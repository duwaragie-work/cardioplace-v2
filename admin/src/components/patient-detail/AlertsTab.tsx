'use client';

// Flow H3 — per-patient alerts tab.
//
// • Tier filter chips (All / BP L2 / Tier 1 / Tier 2 / BP L1 / Tier 3)
// • Status filter (Open / Acknowledged / Resolved / All)
// • Each row uses the shared AlertCard (extracted Nov 2026 so the same
//   inline expand + three-tier + Resolve / Acknowledge surface is reused
//   on /admin/notifications per CLINICAL_SPEC V2-C Layer 1).

import { useCallback, useMemo, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  Stethoscope,
  Clock as ClockIcon,
} from 'lucide-react';
import AlertResolutionModal, { type ResolvableAlert } from '@/components/AlertResolutionModal';
import AlertCard from '@/components/AlertCard';
import {
  acknowledgeProviderAlert,
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
  /** Patient display name — the per-patient alerts endpoint omits the
   *  nested patient object (you're already in the patient's page), so the
   *  resolve modal showed "Unknown patient". Thread it from the shell.
   *  (Phase 1 polish Finding 8.) */
  patientName?: string | null;
}

type TierBucket = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3' | 'OTHER';
type StatusFilter = 'ALL' | 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

function tierBucket(t: string | null): TierBucket {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  if (t === 'TIER_1_CONTRAINDICATION') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (t === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

function bucketChromeFilter(b: TierBucket): { color: string; bg: string } {
  switch (b) {
    case 'BP_L2': return { color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_1': return { color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_2': return { color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'BP_L1': return { color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'TIER_3': return { color: 'var(--brand-accent-teal)', bg: 'var(--brand-accent-teal-light)' };
    default: return { color: 'var(--brand-text-muted)', bg: 'var(--brand-background)' };
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

export default function AlertsTab({ alerts, loading, onResolved, heightCm, patientName }: Props) {
  const [tierFilter, setTierFilter] = useState<TierBucket>('ALL');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<PatientAlert | null>(null);
  // Per-alert ack-in-flight set so the button disables while the request
  // is pending. A Set rather than a boolean so two simultaneous BP L1 acks
  // don't collide visually.
  const [acking, setAcking] = useState<Set<string>>(new Set());

  // Tier 3 (TIER_3_INFO) is informational physician-only context per
  // CLINICAL_SPEC V2-C Layer 1 — it should NOT mix with safety-critical
  // alerts in the main queue. Surface it in the dedicated "Physician
  // notes" section below the main list instead.
  // Cluster 8 Q1: RULE_BRADY_SURVEILLANCE is intentionally NON-medication-
  // linked, so (unlike RULE_HCM_VASODILATOR / RULE_LOOP_DIURETIC_HYPOTENSION
  // which MedicationsTab inlines via tier3DrugClassFor) it has no drug-class
  // row to attach to — it correctly surfaces in this Physician-notes section
  // + as a "Surveillance" pill on the triggering reading (Cluster 8.1 Gap 5).
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

  // Cluster 6 Q4 (Manisha 5/9/26) — group alerts that came off the same
  // reading (matched on JournalEntry.measuredAt — proxy for journalEntryId
  // since the API doesn't surface the id directly). The "2 active alerts"
  // header makes it clear to the provider that the rows are independent
  // findings on one event (e.g. pregnancy ACE + L2 BP + L1 high).
  const groupCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of filtered) {
      const key = a.journalEntry?.measuredAt;
      if (!key) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filtered]);

  const resolvable: ResolvableAlert | null = useMemo(() => {
    if (!resolving) return null;
    return {
      id: resolving.id,
      tier: resolving.tier as AlertTier | null,
      // Finding 8 — the per-patient alerts feed omits the nested patient
      // object; thread the name from the shell so the modal header reads
      // "James Okafor · 118/74" not "Unknown patient · 118/74".
      patient: { name: patientName ?? null },
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
  }, [resolving, patientName]);

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      setAcking((prev) => {
        const next = new Set(prev);
        next.add(alertId);
        return next;
      });
      try {
        await acknowledgeProviderAlert(alertId);
        onResolved();
      } catch {
        // Soft-fail — caller's onResolved refetch will reveal the true
        // server state. Surface error toasts via the parent if desired.
      } finally {
        setAcking((prev) => {
          const next = new Set(prev);
          next.delete(alertId);
          return next;
        });
      }
    },
    [onResolved],
  );

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
            {(['OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'ALL'] as StatusFilter[]).map((s) => {
              const active = statusFilter === s;
              return (
                <button
                  key={s}
                  data-testid={`admin-alerts-status-filter-${s}`}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className="px-2.5 h-6 rounded-full text-[10.5px] font-semibold transition-all cursor-pointer"
                  style={{
                    backgroundColor: active ? 'white' : 'transparent',
                    color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                    boxShadow: active ? 'var(--brand-shadow-card)' : 'none',
                  }}
                >
                  {s === 'OPEN'
                    ? 'Open'
                    : s === 'ACKNOWLEDGED'
                      ? 'Acknowledged'
                      : s === 'RESOLVED'
                        ? 'Resolved'
                        : 'All'}
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
              : bucketChromeFilter(key);
            const count = counts[key];
            return (
              <button
                key={key}
                data-testid={`admin-alerts-tier-filter-${key}`}
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
        <div data-testid="admin-alerts-empty" className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
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
            const expanded = expandedId === a.id;
            const toggle = () => setExpandedId(expanded ? null : a.id);
            // Cluster 6 Q4 — render a "Same reading" group header above
            // the first alert of any reading that produced ≥2 rows.
            const measuredAtKey = a.journalEntry?.measuredAt ?? null;
            const groupCount = measuredAtKey ? (groupCounts.get(measuredAtKey) ?? 1) : 1;
            const prevMeasuredAtKey =
              idx > 0 ? (filtered[idx - 1].journalEntry?.measuredAt ?? null) : null;
            const isGroupStart =
              groupCount >= 2 && measuredAtKey != null && measuredAtKey !== prevMeasuredAtKey;
            return (
              <div
                key={a.id}
                style={{
                  borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none',
                }}
              >
                {isGroupStart && (
                  <div
                    className="px-4 py-2 text-[11px] font-semibold uppercase tracking-wider"
                    style={{
                      backgroundColor: 'var(--brand-background)',
                      color: 'var(--brand-text-muted)',
                      borderBottom: '1px solid var(--brand-border)',
                    }}
                  >
                    {groupCount} alerts from the same reading — independently resolvable
                  </div>
                )}
                <AlertCard
                  alert={a}
                  expanded={expanded}
                  // On the per-patient tab the row IS the toggle — clicking
                  // anywhere in the row body expands/collapses, matching the
                  // pre-extract behavior. The chevron mirrors that handler.
                  onRowClick={toggle}
                  onToggleExpand={toggle}
                  onResolve={() => setResolving(a)}
                  onAcknowledge={() => void handleAcknowledge(a.id)}
                  ackInFlight={acking.has(a.id)}
                  heightCm={heightCm}
                />
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
                  <p className="text-[10.5px] mb-0.5 inline-flex items-center gap-1" style={{ color: 'var(--brand-text-muted)' }}>
                    <ClockIcon className="w-2.5 h-2.5" />
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
