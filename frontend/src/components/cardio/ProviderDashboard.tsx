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
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'framer-motion';
import { useAuth } from '@/lib/auth-context';
import AlertPanel, { type Alert } from './AlertPanel';
import ScheduleModal, { type ScheduleDetails } from './ScheduleModal';
import {
  getProviderStats,
  getProviderAlerts,
  acknowledgeProviderAlert,
} from '@/lib/services/provider.service';

const bpTrendData = [
  { day: 'Mon', systolic: 155, id: 1 },
  { day: 'Tue', systolic: 158, id: 2 },
  { day: 'Wed', systolic: 162, id: 3 },
  { day: 'Thu', systolic: 165, id: 4 },
  { day: 'Fri', systolic: 168, id: 5 },
  { day: 'Sat', systolic: 175, id: 6 },
  { day: 'Sun', systolic: 185, id: 7 },
];

interface ProviderStats {
  totalPatients: number;
  monthlyInteractions: number;
  activeAlerts: number;
  bpControlledPercent: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function transformAlert(raw: any): Alert {
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
    if (raw.systolicBP && raw.diastolicBP) {
      reading = `${raw.systolicBP}/${raw.diastolicBP} mmHg`;
    } else if ((raw.type ?? raw.deviationType ?? '').includes('MEDICATION')) {
      reading = 'Missed medication';
    } else {
      reading = '—';
    }
  }

  return {
    id: String(raw.id),
    initials,
    name,
    location: raw.location ?? raw.ward ?? '—',
    reading,
    type: raw.type ?? raw.deviationType ?? '',
    severity,
    level,
    color,
  };
}

