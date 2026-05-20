'use client';

// /admin/notifications — full-page tabbed inbox.
//
// Two top-level tabs mirror the patient app's notifications page:
//   • Alerts        — clinical alert queue (V2-C Layer 1). Each card
//                     expands inline, Resolve / Acknowledge act in place,
//                     row click navigates to the patient profile.
//                     Reuses AlertCard so this and per-patient AlertsTab
//                     render from one source of truth.
//   • Notifications — admin's personal inbox of dispatched notifications
//                     (escalation pings, etc.). Mirrors the patient page
//                     pattern: all/unread/read filter, per-card tap-to-read,
//                     and a "mark all read" button.
//
// Back button uses router.back() so a user who came in from a patient
// detail returns there.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Activity,
  ArrowLeft,
  ArrowUp,
  Bell,
  CheckCheck,
  CheckCircle2,
  Pill,
  Search,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  acknowledgeProviderAlert,
  getAdminNotifications,
  getProviderAlerts,
  markAdminNotificationsReadBulk,
  type AdminNotificationDto,
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
type TopTab = 'alerts' | 'notifications';
type NotifFilter = 'all' | 'unread' | 'read';

function tierBucket(t: string | null | undefined): TierFilter {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  // Cluster 8 — angioedema buckets into TIER_1 (same chrome + filter group
  // as contraindications) per Manisha "resolved like all Tier 1 alerts".
  if (t === 'TIER_1_CONTRAINDICATION' || t === 'TIER_1_ANGIOEDEMA') return 'TIER_1';
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
  // Cluster 8 — angioedema is medication-linked (ACE/ARB branches) → same
  // "Medication" reading category as Tier 1 contraindication / Tier 2.
  if (
    a.tier === 'TIER_1_CONTRAINDICATION' ||
    a.tier === 'TIER_1_ANGIOEDEMA' ||
    a.tier === 'TIER_2_DISCREPANCY'
  ) return 'Medication';
  return '—';
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Window event the bell + this page both speak. Any local mutation that
// changes alert/notification state broadcasts so siblings can refresh on
// the same tick without waiting for the 30s poll. Same convention as the
// patient app.
//
// `detail` is an OPTIONAL delta hint: when the source already knows how
// the count changed (e.g. "marked 3 notifications read"), it includes the
// delta so listeners can update their badges instantly without a server
// round-trip. Listeners that receive a delta should skip the reconciliation
// fetch — applying the delta + re-fetching simultaneously races against
// the source's PATCH and can overwrite the optimistic value with stale
// server data.
const NOTIF_CHANGE_EVENT = 'cardio:notifications-changed';

type NotifChangeDetail = {
  /** Change in unread-notification count. Negative = mark-read. */
  unreadDelta?: number;
  /** Change in open-alert count. Negative = acknowledged/resolved. */
  alertDelta?: number;
};

function broadcastChange(detail?: NotifChangeDetail) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<NotifChangeDetail>(NOTIF_CHANGE_EVENT, { detail }));
  }
}

