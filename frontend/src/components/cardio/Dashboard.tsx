'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from 'recharts';
import { Flame, Clock, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getJournalEntries, getLatestBaseline, getAlerts } from '@/lib/services/journal.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getDayLabel(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' });
  } catch {
    return '';
  }
}

function formatAlertDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatAlertType(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getLastCheckInText(latestEntry: Record<string, unknown> | null): string {
  if (!latestEntry) return 'No check-ins yet';
  const d = new Date(latestEntry.entryDate as string);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface JournalEntry {
  entryDate: string;
  systolicBP?: number;
  diastolicBP?: number;
  medicationTaken?: boolean;
}

interface Baseline {
  baselineSystolic?: number | string;
  baselineDiastolic?: number | string;
}

interface DeviationAlert {
  id: string;
  type: string;
  severity: string;
  status: string;
  createdAt?: string;
  journalEntry?: { entryDate?: string };
}

export default function Dashboard() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  const [bpChartData, setBpChartData] = useState<{ day: string; systolic: number; diastolic: number }[]>([]);
  const [latestEntry, setLatestEntry] = useState<JournalEntry | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [alerts, setAlerts] = useState<DeviationAlert[]>([]);
  const [streak, setStreak] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    Promise.all([
      getJournalEntries({ limit: 7 }).catch(() => []),
      getLatestBaseline().catch(() => null),
      getAlerts().catch(() => []),
    ]).then(([entries, baselineData, alertsData]) => {
      const arr: JournalEntry[] = Array.isArray(entries) ? entries : [];

      const sortedAsc = [...arr].sort(
        (a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime(),
      );
      setBpChartData(
        sortedAsc.map((e) => ({
          day: getDayLabel(e.entryDate),
          systolic: e.systolicBP ?? 0,
          diastolic: e.diastolicBP ?? 0,
        })),
      );

      const sortedDesc = [...arr].sort(
        (a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
      );
      const newest = sortedDesc[0] ?? null;
      setLatestEntry(newest);
      setTotalEntries(arr.length);

      let s = 0;
      for (const e of sortedDesc) {
        if (e.medicationTaken === true) s++;
        else if (e.medicationTaken === false) break;
      }
      setStreak(s);

      setBaseline(baselineData ?? null);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    });
  }, [isAuthenticated, isLoading]);

  // ─── Derived values ─────────────────────────────────────────────────────
  const userName = user?.name?.split(' ')[0] ?? 'there';

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayHasEntry = latestEntry?.entryDate?.slice(0, 10) === todayStr;

  const latestBP =
    latestEntry?.systolicBP && latestEntry?.diastolicBP
      ? `${latestEntry.systolicBP}/${latestEntry.diastolicBP}`
      : '--/--';

  const bpStatusLabel =
    latestEntry?.systolicBP != null
      ? latestEntry.systolicBP >= 140 || (latestEntry.diastolicBP ?? 0) >= 90
        ? 'Elevated'
        : 'Within Target'
      : 'No Data';

  const bpStatusStyle =
    bpStatusLabel === 'Within Target'
      ? { backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }
      : bpStatusLabel === 'Elevated'
      ? { backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }
      : { backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-muted)' };

  const baselineStr =
    baseline?.baselineSystolic && baseline?.baselineDiastolic
      ? `${Math.round(Number(baseline.baselineSystolic))}/${Math.round(Number(baseline.baselineDiastolic))}`
      : '--/--';

  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  const bpDomain: [number | string, number | string] =
    bpChartData.length > 0
      ? [
          Math.max(0, Math.min(...bpChartData.map((d) => d.systolic)) - 15),
          Math.max(...bpChartData.map((d) => d.systolic)) + 15,
        ]
      : [100, 180];

  return (
    <div
      className="min-h-screen flex justify-center items-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {/* Main Content */}
      <main className="max-w-300 mx-auto px-4 md:px-8 py-6 md:py-8 pb-8">
        {/* ROW 1 - Greeting + Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-5 mb-5">
          {/* Greeting Card */}
          <div
            className="md:col-span-3 lg:col-span-2 p-6 md:p-7 rounded-[20px] relative overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
            }}
          >
            <h2 className="text-white text-2xl font-bold mb-2">
              Good morning, {userName}
            </h2>
            <p
              className="text-white mb-4"
              style={{ opacity: 0.8, fontSize: '14px' }}
            >
              Your care team is monitoring your progress
            </p>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-white rounded-full text-xs font-semibold"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              Cedar Hill Connected
            </div>
          </div>

          {/* Stat Card 1 - BP */}
          <div
            className="bg-white p-4 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <div
              className="text-2xl font-bold mb-1"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              {latestBP}
            </div>
            <div
              className="text-xs mb-2"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              mmHg
            </div>
            <div
              className="text-xs mb-2"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {todayHasEntry ? "Today's BP" : 'Latest BP'}
            </div>
            <div
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold"
              style={bpStatusStyle}
            >
              {bpStatusLabel}
            </div>
          </div>

          {/* Stat Card 2 - Medication Streak */}
          <div
            className="bg-white p-4 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <Flame
              className="w-6 h-6 mb-2"
              style={{ color: 'var(--brand-warning-amber)' }}
            />
            <div
              className="text-2xl font-bold mb-1"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {streak} day
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              streak
            </div>
            <div
              className="text-xs mt-1"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              Medication taken
            </div>
          </div>

          {/* Stat Card 3 - Total Check-ins */}
          <div
            className="bg-white p-4 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <div
              className="text-2xl font-bold mb-1"
              style={{ color: 'var(--brand-accent-teal)' }}
            >
              {totalEntries}
            </div>
            <div
              className="text-xs mb-1"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Total
            </div>
            <div
              className="text-xs"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              Check-ins logged
            </div>
          </div>
        </div>

        {/* ROW 2 - Main Content */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* BP Trend Card */}
          <div
            className="bg-white p-6 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-base font-semibold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                Your BP This Week
              </h3>
              <a
                href="#"
                className="text-xs"
                style={{ color: 'var(--brand-accent-teal)' }}
              >
                View full history &rarr;
              </a>
            </div>

            <div className="h-48 mb-3">
              {bpChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={bpChartData}>
                    <defs>
                      <linearGradient
                        id="colorSystolic"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#7B00E0"
                          stopOpacity={0.08}
                        />
                        <stop
                          offset="95%"
                          stopColor="#7B00E0"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <XAxis
                      dataKey="day"
                      axisLine={true}
                      tickLine={false}
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                    />
                    <YAxis
                      domain={bpDomain}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94A3B8', fontSize: 11 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="systolic"
                      stroke="#7B00E0"
                      strokeWidth={2}
                      fill="url(#colorSystolic)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm" style={{ color: 'var(--brand-text-muted)' }}>
                    No readings yet — complete a check-in to see your trend
                  </p>
                </div>
              )}
            </div>

            <p
              className="text-xs"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Baseline: {baselineStr} mmHg
            </p>
          </div>

          {/* Today's Check-In CTA */}
          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              border: '1px solid #E9D5FF',
            }}
          >
            <Clock
              className="w-8 h-8 mb-3"
              style={{ color: 'var(--brand-primary-purple)' }}
            />
            <h3
              className="text-base font-semibold mb-1"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Today&apos;s Check-In
            </h3>
            <p
              className="text-xs mb-3"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Takes about 3 minutes
            </p>
            {!todayHasEntry && (
              <div
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold mb-4"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  color: 'var(--brand-warning-amber)',
                }}
              >
                Due today
              </div>
            )}
            {todayHasEntry && (
              <div
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold mb-4"
                style={{
                  backgroundColor: 'var(--brand-success-green-light)',
                  color: 'var(--brand-success-green)',
                }}
              >
                Completed today
              </div>
            )}

            <button
              onClick={() => router.push('/check-in')}
              className="w-full h-12 flex items-center justify-center gap-2 rounded-full text-white font-bold text-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{
                backgroundColor: 'var(--brand-primary-purple)',
                boxShadow: 'var(--brand-shadow-button)',
              }}
            >
              {todayHasEntry ? 'Log Another Reading' : "Start Today's Check-In"}
              <ArrowRight className="w-4 h-4" />
            </button>

            <p
              className="text-[11px] mt-3 text-center"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              Last check-in: {getLastCheckInText(latestEntry as Record<string, unknown> | null)}
            </p>
          </div>

          {/* Recent Alerts */}
          <div
            className="bg-white p-6 rounded-2xl"
            style={{ boxShadow: 'var(--brand-shadow-card)' }}
          >
            <h3
              className="text-base font-semibold mb-4"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              Recent Alerts
            </h3>

            {openAlerts.length === 0 && streak === 0 && (
              <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                No active alerts — keep up the great work!
              </p>
            )}

            {openAlerts.slice(0, 2).map((alert) => (
              <div
                key={alert.id}
                className="p-3 rounded-xl mb-3 relative"
                style={{
                  backgroundColor:
                    alert.severity === 'HIGH'
                      ? 'var(--brand-alert-red-light)'
                      : 'var(--brand-warning-amber-light)',
                  borderLeft: `3px solid ${alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                }}
              >
                <div className="flex items-start justify-between mb-1">
                  <p
                    className="text-xs font-semibold"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {formatAlertType(alert.type)} — {formatAlertDate(
                      alert.journalEntry?.entryDate ?? alert.createdAt ?? '',
                    )}
                  </p>
                  <span
                    className="text-[11px] font-semibold"
                    style={{ color: alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}
                  >
                    Open
                  </span>
                </div>
                <p
                  className="text-xs"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Care team notified
                </p>
              </div>
            ))}

            {streak > 0 && (
              <div
                className="p-3 rounded-xl"
                style={{
                  backgroundColor: 'var(--brand-success-green-light)',
                  borderLeft: '3px solid var(--brand-success-green)',
                }}
              >
                <p
                  className="text-xs font-semibold mb-1"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  Medication streak: {streak} day{streak !== 1 ? 's' : ''}
                </p>
                <p
                  className="text-xs"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Keep it up!
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

    </div>
  );
}
