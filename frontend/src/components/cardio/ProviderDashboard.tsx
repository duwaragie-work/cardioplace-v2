'use client';

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
import { Users, Activity, Bell, Heart, X, ChevronUp, Search, ChevronDown, Shield, ClipboardList, AlertTriangle } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/en';
import AlertPanel, { type Alert, type AlertDetail } from './AlertPanel';
import ScheduleModal, { type ScheduleDetails } from './ScheduleModal';
import {
  getProviderStats,
  getProviderAlerts,
  getAlertDetail,
  getPatientBpTrend,
  acknowledgeProviderAlert,
  scheduleCall,
} from '@/lib/services/provider.service';


// ─── Custom scrollbar styles ──────────────────────────────────────────────────
const tableScrollStyles = `
.provider-scroll::-webkit-scrollbar { width: 5px; }
.provider-scroll::-webkit-scrollbar-track { background: transparent; }
.provider-scroll::-webkit-scrollbar-thumb { background: #E0D4F5; border-radius: 99px; }
.provider-scroll::-webkit-scrollbar-thumb:hover { background: #C4B0E0; }
.provider-scroll { scrollbar-width: thin; scrollbar-color: #E0D4F5 transparent; }
`;

// ─── BP Trend Skeleton ────────────────────────────────────────────────────────
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
        {[1,2,3,4,5,6,7].map((_, i) => (
          <div key={i} className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 16 }} />
        ))}
      </div>
    </div>
  );
}