export default function ProviderDashboard() {
  const { user, isLoading } = useAuth();
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());
  const [scheduleAlert, setScheduleAlert] = useState<Alert | null>(null);
  const [alertsList, setAlertsList] = useState<Alert[]>([]);
  const [stats, setStats] = useState<ProviderStats>({
    totalPatients: 0,
    monthlyInteractions: 0,
    activeAlerts: 0,
    bpControlledPercent: 0,
  });



  useEffect(() => {
    if (isLoading || !user) return; // 🔴 WAIT until user is ready

    console.log(user);
    Promise.all([getProviderStats(), getProviderAlerts()]).then(
      ([statsData, alertsData]) => {
        setStats({
          totalPatients: statsData.totalPatients ?? statsData.patients ?? 0,
          monthlyInteractions:
            statsData.monthlyInteractions ?? statsData.interactions ?? 0,
          activeAlerts: statsData.activeAlerts ?? statsData.alerts ?? 0,
          bpControlledPercent:
            statsData.bpControlledPercent ?? statsData.bpControlled ?? 0,
        });
        const rawAlerts: Alert[] = Array.isArray(alertsData)
          ? alertsData.map(transformAlert)
          : [];
        setAlertsList(rawAlerts);
      },
    ).catch(() => {
      // keep defaults on error
    });
  }, [user,isLoading]);

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
          403 — Access Denied
        </h1>
        <p style={{ fontSize: '1.125rem', color: 'var(--brand-text-secondary, #6b7280)' }}>
          Super Admin only
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
          Go to Dashboard
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
  };

  const handleSchedule = (alert: Alert) => {
    setScheduleAlert(alert);
  };

  const handleScheduleConfirm = (_details: ScheduleDetails) => {
    setTimeout(() => {
      setScheduleAlert(null);
    }, 1600);
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
              Patient Safety Dashboard
            </h1>
            <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
              DC Wards 7 &amp; 8 &middot; March 2026
            </p>
          </div>
          <button
            className="h-10 px-6 rounded-full text-white font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98] whitespace-nowrap"
            style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
          >
            + Add Patient
          </button>
        </div>

        {/* Stat Cards Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Active Patients</span>
              <Users className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
            </div>
            <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.totalPatients}</div>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs font-semibold" style={{ color: 'var(--brand-success-green)' }}>
                &uarr; +3 this week
              </span>
            </div>
            <div
              className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold"
              style={{ backgroundColor: 'var(--brand-accent-teal-light)', color: 'var(--brand-accent-teal)' }}
            >
              CPT 99454 eligible
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Monthly Interactions</span>
              <Activity className="w-5 h-5" style={{ color: 'var(--brand-accent-teal)' }} />
            </div>
            <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>{stats.monthlyInteractions.toLocaleString()}</div>
            <span className="text-xs font-semibold" style={{ color: 'var(--brand-success-green)' }}>
              &uarr; 18% vs last month
            </span>
          </div>

          <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Active Alerts</span>
              <Bell className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
            </div>
            <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-alert-red)' }}>{activeAlerts.length}</div>
            <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
              {activeAlerts.filter((a) => a.level === 'L1').length}x Level 1 &middot;{' '}
              {activeAlerts.filter((a) => a.level === 'L2').length}x Level 2
            </span>
          </div>

          <div className="bg-white p-5 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex items-start justify-between mb-2">
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>BP Controlled</span>
              <Heart className="w-5 h-5" style={{ color: 'var(--brand-success-green)' }} />
            </div>
            <div className="text-4xl font-bold mb-2" style={{ color: 'var(--brand-success-green)' }}>{stats.bpControlledPercent}%</div>
            <span className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>Target: &gt;70%</span>
          </div>
        </div>

        {/* Main Content Row */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
          {/* Alert Queue */}
          <div className="lg:col-span-3 bg-white p-6 rounded-2xl" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                Patient Alert Queue
              </h2>
              <div
                className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold w-fit"
                style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}
              >
                Requires Action
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
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Patient</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Last Reading</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Type</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Severity</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Level</th>
                    <th className="px-4 py-3 border-b" style={{ borderColor: 'var(--brand-border)' }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {activeAlerts.map((alert) => (
                    <tr
                      key={alert.id}
                      className="hover:bg-red-50 transition-colors relative"
                      style={{ borderLeft: `3px solid ${alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}` }}
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
                      </td>
                      <td className="px-4 py-4 border-b" style={{ borderColor: '#F1F5F9' }}>
                        <button
                          className="h-8 px-4 rounded-lg text-xs font-semibold border transition-all hover:bg-opacity-10"
                          style={{
                            borderColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                            color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                          }}
                          onClick={() => setSelectedAlert(alert)}
                        >
                          Review &rarr;
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
                  className="p-4 rounded-xl"
                  style={{
                    backgroundColor: 'var(--brand-background)',
                    borderLeft: `3px solid ${alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                  }}
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
                        Last Reading
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
                        Type
                      </div>
                      <div className="text-xs" style={{ color: 'var(--brand-text-secondary)' }}>{alert.type}</div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <div
                      className="inline-flex items-center px-2 py-1 rounded-full text-[10px] font-semibold"
                      style={{
                        backgroundColor: alert.color === 'red' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                        color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                      }}
                    >
                      {alert.severity}
                    </div>
                    <button
                      className="ml-auto h-8 px-4 rounded-lg text-xs font-semibold border"
                      style={{
                        borderColor: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                        color: alert.color === 'red' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)',
                      }}
                      onClick={() => setSelectedAlert(alert)}
                    >
                      Review &rarr;
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
                BP Trend &middot; Marcus Johnson
              </h2>
              <span className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>Last 7 Days</span>
            </div>

            <div className="h-50 relative">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={bpTrendData}>
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
                    domain={[130, 190]}
                    ticks={[130, 140, 150, 160, 170, 180, 190]}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: '#94A3B8', fontSize: 12 }}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload as { id?: number };
                        return (
                          <div
                            className="bg-white px-3 py-2 rounded-lg text-xs font-semibold"
                            style={{ boxShadow: '0 4px 6px rgba(0,0,0,0.1)', color: 'var(--brand-text-primary)' }}
                          >
                            {payload[0].value}/115 mmHg &middot; Mar {15 + (item.id || 0)}
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
                Alert threshold
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Alert Panel */}
      <AnimatePresence>
        {selectedAlert && (
          <AlertPanel
            alert={selectedAlert}
            onClose={() => setSelectedAlert(null)}
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
            onClose={() => setScheduleAlert(null)}
            onConfirm={handleScheduleConfirm}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
