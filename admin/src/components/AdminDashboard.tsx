'use client';

// Flow F — Admin 3-layer dashboard.
//
// Layer 1 (top, always visible): tier-aware alert banners.
//   • BP Level 2 emergency cards (pulsing red) — one per open BP_LEVEL_2 /
//     BP_LEVEL_2_SYMPTOM_OVERRIDE alert. Resolve button opens the
//     AlertResolutionModal in BP_LEVEL_2 variant.
//   • Tier 1 contraindication banners stacked (red, non-dismissable).
//   • Tier 2 discrepancy summary chip (numbered, click to expand inline).
//
// Layer 2 (middle): tier-filterable alert queue with BP trend on the right.
//   Row click → side panel (reuses AlertPanel for review UX). Resolve button
//   in the side panel opens AlertResolutionModal with the matching variant.
//
// Layer 3 (bottom): stat cards. Reuses provider stats endpoint plus a tier
//   breakdown derived from the alerts list, so the numbers always match
//   what's visible in Layer 1 / Layer 2.

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
  Label,
} from 'recharts';
import {
  Users,
  Activity,
  Bell,
  AlertTriangle,
  Pill,
  ArrowUp,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  Shield,
  CheckCircle2,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { useState, useEffect, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { hasAdminRole, isProviderOnly } from '@/lib/roleGates';
import { useLanguage } from '@/contexts/LanguageContext';
import AlertPanel, { type Alert, type AlertDetail } from './AlertPanel';
import ScheduleModal, { type ScheduleDetails } from './ScheduleModal';
import AlertResolutionModal, { type ResolvableAlert } from './AlertResolutionModal';
import {
  getProviderStats,
  getProviderAlerts,
  getAlertDetail,
  getPatientBpTrend,
  acknowledgeProviderAlert,
  scheduleCall,
  resolutionTierFor,
  type AlertTier,
} from '@/lib/services/provider.service';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ProviderStats {
  totalPatients: number;
  readingsThisMonth: number;
  monthlyInteractions: number;
  activeAlerts: number;
  patientsNeedingAttention: number;
}

/** Raw alert as returned by /api/provider/alerts — v2 fields included. */
interface RawAlert {
  id: string;
  type: string | null;
  severity: string | null;
  tier: AlertTier | string | null;
  ruleId: string | null;
  mode: string | null;
  pulsePressure: number | null;
  patientMessage: string | null;
  dismissible: boolean | null;
  escalated: boolean;
  status: string;
  createdAt: string;
  acknowledgedAt: string | null;
  followUpScheduledAt: string | null;
  patient: {
    id: string;
    name: string | null;
    communicationPreference?: string | null;
    riskTier?: string;
  } | null;
  journalEntry: {
    systolicBP: number | null;
    diastolicBP: number | null;
    measuredAt?: string | null;
  } | null;
}

type TierFilter = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3' | 'OTHER';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return parts.length >= 2
    ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    : name.slice(0, 2).toUpperCase();
}

function readingOf(a: RawAlert): string {
  if (a.journalEntry?.systolicBP != null && a.journalEntry?.diastolicBP != null) {
    return `${a.journalEntry.systolicBP}/${a.journalEntry.diastolicBP} mmHg`;
  }
  if ((a.type ?? '').toUpperCase().includes('MEDICATION') || a.tier === 'TIER_1_CONTRAINDICATION' || a.tier === 'TIER_2_DISCREPANCY') {
    return 'Medication';
  }
  return '—';
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

/** Bucket an alert into one of the 7 tier filter groups. */
function tierBucket(a: RawAlert): TierFilter {
  if (a.tier === 'BP_LEVEL_2' || a.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  if (a.tier === 'TIER_1_CONTRAINDICATION') return 'TIER_1';
  if (a.tier === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (a.tier === 'BP_LEVEL_1_HIGH' || a.tier === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (a.tier === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

/** Map a bucket to a (token, label, icon) triple for consistent chrome. */
function bucketChrome(bucket: TierFilter): {
  accent: string;
  light: string;
  label: string;
  icon: React.ReactNode;
} {
  switch (bucket) {
    case 'BP_L2':
      return {
        accent: 'var(--brand-alert-red)',
        light: 'var(--brand-alert-red-light)',
        label: 'BP Level 2',
        icon: <ShieldAlert className="w-3 h-3" />,
      };
    case 'TIER_1':
      return {
        accent: 'var(--brand-alert-red)',
        light: 'var(--brand-alert-red-light)',
        label: 'Tier 1 — Contraindication',
        icon: <Pill className="w-3 h-3" />,
      };
    case 'TIER_2':
      return {
        accent: 'var(--brand-warning-amber)',
        light: 'var(--brand-warning-amber-light)',
        label: 'Tier 2 — Discrepancy',
        icon: <ArrowUp className="w-3 h-3" />,
      };
    case 'BP_L1':
      return {
        accent: 'var(--brand-warning-amber)',
        light: 'var(--brand-warning-amber-light)',
        label: 'BP Level 1',
        icon: <Activity className="w-3 h-3" />,
      };
    case 'TIER_3':
      return {
        accent: 'var(--brand-accent-teal)',
        light: 'var(--brand-accent-teal-light)',
        label: 'Tier 3 — Info',
        icon: <Bell className="w-3 h-3" />,
      };
    default:
      return {
        accent: 'var(--brand-text-muted)',
        light: 'var(--brand-background)',
        label: 'Other',
        icon: <AlertTriangle className="w-3 h-3" />,
      };
  }
}

/** Adapt a RawAlert to the legacy AlertPanel `Alert` shape. */
function toAlertPanelShape(a: RawAlert): Alert {
  const name = a.patient?.name ?? 'Unknown';
  const bucket = tierBucket(a);
  // Map bucket → legacy L1/L2 + color so AlertPanel keeps working.
  const isHigh = bucket === 'BP_L2' || bucket === 'TIER_1';
  return {
    id: a.id,
    initials: initialsOf(name),
    name,
    location: a.patient?.communicationPreference ?? '—',
    reading: readingOf(a),
    type: a.type ?? '',
    severity: isHigh ? 'HIGH' : 'MEDIUM',
    level: isHigh ? 'L2' : 'L1',
    color: isHigh ? 'red' : 'amber',
    patientId: a.patient?.id ?? '',
    followUpScheduledAt: a.followUpScheduledAt,
  };
}

// ─── BP Trend skeleton ───────────────────────────────────────────────────────

function BPTrendSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="flex items-center justify-between mb-4">
        <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 120 }} />
        <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 60 }} />
      </div>
      <div className="h-48 flex items-end gap-1.5 px-2 pb-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
        {[45, 60, 35, 70, 50, 65, 40].map((h, i) => (
          <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: '#EDE9F6' }} />
        ))}
      </div>
      <div className="flex justify-between mt-3 px-2">
        {[1, 2, 3, 4, 5, 6, 7].map((_, i) => (
          <div key={i} className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 16 }} />
        ))}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();

  // Data
  const [rawAlerts, setRawAlerts] = useState<RawAlert[]>([]);
  const [stats, setStats] = useState<ProviderStats>({
    totalPatients: 0,
    readingsThisMonth: 0,
    monthlyInteractions: 0,
    activeAlerts: 0,
    patientsNeedingAttention: 0,
  });
  const [dataLoading, setDataLoading] = useState(true);

  // Layer 1 UI state
  const [tier2Expanded, setTier2Expanded] = useState(false);
  const [bpL2Resolving, setBpL2Resolving] = useState<RawAlert | null>(null);
  const [tier1Resolving, setTier1Resolving] = useState<RawAlert | null>(null);
  const [tier2Resolving, setTier2Resolving] = useState<RawAlert | null>(null);

  // Layer 2 queue state
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [alertSearch, setAlertSearch] = useState('');
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // Side panel (review)
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [selectedAlertDetail, setSelectedAlertDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // BP trend
  const [trendAlert, setTrendAlert] = useState<Alert | null>(null);
  const [trendDetail, setTrendDetail] = useState<AlertDetail | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  type VitalToggle = 'systolic' | 'diastolic' | 'both';
  const [vitalToggle, setVitalToggle] = useState<VitalToggle>('both');
  const [trendPreset, setTrendPreset] = useState<string>('30D');
  const [trendStartDate, setTrendStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [trendEndDate, setTrendEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  type BpPoint = { day: string; systolic: number | null; diastolic: number | null; date: string; time: string | null };
  const [bpTrendData, setBpTrendData] = useState<BpPoint[]>([]);

  // Schedule modal
  const [scheduleAlert, setScheduleAlert] = useState<Alert | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────────────────────
  // PROVIDER-only callers get the assigned-only scope. Other admin roles
  // see everything.
  const alertScope = isProviderOnly(user) ? 'assigned' : undefined;
  const refreshData = useCallback(() => {
    setDataLoading(true);
    Promise.all([
      getProviderStats(),
      getProviderAlerts(alertScope ? { scope: alertScope } : undefined),
    ])
      .then(([statsData, alertsData]) => {
        setStats({
          totalPatients: statsData.totalActivePatients ?? statsData.totalPatients ?? 0,
          readingsThisMonth: statsData.readingsThisMonth ?? 0,
          monthlyInteractions: statsData.monthlyInteractions ?? 0,
          activeAlerts: statsData.activeAlertsCount ?? statsData.activeAlerts ?? 0,
          patientsNeedingAttention: statsData.patientsNeedingAttention ?? 0,
        });
        setRawAlerts(Array.isArray(alertsData) ? (alertsData as RawAlert[]) : []);
      })
      .catch(() => {
        // best-effort
      })
      .finally(() => setDataLoading(false));
  }, [alertScope]);

  useEffect(() => {
    if (isLoading || !user) return;
    refreshData();
  }, [user, isLoading, refreshData]);

  // ── Derived buckets ───────────────────────────────────────────────────────
  const visibleAlerts = useMemo(
    () => rawAlerts.filter((a) => !reviewedIds.has(a.id)),
    [rawAlerts, reviewedIds],
  );

  const bpL2Alerts = useMemo(() => visibleAlerts.filter((a) => tierBucket(a) === 'BP_L2'), [visibleAlerts]);
  const tier1Alerts = useMemo(() => visibleAlerts.filter((a) => tierBucket(a) === 'TIER_1'), [visibleAlerts]);
  const tier2Alerts = useMemo(() => visibleAlerts.filter((a) => tierBucket(a) === 'TIER_2'), [visibleAlerts]);
  const bpL1Alerts = useMemo(() => visibleAlerts.filter((a) => tierBucket(a) === 'BP_L1'), [visibleAlerts]);
  const tier3Alerts = useMemo(() => visibleAlerts.filter((a) => tierBucket(a) === 'TIER_3'), [visibleAlerts]);

  const queueAlerts = useMemo(() => {
    let list = visibleAlerts;
    if (tierFilter !== 'ALL') list = list.filter((a) => tierBucket(a) === tierFilter);
    if (alertSearch.trim()) {
      const q = alertSearch.trim().toLowerCase();
      list = list.filter(
        (a) =>
          (a.patient?.name ?? '').toLowerCase().includes(q) ||
          readingOf(a).toLowerCase().includes(q) ||
          (a.type ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [visibleAlerts, tierFilter, alertSearch]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSelectForReview = useCallback(async (a: RawAlert) => {
    const adapted = toAlertPanelShape(a);
    setSelectedAlert(adapted);
    setSelectedAlertDetail(null);
    setDetailLoading(true);
    try {
      const detail = await getAlertDetail(a.id);
      setSelectedAlertDetail(detail);
    } catch {
      // Panel will fall back to summary data
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const fetchBpTrend = useCallback(async (patientId: string, start: string, end: string) => {
    try {
      const data = await getPatientBpTrend(patientId, start, end);
      setBpTrendData(Array.isArray(data) ? data : []);
    } catch {
      setBpTrendData([]);
    }
  }, []);

  const handleRowHover = useCallback(async (a: RawAlert) => {
    const adapted = toAlertPanelShape(a);
    if (trendAlert?.id === adapted.id) return;
    setTrendAlert(adapted);
    setTrendDetail(null);
    setBpTrendData([]);
    setTrendLoading(true);
    setVitalToggle('both');
    try {
      const [detail] = await Promise.all([
        getAlertDetail(a.id),
        fetchBpTrend(adapted.patientId, trendStartDate, trendEndDate),
      ]);
      setTrendDetail(detail);
    } catch {
      // ignore
    } finally {
      setTrendLoading(false);
    }
  }, [trendAlert?.id, trendStartDate, trendEndDate, fetchBpTrend]);

  const handleTrendPreset = (preset: string) => {
    const days = preset === '7D' ? 7 : preset === '30D' ? 30 : preset === '60D' ? 60 : 90;
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    setTrendPreset(preset);
    setTrendStartDate(start.toISOString().slice(0, 10));
    setTrendEndDate(end.toISOString().slice(0, 10));
  };

  useEffect(() => {
    if (!trendAlert?.patientId) return;
    fetchBpTrend(trendAlert.patientId, trendStartDate, trendEndDate);
  }, [trendStartDate, trendEndDate, trendAlert?.patientId, fetchBpTrend]);

  const handleReview = async (id: string) => {
    try {
      await acknowledgeProviderAlert(id);
    } catch {
      // best-effort — still remove from local view
    }
    setReviewedIds((prev) => new Set([...prev, id]));
    setSelectedAlert(null);
    setSelectedAlertDetail(null);
  };

  const handleSchedule = (alert: Alert) => {
    setScheduleAlert(alert);
    setScheduleError(null);
  };

  const handleScheduleConfirm = async (details: ScheduleDetails) => {
    const alert = scheduleAlert;
    if (!alert) return;
    try {
      await scheduleCall({
        patientUserId: alert.patientId,
        alertId: alert.id,
        callDate: details.date,
        callTime: details.time,
        callType: details.callType,
        notes: details.notes || undefined,
      });
      setScheduleError(null);
      const now = new Date().toISOString();
      setRawAlerts((prev) =>
        prev.map((a) => (a.id === alert.id ? { ...a, followUpScheduledAt: now } : a)),
      );
      if (selectedAlert?.id === alert.id) {
        setSelectedAlert((prev) => (prev ? { ...prev, followUpScheduledAt: now } : prev));
      }
      setTimeout(() => setScheduleAlert(null), 1600);
    } catch (err) {
      setScheduleError(err instanceof Error ? err.message : t('provider.failedSchedule'));
    }
  };

  /** Resolution modal callback — alert was resolved (or marked OPEN+retry). */
  const handleResolved = (id: string, result: { status: 'RESOLVED' | 'OPEN' }) => {
    if (result.status === 'RESOLVED') {
      setRawAlerts((prev) => prev.filter((a) => a.id !== id));
    } else {
      // OPEN (BP_L2 retry) — keep it but force a refresh so escalation/audit
      // fields stay accurate.
      refreshData();
    }
    // Close any side-panels referencing this alert.
    if (selectedAlert?.id === id) {
      setSelectedAlert(null);
      setSelectedAlertDetail(null);
    }
  };

  // Build a ResolvableAlert shape for the modal from the currently-open
  // raw alert (whichever resolve slot is active).
  const resolvableForModal: ResolvableAlert | null = useMemo(() => {
    const a = bpL2Resolving ?? tier1Resolving ?? tier2Resolving;
    if (!a) return null;
    return {
      id: a.id,
      tier: a.tier,
      patient: { name: a.patient?.name ?? null },
      patientMessage: a.patientMessage,
      journalEntry: a.journalEntry,
      createdAt: a.createdAt,
    };
  }, [bpL2Resolving, tier1Resolving, tier2Resolving]);

  // ── Loading / access gates ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
        <div className="flex flex-col items-center gap-3">
          <div
            className="w-10 h-10 border-4 rounded-full animate-spin"
            style={{
              borderColor: 'var(--brand-border, #e5e7eb)',
              borderTopColor: 'var(--brand-primary-purple, #7c3aed)',
            }}
          />
          <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.loadingDashboard')}</p>
        </div>
      </div>
    );
  }

  if (!hasAdminRole(user)) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          gap: '1.5rem',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      >
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand-alert-red)' }}>
          {t('provider.accessDenied')}
        </h1>
        <p style={{ fontSize: '1.125rem', color: 'var(--brand-text-secondary)' }}>
          {t('provider.superAdminOnly')}
        </p>
        <Link
          href="/dashboard"
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            backgroundColor: 'var(--brand-primary-purple)',
            color: '#fff',
            textDecoration: 'none',
            fontWeight: 600,
          }}
        >
          {t('provider.goToDashboard')}
        </Link>
      </div>
    );
  }

  return (
    <div className="h-full" style={{ backgroundColor: 'var(--brand-background)' }}>
      {/* Local pulse keyframe for the BP L2 emergency banner */}
      <style>{`
        @keyframes adminBpL2Pulse {
          0%, 100% { box-shadow: 0 0 0 0 rgba(220,38,38,0.55); }
          50%      { box-shadow: 0 0 0 10px rgba(220,38,38,0); }
        }
        .admin-bp-l2-pulse { animation: adminBpL2Pulse 1.6s ease-out infinite; }

        .admin-scroll::-webkit-scrollbar { width: 5px; }
        .admin-scroll::-webkit-scrollbar-track { background: transparent; }
        .admin-scroll::-webkit-scrollbar-thumb { background: #E0D4F5; border-radius: 99px; }
        .admin-scroll::-webkit-scrollbar-thumb:hover { background: #C4B0E0; }
        .admin-scroll { scrollbar-width: thin; scrollbar-color: #E0D4F5 transparent; }
      `}</style>

      <main className="p-4 md:p-8">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
              >
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('provider.dashboard')}
                </h1>
                <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.dcWards')}
                </p>
              </div>
            </div>
            <div className="hidden md:block text-right">
              <p className="text-base font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {user?.name ?? 'Provider'}
              </p>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {t('provider.role')} &middot; {t('provider.clinic')}
              </p>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════════════════════════
           Stat cards — at-a-glance overview (moved to top per UX request)
           ════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
          {dataLoading ? (
            [0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="bg-white p-5 rounded-2xl animate-pulse"
                style={{ boxShadow: 'var(--brand-shadow-card)' }}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 90 }} />
                  <div className="w-5 h-5 rounded" style={{ backgroundColor: '#EDE9F6' }} />
                </div>
                <div className="h-9 rounded-lg mb-3" style={{ backgroundColor: '#EDE9F6', width: 80 }} />
                <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 110 }} />
              </div>
            ))
          ) : (
            <>
              {/* Total Patients */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.totalPatients')}</span>
                  <Users className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
                  {stats.totalPatients}
                </div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.dcWards')}
                </span>
              </div>

              {/* BP L2 emergencies */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>BP L2 emergencies</span>
                  <ShieldAlert className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-alert-red)' }}>
                  {bpL2Alerts.length}
                </div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  Open ≥160/100 mmHg
                </span>
              </div>

              {/* Tier 1 */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Tier 1 contraindications</span>
                  <Pill className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-alert-red)' }}>
                  {tier1Alerts.length}
                </div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  Med-safety alerts
                </span>
              </div>

              {/* Tier 2 */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Tier 2 discrepancies</span>
                  <ArrowUp className="w-5 h-5" style={{ color: 'var(--brand-warning-amber)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-warning-amber)' }}>
                  {tier2Alerts.length}
                </div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  Reconciliation queue
                </span>
              </div>

              {/* Patients needing attention */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.patientsNeedingAttention')}</span>
                  <AlertTriangle className="w-5 h-5" style={{ color: 'var(--brand-warning-amber)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-warning-amber)' }}>
                  {stats.patientsNeedingAttention}
                </div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.alertsLast24h')}
                </span>
              </div>
            </>
          )}
        </div>

        {/* ════════════════════════════════════════════════════════════════════
           LAYER 1 — Medication & Emergency Alerts Panel
           ════════════════════════════════════════════════════════════════════ */}
        {(bpL2Alerts.length > 0 || tier1Alerts.length > 0 || tier2Alerts.length > 0) && (
          <section className="mb-6 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4" style={{ color: 'var(--brand-alert-red)' }} />
              <h2
                className="text-[11px] font-extrabold uppercase tracking-wider"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                Action required
              </h2>
            </div>

            {/* BP Level 2 emergency banners — pulsing red */}
            <AnimatePresence initial={false}>
              {bpL2Alerts.map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="admin-bp-l2-pulse rounded-2xl p-4 md:p-5"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    border: '2px solid var(--brand-alert-red)',
                  }}
                >
                  {/* Mobile (default): icon + content stack vertically with
                      buttons going full-width at the bottom (each taking
                      half the row). Desktop (md+): traditional single-row
                      layout with right-aligned buttons. */}
                  <div className="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div
                        className="shrink-0 w-10 h-10 md:w-11 md:h-11 rounded-xl flex items-center justify-center text-white"
                        style={{ backgroundColor: 'var(--brand-alert-red)' }}
                        aria-hidden
                      >
                        <ShieldAlert className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-1">
                          <span
                            className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full text-white whitespace-nowrap"
                            style={{ backgroundColor: 'var(--brand-alert-red)' }}
                          >
                            BP Level 2 · Emergency
                          </span>
                          <span className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                            {timeAgo(a.createdAt)}
                          </span>
                          {a.followUpScheduledAt && (
                            <span
                              className="text-[10px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap"
                              style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}
                            >
                              Call scheduled
                            </span>
                          )}
                        </div>
                        <p className="text-[13.5px] sm:text-[14px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                          <span className="break-words">{a.patient?.name ?? 'Unknown patient'}</span>
                          {a.journalEntry?.systolicBP != null && a.journalEntry?.diastolicBP != null && (
                            <span className="ml-2 whitespace-nowrap" style={{ color: 'var(--brand-alert-red)' }}>
                              {a.journalEntry.systolicBP}/{a.journalEntry.diastolicBP} mmHg
                            </span>
                          )}
                        </p>
                        {a.patientMessage && (
                          <p className="text-[12px] sm:text-[12.5px] mt-1.5 leading-relaxed break-words" style={{ color: 'var(--brand-text-secondary)' }}>
                            {a.patientMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Buttons: full-width pair on mobile, compact inline
                        on desktop. flex-1 on each button on mobile so they
                        share the row evenly. */}
                    <div className="flex gap-2 md:shrink-0 [&>button]:flex-1 md:[&>button]:flex-none">
                      <button
                        type="button"
                        className="btn-admin-secondary"
                        onClick={() => handleSelectForReview(a)}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className="btn-admin-danger"
                        onClick={() => setBpL2Resolving(a)}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Resolve
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Tier 1 contraindication banners — red, stacking */}
            <AnimatePresence initial={false}>
              {tier1Alerts.map((a) => (
                <motion.div
                  key={a.id}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="rounded-2xl p-4"
                  style={{
                    backgroundColor: 'var(--brand-alert-red-light)',
                    borderLeft: '4px solid var(--brand-alert-red)',
                    boxShadow: 'var(--brand-shadow-card)',
                  }}
                >
                  <div className="flex flex-col md:flex-row md:items-center gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div
                        className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white"
                        style={{ backgroundColor: 'var(--brand-alert-red)' }}
                        aria-hidden
                      >
                        <Pill className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mb-0.5">
                          <span
                            className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full whitespace-nowrap"
                            style={{ backgroundColor: 'var(--brand-alert-red)', color: 'white' }}
                          >
                            Tier 1 · Contraindication
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                            {timeAgo(a.createdAt)}
                          </span>
                        </div>
                        <p className="text-[13px] sm:text-[13.5px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                          <span className="break-words">{a.patient?.name ?? 'Unknown patient'}</span>
                          {a.ruleId && (
                            <span className="ml-2 text-[11px] font-mono font-normal break-all" style={{ color: 'var(--brand-text-muted)' }}>
                              {a.ruleId}
                            </span>
                          )}
                        </p>
                        {a.patientMessage && (
                          <p className="text-[12px] mt-1 leading-relaxed break-words" style={{ color: 'var(--brand-text-secondary)' }}>
                            {a.patientMessage}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2 md:shrink-0 [&>button]:flex-1 md:[&>button]:flex-none">
                      <button
                        type="button"
                        className="btn-admin-secondary"
                        onClick={() => handleSelectForReview(a)}
                      >
                        Review
                      </button>
                      <button
                        type="button"
                        className="btn-admin-danger"
                        onClick={() => setTier1Resolving(a)}
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Tier 2 — collapsed numbered card, expand inline */}
            {tier2Alerts.length > 0 && (
              <div
                className="rounded-2xl"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  borderLeft: '4px solid var(--brand-warning-amber)',
                  boxShadow: 'var(--brand-shadow-card)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setTier2Expanded((v) => !v)}
                  className="w-full flex items-center gap-3 p-4 cursor-pointer text-left"
                >
                  <div
                    className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white"
                    style={{ backgroundColor: 'var(--brand-warning-amber)' }}
                    aria-hidden
                  >
                    <ArrowUp className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full text-white"
                        style={{ backgroundColor: 'var(--brand-warning-amber)' }}
                      >
                        Tier 2 · Discrepancy
                      </span>
                      <span
                        className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: 'white', color: 'var(--brand-warning-amber)' }}
                      >
                        {tier2Alerts.length}
                      </span>
                    </div>
                    <p className="text-[13px] font-semibold mt-0.5" style={{ color: 'var(--brand-text-primary)' }}>
                      {tier2Alerts.length === 1
                        ? '1 medication discrepancy needs review'
                        : `${tier2Alerts.length} medication discrepancies need review`}
                    </p>
                  </div>
                  {tier2Expanded ? (
                    <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
                  ) : (
                    <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-warning-amber)' }} />
                  )}
                </button>
                <AnimatePresence initial={false}>
                  {tier2Expanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pb-4 space-y-2">
                        {tier2Alerts.map((a) => (
                          <div
                            key={a.id}
                            className="rounded-lg p-3 flex flex-col md:flex-row md:items-center gap-2 md:gap-3 bg-white"
                            style={{ border: '1px solid var(--brand-border)' }}
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[12.5px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                                <span className="break-words">{a.patient?.name ?? 'Unknown patient'}</span>
                                <span className="ml-2 text-[11px] font-normal whitespace-nowrap" style={{ color: 'var(--brand-text-muted)' }}>
                                  {timeAgo(a.createdAt)}
                                </span>
                              </p>
                              {a.patientMessage && (
                                <p className="text-[11.5px] mt-0.5 leading-relaxed break-words" style={{ color: 'var(--brand-text-secondary)' }}>
                                  {a.patientMessage}
                                </p>
                              )}
                            </div>
                            <div className="flex gap-2 md:shrink-0 [&>button]:flex-1 md:[&>button]:flex-none">
                              <button
                                type="button"
                                className="btn-admin-ghost"
                                onClick={() => handleSelectForReview(a)}
                              >
                                Review
                              </button>
                              <button
                                type="button"
                                className="btn-admin-primary"
                                onClick={() => setTier2Resolving(a)}
                              >
                                Resolve
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </section>
        )}

        {/* ════════════════════════════════════════════════════════════════════
           LAYER 2 — Tier-filterable alert queue + BP trend
           ════════════════════════════════════════════════════════════════════ */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mb-6">
          {/* Alert queue */}
          <div
            className="lg:col-span-3 bg-white p-4 md:p-6 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            {/* Title + filter chips */}
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    Alert queue
                  </h2>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
                  >
                    {visibleAlerts.length}
                  </span>
                </div>
                <div
                  className="flex items-center gap-2 px-3 h-8 rounded-full max-w-[220px]"
                  style={{ backgroundColor: 'var(--brand-background)', border: '1.5px solid var(--brand-border)' }}
                >
                  <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                  <input
                    type="text"
                    value={alertSearch}
                    onChange={(e) => setAlertSearch(e.target.value)}
                    placeholder="Search patient or BP"
                    className="flex-1 text-[11px] outline-none bg-transparent min-w-0"
                    style={{ color: 'var(--brand-text-primary)' }}
                  />
                  {alertSearch && (
                    <button onClick={() => setAlertSearch('')} className="shrink-0" type="button">
                      <X className="w-2.5 h-2.5" style={{ color: 'var(--brand-text-muted)' }} />
                    </button>
                  )}
                </div>
              </div>

              {/* Tier filter chips */}
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  ['ALL', 'All', visibleAlerts.length],
                  ['BP_L2', 'BP L2', bpL2Alerts.length],
                  ['TIER_1', 'Tier 1', tier1Alerts.length],
                  ['TIER_2', 'Tier 2', tier2Alerts.length],
                  ['BP_L1', 'BP L1', bpL1Alerts.length],
                  ['TIER_3', 'Tier 3', tier3Alerts.length],
                ] as [TierFilter, string, number][]).map(([key, label, count]) => {
                  const active = tierFilter === key;
                  const chrome = key === 'ALL'
                    ? { accent: 'var(--brand-primary-purple)', light: 'var(--brand-primary-purple-light)' }
                    : bucketChrome(key);
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

            {/* Queue body */}
            {dataLoading ? (
              <div className="space-y-2 animate-pulse">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-14 rounded-xl" style={{ backgroundColor: '#F3EEFB' }} />
                ))}
              </div>
            ) : queueAlerts.length === 0 ? (
              <div className="py-10 flex flex-col items-center text-center">
                <CheckCircle2 className="w-8 h-8 mb-2" style={{ color: 'var(--brand-success-green)' }} />
                <p className="text-[13px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  {tierFilter === 'ALL' ? 'No open alerts' : 'No alerts in this tier'}
                </p>
                <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                  Resolved or acknowledged alerts are removed from the queue.
                </p>
              </div>
            ) : (
              <div className="overflow-y-auto admin-scroll" style={{ maxHeight: '60vh' }}>
                <ul className="space-y-2">
                  {queueAlerts.map((a) => {
                    const bucket = tierBucket(a);
                    const chrome = bucketChrome(bucket);
                    const adapted = toAlertPanelShape(a);
                    const isSelected = trendAlert?.id === adapted.id;
                    const canResolve = resolutionTierFor(a.tier) != null;
                    return (
                      <li key={a.id}>
                        <div
                          className={`group rounded-xl p-3 flex items-center gap-3 cursor-pointer transition-all ${
                            isSelected ? 'ring-2 ring-purple-300' : 'hover:brightness-[0.98]'
                          }`}
                          style={{
                            backgroundColor: chrome.light,
                            borderLeft: `4px solid ${chrome.accent}`,
                          }}
                          onMouseEnter={() => handleRowHover(a)}
                          onClick={() => handleRowHover(a)}
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
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelectForReview(a);
                              }}
                            >
                              Review
                            </button>
                            {canResolve && (
                              <button
                                type="button"
                                className="h-7 px-2.5 rounded-lg text-[11px] font-semibold text-white transition-all hover:brightness-95 cursor-pointer"
                                style={{ backgroundColor: chrome.accent }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (bucket === 'BP_L2') setBpL2Resolving(a);
                                  else if (bucket === 'TIER_1') setTier1Resolving(a);
                                  else if (bucket === 'TIER_2') setTier2Resolving(a);
                                }}
                              >
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

          {/* BP Trend (right column, desktop) */}
          <div className="hidden lg:flex lg:flex-col lg:col-span-2 gap-6 lg:sticky lg:top-24 lg:self-start">
            <div className="bg-white p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
                {vitalToggle === 'systolic'
                  ? t('provider.systolicTrend')
                  : vitalToggle === 'diastolic'
                    ? t('provider.diastolicTrend')
                    : t('provider.bpTrend')}
                {' '}&middot; {trendDetail?.patient?.name ?? trendAlert?.name ?? t('provider.selectPatient')}
              </h2>

              <div className="flex items-center gap-1 mb-3">
                {(['systolic', 'diastolic', 'both'] as VitalToggle[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVitalToggle(v)}
                    className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: vitalToggle === v ? 'var(--brand-primary-purple)' : 'var(--brand-background)',
                      color: vitalToggle === v ? '#fff' : 'var(--brand-text-muted)',
                      border: `1px solid ${vitalToggle === v ? 'var(--brand-primary-purple)' : 'var(--brand-border)'}`,
                    }}
                  >
                    {v === 'systolic' ? t('provider.systolic') : v === 'diastolic' ? t('provider.diastolic') : t('provider.both')}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {['7D', '30D', '60D', '90D'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handleTrendPreset(p)}
                    className="px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: trendPreset === p ? 'var(--brand-primary-purple-light)' : 'var(--brand-background)',
                      color: trendPreset === p ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                      border: `1px solid ${trendPreset === p ? 'var(--brand-primary-purple)' : 'var(--brand-border)'}`,
                    }}
                  >
                    {p}
                  </button>
                ))}
                <div className="flex items-center gap-1 ml-auto">
                  <input
                    type="date"
                    value={trendStartDate}
                    max={trendEndDate}
                    onChange={(e) => {
                      setTrendStartDate(e.target.value);
                      setTrendPreset('');
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded border outline-none"
                    style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                  />
                  <span className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>–</span>
                  <input
                    type="date"
                    value={trendEndDate}
                    min={trendStartDate}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setTrendEndDate(e.target.value);
                      setTrendPreset('');
                    }}
                    className="text-[10px] px-1.5 py-0.5 rounded border outline-none"
                    style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                  />
                </div>
              </div>

              {trendLoading ? (
                <BPTrendSkeleton />
              ) : bpTrendData.length > 0 ? (() => {
                const showSys = vitalToggle === 'systolic' || vitalToggle === 'both';
                const showDia = vitalToggle === 'diastolic' || vitalToggle === 'both';
                const allVals = [
                  ...(showSys ? bpTrendData.map((d) => d.systolic).filter((v): v is number => v != null) : []),
                  ...(showDia ? bpTrendData.map((d) => d.diastolic).filter((v): v is number => v != null) : []),
                ];
                const yMin = allVals.length > 0 ? Math.floor((Math.min(...allVals) - 10) / 10) * 10 : 60;
                const yMax = allVals.length > 0 ? Math.ceil((Math.max(...allVals) + 10) / 10) * 10 : 190;
                const yTicks: number[] = [];
                for (let v = yMin; v <= yMax; v += 10) yTicks.push(v);

                return (
                  <div style={{ height: 250 }} className="relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={bpTrendData}>
                        <defs>
                          <linearGradient id="adminColorSys" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#DC2626" stopOpacity={0.06} />
                            <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="adminColorDia" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.06} />
                            <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="day"
                          axisLine={false}
                          tickLine={false}
                          tick={{ fill: '#94A3B8', fontSize: 10 }}
                          tickFormatter={(v: string) => v.replace(/ #\d+$/, '')}
                          interval={bpTrendData.length <= 7 ? 0 : Math.max(0, Math.floor(bpTrendData.length / 6) - 1)}
                        >
                          <Label value="Date" position="insideBottom" offset={-2} style={{ fill: '#000000', fontSize: 10 }} />
                        </XAxis>
                        <YAxis domain={[yMin, yMax]} ticks={yTicks} axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={38}>
                          <Label value="mmHg" angle={-90} position="insideLeft" offset={-3} style={{ fill: '#000000', fontSize: 10 }} />
                        </YAxis>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const item = payload[0].payload as BpPoint;
                              const dateStr = item.date
                                ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                                : '';
                              return (
                                <div
                                  className="bg-white px-3 py-2 rounded-xl text-xs font-semibold"
                                  style={{
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                                    color: 'var(--brand-text-primary)',
                                    border: '1px solid #E9D5FF',
                                  }}
                                >
                                  {showSys && <div style={{ color: '#DC2626' }}>Sys: {item.systolic ?? '—'}</div>}
                                  {showDia && <div style={{ color: '#2563EB' }}>Dia: {item.diastolic ?? '—'}</div>}
                                  <div style={{ color: '#94A3B8' }}>{dateStr}{item.time ? ` at ${item.time}` : ''}</div>
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        {showSys && <ReferenceLine y={160} stroke="#DC2626" strokeWidth={1} strokeDasharray="4 4" />}
                        {showDia && <ReferenceLine y={90} stroke="#2563EB" strokeWidth={1} strokeDasharray="4 4" />}
                        {showSys && (
                          <Area type="monotone" dataKey="systolic" stroke="#DC2626" strokeWidth={2} fill="url(#adminColorSys)" dot={{ fill: '#DC2626', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
                        )}
                        {showDia && (
                          <Area type="monotone" dataKey="diastolic" stroke="#2563EB" strokeWidth={2} fill="url(#adminColorDia)" dot={{ fill: '#2563EB', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
                        )}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                );
              })() : (
                <div className="h-40 flex items-center justify-center">
                  <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>
                    {trendAlert ? t('provider.noBpData') : t('provider.hoverToSee')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

      </main>

      {/* ── BP Trend Bottom Sheet — mobile/tablet ─────────────────────────── */}
      <AnimatePresence>
        {trendAlert && (
          <motion.div
            key="bp-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl admin-scroll"
            style={{ boxShadow: '0 -8px 40px rgba(123,0,224,0.12)', maxHeight: '50vh', overflowY: 'auto' }}
          >
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: 'var(--brand-border)' }} />
            </div>
            <div className="px-5 pb-5">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[14px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                  BP Trend &middot; {trendDetail?.patient?.name ?? trendAlert.name}
                </h3>
                <button
                  type="button"
                  onClick={() => {
                    setTrendAlert(null);
                    setTrendDetail(null);
                    setBpTrendData([]);
                  }}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition hover:bg-gray-100 cursor-pointer"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              </div>
              {trendLoading ? (
                <BPTrendSkeleton />
              ) : bpTrendData.length > 0 ? (
                <div style={{ height: 200 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={bpTrendData}>
                      <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} width={28} />
                      <Tooltip />
                      <Area type="monotone" dataKey="systolic" stroke="#DC2626" strokeWidth={2} fill="rgba(220,38,38,0.06)" dot={{ fill: '#DC2626', r: 2.5 }} />
                      <Area type="monotone" dataKey="diastolic" stroke="#2563EB" strokeWidth={2} fill="rgba(37,99,235,0.06)" dot={{ fill: '#2563EB', r: 2.5 }} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-[13px] py-6 text-center" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.noBpData')}
                </p>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Side panel — review ───────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedAlert && (
          <AlertPanel
            alert={selectedAlert}
            detail={selectedAlertDetail}
            detailLoading={detailLoading}
            onClose={() => {
              setSelectedAlert(null);
              setSelectedAlertDetail(null);
            }}
            onReview={handleReview}
            onSchedule={handleSchedule}
          />
        )}
      </AnimatePresence>

      {/* ── Schedule modal ────────────────────────────────────────────────── */}
      <AnimatePresence>
        {scheduleAlert && (
          <ScheduleModal
            alert={scheduleAlert}
            onClose={() => {
              setScheduleAlert(null);
              setScheduleError(null);
            }}
            onConfirm={handleScheduleConfirm}
            error={scheduleError}
          />
        )}
      </AnimatePresence>

      {/* ── Resolution modal (Flow G) ─────────────────────────────────────── */}
      <AlertResolutionModal
        alert={resolvableForModal}
        open={!!resolvableForModal}
        onClose={() => {
          setBpL2Resolving(null);
          setTier1Resolving(null);
          setTier2Resolving(null);
        }}
        onResolved={handleResolved}
      />
    </div>
  );
}
