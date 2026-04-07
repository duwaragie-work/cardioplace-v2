'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Label,
  Tooltip,
  CartesianGrid,
  ResponsiveContainer,
} from 'recharts';
import { Flame, Clock, ArrowRight } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { getJournalEntries, getLatestBaseline, getAlerts, getJournalStats } from '@/lib/services/journal.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getDateLabel(dateStr: string): string {
  try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
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


// ─── Types ────────────────────────────────────────────────────────────────────
interface JournalEntry {
  entryDate: string;
  measurementTime?: string | null;
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
  const { t } = useLanguage();

  const [bpChartData, setBpChartData] = useState<{ day: string; systolic: number; diastolic: number }[]>([]);
  const [chartRange, setChartRange] = useState<7 | 90>(7);
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
      getJournalEntries({ limit: 200 }).catch(() => []),
      getLatestBaseline().catch(() => null),
      getAlerts().catch(() => []),
      getJournalStats().catch(() => null),
    ]).then(([entries, baselineData, alertsData, stats]) => {
      const arr: JournalEntry[] = Array.isArray(entries) ? entries : [];
      const sortedAsc = [...arr].sort((a, b) => new Date(a.entryDate).getTime() - new Date(b.entryDate).getTime());
      setBpChartData(sortedAsc.map((e) => ({
        day: getDateLabel(e.entryDate),
        systolic: e.systolicBP ?? 0,
        diastolic: e.diastolicBP ?? 0,
      })));
      const sortedDesc = [...arr].sort((a, b) => new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime());
      setLatestEntry(sortedDesc[0] ?? null);
      setTotalEntries(stats?.totalEntries ?? arr.length);
      setStreak(stats?.currentStreak ?? 0);
      setBaseline(baselineData ?? null);
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated, isLoading]);

  // ─── Derived values ───────────────────────────────────────────────────────
  const visibleChartData = chartRange === 7 ? bpChartData.slice(-7) : bpChartData;
  const loading = isLoading || dataLoading;
  const userName = user?.name?.split(' ')[0] ?? '';

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayHasEntry = latestEntry?.entryDate?.slice(0, 10) === todayStr;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return t('dashboard.goodMorning');
    if (h < 17) return t('dashboard.goodAfternoon');
    return t('dashboard.goodEvening');
  })();

  const latestBP = latestEntry?.systolicBP && latestEntry?.diastolicBP
    ? `${latestEntry.systolicBP}/${latestEntry.diastolicBP}` : '--/--';

  const bpStatusLabel = latestEntry?.systolicBP != null
    ? (latestEntry.systolicBP >= 140 || (latestEntry.diastolicBP ?? 0) >= 90 ? t('dashboard.elevated') : t('dashboard.withinTarget'))
    : t('dashboard.noData');

  const bpStatusStyle = bpStatusLabel === t('dashboard.withinTarget')
    ? { backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }
    : bpStatusLabel === t('dashboard.elevated')
      ? { backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }
      : { backgroundColor: '#F1F5F9', color: 'var(--brand-text-muted)' };

  const baselineStr = baseline?.baselineSystolic && baseline?.baselineDiastolic
    ? `${Math.round(Number(baseline.baselineSystolic))}/${Math.round(Number(baseline.baselineDiastolic))}` : '--/--';

  const openAlerts = alerts.filter((a) => a.status === 'OPEN');

  const bpDomain: [number | string, number | string] = visibleChartData.length > 0
    ? [Math.max(0, Math.min(...visibleChartData.map((d) => d.systolic)) - 15), Math.max(...visibleChartData.map((d) => d.systolic)) + 15]
    : [100, 180];

  return (
    <div className="relative overflow-auto" style={{ height: 'calc(100vh - 4rem)', backgroundColor: '#FAFBFF' }}>

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
        <div className="grid grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4 mb-3 md:mb-4">

          {/* Greeting Card */}
          <div
            className="col-span-3 lg:col-span-2 p-5 rounded-[20px] relative overflow-hidden"
            style={{ background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)' }}
          >
            {/* decorative circle inside card */}
            <div className="absolute -top-6 -right-6 w-28 h-28 rounded-full opacity-10 bg-white" />
            <div className="absolute -bottom-8 -right-4 w-20 h-20 rounded-full opacity-10 bg-white" />

            <p className="text-white/70 text-xs font-medium mb-1">{greeting}</p>
            {loading ? (
              <Bone w={160} h={26} color="rgba(255,255,255,0.3)" />
            ) : (
              <h2 className="text-white text-xl md:text-2xl font-bold leading-tight mb-1">
                {userName ? userName : t('dashboard.welcomeBack')}
              </h2>
            )}
            <p className="text-white/70 text-xs mt-1 mb-3">
              {t('dashboard.careTeamMonitoring')}
            </p>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-full text-xs font-semibold text-white">
              <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block" />
              {t('dashboard.cedarHillConnected')}
            </div>
          </div>

          {/* BP Stat Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <span className="block text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w={60} h={9} r={5} /> : (todayHasEntry ? t('dashboard.todaysBp') : t('dashboard.latestBp'))}
            </span>
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
                {streak} <span className="text-sm font-medium">{t('dashboard.day')}</span>
              </div>
            )}
            <span className="block text-[10px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w={80} h={9} r={5} /> : t('dashboard.medicationStreak')}
            </span>
          </div>

          {/* Total Check-ins Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--brand-text-muted)' }}>
              {t('dashboard.checkIns')}
            </p>
            {loading ? (
              <Bone w={52} h={28} />
            ) : (
              <div className="text-2xl font-bold" style={{ color: 'var(--brand-accent-teal)' }}>{totalEntries}</div>
            )}
            <span className="block text-[10px] mt-1" style={{ color: 'var(--brand-text-secondary)' }}>
              {loading ? <Bone w={56} h={9} r={5} /> : t('dashboard.totalLogged')}
            </span>
          </div>
        </div>

        {/* ROW 2 — BP Chart · Check-In CTA · Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 flex-1 h-[300px]">

          {/* BP Trend */}
          <div className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                {chartRange === 7 ? t('dashboard.bpThisWeek') : t('dashboard.bpTrend')}
              </h3>
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                {([7, 90] as const).map((range) => (
                  <button
                    key={range}
                    onClick={() => setChartRange(range)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all"
                    style={{
                      backgroundColor: chartRange === range ? 'var(--brand-primary-purple)' : 'transparent',
                      color: chartRange === range ? '#fff' : 'var(--brand-text-muted)',
                    }}
                  >
                    {range === 7 ? '7D' : '90D'}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1" style={{ minHeight: 220 }}>
              {loading ? (
                <div className="h-full flex flex-col justify-end gap-1 pb-2">
                  {/* Fake chart bars */}
                  <div className="flex items-end gap-1 h-28 px-2">
                    {[55, 72, 48, 80, 62, 74, 44].map((pct, i) => (
                      <div key={i} className="flex-1 rounded-sm animate-pulse" style={{ height: `${pct}%`, backgroundColor: '#EDE9F6' }} />
                    ))}
                  </div>
                  <div className="flex gap-1 px-2 mt-1">
                    {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((_d, i) => (
                      <div key={i} className="flex-1 flex justify-center">
                        <Bone w={12} h={8} r={4} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : visibleChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={visibleChartData}>
                    <defs>
                      <linearGradient id="colorSystolic" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7B00E0" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#7B00E0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1EEFF" vertical={false} />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} interval={Math.max(0, Math.floor(visibleChartData.length / 8) - 1)}>
                      <Label value="Date" position="insideBottom" offset={-2} style={{ fill: '#1d1d1d', fontSize: 10, fontWeight: 600 }} />
                    </XAxis>
                    <YAxis domain={bpDomain} axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} width={38}>
                      <Label value="mmHg" angle={-90} position="insideLeft" offset={4} style={{ fill: '#1d1d1d', fontSize: 10 ,fontWeight: 600}} />
                    </YAxis>
                    <Tooltip
                      contentStyle={{ backgroundColor: '#fff', border: '1px solid #E9D5FF', borderRadius: 12, boxShadow: '0 4px 16px rgba(123,0,224,0.1)', fontSize: 12 }}
                      labelStyle={{ color: '#94A3B8', fontSize: 11, marginBottom: 2 }}
                      itemStyle={{ color: '#7B00E0', fontWeight: 600 }}
                      cursor={{ stroke: '#7B00E0', strokeWidth: 1, strokeDasharray: '4 4' }}
                    />
                    <Area type="natural" dataKey="systolic" stroke="#7B00E0" strokeWidth={2} fill="url(#colorSystolic)" dot={visibleChartData.length > 14 ? false : { r: 3.5, fill: '#fff', stroke: '#7B00E0', strokeWidth: 2 }} activeDot={{ r: 4, fill: '#7B00E0', stroke: '#fff', strokeWidth: 2 }} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-xs text-center" style={{ color: 'var(--brand-text-muted)' }}>
                    {t('dashboard.noReadingsYet')}
                  </p>
                </div>
              )}
            </div>

            <span className="block text-[10px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
              {loading ? <Bone w="60%" h={9} r={5} /> : `${t('dashboard.baseline')}: ${baselineStr} mmHg`}
            </span>
          </div>

          {/* Check-In CTA + Alerts */}
          <div className="grid grid-rows-[0.5fr_1.5fr] gap-3 md:gap-4">

            <div
              className="p-4 md:p-5 rounded-2xl flex flex-col justify-between bg-[#7B00E0]">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="w-6 h-6" color='white' />
                  <h3 className="text-lg font-semibold text-white" >
                    {t('dashboard.todayCheckin')}
                  </h3>
                  {loading ? (
                    <Bone w={88} h={20} r={99} />
                  ) : todayHasEntry ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                      style={{ backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }}>
                      {'✓ ' + t('dashboard.completedToday')}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold"
                      style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber)' }}>
                      {t('dashboard.dueToday')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] mb-3 text-white">{t('dashboard.takesAbout')}</p>
              </div>

              <div>
                <button
                  onClick={() => router.push('/check-in')}
                  className="w-full h-10 bg-white flex items-center justify-center gap-1.5 rounded-full text-[#7B00E0] font-bold text-[13px] transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                >
                  {loading ? (
                    <Bone w={120} h={12} color="#7B00E0" />
                  ) : (
                    <>{todayHasEntry ? t('dashboard.logAnother') : t('dashboard.startCheckin')} <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
                <span className="block text-[10px] mt-3 text-center text-white">
                  {loading ? (
                    <span className="flex justify-center"><Bone w={90} h={8} r={5} /></span>
                  ) : (
                    `${t('dashboard.last')}: ${getLastCheckInText(latestEntry as Record<string, unknown> | null)}`
                  )}
                </span>
              </div>
            </div>

            {/* Recent Alerts */}
            <div className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
              <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--brand-text-primary)' }}>
                {t('dashboard.recentAlerts')}
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
                      {t('dashboard.noAlertsGreat')}
                    </p>
                  )}

                  <div className="space-y-2">
                    {/* Show max 2 alert items; if streak is shown, only 1 alert */}
                    {openAlerts.slice(0, streak > 0 ? 1 : 2).map((alert) => (
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
                            {t('dashboard.open')}
                          </span>
                        </div>
                        <p className="text-[10px] mt-0.5" style={{ color: 'var(--brand-text-muted)' }}>
                          {formatAlertDate(alert.journalEntry?.entryDate ?? alert.createdAt ?? '')} {'· ' + t('dashboard.careTeamNotified')}
                        </p>
                      </div>
                    ))}

                    {streak > 0 && (
                      <div className="p-3 rounded-xl"
                        style={{ backgroundColor: 'var(--brand-success-green-light)', borderLeft: '3px solid var(--brand-success-green)' }}>
                        <p className="text-[11px] font-semibold mb-0.5" style={{ color: 'var(--brand-text-primary)' }}>
                          {streak} {t('dashboard.day')} {t('dashboard.medicationStreak')} 🔥
                        </p>
                        <p className="text-[10px]" style={{ color: 'var(--brand-text-muted)' }}>{t('dashboard.keepItUp')}</p>
                      </div>
                    )}
                  </div>

                  {openAlerts.length > 2 || (openAlerts.length > 1 && streak > 0) ? (
                    <button
                      onClick={() => router.push('/notifications')}
                      className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-full text-[11px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                      style={{ color: 'var(--brand-primary-purple)', backgroundColor: 'var(--brand-primary-purple-light)' }}
                    >
                      View all alerts <ArrowRight className="w-3 h-3" />
                    </button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