interface ProviderStats {
  totalPatients: number;
  readingsThisMonth: number;
  monthlyInteractions: number;
  activeAlerts: number;
  patientsNeedingAttention: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformAlert(raw: any, t: (key: TranslationKey) => string): Alert {
  const name: string = raw.patientName ?? raw.user?.name ?? raw.patient?.name ?? 'Unknown';
  const parts = name.trim().split(/\s+/);
  const initials =
    parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : name.slice(0, 2).toUpperCase();

  const rawSeverity: string = (raw.severity ?? '').toUpperCase();
  const severity: 'HIGH' | 'MEDIUM' =
    rawSeverity === 'HIGH' || rawSeverity === 'CRITICAL' ? 'HIGH' : 'MEDIUM';
  const escalated: boolean = Boolean(raw.escalated);
  const level: 'L1' | 'L2' = escalated ? 'L2' : 'L1';
  const color: 'red' | 'amber' = level === 'L2' ? 'red' : 'amber';

  let reading: string = raw.reading ?? '';
  if (!reading) {
    if (raw.journalEntry?.systolicBP && raw.journalEntry?.diastolicBP) {
      reading = `${raw.journalEntry.systolicBP}/${raw.journalEntry.diastolicBP} mmHg`;
    } else if (raw.systolicBP && raw.diastolicBP) {
      reading = `${raw.systolicBP}/${raw.diastolicBP} mmHg`;
    } else if ((raw.type ?? raw.deviationType ?? '').includes('MEDICATION')) {
      reading = t('alert.medication');
    } else {
      reading = '—';
    }
  }

  return {
    id: String(raw.id),
    initials,
    name,
    location: raw.patient?.communicationPreference ?? raw.communicationPreference ?? '—',
    reading,
    type: raw.type ?? raw.deviationType ?? '',
    severity,
    level,
    color,
    patientId: raw.patient?.id ?? raw.userId ?? '',
    followUpScheduledAt: raw.followUpScheduledAt ?? null,
  };
}

export default function ProviderDashboard() {
  const { user, isLoading } = useAuth();
  const { t } = useLanguage();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [selectedAlertDetail, setSelectedAlertDetail] = useState<AlertDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [trendAlert, setTrendAlert] = useState<Alert | null>(null);
  const [trendDetail, setTrendDetail] = useState<AlertDetail | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  type VitalToggle = 'systolic' | 'diastolic' | 'both';
  const [vitalToggle, setVitalToggle] = useState<VitalToggle>('both');
  const [trendPreset, setTrendPreset] = useState<string>('30D');
  const [trendStartDate, setTrendStartDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  });
  const [trendEndDate, setTrendEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  type BpPoint = { day: string; systolic: number | null; diastolic: number | null; date: string };
  const [bpTrendData, setBpTrendData] = useState<BpPoint[]>([]);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [scheduleAlert, setScheduleAlert] = useState<Alert | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [alertSearch, setAlertSearch] = useState('');
  const [levelFilter, setLevelFilter] = useState<string>('ALL');
  const [alertsList, setAlertsList] = useState<Alert[]>([]);
  const [stats, setStats] = useState<ProviderStats>({
    totalPatients: 0,
    readingsThisMonth: 0,
    monthlyInteractions: 0,
    activeAlerts: 0,
    patientsNeedingAttention: 0,
  });

  useEffect(() => {
    if (isLoading || !user) return;
    setDataLoading(true);
    Promise.all([getProviderStats(), getProviderAlerts()]).then(
      ([statsData, alertsData]) => {
        setStats({
          totalPatients: statsData.totalActivePatients ?? statsData.totalPatients ?? 0,
          readingsThisMonth: statsData.readingsThisMonth ?? 0,
          monthlyInteractions:
            statsData.monthlyInteractions ?? 0,
          activeAlerts: statsData.activeAlertsCount ?? statsData.activeAlerts ?? 0,
          patientsNeedingAttention: statsData.patientsNeedingAttention ?? 0,
        });
        const rawAlerts: Alert[] = Array.isArray(alertsData)
          ? alertsData.map((a: unknown) => transformAlert(a, t))
          : [];
        setAlertsList(rawAlerts);
      },
    ).catch(() => {
      // keep defaults on error
    }).finally(() => setDataLoading(false));
  }, [user, isLoading]);

  const handleSelectAlert = useCallback(async (alert: Alert) => {
    setSelectedAlert(alert);
    setSelectedAlertDetail(null);
    setDetailLoading(true);
    try {
      const detail = await getAlertDetail(alert.id);
      setSelectedAlertDetail(detail);
    } catch {
      // Panel will show with fallback data
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

  const handleRowHover = useCallback(async (alert: Alert) => {
    if (trendAlert?.id === alert.id) return;
    setTrendAlert(alert);
    setTrendDetail(null);
    setBpTrendData([]);
    setTrendLoading(true);
    setVitalToggle('both');
    try {
      const [detail] = await Promise.all([
        getAlertDetail(alert.id),
        fetchBpTrend(alert.patientId, trendStartDate, trendEndDate),
      ]);
      setTrendDetail(detail);
    } catch {
      // keep empty
    } finally {
      setTrendLoading(false);
    }
  }, [trendAlert?.id, trendStartDate, trendEndDate, fetchBpTrend]);

  const handleTrendPreset = (preset: string) => {
    const days = preset === '7D' ? 7 : preset === '30D' ? 30 : preset === '60D' ? 60 : 90;
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - days);
    setTrendPreset(preset);
    setTrendStartDate(start.toISOString().slice(0, 10));
    setTrendEndDate(end.toISOString().slice(0, 10));
  };

  // Re-fetch BP trend when date range changes
  useEffect(() => {
    if (!trendAlert?.patientId) return;
    fetchBpTrend(trendAlert.patientId, trendStartDate, trendEndDate);
  }, [trendStartDate, trendEndDate, trendAlert?.patientId, fetchBpTrend]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--brand-background)' }}>
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

  if (user?.email !== 'support@healplace.com') {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        gap: '1.5rem',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 700, color: 'var(--brand-red, #dc2626)' }}>
          {t('provider.accessDenied')}
        </h1>
        <p style={{ fontSize: '1.125rem', color: 'var(--brand-text-secondary, #6b7280)' }}>
          {t('provider.superAdminOnly')}
        </p>
        <Link
          href="/dashboard"
          style={{
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            backgroundColor: 'var(--brand-primary, #2563eb)',
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

  const activeAlerts = alertsList.filter((a) => {
    if (reviewedIds.has(a.id)) return false;
    if (levelFilter !== 'ALL' && a.level !== levelFilter) return false;
    if (alertSearch) {
      const q = alertSearch.toLowerCase();
      return a.name.toLowerCase().includes(q) || a.reading.toLowerCase().includes(q);
    }
    return true;
  });

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
      // Mark this alert as having a follow-up scheduled (local state)
      const now = new Date().toISOString();
      setAlertsList((prev) =>
        prev.map((a) =>
          a.id === alert.id ? { ...a, followUpScheduledAt: now } : a,
        ),
      );
      // Also update selectedAlert if it's the same one
      if (selectedAlert?.id === alert.id) {
        setSelectedAlert((prev) =>
          prev ? { ...prev, followUpScheduledAt: now } : prev,
        );
      }
      // ScheduleModal shows its own success animation, then we close
      setTimeout(() => {
        setScheduleAlert(null);
      }, 1600);
    } catch (err) {
      setScheduleError(
        err instanceof Error ? err.message : t('provider.failedSchedule'),
      );
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {/* Main Content */}
      <main className="p-4 md:p-8">
        <div className="flex items-center justify-between mb-6">
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
          <div className="text-right">
            <p className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {user?.name ?? 'Provider'}
            </p>
            <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
              {t('provider.role')} &middot; {t('provider.clinic')}
            </p>
          </div>
        </div>

        {/* Stat Cards Row */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4 mb-6">
          {dataLoading ? (
            [0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-white p-5 rounded-2xl animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
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
              {/* Tile 1: Total Patients */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.totalPatients')}</span>
                  <Users className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.totalPatients}</div>
                <span className="text-xs font-semibold" style={{ color: 'var(--brand-success-green)' }}>
                  &uarr; +3 {t('provider.thisWeek')}
                </span>
              </div>

              {/* Tile 2: Readings This Month */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.readingsThisMonth')}</span>
                  <ClipboardList className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.readingsThisMonth.toLocaleString()}</div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.bpReadingsSubmitted')}
                </span>
              </div>

              {/* Tile 3: Monthly Interactions */}
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.monthlyInteractions')}</span>
                  <Activity className="w-5 h-5" style={{ color: 'var(--brand-accent-teal)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.monthlyInteractions.toLocaleString()}</div>
                <span className="text-xs font-semibold" style={{ color: 'var(--brand-success-green)' }}>
                  &uarr; 18% {t('provider.vsLastMonth')}
                </span>
              </div>

              {/* Tile 4: Unresolved Alerts (with L1/L2 tooltip) */}
              <div className="bg-white p-5 rounded-2xl relative group" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.unresolvedAlerts')}</span>
                  <Bell className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-alert-red)' }}>{activeAlerts.length}</div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.hoverForBreakdown')}
                </span>
                {/* Tooltip */}
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-10">
                  <div className="bg-gray-900 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                    <div className="mb-1">{t('provider.level1')} (24hr): {activeAlerts.filter((a) => a.level === 'L1').length}</div>
                    <div>{t('provider.level2')} ({t('provider.immediate')}): {activeAlerts.filter((a) => a.level === 'L2').length}</div>
                    <div className="absolute left-1/2 -translate-x-1/2 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
                  </div>
                </div>
              </div>

              {/* Tile 5: Patients Needing Attention */}
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

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          <style>{tableScrollStyles}</style>

          {dataLoading ? (
            <>
              {/* Alert Queue Skeleton */}
              <div className="lg:col-span-3 bg-white p-6 rounded-2xl animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-center justify-between mb-5">
                  <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 160 }} />
                  <div className="h-6 rounded-full" style={{ backgroundColor: '#FEF3C7', width: 100 }} />
                </div>
                <div className="space-y-0">
                  {/* Table header skeleton */}
                  <div className="hidden md:grid grid-cols-6 gap-4 px-4 py-3 rounded-lg" style={{ backgroundColor: '#FAFBFF' }}>
                    {[70, 80, 50, 55, 40, 55].map((w, i) => (
                      <div key={i} className="h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: w }} />
                    ))}
                  </div>
                  {/* Table rows skeleton */}
                  {[0, 1, 2, 3, 4].map((i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                      <div className="w-8 h-8 rounded-full shrink-0" style={{ backgroundColor: '#EDE9F6' }} />
                      <div className="flex-1 space-y-2">
                        <div className="h-3.5 rounded-full" style={{ backgroundColor: '#EDE9F6', width: `${55 + i * 5}%` }} />
                        <div className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: `${30 + i * 3}%` }} />
                      </div>
                      <div className="hidden md:block h-3 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 60 }} />
                      <div className="hidden md:block h-5 rounded-full" style={{ backgroundColor: '#FEE2E2', width: 48 }} />
                      <div className="hidden md:block h-7 rounded-lg" style={{ backgroundColor: '#F3EEFB', width: 64 }} />
                    </div>
                  ))}
                </div>
              </div>

              {/* BP Trend Skeleton — desktop only */}
              <div className="hidden lg:block lg:col-span-2 bg-white p-6 rounded-2xl animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <BPTrendSkeleton />
              </div>
            </>
          ) : (
            <>

          {/* Alert Queue */}
          <div className="lg:col-span-3 bg-white p-4 md:p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex flex-col gap-3 mb-4">
              {/* Title row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('provider.alertQueue')}
                  </h2>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
                  >
                    {activeAlerts.length}
                  </span>
                </div>
                <span
                  className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
                >
                  {t('provider.requiresAction')}
                </span>
              </div>

              {/* Filters row */}
              <div className="flex flex-wrap items-center gap-2">
                {/* Search */}
                <div
                  className="flex items-center gap-2 px-3 h-8 rounded-full flex-1 min-w-[140px] max-w-[220px]"
                  style={{ backgroundColor: 'var(--brand-background)', border: '1.5px solid var(--brand-border)' }}
                >
                  <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                  <input
                    type="text"
                    value={alertSearch}
                    onChange={(e) => setAlertSearch(e.target.value)}
                    placeholder={t('provider.searchPatients')}
                    className="flex-1 text-[11px] outline-none bg-transparent"
                    style={{ color: 'var(--brand-text-primary)' }}
                  />
                  {alertSearch && (
                    <button onClick={() => setAlertSearch('')} className="shrink-0">
                      <X className="w-2.5 h-2.5" style={{ color: 'var(--brand-text-muted)' }} />
                    </button>
                  )}
                </div>

                {/* Level filter */}
                <div className="relative">
                  <select
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value)}
                    className="appearance-none h-8 pl-2.5 pr-6 rounded-full text-[11px] font-semibold outline-none cursor-pointer"
                    style={{ backgroundColor: 'var(--brand-background)', border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                  >
                    <option value="ALL">{t('provider.allLevels')}</option>
                    <option value="L1">{t('provider.level1')}</option>
                    <option value="L2">{t('provider.level2')}</option>
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: 'var(--brand-text-muted)' }} />
                </div>
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-y-auto provider-scroll" style={{ maxHeight: '75vh' }}>
              <table className="w-full" style={{ borderSpacing: '0 8px', borderCollapse: 'separate' }}>
                <thead>
                  <tr
                    className="text-[11px] font-semibold text-left sticky top-0 z-10 uppercase tracking-wider"
                    style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
                  >
                    <th className="py-2.5 pl-3 pr-2" style={{ width: '30%' }}>Patient</th>
                    <th className="py-2.5 px-2" style={{ width: '15%' }}>BP</th>
                    <th className="py-2.5 px-2" style={{ width: '15%' }}>Type</th>
                    <th className="py-2.5 px-2" style={{ width: '22%' }}>Level</th>
                    <th className="py-2.5 px-2 pr-3 text-right" style={{ width: '10%' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {activeAlerts.map((alert) => {
                    const isL2 = alert.level === 'L2';
                    const bg = isL2 ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)';
                    const accent = isL2 ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)';
                    const isSelected = trendAlert?.id === alert.id;
                    return (
                      <tr
                        key={alert.id}
                        className={`cursor-pointer transition-all ${isSelected ? 'ring-2 ring-purple-300' : 'hover:brightness-[0.97]'}`}
                        style={{ backgroundColor: bg, borderLeft: `4px solid ${accent}`, borderRadius: '12px', outline: isSelected ? undefined : 'none' }}
                        onMouseEnter={() => handleRowHover(alert)}
                        onClick={() => handleRowHover(alert)}
                      >
                        {/* Patient */}
                        <td className="py-3 pl-3 pr-2 rounded-l-xl" style={{ borderLeft: `4px solid ${accent}` }}>
                          <div className="flex items-center gap-2.5">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-[10px] shrink-0"
                              style={{ backgroundColor: accent }}
                            >
                              {alert.initials}
                            </div>
                            <div className="min-w-0">
                              <div className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>{alert.name}</div>
                              <div className="text-[10px] truncate" style={{ color: 'var(--brand-text-muted)' }}>{alert.location}</div>
                            </div>
                          </div>
                        </td>
                        {/* BP Reading */}
                        <td className="py-3 px-2">
                          <div className="text-[12px] font-bold" style={{ color: accent }}>
                            {alert.reading}
                          </div>
                        </td>
                        {/* Type */}
                        <td className="py-3 px-2">
                          <div className="text-[11px] truncate" style={{ color: 'var(--brand-text-muted)' }}>{alert.type}</div>
                        </td>
                        {/* Level flag */}
                        <td className="py-3 px-2">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <div className="flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                              <span className="text-[11px] font-extrabold uppercase" style={{ color: accent }}>
                                {isL2 ? t('provider.level2') : t('provider.level1')}
                              </span>
                            </div>
                            <span className="text-[9px]" style={{ color: accent, opacity: 0.8 }}>
                              {isL2 ? t('provider.alertImmediate') : t('provider.alert24hr')}
                            </span>
                            {alert.followUpScheduledAt && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold" style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}>
                                {t('provider.callScheduled')}
                              </span>
                            )}
                          </div>
                        </td>
                        {/* Action */}
                        <td className="py-3 px-2 pr-3 text-right rounded-r-xl">
                          <button
                            className="h-7 px-3 rounded-lg text-[11px] font-semibold border transition-all hover:brightness-95"
                            style={{ borderColor: accent, color: accent, backgroundColor: 'rgba(255,255,255,0.6)' }}
                            onClick={(e) => { e.stopPropagation(); handleSelectAlert(alert); }}
                          >
                            {t('provider.review')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-2.5 overflow-y-auto provider-scroll" style={{ maxHeight: '60vh' }}>
              {activeAlerts.map((alert) => {
                const isL2 = alert.level === 'L2';
                const bg = isL2 ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)';
                const accent = isL2 ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)';
                const isSelected = trendAlert?.id === alert.id;
                return (
                  <div
                    key={alert.id}
                    className={`p-3.5 rounded-xl cursor-pointer transition-colors ${isSelected ? 'ring-2 ring-purple-300' : ''}`}
                    style={{
                      backgroundColor: bg,
                      borderLeft: `4px solid ${accent}`,
                    }}
                    onClick={() => handleRowHover(alert)}
                  >
                    {/* Level flag */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: accent }} />
                        <span className="text-[11px] font-extrabold uppercase" style={{ color: accent }}>
                          {isL2 ? t('provider.level2') : t('provider.level1')}
                        </span>
                      </div>
                      <span className="text-[10px]" style={{ color: accent, opacity: 0.8 }}>
                        {isL2 ? t('provider.alertImmediate') : t('provider.alert24hr')}
                      </span>
                    </div>
                    {/* Patient + BP */}
                    <div className="flex items-center gap-2.5 mb-2.5">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center text-white font-semibold text-[11px] shrink-0"
                        style={{ backgroundColor: accent }}
                      >
                        {alert.initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>{alert.name}</div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--brand-text-muted)' }}>{alert.type}</div>
                      </div>
                      <div className="text-[14px] font-bold shrink-0" style={{ color: accent }}>
                        {alert.reading}
                      </div>
                    </div>
                    {/* Actions row */}
                    <div className="flex items-center justify-between">
                      {alert.followUpScheduledAt ? (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[8px] font-bold" style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}>
                          Call scheduled
                        </span>
                      ) : <span />}
                      <button
                        className="h-7 px-3 rounded-lg text-[11px] font-semibold border transition-all"
                        style={{ borderColor: accent, color: accent, backgroundColor: 'rgba(255,255,255,0.6)' }}
                        onClick={(e) => { e.stopPropagation(); handleSelectAlert(alert); }}
                      >
                        {t('provider.review')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right column: BP Trend + Legend — desktop only */}
          <div className="hidden lg:flex lg:flex-col lg:col-span-2 gap-6 lg:sticky lg:top-24 lg:self-start">
          <div className="bg-white p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            {/* Title */}
            <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
              {vitalToggle === 'systolic' ? t('provider.systolicTrend')
                : vitalToggle === 'diastolic' ? t('provider.diastolicTrend')
                : t('provider.bpTrend')}
              {' '}&middot; {trendDetail?.patient?.name ?? trendAlert?.name ?? t('provider.selectPatient')}
            </h2>

            {/* Vital toggle */}
            <div className="flex items-center gap-1 mb-3">
              {(['systolic', 'diastolic', 'both'] as VitalToggle[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setVitalToggle(v)}
                  className="px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all"
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

            {/* Preset buttons + date pickers */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              {['7D', '30D', '60D', '90D'].map((p) => (
                <button
                  key={p}
                  onClick={() => handleTrendPreset(p)}
                  className="px-2 py-0.5 rounded-full text-[10px] font-semibold transition-all"
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
                  onChange={(e) => { setTrendStartDate(e.target.value); setTrendPreset(''); }}
                  className="text-[10px] px-1.5 py-0.5 rounded border outline-none"
                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                />
                <span className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>–</span>
                <input
                  type="date"
                  value={trendEndDate}
                  min={trendStartDate}
                  max={new Date().toISOString().slice(0, 10)}
                  onChange={(e) => { setTrendEndDate(e.target.value); setTrendPreset(''); }}
                  className="text-[10px] px-1.5 py-0.5 rounded border outline-none"
                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                />
              </div>
            </div>

            {/* Chart */}
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
                        <linearGradient id="colorSysDesktop" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#DC2626" stopOpacity={0.06} />
                          <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorDiaDesktop" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#2563EB" stopOpacity={0.06} />
                          <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#94A3B8', fontSize: 10 }}
                        tickFormatter={(v: string) => { try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return String(v); } }}
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
                            const dateStr = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                            return (
                              <div className="bg-white px-3 py-2 rounded-xl text-xs font-semibold" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)', color: 'var(--brand-text-primary)', border: '1px solid #E9D5FF' }}>
                                {showSys && <div style={{ color: '#DC2626' }}>Sys: {item.systolic ?? '—'}</div>}
                                {showDia && <div style={{ color: '#2563EB' }}>Dia: {item.diastolic ?? '—'}</div>}
                                {dateStr && <div style={{ color: '#94A3B8' }}>{dateStr}</div>}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      {showSys && <ReferenceLine y={160} stroke="#DC2626" strokeWidth={1} strokeDasharray="4 4" />}
                      {showDia && <ReferenceLine y={90} stroke="#2563EB" strokeWidth={1} strokeDasharray="4 4" />}
                      {showSys && (
                        <Area type="monotone" dataKey="systolic" stroke="#DC2626" strokeWidth={2} fill="url(#colorSysDesktop)" dot={{ fill: '#DC2626', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
                      )}
                      {showDia && (
                        <Area type="monotone" dataKey="diastolic" stroke="#2563EB" strokeWidth={2} fill="url(#colorDiaDesktop)" dot={{ fill: '#2563EB', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />
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

          {/* Alert Level Legend */}
          <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
              {t('provider.alertLegendTitle')}
            </h3>
            <div className="space-y-3">
              {/* Level 1 */}
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--brand-warning-amber-light)', borderLeft: '3px solid var(--brand-warning-amber)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-warning-amber)' }} />
                  <span className="text-[11px] font-extrabold uppercase" style={{ color: 'var(--brand-warning-amber)' }}>
                    {t('provider.level1')}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.legendL1Desc')}
                </p>
              </div>
              {/* Level 2 */}
              <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--brand-alert-red-light)', borderLeft: '3px solid var(--brand-alert-red)' }}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-alert-red)' }} />
                  <span className="text-[11px] font-extrabold uppercase" style={{ color: 'var(--brand-alert-red)' }}>
                    {t('provider.level2')}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('provider.legendL2Desc')}
                </p>
              </div>
            </div>
          </div>
          </div>

            </>
          )}
        </div>

        {/* Alert Level Legend — mobile/tablet */}
        <div className="lg:hidden bg-white p-5 rounded-2xl mt-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <h3 className="text-[13px] font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
            {t('provider.alertLegendTitle')}
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--brand-warning-amber-light)', borderLeft: '3px solid var(--brand-warning-amber)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-warning-amber)' }} />
                <span className="text-[11px] font-extrabold uppercase" style={{ color: 'var(--brand-warning-amber)' }}>
                  {t('provider.level1')}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                {t('provider.legendL1Desc')}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--brand-alert-red-light)', borderLeft: '3px solid var(--brand-alert-red)' }}>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--brand-alert-red)' }} />
                <span className="text-[11px] font-extrabold uppercase" style={{ color: 'var(--brand-alert-red)' }}>
                  {t('provider.level2')}
                </span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                {t('provider.legendL2Desc')}
              </p>
            </div>
          </div>
        </div>
      </main>

      {/* BP Trend Bottom Sheet — mobile/tablet only (below lg:) */}
      <AnimatePresence>
        {trendAlert && (
          <motion.div
            key="bp-sheet"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-white rounded-t-2xl provider-scroll"
            style={{ boxShadow: '0 -8px 40px rgba(123,0,224,0.12)', maxHeight: '45vh' }}
          >
            {/* Handle bar */}
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full" style={{ backgroundColor: 'var(--brand-border)' }} />
            </div>

            <div className="px-5 pb-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <ChevronUp className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
                  <h3 className="text-[14px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                    {vitalToggle === 'systolic' ? t('provider.systolicTrend')
                      : vitalToggle === 'diastolic' ? t('provider.diastolicTrend')
                      : t('provider.bpTrend')}
                    {' '}&middot; {trendDetail?.patient?.name ?? trendAlert.name}
                  </h3>
                </div>
                <button
                  onClick={() => { setTrendAlert(null); setTrendDetail(null); setBpTrendData([]); }}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition hover:bg-gray-100"
                >
                  <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
                </button>
              </div>

              {/* Vital toggle + presets */}
              <div className="flex items-center gap-1 mb-2">
                {(['systolic', 'diastolic', 'both'] as VitalToggle[]).map((v) => (
                  <button key={v} onClick={() => setVitalToggle(v)}
                    className="px-2 py-0.5 rounded-full text-[9px] font-semibold"
                    style={{
                      backgroundColor: vitalToggle === v ? 'var(--brand-primary-purple)' : 'var(--brand-background)',
                      color: vitalToggle === v ? '#fff' : 'var(--brand-text-muted)',
                      border: `1px solid ${vitalToggle === v ? 'var(--brand-primary-purple)' : 'var(--brand-border)'}`,
                    }}
                  >
                    {v === 'systolic' ? t('provider.systolic') : v === 'diastolic' ? t('provider.diastolic') : t('provider.both')}
                  </button>
                ))}
                <div className="ml-auto flex gap-1">
                  {['7D', '30D', '60D', '90D'].map((p) => (
                    <button key={p} onClick={() => handleTrendPreset(p)}
                      className="px-1.5 py-0.5 rounded-full text-[9px] font-semibold"
                      style={{
                        backgroundColor: trendPreset === p ? 'var(--brand-primary-purple-light)' : 'var(--brand-background)',
                        color: trendPreset === p ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                        border: `1px solid ${trendPreset === p ? 'var(--brand-primary-purple)' : 'var(--brand-border)'}`,
                      }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chart */}
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
                  <div style={{ height: 200 }} className="relative">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={bpTrendData}>
                        <defs>
                          <linearGradient id="colorSysMobile" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#DC2626" stopOpacity={0.08} />
                            <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="colorDiaMobile" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563EB" stopOpacity={0.08} />
                            <stop offset="95%" stopColor="#2563EB" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }}
                          tickFormatter={(v: string) => new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          interval={Math.max(0, Math.floor(bpTrendData.length / 5) - 1)}
                        />
                        <YAxis domain={[yMin, yMax]} ticks={yTicks} axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 11 }} width={38}>
                          <Label value="mmHg" angle={-90} position="insideLeft" offset={-3} style={{ fill: '#000000', fontSize: 10 }} />
                        </YAxis>
                        <Tooltip
                          content={({ active, payload }) => {
                            if (active && payload && payload.length) {
                              const item = payload[0].payload as BpPoint;
                              const dateStr = item.date ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                              return (
                                <div className="bg-white px-3 py-2 rounded-xl text-xs font-semibold" style={{ boxShadow: '0 4px 12px rgba(0,0,0,0.1)', color: 'var(--brand-text-primary)', border: '1px solid #E9D5FF' }}>
                                  {showSys && <div style={{ color: '#DC2626' }}>Sys: {item.systolic ?? '—'}</div>}
                                  {showDia && <div style={{ color: '#2563EB' }}>Dia: {item.diastolic ?? '—'}</div>}
                                  {dateStr && <div style={{ color: '#94A3B8' }}>{dateStr}</div>}
                                </div>
                              );
                            }
                            return null;
                          }}
                        />
                        {showSys && <ReferenceLine y={160} stroke="#DC2626" strokeWidth={1} strokeDasharray="4 4" />}
                        {showDia && <ReferenceLine y={90} stroke="#2563EB" strokeWidth={1} strokeDasharray="4 4" />}
                        {showSys && <Area type="monotone" dataKey="systolic" stroke="#DC2626" strokeWidth={2} fill="url(#colorSysMobile)" dot={{ fill: '#DC2626', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />}
                        {showDia && <Area type="monotone" dataKey="diastolic" stroke="#2563EB" strokeWidth={2} fill="url(#colorDiaMobile)" dot={{ fill: '#2563EB', r: 3, stroke: '#fff', strokeWidth: 1.5 }} activeDot={{ r: 5 }} />}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                );
              })() : (
                <div className="h-32 flex items-center justify-center">
                  <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.noBpData')}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Alert Panel */}
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

      {/* Schedule Modal */}
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
    </div>
  );
}