export default function NotificationsScreen() {
  const router = useRouter();
  // ?tab=notifications opens directly on the personal-inbox tab — used by
  // the top-bar bell so "View all →" lands on the read/unread inbox the
  // user clicked from, not the clinical alert queue. Anything else (or
  // missing) defaults to Alerts, which is the workflow-priority default.
  const searchParams = useSearchParams();
  const initialTab: TopTab =
    searchParams?.get('tab') === 'notifications' ? 'notifications' : 'alerts';
  const [alerts, setAlerts] = useState<ProviderAlert[]>([]);
  const [notifs, setNotifs] = useState<AdminNotificationDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [search, setSearch] = useState('');
  const [resolving, setResolving] = useState<ProviderAlert | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Per-alert ack-in-flight set so the button disables individually (two
  // simultaneous BP L1 acks don't conflate visually).
  const [acking, setAcking] = useState<Set<string>>(new Set());
  const [topTab, setTopTab] = useState<TopTab>(initialTab);
  const [notifFilter, setNotifFilter] = useState<NotifFilter>('all');
  const [markingAll, setMarkingAll] = useState(false);

  // First mount sets `loading` so the skeleton shows; subsequent
  // event-driven refreshes pass `silent` so the page doesn't flash a
  // skeleton every time the bell fires a change event.
  const refresh = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const [alertData, notifData] = await Promise.all([
        getProviderAlerts().catch(() => []),
        getAdminNotifications({ status: 'all' }).catch(() => [] as AdminNotificationDto[]),
      ]);
      setAlerts(Array.isArray(alertData) ? (alertData as ProviderAlert[]) : []);
      setNotifs(
        Array.isArray(notifData)
          ? [...notifData].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())
          : [],
      );
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    // Mutations from the top-bar bell (mark-read, mark-all-read) broadcast
    // a window event so the page picks up the new state on the same tick
    // — keeps both surfaces consistent without waiting on the poll.
    const onChange = () => { void refresh({ silent: true }); };
    // Background poll catches everything else: new alerts arriving from the
    // backend, escalation events being fired, other admins resolving alerts
    // on patients we share. Silent so the skeleton doesn't flash every 30s.
    const interval = setInterval(() => { void refresh({ silent: true }); }, 30_000);
    if (typeof window !== 'undefined') {
      window.addEventListener(NOTIF_CHANGE_EVENT, onChange);
    }
    return () => {
      clearInterval(interval);
      if (typeof window !== 'undefined') {
        window.removeEventListener(NOTIF_CHANGE_EVENT, onChange);
      }
    };
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

  const unreadCount = useMemo(() => notifs.filter((n) => !n.watched).length, [notifs]);

  const filteredNotifs = useMemo(() => {
    if (notifFilter === 'unread') return notifs.filter((n) => !n.watched);
    if (notifFilter === 'read') return notifs.filter((n) => n.watched);
    return notifs;
  }, [notifs, notifFilter]);

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
        // Tell the bell instantly that one alert came off the queue, then
        // sync our own state from the server. The delta event drops the
        // bell badge without it having to re-fetch.
        broadcastChange({ alertDelta: -1 });
        await refresh({ silent: true });
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

  // Caller (NotifCard's "Mark read" pill) only renders on unread rows, so
  // we don't need an internal "did the row actually change?" guard — and
  // putting one inside the setNotifs updater would race with React's
  // deferred batching and silently swallow the broadcast that the bell +
  // any other sibling listener depend on for live sync.
  //
  // Broadcast goes out IMMEDIATELY (before awaiting the PATCH) with the
  // delta so the bell badge drops instantly — no PATCH-round-trip wait.
  // Bulk-PATCHes every channel sibling so the row stays read after refetch
  // (single-id PATCH would leave its DASHBOARD twin unread and re-show the
  // entry on next poll).
  const handleMarkRead = useCallback(async (notif: AdminNotificationDto) => {
    setNotifs((prev) => prev.map((n) => (n.id === notif.id ? { ...n, watched: true } : n)));
    broadcastChange({ unreadDelta: -1 });
    try {
      await markAdminNotificationsReadBulk(notif.siblingIds);
    } catch {
      // Optimistic update stands — next refresh reconciles.
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    const unread = notifs.filter((n) => !n.watched);
    if (unread.length === 0) return;
    // Flatten channel siblings so the bulk PATCH covers every underlying
    // row; the displayed delta is the entry count, not the sibling count.
    const ids = unread.flatMap((n) => n.siblingIds);
    setMarkingAll(true);
    setNotifs((prev) => prev.map((n) => ({ ...n, watched: true })));
    broadcastChange({ unreadDelta: -unread.length });
    try {
      await markAdminNotificationsReadBulk(ids);
    } catch {
      // Optimistic update stands.
    } finally {
      setMarkingAll(false);
    }
  }, [notifs]);

  const headerSub = loading
    ? 'Loading…'
    : topTab === 'alerts'
      ? `${counts.ALL} active alert${counts.ALL === 1 ? '' : 's'}`
      : unreadCount > 0
        ? `${unreadCount} unread`
        : 'All caught up';

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
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              Alerts & Notifications
            </h1>
            <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
              {headerSub}
            </p>
          </div>
          {topTab === 'notifications' && unreadCount > 0 && (
            <button
              type="button"
              onClick={() => void handleMarkAllRead()}
              disabled={markingAll}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold transition hover:opacity-80 disabled:opacity-50 cursor-pointer"
              style={{
                backgroundColor: 'var(--brand-primary-purple-light)',
                color: 'var(--brand-primary-purple)',
              }}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {markingAll ? 'Marking…' : 'Mark all read'}
            </button>
          )}
        </div>

        {/* Top tab bar — Alerts | Notifications. Counts on each tab keep
            the user oriented when switching. */}
        <TopTabBar
          active={topTab}
          onChange={setTopTab}
          alertsCount={counts.ALL}
          notifsCount={unreadCount}
        />

        {topTab === 'alerts' ? (
          <>
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
              <EmptyAlertCard hasAlerts={alerts.length > 0} />
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
          </>
        ) : (
          <>
            {/* Notifications tab — sub-filter (all / unread / read) + list. */}
            <NotifFilterBar
              active={notifFilter}
              onChange={setNotifFilter}
              unreadCount={unreadCount}
            />

            {loading && notifs.length === 0 ? (
              <NotifListSkeleton />
            ) : filteredNotifs.length === 0 ? (
              <EmptyNotifCard filter={notifFilter} hasNotifs={notifs.length > 0} />
            ) : (
              <div
                data-testid="admin-notifications-list"
                className="bg-white rounded-2xl overflow-hidden"
                style={{ boxShadow: 'var(--brand-shadow-card)' }}
              >
                {filteredNotifs.map((n, idx) => (
                  <div
                    key={n.id}
                    data-testid={`admin-notification-row-${n.id}`}
                    style={{ borderTop: idx > 0 ? '1px solid var(--brand-border)' : 'none' }}
                  >
                    <NotifCard
                      notif={n}
                      onRead={() => void handleMarkRead(n)}
                      onOpen={() => {
                        if (!n.watched) void handleMarkRead(n);
                        // Alert-linked notification → switch to Alerts tab so
                        // the user can act on it; bare notifications just
                        // mark-read on tap.
                        if (n.alertId) setTopTab('alerts');
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <AlertResolutionModal
        alert={resolvable}
        open={!!resolvable}
        onClose={() => setResolving(null)}
        onResolved={() => {
          setResolving(null);
          // Drop the bell badge instantly, then silently re-sync our list.
          broadcastChange({ alertDelta: -1 });
          void refresh({ silent: true });
        }}
      />
    </div>
  );
}

// ─── Top tab bar (Alerts | Notifications) ──────────────────────────────────
function TopTabBar({
  active,
  onChange,
  alertsCount,
  notifsCount,
}: {
  active: TopTab;
  onChange: (t: TopTab) => void;
  alertsCount: number;
  notifsCount: number;
}) {
  const tabs: { id: TopTab; label: string; count: number }[] = [
    { id: 'alerts', label: 'Alerts', count: alertsCount },
    { id: 'notifications', label: 'Notifications', count: notifsCount },
  ];
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl w-full"
      style={{ backgroundColor: 'var(--brand-background)', border: '1px solid var(--brand-border)' }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="relative flex-1 h-10 rounded-lg text-[13px] sm:text-[14px] font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
            style={{
              backgroundColor: isActive ? 'white' : 'transparent',
              color: isActive ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
              boxShadow: isActive ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span
                className="min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
                style={{
                  backgroundColor: isActive
                    ? 'var(--brand-primary-purple)'
                    : 'var(--brand-text-muted)',
                }}
              >
                {tab.count > 99 ? '99+' : tab.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Notification sub-filter (all / unread / read) ─────────────────────────
function NotifFilterBar({
  active,
  onChange,
  unreadCount,
}: {
  active: NotifFilter;
  onChange: (f: NotifFilter) => void;
  unreadCount: number;
}) {
  const tabs: { id: NotifFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unread', label: 'Unread' },
    { id: 'read', label: 'Read' },
  ];
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl"
      style={{ backgroundColor: 'white', boxShadow: 'var(--brand-shadow-card)' }}
    >
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className="relative flex-1 h-8 rounded-lg text-[12px] font-semibold transition cursor-pointer"
            style={{
              backgroundColor: isActive ? 'var(--brand-primary-purple-light)' : 'transparent',
              color: isActive ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
            }}
          >
            {tab.label}
            {tab.id === 'unread' && unreadCount > 0 && (
              <span
                className="ml-1.5 inline-flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Notification card ─────────────────────────────────────────────────────
function NotifCard({
  notif,
  onRead,
  onOpen,
}: {
  notif: AdminNotificationDto;
  onRead: () => void;
  onOpen: () => void;
}) {
  // Outer is a div (not a button) so the inner "Mark read" pill button is
  // a valid descendant — nested <button> elements break HTML semantics and
  // trigger React's hydration error.
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      className="w-full text-left px-4 py-3 flex items-start gap-3 transition-colors hover:bg-gray-50 cursor-pointer focus:outline-none focus-visible:ring-2"
      style={{
        // @ts-expect-error custom property for focus-visible ring
        '--tw-ring-color': 'var(--brand-primary-purple)',
      }}
    >
      <span
        className="shrink-0 w-2 h-2 rounded-full mt-2"
        style={{
          backgroundColor: notif.watched ? 'var(--brand-border)' : 'var(--brand-primary-purple)',
        }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-3">
          <p
            className="text-[13px] leading-snug"
            style={{
              color: 'var(--brand-text-primary)',
              fontWeight: notif.watched ? 500 : 700,
            }}
          >
            {notif.title}
          </p>
          <span
            className="text-[11px] shrink-0 mt-0.5"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {timeAgo(notif.sentAt)}
          </span>
        </div>
        {notif.body && (
          <p
            className="text-[12px] mt-0.5 leading-relaxed"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {notif.body}
          </p>
        )}
        {!notif.watched && (
          <div className="mt-1.5 flex items-center justify-between gap-2">
            {notif.alertId ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold"
                style={{ color: 'var(--brand-primary-purple)' }}
              >
                View alert
                <span aria-hidden>→</span>
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRead();
              }}
              className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-[11px] font-semibold cursor-pointer transition hover:opacity-80"
              style={{
                backgroundColor: 'var(--brand-background)',
                color: 'var(--brand-text-secondary)',
                border: '1px solid var(--brand-border)',
              }}
            >
              <CheckCircle2 className="w-3 h-3" />
              Mark read
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyAlertCard({ hasAlerts }: { hasAlerts: boolean }) {
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

function EmptyNotifCard({ filter, hasNotifs }: { filter: NotifFilter; hasNotifs: boolean }) {
  const message =
    filter === 'unread'
      ? 'No unread notifications'
      : filter === 'read'
        ? 'No read notifications yet'
        : hasNotifs
          ? 'No notifications match your filter'
          : 'No notifications yet';
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
      >
        <Bell className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
        {message}
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

function NotifListSkeleton() {
  return (
    <div
      className="bg-white rounded-2xl overflow-hidden"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="px-4 py-3 flex items-start gap-3"
          style={{ borderTop: i > 0 ? '1px solid var(--brand-border)' : 'none' }}
        >
          <div className="w-2 h-2 rounded-full mt-2 animate-pulse" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="flex-1 space-y-2">
            <div className="h-3 rounded animate-pulse w-2/3" style={{ backgroundColor: '#EDE9F6' }} />
            <div className="h-3 rounded animate-pulse w-11/12" style={{ backgroundColor: '#EDE9F6' }} />
          </div>
        </div>
      ))}
    </div>
  );
}
