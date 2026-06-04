'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
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
import { Flame, Clock, ArrowRight, Heart, Bell, Target, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import { getJournalEntries, getNotifications, getAlerts, getJournalStats, type AlertTier } from '@/lib/services/journal.service';
import { getAlertPresentation } from '@/components/alerts/alert-presentation';
import { getMyPatientProfile, getMyMedications, type PatientProfileDto } from '@/lib/services/intake.service';
import { getMyThreshold, type PatientThresholdDto } from '@/lib/services/threshold.service';
import { loadDraft, hasDraft, stepProgress } from '@/lib/intake/draft';
import ActionRequiredCard from '@/components/intake/ActionRequiredCard';
import MonthlyMedReask from '@/components/intake/MonthlyMedReask';
import AudioButton from '@/components/intake/AudioButton';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getDateLabel(dateStr: string): string {
  try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function formatAlertDate(dateStr: string): string {
  try { return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function formatAlertType(type: string | null | undefined, t: (key: TranslationKey) => string): string {
  if (!type) return t('dashboard.alert');
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getLastCheckInText(
  latestEntry: Record<string, unknown> | null,
  t: (key: TranslationKey) => string,
): string {
  if (!latestEntry) return t('dashboard.noCheckinsYet');
  const d = new Date(latestEntry.measuredAt as string);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t('dashboard.today');
  if (d.toDateString() === yesterday.toDateString()) return t('dashboard.yesterday');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}


// ─── Types ────────────────────────────────────────────────────────────────────
interface JournalEntry {
  measuredAt: string;
  systolicBP?: number;
  diastolicBP?: number;
  pulse?: number | null;
  medicationTaken?: boolean | null;
}
interface DashboardNotif {
  id: string;
  title: string;
  body: string;
  sentAt: string;
  watched: boolean;
  channel?: string;
  alertId?: string | null;
}
interface DeviationAlert {
  id: string;
  // type/severity are nullable on the v2 DTO (legacy fields, replaced by tier)
  type?: string | null;
  severity?: string | null;
  status?: string;
  createdAt?: string;
  // V2 fields used by D3 prioritization + Flow C dispatch
  tier?: import('@/lib/services/journal.service').AlertTier | null;
  patientMessage?: string | null;
  // Rule-aware chrome + admin-parity fields surfaced on the v2 alert DTO.
  ruleId?: string | null;
  mode?: string | null;
  escalated?: boolean;
  dismissible?: boolean;
  resolvedBy?: string | null;
  journalEntry?: {
    measuredAt?: string | null;
    systolicBP?: number | null;
    diastolicBP?: number | null;
    pulse?: number | null;
  } | null;
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

  const [bpChartData, setBpChartData] = useState<{ day: string; systolic: number; diastolic: number; fullDate: string; time: string }[]>([]);
  const [chartRange, setChartRange] = useState<7 | 90>(7);
  const [latestEntry, setLatestEntry] = useState<JournalEntry | null>(null);
  const [notifs, setNotifs] = useState<DashboardNotif[]>([]);
  const [alerts, setAlerts] = useState<DeviationAlert[]>([]);
  const [streak, setStreak] = useState(0);
  const [totalEntries, setTotalEntries] = useState(0);
  const [dataLoading, setDataLoading] = useState(true);

  // Clinical Intake (Flow A) state — surfaces the Action Required card when
  // basic onboarding is COMPLETED but PatientProfile has not been recorded yet.
  type IntakeUiState =
    | { kind: 'unknown' }
    | { kind: 'done' }
    | { kind: 'fresh' }
    | { kind: 'resume'; stepIndex: number; total: number; stepLabel: string };
  const [intakeUi, setIntakeUi] = useState<IntakeUiState>({ kind: 'unknown' });

  // Flow D state — full profile (for D1 verification badge) + threshold (D2 + D4 colors).
  const [profile, setProfile] = useState<PatientProfileDto | null>(null);
  const [threshold, setThreshold] = useState<PatientThresholdDto | null>(null);
  // E4 — track whether the patient has any active medications so we don't
  // pop the monthly re-ask modal for someone who reported zero meds.
  const [hasMeds, setHasMeds] = useState(false);

  // Resolve Flow D state — fetches PatientProfile + PatientThreshold in
  // parallel, falls back to localStorage draft inspection for the intake UI.
  // Hidden completely until resolved so the amber Action Required card
  // doesn't flash and disappear.
  useEffect(() => {
    if (isLoading || !isAuthenticated || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [p, t, m] = await Promise.all([
          getMyPatientProfile().catch(() => null),
          getMyThreshold().catch(() => null),
          // Only check meds if profile exists — saves a 404-then-empty round trip
          // for patients who haven't completed clinical intake yet.
          getMyMedications().catch(() => []),
        ]);
        if (cancelled) return;
        setProfile(p);
        setThreshold(t);
        setHasMeds(Array.isArray(m) && m.some((med) => !med.discontinuedAt));

        // Without a server-side completion field, the localStorage draft
        // doubles as the "still in progress" sentinel: handleSubmit's
        // clearDraft() runs ONLY at the final A10 → A11 submit, so if a
        // draft is still in progress on this device the patient hasn't
        // finished, regardless of whether a partial profile is on the
        // server. (Cross-device limitation: a patient who saved partial
        // and switched devices will see "done" — accepted trade-off for
        // not changing the schema.)
        const draft = hasDraft(user.id) ? loadDraft(user.id) : null;
        const draftMidFlow =
          !!draft && !!draft.currentStep && draft.currentStep !== 'A11';
        if (p && !draftMidFlow) { setIntakeUi({ kind: 'done' }); return; }
        const labels: Record<string, string> = {
          A1: 'About you',
          A2: 'Pregnancy',
          A3: 'Conditions',
          A4: 'Heart failure type',
          A5: 'Medications',
          A6: 'Combination pills',
          A8: 'Other medicines',
          A9: 'How often',
          A10: 'Review',
        };
        if (draftMidFlow) {
          const { index, total } = stepProgress(draft?.currentStep);
          setIntakeUi({
            kind: 'resume',
            stepIndex: index,
            total,
            stepLabel: labels[draft?.currentStep ?? 'A1'] ?? 'Continuing',
          });
        } else if (draft?.currentStep === 'A11') {
          // A draft pointing at A11 is stale (submit succeeded but the DB
          // row was later removed). Show the fresh card instead.
          setIntakeUi({ kind: 'fresh' });
        } else {
          setIntakeUi({ kind: 'fresh' });
        }
      } catch {
        if (!cancelled) setIntakeUi({ kind: 'fresh' });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, isLoading, isAuthenticated]);

  useEffect(() => {
    if (isLoading || !isAuthenticated) return;
    setDataLoading(true);
    Promise.all([
      getJournalEntries({ limit: 200 }).catch(() => []),
      getNotifications('all').catch(() => []),
      getAlerts().catch(() => []),
      getJournalStats().catch(() => null),
    ]).then(([entries, notifData, alertsData, stats]) => {
      const arr: JournalEntry[] = Array.isArray(entries) ? entries : [];
      const sortedAsc = [...arr].sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());
      const dateCounts = new Map<string, number>();
      setBpChartData(sortedAsc.map((e) => {
        const label = getDateLabel(e.measuredAt);
        const count = (dateCounts.get(label) ?? 0) + 1;
        dateCounts.set(label, count);
        // measuredAt now carries both date and time — derive a hh:mm label.
        const dt = new Date(e.measuredAt);
        const hh = String(dt.getHours()).padStart(2, '0');
        const mi = String(dt.getMinutes()).padStart(2, '0');
        return {
          day: count > 1 ? `${label} #${count}` : label,
          systolic: e.systolicBP ?? 0,
          diastolic: e.diastolicBP ?? 0,
          fullDate: e.measuredAt,
          time: `${hh}:${mi}`,
        };
      }));
      const sortedDesc = [...arr].sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime());
      setLatestEntry(sortedDesc[0] ?? null);
      setTotalEntries(stats?.totalEntries ?? arr.length);
      setStreak(stats?.currentStreak ?? 0);
      // Only PUSH/null channels are patient-facing in-app messages (matches
      // the Notifications page filter); DASHBOARD rows are alert-linked.
      const notifArr: DashboardNotif[] = Array.isArray(notifData) ? (notifData as DashboardNotif[]) : [];
      setNotifs(
        notifArr
          .filter((n) => !n.channel || n.channel === 'PUSH')
          .sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()),
      );
      setAlerts(Array.isArray(alertsData) ? alertsData : []);
    }).finally(() => setDataLoading(false));
  }, [isAuthenticated, isLoading]);

  // ─── Derived values ───────────────────────────────────────────────────────
  const visibleChartData = chartRange === 7 ? bpChartData.slice(-7) : bpChartData;
  // Wait for BOTH data streams before lifting the skeleton — auth + journal
  // (dataLoading) AND the intake-state probe (intakeUi.kind === 'unknown').
  // Without this gate, journal loads first, the page paints, then the
  // Action Required card pops in a moment later as a visual jolt.
  const loading = isLoading || dataLoading || intakeUi.kind === 'unknown';
  const userName = user?.name?.split(' ')[0] ?? '';

  const todayStr = new Date().toISOString().slice(0, 10);
  const todayHasEntry = latestEntry?.measuredAt?.slice(0, 10) === todayStr;

  // React #418 fix: the time-of-day greeting is derived from
  // `new Date().getHours()`, which is LOCAL time — the server's timezone
  // and the browser's can differ, so computing it during render makes the
  // SSR markup and the first client render disagree and trips a hydration
  // error on /dashboard. Compute it in an effect instead (after mount);
  // the small subtitle line starts blank and fills in on the client.
  const [greeting, setGreeting] = useState('');
  useEffect(() => {
    const h = new Date().getHours();
    setGreeting(
      h < 12
        ? t('dashboard.goodMorning')
        : h < 17
          ? t('dashboard.goodAfternoon')
          : t('dashboard.goodEvening'),
    );
  }, [t]);

  const latestBP = latestEntry?.systolicBP && latestEntry?.diastolicBP
    ? `${latestEntry.systolicBP}/${latestEntry.diastolicBP}` : '--/--';

  const bpStatusLabel = latestEntry?.systolicBP != null
    ? (latestEntry.systolicBP >= 140 || (latestEntry.diastolicBP ?? 0) >= 90 ? t('dashboard.elevated') : t('dashboard.withinTarget'))
    : t('dashboard.noData');

  const bpStatusStyle = bpStatusLabel === t('dashboard.withinTarget')
    ? { backgroundColor: 'var(--brand-success-green-light)', color: 'var(--brand-success-green)' }
    : bpStatusLabel === t('dashboard.elevated')
      ? { backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }
      : { backgroundColor: '#F1F5F9', color: 'var(--brand-text-muted)' };


  // Patient-actionable open alerts. F32 — Tier 2 medication-discrepancy
  // alerts are admin-facing per the v2 clinical spec EXCEPT when the rule
  // engine populated a patient-facing message (e.g. the A5-3 beta-blocker
  // carve-out: RULE_MEDICATION_MISSED). Those are patient-visible and the
  // detail page now renders them; the silent ones stay hidden so a tap can't
  // dead-end on a "care team only" screen.
  const tier2Hidden = (a: typeof alerts[number]) =>
    a.tier === 'TIER_2_DISCREPANCY' &&
    !(typeof a.patientMessage === 'string' && a.patientMessage.trim().length > 0);
  const openAlerts = alerts.filter(
    (a) => a.status === 'OPEN' && !tier2Hidden(a),
  );

  // ── Flow D helpers ────────────────────────────────────────────────────────
  // D1 verification badge: shown only when the patient has submitted intake
  // (profile exists) AND the care team hasn't yet confirmed it.
  const showVerificationBadge =
    intakeUi.kind === 'done' && profile?.profileVerificationStatus === 'UNVERIFIED';

  // D3 top alert: pick the single most-urgent open alert. We try the v2 tier
  // first, then derive from the legacy severity + the actual reading so v1
  // alerts still slot in correctly.
  function alertPriority(a: typeof openAlerts[number]): number {
    const sbp = a.journalEntry?.systolicBP ?? 0;
    const dbp = a.journalEntry?.diastolicBP ?? 0;
    const tier = (a as { tier?: AlertTier | null }).tier;
    // Cluster 8 (Manisha 5/18/26, P0) — ACE-angioedema is an airway
    // emergency; same urgency bucket as BP Level 2 so the dashboard top-
    // card surfaces it ahead of every other open alert.
    if (tier === 'TIER_1_ANGIOEDEMA') return 100;
    if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 100;
    if (sbp >= 180 || dbp >= 120) return 100; // tier-null but clinically critical
    if (tier === 'TIER_1_CONTRAINDICATION') return 80;
    if (tier === 'BP_LEVEL_1_HIGH') return 60;
    if (tier === 'BP_LEVEL_1_LOW') return 60;
    if (a.severity === 'HIGH') return 60;
    // F32 — patient-visible medication-discrepancy ranks below BP L1 but above
    // pure info, so it surfaces on the banner only when nothing more urgent is open.
    if (tier === 'TIER_2_DISCREPANCY') return 30;
    if (tier === 'TIER_3_INFO') return 20;
    return 40;
  }
  const topAlert = openAlerts.length > 0
    ? [...openAlerts].sort((x, y) => alertPriority(y) - alertPriority(x))[0]
    : null;

  // Visual variant for the D3 banner — consumes the shared helper so chrome +
  // ruleId overrides (e.g. RULE_HF_DECOMPENSATION → amber/Heart, Round 2 A1)
  // stay in lockstep with TierAlertView. The banner derives the body from
  // patientMessage; the helper's defaultBody is the safe fallback.
  function variantForTopAlert(a: typeof topAlert) {
    if (!a) return null;
    const sbp = a.journalEntry?.systolicBP ?? 0;
    const dbp = a.journalEntry?.diastolicBP ?? 0;
    const raw = a as { tier?: AlertTier | null; ruleId?: string | null; patientMessage?: string | null };
    // Same defensive emergency derivation as TierAlertView's deriveTier:
    // when the engine hasn't classified yet but the reading is clearly
    // critical, force BP_LEVEL_2 so the banner gets the red treatment.
    const effectiveTier: AlertTier | null | undefined =
      raw.tier ??
      (sbp >= 180 || dbp >= 120 ? 'BP_LEVEL_2' : undefined);
    const v = getAlertPresentation({
      tier: effectiveTier,
      ruleId: raw.ruleId,
    });
    const patientMessage = raw.patientMessage ?? '';
    return {
      key: v.key,
      accent: v.accent,
      accentText: v.accentText,
      accentLight: v.accentLight,
      Icon: v.Icon,
      title: v.title,
      body: patientMessage || v.defaultBody,
    };
  }
  const topAlertVariant = variantForTopAlert(topAlert);

  // D4 BP-vs-target color coding. Prefer the patient's PatientThreshold; fall
  // back to AHA defaults (140/90 high, 90/60 low) when no threshold is set.
  const sbpUpper = threshold?.sbpUpperTarget ?? 140;
  const dbpUpper = threshold?.dbpUpperTarget ?? 90;
  const sbpLower = threshold?.sbpLowerTarget ?? 90;
  const dbpLower = threshold?.dbpLowerTarget ?? 60;

  const bpStatusVsTarget: 'within' | 'high' | 'low' | 'critical' | 'none' = (() => {
    const s = latestEntry?.systolicBP;
    const d = latestEntry?.diastolicBP;
    if (s == null || d == null) return 'none';
    if (s >= 180 || d >= 120) return 'critical';
    if (s > sbpUpper || d > dbpUpper) return 'high';
    if (s < sbpLower || d < dbpLower) return 'low';
    return 'within';
  })();

  const bpVsTargetStyle: { bg: string; fg: string; label: string } = (() => {
    switch (bpStatusVsTarget) {
      case 'critical':
        return {
          bg: 'var(--brand-alert-red-light)',
          fg: 'var(--brand-alert-red-text)',
          label: t('dashboard.critical'),
        };
      case 'high':
        return {
          bg: 'var(--brand-warning-amber-light)',
          fg: 'var(--brand-warning-amber-text)',
          label: t('dashboard.elevated'),
        };
      case 'low':
        return { bg: '#DBEAFE', fg: '#1D4ED8', label: t('dashboard.low') };
      case 'within':
        return {
          bg: 'var(--brand-success-green-light)',
          fg: 'var(--brand-success-green)',
          label: t('dashboard.withinTarget'),
        };
      default:
        return { bg: '#F1F5F9', fg: 'var(--brand-text-muted)', label: t('dashboard.noData') };
    }
  })();

  // D2 threshold display helpers
  const hasBpThreshold = !!(threshold && (threshold.sbpUpperTarget || threshold.dbpUpperTarget));
  // #89 — graceful partial-threshold display. The old `${sbp ?? '—'}/${dbp ?? '—'}`
  // surfaced a bare em-dash ("Below 140/— mmHg") a patient can't parse. Show
  // only the axis that's set; flag diastolic-only so it isn't read as systolic.
  const sbpUpperT = threshold?.sbpUpperTarget ?? null;
  const dbpUpperT = threshold?.dbpUpperTarget ?? null;
  const thresholdIsDiastolicOnly = sbpUpperT == null && dbpUpperT != null;
  const thresholdTargetText =
    sbpUpperT != null && dbpUpperT != null
      ? `${sbpUpperT}/${dbpUpperT}`
      : sbpUpperT != null
        ? `${sbpUpperT}`
        : dbpUpperT != null
          ? `${dbpUpperT}`
          : null;
  const thresholdSetAt = threshold?.setAt
    ? new Date(threshold.setAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const bpDomain: [number | string, number | string] = visibleChartData.length > 0
    ? [Math.max(0, Math.min(...visibleChartData.map((d) => d.systolic)) - 15), Math.max(...visibleChartData.map((d) => d.systolic)) + 15]
    : [100, 180];

  // Phase/26 TTS pass 2 — single humanised overview that replaces the 5
  // per-card audio buttons. Composes greeting + latest BP + personal goal +
  // BP-trend summary + medication streak + check-in count + top alert into
  // one flowing summary so the patient hears the dashboard state from one
  // tap. Conditional pieces drop out cleanly when not applicable.
  const dashboardOverview = (() => {
    const parts: string[] = [];
    parts.push(`${greeting}${userName ? `, ${userName}` : ''}.`);

    // Intake CTA gate — if the patient hasn't finished (or hasn't started)
    // clinical intake, every downstream metric is empty (no readings, no
    // alerts, no goal, no streak), so reading them out is just noise.
    // Read the action and stop.
    if (intakeUi.kind === 'fresh' || intakeUi.kind === 'resume') {
      parts.push(
        intakeUi.kind === 'fresh'
          ? 'Before anything else, please complete your clinical intake. Your dashboard fills in once that\'s done.'
          : 'Please pick up where you left off on your clinical intake. Your dashboard fills in once that\'s done.',
      );
      return parts.join(' ');
    }

    // Active alert — read first when present so the patient hears the most
    // urgent thing before the rest of the summary. Include the variant body
    // so they know WHAT to do, not just that something is wrong.
    if (topAlert && topAlertVariant) {
      const alertSentence =
        `Heads up, there's an active alert: ${topAlertVariant.title}.` +
        (topAlertVariant.body ? ` ${topAlertVariant.body}` : '');
      parts.push(alertSentence);
    }

    if (latestEntry?.systolicBP != null && latestEntry?.diastolicBP != null) {
      const bpSentence =
        `Your ${todayHasEntry ? "today's" : 'latest'} blood pressure is ` +
        `${latestEntry.systolicBP} over ${latestEntry.diastolicBP}` +
        (latestEntry.pulse != null ? `, with a pulse of ${latestEntry.pulse}` : '') +
        `, ${bpVsTargetStyle.label.toLowerCase()}.`;
      parts.push(bpSentence);
    } else {
      parts.push('No blood pressure readings yet. Tap New check-in to log your first one.');
    }

    // Personal threshold (D2 banner). Read it right after the latest BP so
    // the patient hears the goal in the same breath as where they currently
    // stand against it.
    if (hasBpThreshold && thresholdTargetText) {
      parts.push(
        `Your care team's goal for you is to stay below ${thresholdTargetText}.`,
      );
    }

    // BP trend chart — summarise the visible range with an average and a
    // direction read (rising / falling / steady) so the patient gets a
    // sense of where things are heading without having to read the chart.
    if (visibleChartData.length >= 2) {
      const sysAvg = Math.round(
        visibleChartData.reduce((s, d) => s + d.systolic, 0) / visibleChartData.length,
      );
      const diaAvg = Math.round(
        visibleChartData.reduce((s, d) => s + d.diastolic, 0) / visibleChartData.length,
      );
      // Compare first half vs second half — a simple, robust trend read
      // without a regression library. ≤3 mmHg drift is "steady".
      const mid = Math.floor(visibleChartData.length / 2);
      const firstHalf = visibleChartData.slice(0, mid);
      const secondHalf = visibleChartData.slice(mid);
      const firstAvg =
        firstHalf.reduce((s, d) => s + d.systolic, 0) / firstHalf.length;
      const secondAvg =
        secondHalf.reduce((s, d) => s + d.systolic, 0) / secondHalf.length;
      const diff = secondAvg - firstAvg;
      const direction =
        diff > 3 ? 'trending upward' : diff < -3 ? 'trending downward' : 'holding steady';
      const window = chartRange === 7 ? 'past week' : 'past three months';
      parts.push(
        `Looking at the ${window}, your readings are averaging ${sysAvg} over ${diaAvg}, ${direction}.`,
      );
    }

    if (streak > 0) {
      parts.push(
        `You're on a ${streak}-day medication streak with ${totalEntries} ${totalEntries === 1 ? 'check-in' : 'check-ins'} logged.`,
      );
    } else if (totalEntries > 0) {
      parts.push(`You've logged ${totalEntries} ${totalEntries === 1 ? 'check-in' : 'check-ins'} so far.`);
    }

    if (!topAlert) {
      parts.push('No active alerts. Your care team is monitoring.');
    }
    return parts.join(' ');
  })();

  return (
    <div className="relative min-h-[calc(100dvh-4rem)]" style={{ backgroundColor: '#FAFBFF' }}>

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
      <main id="main" className="relative flex flex-col px-4 md:px-8 py-4 md:py-5 pb-20 md:pb-16 max-w-7xl mx-auto">

        {/* D3 — Active alert card (top priority; tier-colored). Tap to open
            the Flow C alert detail. Hidden when no open alerts. */}
        {topAlert && topAlertVariant && (
          <div data-testid="active-alert-banner" className="relative mb-3 md:mb-4">
          <button
            type="button"
            data-testid="dashboard-alert-banner"
            onClick={() => router.push(`/alerts/${topAlert.id}`)}
            className="w-full text-left rounded-2xl p-4 cursor-pointer transition-all flex items-center gap-3 active:scale-[0.99]"
            style={{
              backgroundColor: topAlertVariant.accentLight,
              border: `1.5px solid ${topAlertVariant.accent}`,
              boxShadow: `0 4px 14px ${topAlertVariant.accent}22`,
            }}
            aria-label={t('dashboard.viewDetailsAria').replace('{title}', topAlertVariant.title)}
            // Known WCAG debt — banner uses accentLight bg + accentText
            // (vibrant) for small chip text inside. Same accepted tradeoff
            // as the admin alert queue rows.
            data-axe-debt="avatar-orange-small-text"
          >
            <div
              className="shrink-0 rounded-xl flex items-center justify-center text-white"
              style={{ width: 40, height: 40, backgroundColor: topAlertVariant.accent }}
            >
              <topAlertVariant.Icon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-0.5"
                style={{ color: topAlertVariant.accentText }}
              >
                {t('dashboard.activeAlert')}
              </p>
              {/* lang="en": variant title/body are English clinical fallbacks. */}
              <p
                lang="en"
                className="text-[14px] font-bold leading-tight"
                style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
              >
                {topAlertVariant.title}
              </p>
              <p
                data-testid="active-alert-reading"
                lang="en"
                className="text-[12px] mt-0.5 leading-snug"
                style={{ color: 'var(--brand-text-secondary)', wordBreak: 'break-word' }}
              >
                {topAlertVariant.body}
              </p>
            </div>
            <div
              className="shrink-0 hidden sm:flex items-center gap-1 px-3 h-9 rounded-full font-bold text-[12px] text-white"
              style={{ backgroundColor: topAlertVariant.accent }}
              // Known WCAG debt — vibrant amber bg + 12px bold white text is
              // ~2.8:1 (fails AA Normal). Same tracking as the admin avatar.
              // Future fix: bump text to 14px bold for AA Large compliance.
              data-axe-debt="avatar-orange-small-text"
            >
              {t('dashboard.viewDetails')}
              <ArrowRight aria-hidden="true" className="w-3.5 h-3.5" />
            </div>
            <ArrowRight
              className="w-4 h-4 shrink-0 sm:hidden"
              style={{ color: topAlertVariant.accentText }}
            />
          </button>
          </div>
        )}

        {/* P2 — the "Recent Alerts" strip was removed (Duwaragie's call): the
            headline banner + the notifications bell already surface alerts, so
            a third dashboard surface was redundant noise. */}

        {/* D0 — Clinical Intake Action Required (above stats, below D3) */}
        {intakeUi.kind === 'fresh' && <ActionRequiredCard state={{ kind: 'fresh' }} />}
        {intakeUi.kind === 'resume' && (
          <ActionRequiredCard
            state={{
              kind: 'resume',
              stepIndex: intakeUi.stepIndex,
              total: intakeUi.total,
              stepLabel: intakeUi.stepLabel,
            }}
          />
        )}

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

            {/* a11y: every page needs exactly one <h1>. The visible heading
                is the userName <h2> below (intentional visual hierarchy), so
                the page-level <h1> is screen-reader-only. */}
            <h1 className="sr-only">Dashboard</h1>
            <p data-testid="dashboard-greeting" className="text-white/70 text-xs font-medium mb-1">{greeting}</p>
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
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/20 rounded-full text-xs font-semibold text-white">
                <span className="w-1.5 h-1.5 rounded-full bg-green-300 inline-block" />
                {t('dashboard.cedarHillConnected')}
              </div>
              {/* D1 — Awaiting Provider Verification (intake done, profile UNVERIFIED) */}
              {showVerificationBadge && (
                <div
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: 'var(--brand-warning-amber-light)',
                    color: 'var(--brand-warning-amber-text)',
                  }}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {t('dashboard.awaitingVerification')}
                </div>
              )}
            </div>
          </div>

          {/* D4 — BP stat card. Status pill is colored vs the patient's
              PatientThreshold (or AHA defaults if no threshold set). Pulse
              renders below the BP when present on the latest entry. */}
          <div data-testid="latest-bp" className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl relative" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <span className="block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? <Bone w={60} h={9} r={5} /> : (todayHasEntry ? t('dashboard.todaysBp') : t('dashboard.latestBp'))}
              </span>
            </div>
            {loading ? (
              <Bone w={88} h={28} />
            ) : (
              <div className="text-2xl font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{latestBP}</div>
            )}
            <p className="text-[10px] mt-0.5 mb-2 flex items-center gap-2" style={{ color: 'var(--brand-text-muted)' }}>
              <span>mmHg</span>
              {!loading && latestEntry?.pulse != null && (
                <span className="inline-flex items-center gap-0.5 font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
                  <Heart className="w-3 h-3" /> {latestEntry.pulse}
                </span>
              )}
            </p>
            {loading ? (
              <Bone w={72} h={18} r={99} />
            ) : (
              <span
                data-testid="latest-bp-status"
                className="inline-flex items-center justify-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold text-center"
                style={{ backgroundColor: bpVsTargetStyle.bg, color: bpVsTargetStyle.fg }}
                // Known WCAG debt — chip pattern at 10px is below AA Normal
                // threshold with vibrant tokens. Same accepted tradeoff.
                data-axe-debt="avatar-orange-small-text"
              >
                {bpVsTargetStyle.label}
              </span>
            )}
          </div>

          {/* Streak Stat Card */}
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl relative" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <Flame className="w-5 h-5" style={{ color: 'var(--brand-warning-amber-text)' }} />
            </div>
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
          <div className="bg-white/80 backdrop-blur-sm p-4 rounded-2xl relative" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-start justify-between gap-2 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                {t('dashboard.checkIns')}
              </p>
            </div>
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

        {/* D2 — Personal threshold card. Hidden when no threshold has been
            set by the care team (provider-authored row in PatientThreshold). */}
        {hasBpThreshold && (
          <div
            className="rounded-2xl px-4 py-2.5 mb-3 md:mb-4 flex items-center gap-3 flex-wrap"
            style={{
              backgroundColor: 'var(--brand-accent-teal-light)',
              border: '1px solid rgba(13,148,136,0.25)',
            }}
          >
            <div
              className="shrink-0 rounded-xl flex items-center justify-center text-white"
              style={{ width: 36, height: 36, backgroundColor: 'var(--brand-accent-teal)' }}
              aria-hidden
            >
              <Target className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-accent-teal)' }}>
                {t('dashboard.yourGoal')}
              </p>
              <p
                className="text-[13px] font-semibold leading-tight"
                style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
              >
                {(thresholdIsDiastolicOnly
                  ? t('dashboard.belowDiastolic')
                  : t('dashboard.belowTarget')
                ).replace('{target}', thresholdTargetText ?? '')}
                <span className="ml-2 font-medium" style={{ color: 'var(--brand-text-muted)' }}>
                  {` ${t('dashboard.setByCareTeam')}`}
                  {thresholdSetAt ? ` · ${thresholdSetAt}` : ''}
                </span>
              </p>
              {/* PERSONALIZED +20 tolerance band (CLINICAL_SPEC §4.1) — alerts
                  begin 20 mmHg above the goal, not at the goal. Explain it so a
                  reading just over the goal doesn't read as a missed alert. */}
              {threshold?.sbpUpperTarget != null && (
                <p
                  data-testid="dashboard-goal-tolerance"
                  className="text-[11.5px] mt-0.5"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  {t('dashboard.goalTolerance').replace(
                    '{value}',
                    String(threshold.sbpUpperTarget + 20),
                  )}
                </p>
              )}
            </div>
          </div>
        )}

        {/* ROW 2 — BP Chart · Check-In CTA · Alerts */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 flex-1 h-[300px]">

          {/* BP Trend */}
          <div className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col" style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}>
            <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div className="flex items-center gap-3 flex-wrap">
                <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  {chartRange === 7 ? t('dashboard.bpThisWeek') : t('dashboard.bpTrend')}
                </h3>
                <button
                  type="button"
                  onClick={() => router.push('/readings')}
                  className="text-[11px] font-semibold cursor-pointer hover:opacity-75 transition"
                  style={{ color: 'var(--brand-primary-purple)' }}
                >
                  {t('dashboard.fullHistory')}
                </button>
              </div>
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
                  <AreaChart data={visibleChartData} margin={{ top: 5, right: 24, left: 5, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorSystolic" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#7B00E0" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="#7B00E0" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#F1EEFF" vertical={false} />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={((props: { x?: number | string; y?: number | string; payload?: { value?: unknown } }) => {
                      const x = typeof props.x === 'number' ? props.x : Number(props.x ?? 0);
                      const y = typeof props.y === 'number' ? props.y : Number(props.y ?? 0);
                      const raw = String(props.payload?.value ?? '');
                      const display = raw.replace(/ #\d+$/, '');
                      return (
                        <g transform={`translate(${x},${y})`}>
                          <text data-testid="bp-chart-x-tick" x={0} y={0} dy={10} textAnchor="middle" fill="#94A3B8" fontSize={10}>{display}</text>
                        </g>
                      );
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    }) as any} interval="preserveStartEnd" minTickGap={24} tickFormatter={(v: string) => v.replace(/ #\d+$/, '')}>
                      <Label value={t('dashboard.chartDateAxis')} position="insideBottom" offset={-2} style={{ fill: '#1d1d1d', fontSize: 10, fontWeight: 600 }} />
                    </XAxis>
                    <YAxis domain={bpDomain} axisLine={false} tickLine={false} tick={{ fill: '#94A3B8', fontSize: 10 }} width={38}>
                      <Label value="mmHg" angle={-90} position="insideLeft" offset={4} style={{ fill: '#1d1d1d', fontSize: 10 ,fontWeight: 600}} />
                    </YAxis>
                    <Tooltip
                      cursor={{ stroke: '#7B00E0', strokeWidth: 1, strokeDasharray: '4 4' }}
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const d = payload[0].payload as { systolic: number; diastolic: number; fullDate: string; time: string };
                          const dateStr = d.fullDate ? new Date(d.fullDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';
                          return (
                            <div className="bg-white px-3 py-2 rounded-xl text-xs" style={{ boxShadow: '0 4px 16px rgba(123,0,224,0.1)', border: '1px solid #E9D5FF' }}>
                              <p className="font-bold" style={{ color: 'var(--brand-primary-purple)' }}>{d.systolic}/{d.diastolic} mmHg</p>
                              {/* Cluster-3 / B10: was #94A3B8 (slate-400, 2.56:1) — failed
                                  WCAG AA. Bumped to slate-600 (#475569, 7.04:1). */}
                              <p style={{ color: '#475569' }}>{dateStr}{d.time ? ` ${t('dashboard.chartAt')} ${d.time}` : ''}</p>
                            </div>
                          );
                        }
                        return null;
                      }}
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
                      style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
                      // Known WCAG debt — 10px vibrant amber on amber-100 =
                      // 2.51:1 (fails AA Normal). Same accepted tradeoff as
                      // other "Due today / Elevated / Moderate" chips.
                      data-axe-debt="avatar-orange-small-text"
                    >
                      {t('dashboard.dueToday')}
                    </span>
                  )}
                </div>
                <p className="text-[11px] mb-3 text-white">{t('dashboard.takesAbout')}</p>
              </div>

              <div data-testid="dashboard-cta-checkin">
                {/* Check-in is gated on intake being fully complete —
                    routes to /clinical-intake instead so the patient
                    finishes onboarding before logging readings the rule
                    engine can't safely evaluate against a partial profile. */}
                <button
                  data-testid="start-checkin-cta"
                  onClick={() =>
                    router.push(intakeUi.kind === 'done' ? '/check-in' : '/clinical-intake')
                  }
                  disabled={intakeUi.kind === 'unknown'}
                  className="w-full h-11 bg-white flex items-center justify-center gap-1.5 rounded-full text-[#7B00E0] font-bold text-[13px] transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                >
                  {loading ? (
                    <Bone w={120} h={12} color="#7B00E0" />
                  ) : intakeUi.kind !== 'done' ? (
                    <>Finish intake first <ArrowRight aria-hidden="true" className="w-4 h-4" /></>
                  ) : (
                    <>{todayHasEntry ? t('dashboard.logAnother') : t('dashboard.startCheckin')} <ArrowRight aria-hidden="true" className="w-4 h-4" /></>
                  )}
                </button>
                <span className="block text-[10px] mt-3 text-center text-white">
                  {loading ? (
                    <span className="flex justify-center"><Bone w={90} h={8} r={5} /></span>
                  ) : (
                    `${t('dashboard.last')}: ${getLastCheckInText(latestEntry as Record<string, unknown> | null, t)}`
                  )}
                </span>
              </div>
            </div>

            {/* Notifications — patient-facing PUSH messages (med holds,
                reminders, care-team updates). BP alerts surface separately as
                dashboard banners, so this panel is notifications-only. */}
            <div
              className="bg-white/80 backdrop-blur-sm p-4 md:p-5 rounded-2xl flex flex-col"
              style={{ boxShadow: '0 1px 20px rgba(123,0,224,0.07)' }}
              aria-live="polite"
              aria-relevant="additions"
              aria-label={t('notifications.title')}
            >
              <div className="flex items-center gap-2 mb-3">
                <Bell className="w-4 h-4 shrink-0" style={{ color: 'var(--brand-warning-amber-text)' }} />
                <h3 className="text-sm font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  {t('notifications.title')}
                </h3>
              </div>

              {loading ? (
                <div className="space-y-2">
                  {[1, 2].map((i) => (
                    <div key={i} className="p-3 rounded-xl" style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}>
                      <Bone w="75%" h={11} />
                      <div className="mt-1.5"><Bone w="45%" h={9} r={5} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <>
                  {notifs.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-center py-5">
                      <div
                        className="w-9 h-9 rounded-full flex items-center justify-center mb-2"
                        style={{ backgroundColor: 'var(--brand-warning-amber-light)' }}
                      >
                        <Bell className="w-4 h-4" style={{ color: 'var(--brand-warning-amber-text)' }} />
                      </div>
                      <p className="text-xs" style={{ color: 'var(--brand-text-muted)' }}>
                        {t('notifications.noMessages')}
                      </p>
                    </div>
                  )}

                  <div className="space-y-2">
                    {notifs.slice(0, 3).map((n) => (
                      <button
                        type="button"
                        key={n.id}
                        onClick={() => router.push(n.alertId ? `/alerts/${n.alertId}` : '/notifications?tab=notifications')}
                        className="w-full text-left p-3 rounded-xl cursor-pointer transition hover:scale-[1.01] active:scale-[0.99]"
                        style={{
                          backgroundColor: n.watched ? 'var(--brand-background)' : 'var(--brand-warning-amber-light)',
                          border: `1px solid ${n.watched ? 'var(--brand-border)' : 'var(--brand-warning-amber)'}`,
                        }}
                      >
                        <div className="flex items-start gap-2">
                          {!n.watched && (
                            <span
                              className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0"
                              style={{ backgroundColor: 'var(--brand-warning-amber)' }}
                              aria-hidden
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="text-[11.5px] font-semibold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                              {n.title}
                            </p>
                            <p className="text-[10.5px] mt-0.5 leading-snug line-clamp-2" style={{ color: 'var(--brand-text-secondary)' }}>
                              {n.body}
                            </p>
                            <p className="text-[9.5px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                              {formatAlertDate(n.sentAt)}
                            </p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>

                  {notifs.length > 3 && (
                    <button
                      onClick={() => router.push('/notifications?tab=notifications')}
                      className="mt-2 w-full flex items-center justify-center gap-1 py-1.5 rounded-full text-[11px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                      style={{ color: 'var(--brand-warning-amber-text)', backgroundColor: 'var(--brand-warning-amber-light)' }}
                    >
                      {t('dashboard.viewAllNotifications')} <ArrowRight aria-hidden="true" className="w-3 h-3" />
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Phase/26 TTS pass 2 — floating overview audio pill. Anchored to the
          dashboard's bottom-right (absolute, inside the relative+overflow-auto
          wrapper) so it stays in view regardless of scroll, doesn't bleed onto
          other routes, and doesn't crowd the cards above. */}
      {!loading && (
        <div
          className="fixed bottom-3 right-3 md:bottom-6 md:right-6 z-30 flex items-center gap-1 md:gap-2 bg-white rounded-full pl-1.5 pr-2 py-1 md:pl-2 md:pr-3 md:py-1.5"
          style={{
            boxShadow: '0 8px 24px rgba(123,0,224,0.18)',
            border: '1px solid var(--brand-border)',
          }}
        >
          <AudioButton size="sm" text={dashboardOverview} />
          <span
            className="text-[10px] md:text-[12px] font-semibold whitespace-nowrap"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {t('dashboard.hearSummary')}
          </span>
        </div>
      )}

      {/* E4 — Monthly medication re-check modal. Self-managed (timestamp in
          localStorage); only fires for patients who have completed intake
          AND have at least one active medication on file. */}
      <MonthlyMedReask
        userId={user?.id ?? null}
        hasMedications={hasMeds}
        intakeComplete={intakeUi.kind === 'done'}
      />
    </div>
  );
}
