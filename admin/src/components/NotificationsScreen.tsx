'use client';

// /admin/notifications — full-page alerts inbox.
//
// CLINICAL_SPEC V2-C Layer 1 — this is the provider's command center for
// handling alerts in place: each card expands inline to show the three-tier
// messages (PATIENT / CAREGIVER / PHYSICIAN) and the escalation audit
// trail; Resolve / Acknowledge act on the alert without leaving the page;
// clicking the row body navigates to the patient profile.
//
// Implementation: reuses the shared AlertCard so /admin/notifications and
// the per-patient AlertsTab render from one source of truth. The Review
// button (v1 legacy) was removed in favor of row-as-nav per spec.
//
// Back button uses router.back() so a user who came in from a patient
// detail returns there.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  Bell,
  CheckCircle2,
  Pill,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  acknowledgeProviderAlert,
  getProviderAlerts,
  type AlertTier,
} from '@/lib/services/provider.service';
import type { PatientAlert } from '@/lib/services/patient-detail.service';
import AlertCard from './AlertCard';
import AlertResolutionModal, { type ResolvableAlert } from './AlertResolutionModal';

// PatientAlert with the provider-wide endpoint's extra fields. The shared
// AlertCard accepts a PatientAlert structurally — this superset is still
// assignable.
type ProviderAlert = PatientAlert & {
  patient: { id: string; name: string | null } | null;
  followUpScheduledAt: string | null;
};

type TierFilter = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'OTHER';

function tierBucket(t: string | null | undefined): TierFilter {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  if (t === 'TIER_1_CONTRAINDICATION') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  return 'OTHER';
}

function bucketChrome(b: TierFilter): {
  label: string;
  accent: string;
  light: string;
  icon: React.ReactNode;
} {
  switch (b) {
    case 'BP_L2':
      return { label: 'BP L2', accent: 'var(--brand-alert-red)', light: 'var(--brand-alert-red-light)', icon: <ShieldAlert className="w-3 h-3" /> };
    case 'TIER_1':
      return { label: 'Tier 1', accent: 'var(--brand-alert-red)', light: 'var(--brand-alert-red-light)', icon: <Pill className="w-3 h-3" /> };
    case 'TIER_2':
      return { label: 'Tier 2', accent: 'var(--brand-warning-amber)', light: 'var(--brand-warning-amber-light)', icon: <ArrowUp className="w-3 h-3" /> };
    case 'BP_L1':
      return { label: 'BP L1', accent: 'var(--brand-warning-amber)', light: 'var(--brand-warning-amber-light)', icon: <Activity className="w-3 h-3" /> };
    default:
      return { label: 'Other', accent: 'var(--brand-text-muted)', light: 'var(--brand-background)', icon: <Bell className="w-3 h-3" /> };
  }
}

function readingOf(a: ProviderAlert): string {
  if (a.journalEntry?.systolicBP != null && a.journalEntry?.diastolicBP != null) {
    return `${a.journalEntry.systolicBP}/${a.journalEntry.diastolicBP} mmHg`;
  }
  if (a.tier === 'TIER_1_CONTRAINDICATION' || a.tier === 'TIER_2_DISCREPANCY') return 'Medication';
  return '—';
}

