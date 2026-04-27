'use client';

// Flow H — patient detail shell. Owns the data fetch (profile, medications,
// alerts, threshold, verification logs) and renders the 5-tab layout. Each
// tab is a separate file so the shell stays focused on coordination.

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronLeft,
  User as UserIcon,
  Pill,
  Bell,
  Sliders,
  Clock,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  Mail,
  Calendar,
  Users as UsersIcon,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { getPatientSummary } from '@/lib/services/provider.service';
import {
  getPatientProfile,
  getPatientMedications,
  getPatientAlerts,
  getPatientThreshold,
  getVerificationLogs,
  type PatientProfile,
  type PatientMedication,
  type PatientAlert,
  type PatientThreshold,
  type ProfileVerificationLog,
} from '@/lib/services/patient-detail.service';
import ProfileTab from './ProfileTab';
import MedicationsTab from './MedicationsTab';
import AlertsTab from './AlertsTab';
import ThresholdsTab from './ThresholdsTab';
import TimelineTab from './TimelineTab';
import CareTeamTab from './CareTeamTab';

type TabKey = 'profile' | 'medications' | 'alerts' | 'thresholds' | 'careteam' | 'timeline';

interface PatientHeader {
  id: string;
  name: string | null;
  email: string | null;
  riskTier: string | null;
  primaryCondition: string | null;
  communicationPreference: string | null;
  activeAlertsCount: number;
  latestBP: { systolicBP: number | null; diastolicBP: number | null; entryDate: string | null } | null;
  lastEntryDate: string | null;
}

interface Props {
  patientId: string;
}

