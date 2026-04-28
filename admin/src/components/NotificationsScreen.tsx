'use client';

// /admin/notifications — full-page alerts inbox.
//
// Mirrors the dashboard's Alert queue: filterable list of open alerts
// with inline Review + Resolve buttons, no animations. The dashboard's
// Layer 2 queue is the dashboard-side preview; this page is the
// stand-alone surface the bell dropdown's "View all" lands on.
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
  Clock,
  Pill,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  getProviderAlerts,
  resolutionTierFor,
  type AlertTier,
} from '@/lib/services/provider.service';
import AlertResolutionModal, { type ResolvableAlert } from './AlertResolutionModal';

interface RawAlert {
  id: string;
  tier?: string | null;
  ruleId?: string | null;
  patientMessage?: string | null;
  createdAt: string;
  patient?: { id: string; name: string | null } | null;
  journalEntry?: { systolicBP: number | null; diastolicBP: number | null } | null;
  followUpScheduledAt?: string | null;
}

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

function readingOf(a: RawAlert): string {
  if (a.journalEntry?.systolicBP != null && a.journalEntry?.diastolicBP != null) {
    return `${a.journalEntry.systolicBP}/${a.journalEntry.diastolicBP} mmHg`;
  }
  if (a.tier === 'TIER_1_CONTRAINDICATION' || a.tier === 'TIER_2_DISCREPANCY') return 'Medication';
  return '—';
}

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
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

export default function NotificationsScreen() {
  const router = useRouter();
  const [alerts, setAlerts] = useState<RawAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [search, setSearch] = useState('');
  const [resolving, setResolving] = useState<RawAlert | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProviderAlerts().catch(() => []);
      setAlerts(Array.isArray(data) ? data : []);
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

        {/* Alert list — mirror of Layer 2 queue rows. No animation. */}
        {loading && alerts.length === 0 ? (
          <ListSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyCard hasAlerts={alerts.length > 0} />
        ) : (
          <div
            className="bg-white rounded-2xl p-3 md:p-4"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <ul className="space-y-2">
              {filtered.map((a) => {
                const bucket = tierBucket(a.tier);
                const chrome = bucketChrome(bucket);
                const canResolve = resolutionTierFor(a.tier ?? null) != null;
                return (
                  <li key={a.id}>
                    <div
                      className="rounded-xl p-3 flex items-center gap-3 transition-all hover:brightness-[0.98]"
                      style={{
                        backgroundColor: chrome.light,
                        borderLeft: `4px solid ${chrome.accent}`,
                      }}
                    >
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[10.5px] shrink-0"
                        style={{ backgroundColor: chrome.accent }}
                      >
                        {initialsOf(a.patient?.name)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                            {a.patient?.name ?? 'Unknown'}
                          </span>
                          <span
                            className="inline-flex items-center gap-1 text-[9.5px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                            style={{ backgroundColor: 'white', color: chrome.accent }}
                          >
                            {chrome.icon}
                            {chrome.label}
                          </span>
                          {a.followUpScheduledAt && (
                            <span
                              className="text-[9.5px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}
                            >
                              Call scheduled
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11.5px] font-bold" style={{ color: chrome.accent }}>
                            {readingOf(a)}
                          </span>
                          <span className="text-[10.5px] inline-flex items-center gap-1" style={{ color: 'var(--brand-text-muted)' }}>
                            <Clock className="w-2.5 h-2.5" />
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        {a.patientMessage && (
                          <p className="text-[11.5px] mt-0.5 leading-snug line-clamp-2" style={{ color: 'var(--brand-text-secondary)' }}>
                            {a.patientMessage}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <button
                          type="button"
                          className="h-7 px-2.5 rounded-lg text-[11px] font-semibold transition-all hover:brightness-95 cursor-pointer"
                          style={{
                            backgroundColor: 'white',
                            color: chrome.accent,
                            border: `1.5px solid ${chrome.accent}`,
                          }}
                          onClick={() => {
                            if (a.patient?.id) router.push(`/patients/${a.patient.id}`);
                          }}
                          disabled={!a.patient?.id}
                        >
                          Review
                        </button>
                        {canResolve && (
                          <button
                            type="button"
                            className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:brightness-95 cursor-pointer inline-flex items-center gap-1"
                            style={{ backgroundColor: chrome.accent }}
                            onClick={() => setResolving(a)}
                          >
                            {bucket === 'BP_L2' && <CheckCircle2 className="w-3 h-3" />}
                            Resolve
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
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