export default function NotificationsScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<ProviderAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [search, setSearch] = useState('');
  const [resolving, setResolving] = useState<ProviderAlert | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Per-alert ack-in-flight set so the button disables individually (two
  // simultaneous BP L1 acks don't conflate visually).
  const [acking, setAcking] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProviderAlerts().catch(() => []);
      setAlerts(Array.isArray(data) ? (data as ProviderAlert[]) : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Per-tier counts drive the filter chips (always show even tier-empty
  // chips so the filter row doesn't reflow as alerts come and go).
  const counts = useMemo(() => {
    const acc: Record<TierFilter, number> = { ALL: 0, BP_L2: 0, TIER_1: 0, TIER_2: 0, BP_L1: 0, OTHER: 0 };
    for (const a of alerts) {
      acc.ALL++;
      acc[tierBucket(a.tier)]++;
    }
    return acc;
  }, [alerts]);

  const filtered = useMemo(() => {
    let list = alerts;
    if (tierFilter !== 'ALL') list = list.filter((a) => tierBucket(a.tier) === tierFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(
        (a) =>
          (a.patient?.name ?? '').toLowerCase().includes(q) ||
          readingOf(a).toLowerCase().includes(q) ||
          (a.tier ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [alerts, tierFilter, search]);

  const resolvable: ResolvableAlert | null = useMemo(() => {
    if (!resolving) return null;
    return {
      id: resolving.id,
      tier: (resolving.tier ?? null) as AlertTier | null,
      patient: resolving.patient ? { name: resolving.patient.name } : null,
      patientMessage: resolving.patientMessage ?? null,
      journalEntry: resolving.journalEntry
        ? {
            systolicBP: resolving.journalEntry.systolicBP,
            diastolicBP: resolving.journalEntry.diastolicBP,
          }
        : null,
      createdAt: resolving.createdAt,
    };
  }, [resolving]);

  const handleAcknowledge = useCallback(
    async (alertId: string) => {
      setAcking((prev) => {
        const next = new Set(prev);
        next.add(alertId);
        return next;
      });
      try {
        await acknowledgeProviderAlert(alertId);
        await refresh();
      } catch {
        // Soft-fail — the next refresh will reveal the true server state.
      } finally {
        setAcking((prev) => {
          const next = new Set(prev);
          next.delete(alertId);
          return next;
        });
      }
    },
    [refresh],
  );

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      <div className="max-w-5xl mx-auto px-4 md:px-8 py-6 space-y-4">
        {/* Header — back button uses browser history so coming from a patient
            detail returns there, coming from the dashboard returns there. */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-gray-100 cursor-pointer transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="w-4 h-4" style={{ color: 'var(--brand-text-secondary)' }} />
          </button>
          <div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              Alerts
            </h1>
            <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? 'Loading…' : `${counts.ALL} active alert${counts.ALL === 1 ? '' : 's'}`}
            </p>
          </div>
        </div>

        {/* Filters card — search + per-tier chips, mirrors Layer 2 queue. */}
        <div
          className="bg-white rounded-2xl p-4 md:p-5 space-y-3"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 h-9 rounded-full"
            style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by patient, tier, or reading"
              className="flex-1 text-[12px] outline-none bg-transparent min-w-0"
              style={{ color: 'var(--brand-text-primary)' }}
            />
            {search && (
              <button onClick={() => setSearch('')} className="shrink-0" aria-label="Clear search">
                <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            )}
          </div>

          {/* Tier filter chips */}
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              ['ALL', 'All'],
              ['BP_L2', 'BP L2'],
              ['TIER_1', 'Tier 1'],
              ['TIER_2', 'Tier 2'],
              ['BP_L1', 'BP L1'],
            ] as [TierFilter, string][]).map(([key, label]) => {
              const active = tierFilter === key;
              const chrome = key === 'ALL'
                ? { accent: 'var(--brand-primary-purple)', light: 'var(--brand-primary-purple-light)' }
                : bucketChrome(key);
              const count = counts[key];
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTierFilter(key)}
                  className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer"
                  style={{
                    backgroundColor: active ? chrome.accent : chrome.light,
                    color: active ? 'white' : chrome.accent,
                    border: `1.5px solid ${active ? chrome.accent : 'transparent'}`,
                  }}
                >
                  {label}
                  <span
                    className="text-[10px] font-bold px-1.5 rounded-full"
                    style={{
                      backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'white',
                      color: active ? 'white' : chrome.accent,
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

        {/* Alert list — V2-C Layer 1 expandable cards. Row click navigates
            to the patient profile; chevron expands inline; Resolve /
            Acknowledge are inline buttons that stop event propagation. */}
        {loading && alerts.length === 0 ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyCard hasAlerts={alerts.length > 0} />
        ) : (
          <div
            className="bg-white rounded-2xl overflow-hidden"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            {filtered.map((a, idx) => {
              const expanded = expandedId === a.id;
              return (
                <div
                  key={a.id}
                  style={{ borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none' }}
                >
                  <AlertCard
                    alert={a}
                    expanded={expanded}
                    // Row click navigates — replaces the v1 "Review" button.
                    // Falls back to expand-toggle if patient.id is missing
                    // (rare — orphaned alert) so the card still does
                    // something.
                    onRowClick={() => {
                      if (a.patient?.id) router.push(`/patients/${a.patient.id}`);
                      else setExpandedId(expanded ? null : a.id);
                    }}
                    onToggleExpand={() => setExpandedId(expanded ? null : a.id)}
                    onResolve={() => setResolving(a)}
                    onAcknowledge={() => void handleAcknowledge(a.id)}
                    ackInFlight={acking.has(a.id)}
                    patientName={a.patient?.name ?? 'Unknown'}
                    followUpScheduledAt={a.followUpScheduledAt}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <AlertResolutionModal
        alert={resolvable}
        open={!!resolvable}
        onClose={() => setResolving(null)}
        onResolved={() => {
          setResolving(null);
          void refresh();
        }}
      />
    </div>
  );
}

function EmptyCard({ hasAlerts }: { hasAlerts: boolean }) {
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <CheckCircle2
          className="w-7 h-7"
          style={{ color: hasAlerts ? 'var(--brand-text-muted)' : 'var(--brand-success-green)' }}
        />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
        {hasAlerts ? 'No alerts match your filter' : 'No active alerts'}
      </p>
      <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
        {hasAlerts ? 'Widen the search or pick a different tier.' : 'All open alerts have been resolved or acknowledged.'}
      </p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-16 rounded-xl animate-pulse"
          style={{ backgroundColor: '#F3EEFB' }}
        />
      ))}
    </div>
  );
}