export default function PatientDetailShell({ patientId }: Props) {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('profile');

  // Header (always loaded — top-of-page summary card)
  const [header, setHeader] = useState<PatientHeader | null>(null);
  const [headerLoading, setHeaderLoading] = useState(true);
  const [headerError, setHeaderError] = useState<string | null>(null);

  // Per-tab data (loaded on demand)
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [medications, setMedications] = useState<PatientMedication[]>([]);
  const [alerts, setAlerts] = useState<PatientAlert[]>([]);
  const [threshold, setThreshold] = useState<PatientThreshold | null>(null);
  const [logs, setLogs] = useState<ProfileVerificationLog[]>([]);

  const [profileLoading, setProfileLoading] = useState(false);
  const [medsLoading, setMedsLoading] = useState(false);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [thresholdLoading, setThresholdLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(false);

  // Per-tab load errors. Stored separately so a profile failure doesn't
  // wipe a healthy medications cache. Each loader catches and writes here
  // instead of letting the rejection bubble to an unhandled console crash.
  const [profileError, setProfileError] = useState<string | null>(null);
  const [medsError, setMedsError] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [logsError, setLogsError] = useState<string | null>(null);

  // ── Header fetch ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    // Standard fetch-on-mount: state updates inside the async chain are
    // exactly what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeaderLoading(true);
    setHeaderError(null);
    getPatientSummary(patientId)
      .then((data) => {
        if (cancelled) return;
        const p = data?.patient ?? data;
        setHeader({
          id: p?.id ?? patientId,
          name: p?.name ?? null,
          email: p?.email ?? null,
          riskTier: p?.riskTier ?? null,
          primaryCondition: p?.primaryCondition ?? null,
          communicationPreference: p?.communicationPreference ?? null,
          activeAlertsCount: p?.activeAlertsCount ?? 0,
          latestBP: p?.latestBP ?? null,
          lastEntryDate: p?.lastEntryDate ?? null,
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setHeaderError(e instanceof Error ? e.message : 'Could not load patient.');
      })
      .finally(() => {
        if (!cancelled) setHeaderLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // ── Per-tab loaders ───────────────────────────────────────────────────────
  // Every loader has a `catch` so a transient network blip (dev backend
  // restart, browser dropping the connection on tab switch, etc.) becomes
  // a recoverable inline error with a Retry button — never an unhandled
  // promise rejection that crashes the console.
  const errMsg = (e: unknown): string =>
    e instanceof Error ? e.message : 'Network error — please retry.';

  const loadProfile = useCallback(async () => {
    setProfileLoading(true);
    setProfileError(null);
    try {
      const p = await getPatientProfile(patientId);
      setProfile(p);
    } catch (e) {
      setProfileError(errMsg(e));
    } finally {
      setProfileLoading(false);
    }
  }, [patientId]);

  const loadMedications = useCallback(async () => {
    setMedsLoading(true);
    setMedsError(null);
    try {
      const m = await getPatientMedications(patientId);
      setMedications(m);
    } catch (e) {
      setMedsError(errMsg(e));
    } finally {
      setMedsLoading(false);
    }
  }, [patientId]);

  const loadAlerts = useCallback(async () => {
    setAlertsLoading(true);
    setAlertsError(null);
    try {
      const a = await getPatientAlerts(patientId);
      setAlerts(a);
    } catch (e) {
      setAlertsError(errMsg(e));
    } finally {
      setAlertsLoading(false);
    }
  }, [patientId]);

  const loadThreshold = useCallback(async () => {
    setThresholdLoading(true);
    setThresholdError(null);
    try {
      const t = await getPatientThreshold(patientId);
      setThreshold(t);
    } catch (e) {
      setThresholdError(errMsg(e));
    } finally {
      setThresholdLoading(false);
    }
  }, [patientId]);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    setLogsError(null);
    try {
      const l = await getVerificationLogs(patientId);
      setLogs(l);
    } catch (e) {
      setLogsError(errMsg(e));
    } finally {
      setLogsLoading(false);
    }
  }, [patientId]);

  // Per-tab change handlers. Each one reloads its own slice AND invalidates
  // the timeline + header so newly-created audit rows / counts surface
  // without a manual page refresh.
  const onProfileChanged = useCallback(async () => {
    await Promise.all([loadProfile(), loadLogs()]);
  }, [loadProfile, loadLogs]);

  const onMedicationsChanged = useCallback(async () => {
    await Promise.all([loadMedications(), loadLogs()]);
  }, [loadMedications, loadLogs]);

  const onAlertsResolved = useCallback(async () => {
    await Promise.all([loadAlerts(), loadLogs()]);
  }, [loadAlerts, loadLogs]);

  const onThresholdChanged = useCallback(async () => {
    await Promise.all([loadThreshold(), loadLogs()]);
  }, [loadThreshold, loadLogs]);

  // ── On tab change, fire the matching loader ──────────────────────────────
  // Most tabs lazy-load on first visit. Timeline ALWAYS refetches on entry
  // because it's the audit feed and must always show the latest. Timeline
  // also needs alerts (for alert/escalation entries) — load those if not
  // already cached.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (tab === 'profile' && !profile && !profileLoading) loadProfile();
    if (tab === 'medications' && medications.length === 0 && !medsLoading) loadMedications();
    if (tab === 'alerts' && alerts.length === 0 && !alertsLoading) loadAlerts();
    if (tab === 'thresholds' && !threshold && !thresholdLoading) loadThreshold();
    if (tab === 'timeline') {
      loadLogs();
      if (alerts.length === 0 && !alertsLoading) loadAlerts();
      // Medications power the UUID → drug-name lookup the timeline uses
      // for human-readable titles ("Lisinopril verified by admin").
      if (medications.length === 0 && !medsLoading) loadMedications();
    }
  }, [tab, patientId]);

  // Profile is needed by the Thresholds tab too (for condition defaults +
  // mandatory banner) — preload it whenever Thresholds is selected.
  useEffect(() => {
    if (tab === 'thresholds' && !profile && !profileLoading) loadProfile();
  }, [tab]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const initials = (() => {
    if (!header?.name) return 'P';
    const parts = header.name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : header.name.slice(0, 2).toUpperCase();
  })();

  const verificationBadge = (() => {
    const s = profile?.profileVerificationStatus;
    if (s === 'VERIFIED') {
      return {
        label: 'Profile verified',
        bg: 'var(--brand-success-green-light)',
        fg: 'var(--brand-success-green)',
        icon: <ShieldCheck className="w-3 h-3" />,
      };
    }
    if (s === 'CORRECTED') {
      return {
        label: 'Corrected by admin',
        bg: 'var(--brand-warning-amber-light)',
        fg: 'var(--brand-warning-amber)',
        icon: <ShieldAlert className="w-3 h-3" />,
      };
    }
    return {
      label: 'Profile unverified',
      bg: 'var(--brand-alert-red-light)',
      fg: 'var(--brand-alert-red)',
      icon: <ShieldAlert className="w-3 h-3" />,
    };
  })();

  const tabs: { key: TabKey; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'profile', label: 'Profile', icon: <UserIcon className="w-3.5 h-3.5" /> },
    { key: 'medications', label: 'Medications', icon: <Pill className="w-3.5 h-3.5" />, count: medications.length || undefined },
    { key: 'alerts', label: 'Alerts', icon: <Bell className="w-3.5 h-3.5" />, count: header?.activeAlertsCount },
    { key: 'thresholds', label: 'Thresholds', icon: <Sliders className="w-3.5 h-3.5" /> },
    { key: 'careteam', label: 'Care team', icon: <UsersIcon className="w-3.5 h-3.5" /> },
    { key: 'timeline', label: 'Timeline', icon: <Clock className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-full" style={{ backgroundColor: 'var(--brand-background)' }}>
      <main className="p-4 md:p-8 space-y-5 md:space-y-6 max-w-[1400px] mx-auto">
        {/* ── Back link ─────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => router.push('/patients')}
          className="inline-flex items-center gap-1 text-[12px] font-semibold cursor-pointer hover:underline"
          style={{ color: 'var(--brand-text-secondary)' }}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back to patients
        </button>

        {/* ── Header card ───────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl p-5 md:p-6" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          {headerLoading ? (
            <div className="flex items-center gap-4 animate-pulse">
              <div className="w-14 h-14 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-40 rounded-full" style={{ backgroundColor: '#EDE9F6' }} />
                <div className="h-3 w-60 rounded-full" style={{ backgroundColor: '#F3EEFB' }} />
              </div>
            </div>
          ) : headerError ? (
            <div className="text-[13px]" style={{ color: 'var(--brand-alert-red)' }}>
              {headerError}{' '}
              <Link href="/patients" className="underline">Back</Link>
            </div>
          ) : header ? (
            <div className="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center shrink-0 text-[15px] font-bold"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2 mb-0.5">
                  <h1 className="text-xl font-bold truncate" style={{ color: 'var(--brand-text-primary)' }}>
                    {header.name ?? 'Unknown patient'}
                  </h1>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-bold uppercase tracking-wider"
                    style={{ backgroundColor: verificationBadge.bg, color: verificationBadge.fg }}
                  >
                    {verificationBadge.icon}
                    {verificationBadge.label}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {header.email && (
                    <span className="inline-flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {header.email}
                    </span>
                  )}
                  {header.lastEntryDate && (
                    <span className="inline-flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      Last reading {new Date(header.lastEntryDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </span>
                  )}
                  {header.primaryCondition && (
                    <span className="inline-flex items-center gap-1 font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
                      {header.primaryCondition}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-3 md:gap-4">
                {header.latestBP && header.latestBP.systolicBP != null && (
                  <div className="text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                      Latest BP
                    </p>
                    <p className="text-lg font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                      {header.latestBP.systolicBP}/{header.latestBP.diastolicBP}
                      <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--brand-text-muted)' }}>mmHg</span>
                    </p>
                  </div>
                )}
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                    Open alerts
                  </p>
                  <p
                    className="text-lg font-bold"
                    style={{
                      color:
                        (header.activeAlertsCount ?? 0) > 0
                          ? 'var(--brand-alert-red)'
                          : 'var(--brand-success-green)',
                    }}
                  >
                    {header.activeAlertsCount ?? 0}
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* ── Tab nav ──────────────────────────────────────────────────────── */}
        <div
          className="bg-white rounded-2xl p-1.5 inline-flex flex-wrap gap-1"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
          role="tablist"
        >
          {tabs.map(({ key, label, icon, count }) => {
            const active = tab === key;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(key)}
                className="inline-flex items-center gap-1.5 px-3 md:px-4 h-9 rounded-xl text-[12.5px] font-semibold transition-all cursor-pointer"
                style={{
                  backgroundColor: active ? 'var(--brand-primary-purple)' : 'transparent',
                  color: active ? 'white' : 'var(--brand-text-secondary)',
                }}
              >
                {icon}
                {label}
                {count != null && count > 0 && (
                  <span
                    className="text-[10px] font-bold px-1.5 rounded-full"
                    style={{
                      backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'var(--brand-primary-purple-light)',
                      color: active ? 'white' : 'var(--brand-primary-purple)',
                      minWidth: 16,
                      textAlign: 'center',
                    }}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18 }}
          >
            {tab === 'profile' && (
              <>
                {profileError && <LoadErrorBanner message={profileError} onRetry={loadProfile} />}
                <ProfileTab
                  patientId={patientId}
                  profile={profile}
                  loading={profileLoading}
                  onChanged={onProfileChanged}
                />
              </>
            )}
            {tab === 'medications' && (
              <>
                {medsError && <LoadErrorBanner message={medsError} onRetry={loadMedications} />}
                <MedicationsTab
                  medications={medications}
                  loading={medsLoading}
                  onChanged={onMedicationsChanged}
                />
              </>
            )}
            {tab === 'alerts' && (
              <>
                {alertsError && <LoadErrorBanner message={alertsError} onRetry={loadAlerts} />}
                <AlertsTab
                  alerts={alerts}
                  loading={alertsLoading}
                  onResolved={onAlertsResolved}
                />
              </>
            )}
            {tab === 'thresholds' && (
              <>
                {thresholdError && <LoadErrorBanner message={thresholdError} onRetry={loadThreshold} />}
                <ThresholdsTab
                  patientId={patientId}
                  profile={profile}
                  threshold={threshold}
                  loading={thresholdLoading || profileLoading}
                  onChanged={onThresholdChanged}
                />
              </>
            )}
            {tab === 'careteam' && <CareTeamTab patientId={patientId} />}
            {tab === 'timeline' && (
              <>
                {logsError && <LoadErrorBanner message={logsError} onRetry={loadLogs} />}
                {alertsError && !logsError && <LoadErrorBanner message={alertsError} onRetry={loadAlerts} />}
                <TimelineTab
                  logs={logs}
                  alerts={alerts}
                  medications={medications}
                  logsLoading={logsLoading}
                  alertsLoading={alertsLoading}
                />
              </>
            )}
          </motion.div>
        </AnimatePresence>

        {headerLoading && (
          <div className="flex items-center justify-center py-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Inline retry banner shown above a tab body when its loader fails. Keeps
 * the user in context — they don't lose their place — and gives them an
 * explicit Retry button instead of a silent broken UI. Used by every tab
 * loader in PatientDetailShell.
 */
function LoadErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      className="mb-4 rounded-2xl p-4 flex items-start gap-3"
      style={{
        backgroundColor: 'var(--brand-alert-red-light)',
        borderLeft: '4px solid var(--brand-alert-red)',
      }}
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-alert-red)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
          Couldn&apos;t load this tab
        </p>
        <p className="text-[11.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {message}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-lg text-[12px] font-semibold cursor-pointer"
        style={{
          backgroundColor: 'white',
          color: 'var(--brand-alert-red)',
          border: '1.5px solid var(--brand-alert-red)',
        }}
      >
        <RefreshCw className="w-3 h-3" />
        Retry
      </button>
    </div>
  );
}
