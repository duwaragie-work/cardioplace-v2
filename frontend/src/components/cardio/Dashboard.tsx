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
  try { return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short' }); }
  catch { return ''; }
}

function formatAlertDate(dateStr: string): string {
  try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return ''; }
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
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
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

// ─── Skeleton bone ───────────────────────────────────────────────────────────
function Bone({ w, h = 14, r = 8, color = '#EDE9F6' }: { w: number | string; h?: number; r?: number; color?: string }) {
  return (
    <div className="animate-pulse flex-shrink-0"
      style={{ width: w, height: h, borderRadius: r, backgroundColor: color }} />
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
export default function Dashboard() {
  const router = useRouter();
  const { user, isAuthenticated, isLoading } = useAuth();

  const [bpChartData, setBpChartData] = useState<{ day: string; systolic: number; diastolic: number }[]>([]);
  const [latestEntry, setLatestEntry] = useState<JournalEntry | null>(null);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [alerts, setAlerts] = useState<DeviationAlert[]>([]);
  const [streak, setStreak] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    setDataLoading(true);
    Promise.all([
      getJournalEntries({ limit: 7 }).catch(() => []),
      getLatestBaseline().catch(() => null),
      getAlerts().catch(() => []),
    ]).then(([entries, baselineData, alertsData]) => {
      const arr: JournalEntry[] = Array.isArray(entries) ? entries : [];
      const sortedAsc = [...arr].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
      setBpChartData(sortedAsc.map((e) => ({ day: getDayLabel(e.entryDate), systolic: e.systolicBP ?? 0, diastolic: e.diastolicBP ?? 0 })));
      const sortedDesc = [...arr].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
      setLatestEntry(sortedDesc[0] ?? null);
      setTotalEntries(arr.length);
      let s = 0;
      for (const e of sortedDesc) {
        if (e.medicationTaken === true) s++;
        else if (e.medicationTaken === false) break;
      }
      setStreak(s);
      setBaseline(baselineData ?? null);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated, isLoading]);

  // ─── Derived values ───────────────────────────────────────────────────────
  const loading = isLoading || dataLoading;
  const userName = user?.name?.split(' ')[0] ?? '';

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayHasEntry = latestEntry?.entryDate?.slice(0, 10) === todayStr;

  const latestBP = latestEntry?.systolicBP && latestEntry?.diastolicBP
    ? `${latestEntry.systolicBP}/${latestEntry.diastolicBP}` : '--/--';

  const bpStatusLabel = latestEntry?.systolicBP != null
    ? (latestEntry.systolicBP >= 140 || (latestEntry.diastolicBP ?? 0) >= 90 ? 'Elevated' : 'Within Target')
    : 'No Data';

  const bpStatusStyle = bpStatusLabel === 'Within Target'
    ? { backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }
    : bpStatusLabel === 'Elevated'
    ? { backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }
    : { backgroundColor: '#F1F5F9', color: 'var(--brand-text-muted)' };

  const baselineStr = baseline?.baselineSystolic && baseline?.baselineDiastolic
    ? `${Math.round(Number(baseline.baselineSystolic))}/${Math.round(Number(baseline.baselineDiastolic))}` : '--/--';

  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  const bpDomain: [number | string, number | string] = bpChartData.length > 0
    ? [Math.max(0, Math.min(...bpChartData.map((d) => d.systolic)) - 15), Math.max(...bpChartData.map((d) => d.systolic)) + 15]
    : [100, 180];

  return (
    <div className="relative overflow-hidden" style={{ height: 'calc(100vh - 4rem)', backgroundColor: '#FAFBFF' }}>

      {/* ── Decorative background blobs ── */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        {/* Top-right purple glow */}
        <div className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(123,0,224,0.07) 0%, transparent 70%)' }} />
        {/* Bottom-left teal glow */}
        <div className="absolute -bottom-24 -left-24 w-[400px] h-[400px] rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(0,188,212,0.06) 0%, transparent 70%)' }} />
        {/* Center faint blob */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full"
          style={{ background: 'radial-gradient(ellipse, rgba(147,51,234,0.03) 0%, transparent 70%)' }} />
      </div>

      {/* ── Content ── */}
      <main className="relative h-full flex flex-col px-4 md:px-8 py-4 md:py-5 max-w-7xl mx-auto">

        {/* ROW 1 — Greeting + Stat cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-3 md:mb-4">

          {/* Greeting Card */}
          <div
            className="md:col-span-3 lg:col-span-2 p-5 rounded-[20px] relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)' }}
          >
            {/* decorative circle inside card */}
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-10 bg-white" />
            <div className="absolute -bottom-8 -right-4 w-20 h-20 rounded-full opacity-10 bg-white" />

            <p className="text-white/70 text-xs font-medium mb-1">{getGreeting()}</p>
            {loading ? (
              <Bone w={160} h={26} color="rgba(255,255,255,0.3)" />
            ) : (
              <h2 className="text-white text-xl md:text-2xl font-bold leading-tight mb-1">
                {userName ? userName : 'Welcome back'}
              </h2>
            )}
            <p className="text-white/70 text-xs mt-1 mb-3">
              Your care team is monitoring your progress
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-full text-xs font-semibold text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block" />
              Cedar Hill Connected
            </div>
          </div>

          {/* BP Stat Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w={60} h={9} r={5} /> : (todayHasEntry ? "Today's BP" : 'Latest BP')}
            </p>
            {loading ? (
              <Bone w={88} h={28} />
            ) : (
              <div className="text-2xl font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{latestBP}</div>
            )}
            <p className="text-[10px] mt-0.5 mb-2" style={{ color: 'var(--brand-text-muted)' }}>mmHg</p>
            {loading ? (
              <Bone w={72} h={18} r={99} />
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold" style={bpStatusStyle}>
                {bpStatusLabel}
              </span>
            )}
          </div>

          {/* Streak Stat Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <Flame className="w-5 h-5 mb-2" style={{ color: 'var(--brand-warning-amber)' }} />
            {loading ? (
              <Bone w={64} h={28} />
            ) : (
              <div className="text-2xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {streak} <span className="text-sm font-medium">day</span>
              </div>
            )}
            <p className="text-[10px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w={80} h={9} r={5} /> : 'Medication streak'}
            </p>
          </div>

          {/* Total Check-ins Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-text-muted)' }}>
              Check-ins
            </p>
            {loading ? (
              <Bone w={52} h={28} />
            ) : (
              <div className="text-2xl font-bold" style={{ color: 'var(--brand-accent-teal)' }}>{totalEntries}</div>
            )}
            <p className="text-[10px] mt-1" style={{ color: 'var(--brand-text-secondary)' }}>
              {loading ? <Bone w={56} h={9} r={5} /> : 'Total logged'}
            </p>
          </div>
        </div>

        {/* ROW 2 — BP Chart · Check-In CTA · Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-4 flex-1 min-h-0">

          {/* BP Trend */}
          <div className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                BP This Week
              </h3>
              <a href="#" className="text-[11px]" style={{ color: 'var(--brand-accent-teal)' }}>
                Full history →
              </a>
            </div>

            <div className="flex-1 min-h-0" style={{ minHeight: 120 }}>
              {loading ? (
                <div className="h-full flex flex-col justify-end gap-1 pb-2">
                  {/* Fake chart bars */}
                  <div className="flex items-end gap-1 h-28 px-2">
                    {[55, 72, 48, 80, 62, 74, 44].map((pct, i) => (
                      <div key={i} className="flex-1 rounded-sm animate-pulse" style={{ height: `${pct}%`, backgroundColor: '#EDE9F6' }} />
                    ))}
                  </div>
                  <div className="flex gap-1 px-2 mt-1">
                    {['M','T','W','T','F','S','S'].map((_d, i) => (
                      <div key={i} className="flex-1 flex justify-center">
                        <Bone w={12} h={8} r={4} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : bpChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={bpChartData}>
                    <defs>
                      <linearGradient id="colorSystolic" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#7B00E0" stopOpacity={0.08} />
                        <stop offset="95%" stopColor="#7B00E0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} />
                    <YAxis domain={bpDomain} axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} width={30} />
                    <Area type="monotone" dataKey="systolic" stroke="#7B00E0" strokeWidth={2} fill="url(#colorSystolic)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-center" style={{ color: 'var(--brand-text-muted)' }}>
                    No readings yet — complete a check-in
                  </p>
                </div>
              )}
            </div>

            <p className="text-[10px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w="60%" h={9} r={5} /> : `Baseline: ${baselineStr} mmHg`}
            </p>
          </div>

          {/* Check-In CTA */}
          <div
            className="p-4 md:p-5 rounded-2xl flex flex-col justify-between"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)', border: '1px solid #E9D5FF' }}
          >
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Clock className="w-5 h-5" style={{ color: 'var(--brand-primary-purple)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  Today&apos;s Check-In
                </h3>
              </div>
              <p className="text-[11px] mb-3" style={{ color: 'var(--brand-text-muted)' }}>Takes about 3 minutes</p>

              {loading ? (
                <Bone w={88} h={20} r={99} />
              ) : todayHasEntry ? (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}>
                  ✓ Completed today
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                  style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}>
                  Due today
                </span>
              )}
            </div>

            <div>
              <button
                onClick={() => router.push('/check-in')}
                className="w-full h-9 flex items-center justify-center gap-1.5 rounded-full text-white font-bold text-xs transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
              >
                {loading ? (
                  <Bone w={120} h={12} color="rgba(255,255,255,0.4)" />
                ) : (
                  <>{todayHasEntry ? 'Log Another Reading' : 'Start Check-In'} <ArrowRight className="w-3 h-3" /></>
                )}
              </button>
              <p className="text-[10px] mt-1.5 text-center" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? (
                  <span className="flex justify-center"><Bone w={90} h={8} r={5} /></span>
                ) : (
                  `Last: ${getLastCheckInText(latestEntry as Record<string, unknown> | null)}`
                )}
              </p>
            </div>
          </div>

          {/* Recent Alerts */}
          <div className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
              Recent Alerts
            </h3>

            {loading ? (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: '#F8F4FF', borderLeft: '3px solid #EDE9F6' }}>
                    <Bone w="75%" h={11} />
                    <div className="mt-1.5"><Bone w="45%" h={9} r={5} /></div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {openAlerts.length === 0 && streak === 0 && (
                  <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                    No active alerts — keep up the great work!
                  </p>
                )}

                <div className="space-y-2">
                  {openAlerts.slice(0, 2).map((alert) => (
                    <div key={alert.id} className="p-3 rounded-xl"
                      style={{
                        backgroundColor: alert.severity === 'HIGH' ? 'var(--brand-alert-red-light)' : 'var(--brand-warning-amber-light)',
                        borderLeft: `3px solid ${alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)'}`,
                      }}>
                      <div className="flex items-start justify-between">
                        <p className="text-[11px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                          {formatAlertType(alert.type)}
                        </p>
                        <span className="text-[10px] font-semibold"
                          style={{ color: alert.severity === 'HIGH' ? 'var(--brand-alert-red)' : 'var(--brand-warning-amber)' }}>
                          Open
                        </span>
                      </div>
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                        {formatAlertDate(alert.journalEntry?.entryDate ?? alert.createdAt ?? '')} · Care team notified
                      </p>
                    </div>
                  ))}

                  {streak > 0 && (
                    <div className="p-3 rounded-xl"
                      style={{ backgroundColor: 'var(--brand-success-green-light)', borderLeft: '3px solid var(--brand-success-green)' }}>
                      <p className="text-[11px] font-semibold mb-0.5" style={{ color: 'var(--brand-text-primary)' }}>
                        {streak} day medication streak 🔥
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>Keep it up!</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
