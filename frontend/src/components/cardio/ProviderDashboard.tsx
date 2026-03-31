'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from 'recharts';
import { Users, Activity, Bell, Heart } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n/en';
import AlertPanel, { type Alert, type AlertDetail } from './AlertPanel';
import ScheduleModal, { type ScheduleDetails } from './ScheduleModal';
import {
  getProviderStats,
  getProviderAlerts,
  getAlertDetail,
  acknowledgeProviderAlert,
  scheduleCall,
} from '@/lib/services/provider.service';


interface ProviderStats {
  totalPatients: number;
  monthlyInteractions: number;
  activeAlerts: number;
  bpControlledPercent: number;
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
  const color: 'red' | 'amber' = severity === 'HIGH' ? 'red' : 'amber';

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
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [scheduleAlert, setScheduleAlert] = useState<Alert | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [alertsList, setAlertsList] = useState<Alert[]>([]);
  const [stats, setStats] = useState<ProviderStats>({
    totalPatients: 0,
    monthlyInteractions: 0,
    activeAlerts: 0,
    bpControlledPercent: 0,
  });

  useEffect(() => {
    if (isLoading || !user) return;
    setDataLoading(true);
    Promise.all([getProviderStats(), getProviderAlerts()]).then(
      ([statsData, alertsData]) => {
        setStats({
          totalPatients: statsData.totalActivePatients ?? statsData.totalPatients ?? 0,
          monthlyInteractions:
            statsData.monthlyInteractions ?? 0,
          activeAlerts: statsData.activeAlertsCount ?? statsData.activeAlerts ?? 0,
          bpControlledPercent:
            statsData.bpControlledPercent ?? 0,
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

  const handleRowHover = useCallback(async (alert: Alert) => {
    if (trendAlert?.id === alert.id) return;
    setTrendAlert(alert);
    setTrendDetail(null);
    setTrendLoading(true);
    try {
      const detail = await getAlertDetail(alert.id);
      setTrendDetail(detail);
    } catch {
      // keep empty
    } finally {
      setTrendLoading(false);
    }
  }, [trendAlert?.id]);

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

  if (!user?.roles?.includes('SUPER_ADMIN')) {
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

  const activeAlerts = alertsList.filter((a) => !reviewedIds.has(a.id));

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
        <div className="flex flex-col md:flex-row md:items-center md:justify-between mb-6 gap-4">
          <div>
            <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
              {t('provider.dashboard')}
            </h1>
            <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
              {t('provider.dcWards')} &middot; March 2026
            </p>
          </div>
          <button
            className="h-10 px-6 rounded-full text-white font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
            style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
          >
            + {t('provider.addPatient')}
          </button>
        </div>

        {/* Stat Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {dataLoading ? (
            [0, 1, 2, 3].map((i) => (
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
              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.totalPatients')}</span>
                  <Users className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.totalPatients}</div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--brand-success-green)' }}>
                    &uarr; +3 {t('provider.thisWeek')}
                  </span>
                </div>
                <div
                  className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)' }}
                >
                  {t('provider.cptEligible')}
                </div>
              </div>

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

              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.activeAlerts')}</span>
                  <Bell className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-alert-red)' }}>{activeAlerts.length}</div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                  {activeAlerts.filter((a) => a.level === 'L1').length}x {t('provider.level1')} &middot;{' '}
                  {activeAlerts.filter((a) => a.level === 'L2').length}x {t('provider.level2')}
                </span>
              </div>

              <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-start justify-between mb-2">
                  <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.bpControlRate')}</span>
                  <Heart className="w-5 h-5" style={{ color: 'var(--brand-success-green)' }} />
                </div>
                <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-success-green)' }}>{stats.bpControlledPercent}%</div>
                <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.target')}: &gt;70%</span>
              </div>
            </>
          )}
        </div>

        {/* Main Content Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">

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

              {/* BP Trend Skeleton */}
              <div className="lg:col-span-2 bg-white p-6 rounded-2xl animate-pulse" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
                <div className="flex items-center justify-between mb-5">
                  <div className="h-4 rounded-full" style={{ backgroundColor: '#EDE9F6', width: 140 }} />
                  <div className="h-3 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 70 }} />
                </div>
                {/* Fake chart area */}
                <div className="h-48 flex items-end gap-1 px-2 pb-4" style={{ borderBottom: '1px solid #F1F5F9' }}>
                  {[40, 55, 35, 65, 50, 70, 45].map((h, i) => (
                    <div key={i} className="flex-1 rounded-t" style={{ height: `${h}%`, backgroundColor: '#EDE9F6' }} />
                  ))}
                </div>
                <div className="flex justify-between mt-3">
                  {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((_, i) => (
                    <div key={i} className="h-2.5 rounded-full" style={{ backgroundColor: '#F3EEFB', width: 14 }} />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>

          {/* Alert Queue */}
          <div className="lg:col-span-3 bg-white p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('provider.alertQueue')}
              </h2>
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold w-fit"
                style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
              >
                {t('provider.requiresAction')}
              </div>
            </div>

            {/* Desktop Table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr
                    className="text-[13px] font-semibold text-left"
                    style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' }}
                  >
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.patient')}</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.lastReading')}</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.type')}</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.severity')}</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.level')}</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>{t('provider.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAlerts.map((alert) => (
                    <tr
                      key={alert.id}
                      className="hover:bg-red-50 transition-colors relative cursor-pointer"
                      style={{ borderLeft: `3px solid ${alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}` }}
                      onMouseEnter={() => handleRowHover(alert)}
                      onClick={() => handleRowHover(alert)}
                    >
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <div className="flex items-center gap-3">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white font-semibold text-xs"
                            style={{ backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                          >
                            {alert.initials}
                          </div>
                          <div>
                            <div className="text-sm font-bold" style={{ color: 'var(--brand-text-primary)' }}>{alert.name}</div>
                            <div className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>{alert.location}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <div
                          className="text-[13px] font-bold"
                          style={{ color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                        >
                          {alert.reading}
                        </div>
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <div className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>{alert.type}</div>
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <div
                          className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold"
                          style={{
                            backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                            color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                          }}
                        >
                          {alert.severity}
                        </div>
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <div className="flex items-center gap-2">
                          <div
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
                            style={{
                              backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                              color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                            }}
                          >
                            <div
                              className="w-1.5 h-1.5 rounded-full animate-pulse"
                              style={{ backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                            />
                            {alert.level}
                          </div>
                          {alert.followUpScheduledAt && (
                            <span
                              className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold whitespace-nowrap"
                              style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}
                            >
                              {t('provider.callScheduled')}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <button
                          className="h-8 px-4 rounded-lg text-xs font-semibold border transition-all hover:bg-opacity-10"
                          style={{
                            borderColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                            color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                          }}
                          onClick={() => handleSelectAlert(alert)}
                        >
                          {t('provider.review')} &rarr;
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {activeAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="p-4 rounded-xl cursor-pointer"
                  style={{
                    backgroundColor: 'var(--brand-background)',
                    borderLeft: `3px solid ${alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                  }}
                  onClick={() => handleRowHover(alert)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm"
                        style={{ backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                      >
                        {alert.initials}
                      </div>
                      <div>
                        <div className="text-sm font-bold" style={{ color: 'var(--brand-text-primary)' }}>{alert.name}</div>
                        <div className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>{alert.location}</div>
                      </div>
                    </div>
                    <div
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-semibold"
                      style={{
                        backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                        color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                      }}
                    >
                      <div
                        className="w-1.5 h-1.5 rounded-full animate-pulse"
                        style={{ backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                      />
                      {alert.level}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <div>
                      <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>
                        {t('provider.lastReading')}
                      </div>
                      <div
                        className="text-sm font-bold"
                        style={{ color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                      >
                        {alert.reading}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--brand-text-muted)' }}>
                        {t('provider.type')}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--brand-text-secondary)' }}>{alert.type}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <div
                      className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold"
                      style={{
                        backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                        color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                      }}
                    >
                      {alert.severity}
                    </div>
                    {alert.followUpScheduledAt && (
                      <span
                        className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold"
                        style={{ backgroundColor: '#CCFBF1', color: '#0D9488' }}
                      >
                        Call scheduled
                      </span>
                    )}
                    <button
                      className="ml-auto h-8 px-4 rounded-lg text-xs font-semibold border"
                      style={{
                        borderColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                        color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                      }}
                      onClick={() => handleSelectAlert(alert)}
                    >
                      {t('provider.review')} &rarr;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* BP Trend Panel */}
          <div className="lg:col-span-2 bg-white p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('provider.bpTrend')} &middot; {trendDetail?.patient?.name ?? trendAlert?.name ?? t('provider.selectPatient')}
              </h2>
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('provider.last7Days')}</span>
            </div>

            {trendDetail?.bpTrend && trendDetail.bpTrend.length > 0 ? (() => {
              const trendData = trendDetail.bpTrend;
              const systolicVals = trendData
                .map((d) => d.systolic)
                .filter((v): v is number => v != null);
              const yMin = systolicVals.length > 0
                ? Math.floor((Math.min(...systolicVals) - 10) / 10) * 10
                : 130;
              const yMax = systolicVals.length > 0
                ? Math.ceil((Math.max(...systolicVals) + 10) / 10) * 10
                : 190;
              const yTicks: number[] = [];
              for (let t = yMin; t <= yMax; t += 10) yTicks.push(t);

              return (
                <div className="h-50 relative">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData}>
                      <defs>
                        <linearGradient id="colorBP" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#DC2626" stopOpacity={0.06} />
                          <stop offset="95%" stopColor="#DC2626" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="day"
                        axisLine={true}
                        tickLine={false}
                        tick={{ fill: '#94A3B8', fontSize: 12 }}
                      />
                      <YAxis
                        domain={[yMin, yMax]}
                        ticks={yTicks}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: '#94A3B8', fontSize: 12 }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const item = payload[0].payload as { diastolic?: number; date?: string };
                            const dateStr = item.date
                              ? new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                              : '';
                            return (
                              <div
                                className="bg-white px-3 py-2 rounded-lg text-xs font-semibold"
                                style={{ boxShadow: '0 4px 6px rgba(0,0,0,0.1)', color: 'var(--brand-text-primary)' }}
                              >
                                {payload[0].value}/{item.diastolic ?? '—'} mmHg{dateStr ? ` · ${dateStr}` : ''}
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                      <ReferenceLine y={160} stroke="#DC2626" strokeWidth={1} strokeDasharray="4 4" />
                      <Area
                        type="monotone"
                        dataKey="systolic"
                        stroke="#DC2626"
                        strokeWidth={2.5}
                        fill="url(#colorBP)"
                        dot={{ fill: '#DC2626', r: 4 }}
                        activeDot={{ r: 6 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>

                  <div
                    className="absolute right-2 text-[11px] font-semibold"
                    style={{ top: '40%', transform: 'translateY(-50%)', color: 'var(--brand-alert-red)' }}
                  >
                    {t('provider.alertThreshold')}
                  </div>
                </div>
              );
            })() : (
              <div className="h-50 flex items-center justify-center">
                <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
                  {trendLoading ? t('provider.loadingTrend') : t('provider.hoverToSee')}
                </p>
              </div>
            )}
          </div>
            </>
          )}
        </div>
      </main>

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
