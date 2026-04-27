'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Bell,
  AlertTriangle,
  Activity,
  Pill,
  Scale,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CheckCheck,
  Zap,
} from 'lucide-react';
import {
  getAlerts,
  acknowledgeAlert,
  getNotifications,
  markNotificationRead,
} from '@/lib/services/journal.service';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';

type TFn = (key: TranslationKey) => string;

// ─── Types ────────────────────────────────────────────────────────────────────
type AlertType = 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'BP_COMBINED' | 'WEIGHT' | 'MEDICATION_ADHERENCE';
type AlertSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
type AlertStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

// Local view-model. `type`/`severity` are nullable + loosened to `string`
// because v2 DeviationAlertDto allows null on legacy fields (the v2
// `tier` field replaces them). The TYPE_META + SEVERITY_META lookups
// fall back gracefully when the field is absent.
type Alert = {
  id: string;
  type?: AlertType | string | null;
  /** v2 tier — preferred over `type` for derived UI labels (the legacy
   *  `type` enum can't represent Tier 1 contraindications, so cards drove
   *  off it would all read "Missed Medication"). */
  tier?: string | null;
  /** Three-tier patient-facing message. Backend always populates this on
   *  v2 alerts; falling back to the legacy BP/value rendering when null. */
  patientMessage?: string | null;
  severity?: AlertSeverity | string | null;
  magnitude?: number | null;
  baselineValue?: number | null;
  actualValue?: number | null;
  status?: AlertStatus | string;
  escalated?: boolean;
  createdAt: string;
  acknowledgedAt?: string | null;
  journalEntry?: {
    id: string;
    /** ISO 8601 timestamp (replaces v1 entryDate + measurementTime). */
    measuredAt: string;
    systolicBP?: number | null;
    diastolicBP?: number | null;
    weight?: number | null;
  } | null;
};

type Notif = {
  id: string;
  title: string;
  body: string;
  tips: string[];
  sentAt: string;
  watched: boolean;
  channel?: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const TYPE_META: Record<string, { label: string; icon: typeof Activity }> = {
  SYSTOLIC_BP: { label: 'Elevated Systolic BP', icon: Activity },
  DIASTOLIC_BP: { label: 'Elevated Diastolic BP', icon: Activity },
  BP_COMBINED: { label: 'Elevated Blood Pressure', icon: Activity },
  WEIGHT: { label: 'Weight Change Detected', icon: Scale },
  MEDICATION_ADHERENCE: { label: 'Missed Medication', icon: Pill },
};

// Tier-aware card chrome. Preferred over TYPE_META so a Tier 1 contraindication
// doesn't display as "Missed Medication Urgent" just because its legacy
// `type` field is MEDICATION_ADHERENCE. `null` tier falls through to the
// legacy type-based path so v1 alerts still render.
const TIER_META: Record<
  string,
  { label: string; icon: typeof Activity; severity: 'HIGH' | 'MEDIUM' | 'LOW' }
> = {
  BP_LEVEL_2: { label: 'Urgent Blood Pressure Alert', icon: AlertTriangle, severity: 'HIGH' },
  BP_LEVEL_2_SYMPTOM_OVERRIDE: { label: 'Urgent Blood Pressure Alert', icon: AlertTriangle, severity: 'HIGH' },
  TIER_1_CONTRAINDICATION: { label: 'Important medication alert', icon: Pill, severity: 'HIGH' },
  TIER_2_DISCREPANCY: { label: 'Medication check-in needed', icon: Pill, severity: 'MEDIUM' },
  BP_LEVEL_1_HIGH: { label: 'Elevated blood pressure', icon: Activity, severity: 'MEDIUM' },
  BP_LEVEL_1_LOW: { label: 'Low blood pressure', icon: Activity, severity: 'MEDIUM' },
  TIER_3_INFO: { label: 'Care team update', icon: Bell, severity: 'LOW' },
};

const SEVERITY_META = {
  HIGH: { label: 'Urgent', bg: '#FEE2E2', text: '#DC2626', border: '#FECACA' },
  MEDIUM: { label: 'Moderate', bg: '#FFF7ED', text: '#EA580C', border: '#FED7AA' },
  LOW: { label: 'Low', bg: '#F0FDF4', text: '#16A34A', border: '#BBF7D0' },
};

function timeAgo(dateStr: string, t: TFn): string {
  try {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return t('notifications.time.justNow');
    if (mins < 60) return t('notifications.time.minsAgo').replace('{mins}', String(mins));
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('notifications.time.hrsAgo').replace('{hrs}', String(hrs));
    const days = Math.floor(hrs / 24);
    if (days < 7) return t('notifications.time.daysAgo').replace('{days}', String(days));
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return '';
  }
}

function formatAlertDate(dateStr: string): string {
  try {
    // measuredAt is a full ISO timestamp — render in the patient's local tz.
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ─── Skeleton helpers ─────────────────────────────────────────────────────────
function Bone({
  w,
  h,
  rounded = 'rounded-lg',
  className = '',
}: {
  w: number | string;
  h: number;
  rounded?: string;
  className?: string;
}) {
  return (
    <div
      className={`animate-pulse ${rounded} shrink-0 ${className}`}
      style={{ width: w, height: h, backgroundColor: '#EDE9F6' }}
    />
  );
}

function AlertSkeleton() {
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid #EDE9F6', backgroundColor: 'white' }}
    >
      <div className="p-4 flex items-start gap-3">
        <Bone w={40} h={40} rounded="rounded-xl" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Bone w={100} h={13} />
            <Bone w={56} h={20} rounded="rounded-full" />
          </div>
          <Bone w="75%" h={11} />
          <div className="flex gap-2 mt-1">
            <Bone w={80} h={28} rounded="rounded-xl" />
            <Bone w={80} h={28} rounded="rounded-xl" />
          </div>
        </div>
      </div>
      <div className="px-4 pb-4">
        <Bone w="100%" h={36} rounded="rounded-xl" />
      </div>
    </div>
  );
}

function NotifSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <div
      className="flex items-start gap-3 p-4 rounded-2xl"
      style={{ backgroundColor: 'white', animationDelay: `${delay}ms` }}
    >
      <Bone w={40} h={40} rounded="rounded-full" />
      <div className="flex-1 space-y-2">
        <div className="flex items-start justify-between">
          <Bone w="55%" h={13} />
          <Bone w={40} h={11} className="ml-2" />
        </div>
        <Bone w="88%" h={11} />
        <Bone w="65%" h={11} />
      </div>
    </div>
  );
}

// ─── Alert Card ───────────────────────────────────────────────────────────────
function AlertCard({
  alert,
  onAcknowledge,
  acknowledging,
}: {
  alert: Alert;
  onAcknowledge: (id: string) => void;
  acknowledging: string | null;
}) {
  const { t } = useLanguage();
  // Tier-first label resolution: v2 alerts always carry a `tier`, and the
  // tier is the only field that distinguishes a Tier 1 contraindication
  // from a missed-dose Tier 2 (both carry the legacy MEDICATION_ADHERENCE
  // type). Falls back to the legacy `type` lookup for any v1 row that
  // never had `tier` populated.
  const tierMeta = alert.tier ? TIER_META[alert.tier] : null;
  const meta =
    tierMeta ??
    TYPE_META[alert.type as AlertType] ??
    { label: alert.type ?? '—', icon: AlertTriangle };
  // Tier severity wins over the legacy severity field so the badge color
  // matches the actual clinical priority.
  const effectiveSeverity = (tierMeta?.severity ?? alert.severity) as AlertSeverity | undefined;
  const sevMeta = SEVERITY_META[effectiveSeverity as AlertSeverity] ?? SEVERITY_META.LOW;
  const Icon = meta.icon;
  const isOpen = alert.status === 'OPEN';
  const isAcking = acknowledging === alert.id;

  const alertTypeLabels: Record<string, string> = {
    SYSTOLIC_BP: t('alert.systolicBP'),
    DIASTOLIC_BP: t('alert.diastolicBP'),
    BP_COMBINED: t('alert.bpCombined') || 'Elevated Blood Pressure',
    WEIGHT: t('alert.weight'),
    MEDICATION_ADHERENCE: t('alert.medication'),
  };

  const sevLabels: Record<string, string> = {
    HIGH: t('alert.urgent'),
    MEDIUM: t('alert.moderate'),
    LOW: t('alert.low'),
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className="rounded-2xl overflow-hidden"
      style={{
        border: `1px solid ${sevMeta.border}`,
        backgroundColor: 'white',
        boxShadow: `0 2px 16px ${sevMeta.bg}`,
      }}
    >
      {/* Top accent strip */}
      <div
        className="h-1 w-full"
        style={{ backgroundColor: sevMeta.text, opacity: 0.7 }}
      />

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ backgroundColor: sevMeta.bg }}
          >
            <Icon className="w-5 h-5" style={{ color: sevMeta.text }} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span
                className="text-[14px] font-bold"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {tierMeta
                  ? tierMeta.label
                  : alert.type
                    ? (alertTypeLabels[alert.type] ?? alert.type)
                    : '—'}
              </span>
              <span
                className="px-2 py-0.5 rounded-full text-[11px] font-bold shrink-0"
                style={{ backgroundColor: sevMeta.bg, color: sevMeta.text }}
              >
                {effectiveSeverity ? (sevLabels[effectiveSeverity] ?? effectiveSeverity) : '—'}
              </span>
              {alert.escalated && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-red-600 text-white shrink-0 flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {t('notifications.escalated')}
                </span>
              )}
            </div>

            {/* Tier-1/Tier-2/BP-Level-2 alerts carry a clinical patient
                message from the alert engine. Surface it verbatim so the
                instruction (e.g. "stop and call your provider before next
                dose") reaches the patient on the notifications inbox, not
                just on the dedicated alert detail screen. */}
            {alert.patientMessage && (
              <p
                className="text-[12.5px] mb-1 leading-relaxed"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {alert.patientMessage}
              </p>
            )}

            {/* BP reading for combined/BP alerts */}
            {alert.journalEntry && (alert.type === 'BP_COMBINED' || (alert.type ?? '').includes('BP')) && (
              <p className="text-[12px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>
                {t('alert.recorded')}{' '}
                <span className="font-semibold" style={{ color: sevMeta.text }}>
                  {alert.journalEntry.systolicBP ?? '—'}/{alert.journalEntry.diastolicBP ?? '—'} mmHg
                </span>
                {alert.baselineValue != null && (
                  <>
                    {' '}{t('alert.vsBaseline')}{' '}
                    <span className="font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
                      {Number(alert.baselineValue).toFixed(0)} mmHg
                    </span>
                  </>
                )}
              </p>
            )}

            {/* Non-BP values (weight, medication) */}
            {alert.actualValue != null && !(alert.type ?? '').includes('BP') && alert.type !== 'BP_COMBINED' && (
              <p className="text-[12px] mb-1" style={{ color: 'var(--brand-text-muted)' }}>
                {t('alert.recorded')}{' '}
                <span className="font-semibold" style={{ color: sevMeta.text }}>
                  {Number(alert.actualValue).toFixed(0)}
                </span>
                {alert.type === 'WEIGHT' ? ' lbs' : ''}
              </p>
            )}

            {/* Measured-at — date + time derived from the single timestamp. */}
            {alert.journalEntry?.measuredAt && (() => {
              const dt = new Date(alert.journalEntry.measuredAt);
              const hh = String(dt.getHours()).padStart(2, '0');
              const mi = String(dt.getMinutes()).padStart(2, '0');
              return (
                <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {formatAlertDate(alert.journalEntry.measuredAt)}
                  <span className="ml-1 font-semibold">{`${hh}:${mi}`}</span>
                </p>
              );
            })()}
          </div>

          {/* Status badge */}
          {!isOpen && (
            <div className="shrink-0 flex items-center gap-1" style={{ color: '#16A34A' }}>
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-[11px] font-semibold">{t('notifications.done')}</span>
            </div>
          )}
        </div>

        {/* Action row — Acknowledge + deep-link to the Flow C alert detail */}
        <div className="mt-3 flex items-center gap-2">
          {isOpen && (
            <motion.button
              onClick={() => onAcknowledge(alert.id)}
              disabled={isAcking}
              className="flex-1 h-10 rounded-xl text-[13px] font-bold flex items-center justify-center gap-2 transition disabled:opacity-60 cursor-pointer"
              style={{ backgroundColor: sevMeta.bg, color: sevMeta.text, border: `1px solid ${sevMeta.border}` }}
              whileTap={{ scale: 0.98 }}
            >
              {isAcking ? (
                <>{t('notifications.acknowledging')}</>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {t('notifications.acknowledge')}
                </>
              )}
            </motion.button>
          )}
          <Link
            href={`/alerts/${alert.id}`}
            className={
              (isOpen ? 'h-10 px-4' : 'flex-1 h-10') +
              ' rounded-xl text-[13px] font-bold flex items-center justify-center gap-1 transition cursor-pointer'
            }
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
              border: '1px solid var(--brand-primary-purple-light)',
            }}
            aria-label={t('notifications.viewDetailsAria')}
          >
            {t('notifications.viewDetails')}
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Notification Card ────────────────────────────────────────────────────────
function NotifCard({
  notif,
  onRead,
}: {
  notif: Notif;
  onRead: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const hasTips = notif.tips && notif.tips.length > 0;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="rounded-2xl overflow-hidden cursor-pointer"
      style={{
        backgroundColor: 'white',
        border: notif.watched
          ? '1px solid var(--brand-border)'
          : '1px solid var(--brand-primary-purple)',
        boxShadow: notif.watched
          ? '0 1px 8px rgba(0,0,0,0.04)'
          : '0 2px 16px rgba(123,0,224,0.08)',
      }}
      onClick={() => {
        if (!notif.watched) onRead(notif.id);
      }}
    >
      {/* Unread indicator strip */}
      {!notif.watched && (
        <div
          className="h-0.5 w-full"
          style={{ backgroundColor: 'var(--brand-primary-purple)', opacity: 0.6 }}
        />
      )}

      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{
              backgroundColor: notif.watched
                ? 'var(--brand-background)'
                : 'var(--brand-primary-purple-light)',
            }}
          >
            <Bell
              className="w-4 h-4"
              style={{
                color: notif.watched
                  ? 'var(--brand-text-muted)'
                  : 'var(--brand-primary-purple)',
              }}
            />
          </div>

          {/* Text */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p
                className="text-[14px] leading-snug"
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
                {timeAgo(notif.sentAt, t)}
              </span>
            </div>
            <p
              className="text-[13px] mt-0.5 leading-relaxed"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {notif.body}
            </p>

            {/* Unread dot */}
            {!notif.watched && (
              <span
                className="inline-block mt-1.5 text-[11px] font-semibold"
                style={{ color: 'var(--brand-primary-purple)' }}
              >
                {t('notifications.tapToRead')}
              </span>
            )}
          </div>
        </div>

        {/* Tips expand/collapse */}
        {hasTips && (
          <div className="mt-3">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((v) => !v);
                if (!notif.watched) onRead(notif.id);
              }}
              className="flex items-center gap-1.5 text-[12px] font-semibold transition hover:opacity-75"
              style={{ color: 'var(--brand-accent-teal)' }}
            >
              {expanded ? (
                <>
                  <ChevronUp className="w-3.5 h-3.5" />
                  {t('notifications.hideTips')}
                </>
              ) : (
                <>
                  <ChevronDown className="w-3.5 h-3.5" />
                  {notif.tips.length} {notif.tips.length > 1 ? t('notifications.careTips') : t('notifications.careTip')}
                </>
              )}
            </button>

            <AnimatePresence>
              {expanded && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className="overflow-hidden mt-2 space-y-1.5"
                >
                  {notif.tips.map((tip, i) => (
                    <li
                      key={i}
                      className="flex items-start gap-2 text-[12px] leading-relaxed"
                      style={{ color: 'var(--brand-text-secondary)' }}
                    >
                      <span
                        className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                        style={{ backgroundColor: 'var(--brand-accent-teal)' }}
                      />
                      {tip}
                    </li>
                  ))}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────
type Tab = 'all' | 'unread' | 'read';

function TabBar({ active, onChange, unreadCount }: { active: Tab; onChange: (t: Tab) => void; unreadCount: number }) {
  const { t } = useLanguage();
  const tabs: { id: Tab; label: string }[] = [
    { id: 'all', label: t('notifications.allTab') },
    { id: 'unread', label: t('notifications.unreadTab') },
    { id: 'read', label: t('notifications.readTab') },
  ];
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className="relative flex-1 h-8 rounded-lg text-[13px] font-semibold transition"
          style={{
            backgroundColor: active === tab.id ? 'white' : 'transparent',
            color: active === tab.id ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
            boxShadow: active === tab.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {tab.label}
          {tab.id === 'unread' && unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[9px] font-bold text-white flex items-center justify-center"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionLabel({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span
        className="text-[12px] font-bold uppercase tracking-wide"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {children}
      </span>
      {count != null && count > 0 && (
        <span
          className="px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white"
          style={{ backgroundColor: 'var(--brand-primary-purple)' }}
        >
          {count}
        </span>
      )}
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <div
        className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
        style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
      >
        <Bell className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
        {message}
      </p>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function NotificationsPage() {
  const { t } = useLanguage();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('all');
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [alertData, notifData] = await Promise.all([
        getAlerts().catch(() => []),
        getNotifications('all').catch(() => []),
      ]);
      const alertArr: Alert[] = Array.isArray(alertData) ? alertData : [];
      const notifArr: Notif[] = Array.isArray(notifData) ? notifData : [];
      setAlerts(alertArr.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      // Only show PUSH notifications in-app — EMAIL records are for tracking only
      const pushOnly = notifArr.filter((n) => !n.channel || n.channel === 'PUSH');
      setNotifs(pushOnly.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Poll every 30s for new alerts/notifications
    const interval = setInterval(() => { load(); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  async function handleAcknowledge(id: string) {
    setAcknowledging(id);
    try {
      await acknowledgeAlert(id);
      setAlerts((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: 'ACKNOWLEDGED' as AlertStatus } : a)),
      );
    } catch {
      // leave open
    } finally {
      setAcknowledging(null);
    }
  }

  async function handleRead(id: string) {
    try {
      await markNotificationRead(id, true);
      setNotifs((prev) => prev.map((n) => (n.id === id ? { ...n, watched: true } : n)));
    } catch {
      // optimistic update is fine to keep
    }
  }

  async function handleMarkAllRead() {
    const unread = notifs.filter((n) => !n.watched);
    if (unread.length === 0) return;
    setMarkingAll(true);
    try {
      await Promise.all(unread.map((n) => markNotificationRead(n.id, true)));
      setNotifs((prev) => prev.map((n) => ({ ...n, watched: true })));
    } catch {
      // partial update is ok
    } finally {
      setMarkingAll(false);
    }
  }

  // Consolidate alerts from the same journal entry into one
  // (e.g., systolic + diastolic from same reading = 1 alert card)
  const consolidatedAlerts = (() => {
    const byEntry = new Map<string, Alert[]>();
    for (const a of alerts) {
      const key = a.journalEntry?.id ?? a.id;
      if (!byEntry.has(key)) byEntry.set(key, []);
      byEntry.get(key)!.push(a);
    }
    return [...byEntry.values()].map((group) => {
      if (group.length === 1) return group[0];
      // Merge: pick worst severity, combine types, keep first alert's ID for actions
      const worst = group.find((a) => a.severity === 'HIGH') ?? group[0];
      const types = group.map((a) => a.type);
      const hasBoth = types.includes('SYSTOLIC_BP') && types.includes('DIASTOLIC_BP');
      return {
        ...worst,
        type: (hasBoth ? 'BP_COMBINED' : worst.type) as AlertType,
        // Keep OPEN status if any in group is OPEN
        status: (group.some((a) => a.status === 'OPEN') ? 'OPEN' : worst.status) as AlertStatus,
        escalated: group.some((a) => a.escalated),
      };
    });
  })();

  const openAlerts = consolidatedAlerts.filter((a) => a.status === 'OPEN');
  const pastAlerts = consolidatedAlerts.filter((a) => a.status !== 'OPEN');
  const unreadCount = notifs.filter((n) => !n.watched).length;

  const filteredNotifs =
    tab === 'unread'
      ? notifs.filter((n) => !n.watched)
      : tab === 'read'
        ? notifs.filter((n) => n.watched)
        : notifs;

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6">
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="flex items-center gap-3">
            <Link
              href="/dashboard"
              className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-75 shrink-0"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <ArrowLeft className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
            </Link>
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Bell className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('notifications.title')}
              </h1>
              {!loading && (
                <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {openAlerts.length > 0
                    ? `${openAlerts.length} ${openAlerts.length > 1 ? t('notifications.actionsNeededPlural') : t('notifications.actionsNeeded')} · ${unreadCount} ${t('notifications.unread')}`
                    : unreadCount > 0
                      ? `${unreadCount} ${t('notifications.unread')}`
                      : t('notifications.allCaughtUp')}
                </p>
              )}
            </div>
          </div>

          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[12px] font-semibold transition hover:opacity-80 disabled:opacity-50"
              style={{
                backgroundColor: 'var(--brand-primary-purple-light)',
                color: 'var(--brand-primary-purple)',
              }}
            >
              <CheckCheck className="w-3.5 h-3.5" />
              {markingAll ? t('notifications.marking') : t('notifications.markAllRead')}
            </button>
          )}
        </div>

      <div className="space-y-6">
        {loading ? (
          <>
            {/* Alert skeletons */}
            <div className="space-y-3">
              <Bone w={120} h={12} rounded="rounded-md" />
              <AlertSkeleton />
              <AlertSkeleton />
            </div>
            {/* Notif skeletons */}
            <div className="space-y-3">
              <Bone w={100} h={12} rounded="rounded-md" />
              <div
                className="rounded-2xl overflow-hidden"
                style={{ border: '1px solid var(--brand-border)' }}
              >
                {[0, 120, 240, 360].map((delay) => (
                  <div
                    key={delay}
                    style={{ borderBottom: delay < 360 ? '1px solid var(--brand-border)' : 'none' }}
                  >
                    <NotifSkeleton delay={delay} />
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            {/* ── Alerts grouped by tier (E1) — emergency first, then Tier 1
                contraindications, BP Level 1 high, BP Level 1 low, info, then
                anything that the rule engine hasn't classified. Each section
                renders only when it has at least one open alert. */}
            {openAlerts.length > 0 && (() => {
              type TierBucketKey =
                | 'emergency'
                | 'tier1'
                | 'high'
                | 'low'
                | 'info'
                | 'other';
              const order: TierBucketKey[] = ['emergency', 'tier1', 'high', 'low', 'info', 'other'];
              const headings: Record<TierBucketKey, string> = {
                emergency: t('notifications.bucket.emergency'),
                tier1: t('notifications.bucket.tier1'),
                high: t('notifications.bucket.high'),
                low: t('notifications.bucket.low'),
                info: t('notifications.bucket.info'),
                other: t('notifications.bucket.other'),
              };
              const bucketize = (a: typeof openAlerts[number]): TierBucketKey => {
                const tier = (a as { tier?: string | null }).tier ?? null;
                const sbp = a.journalEntry?.systolicBP ?? 0;
                const dbp = a.journalEntry?.diastolicBP ?? 0;
                if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'emergency';
                if (sbp >= 180 || dbp >= 120) return 'emergency';
                if (tier === 'TIER_1_CONTRAINDICATION') return 'tier1';
                if (tier === 'BP_LEVEL_1_LOW' || (sbp > 0 && sbp < 90) || (dbp > 0 && dbp < 60)) return 'low';
                if (tier === 'BP_LEVEL_1_HIGH') return 'high';
                if (tier === 'TIER_3_INFO') return 'info';
                if (a.severity === 'HIGH' || (a.type ?? '').includes('BP')) return 'high';
                return 'other';
              };
              const buckets = new Map<TierBucketKey, typeof openAlerts>();
              for (const a of openAlerts) {
                const k = bucketize(a);
                if (!buckets.has(k)) buckets.set(k, []);
                buckets.get(k)!.push(a);
              }
              return order
                .filter((k) => buckets.has(k))
                .map((k) => (
                  <div key={k}>
                    <SectionLabel count={buckets.get(k)!.length}>{headings[k]}</SectionLabel>
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {buckets.get(k)!.map((alert) => (
                          <AlertCard
                            key={alert.id}
                            alert={alert}
                            onAcknowledge={handleAcknowledge}
                            acknowledging={acknowledging}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ));
            })()}

            {/* ── Notifications ── */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <SectionLabel count={unreadCount > 0 ? unreadCount : undefined}>
                  {t('notifications.messages')}
                </SectionLabel>
              </div>

              <TabBar active={tab} onChange={setTab} unreadCount={unreadCount} />

              <div className="mt-3 space-y-2">
                <AnimatePresence mode="popLayout">
                  {filteredNotifs.length === 0 ? (
                    <EmptyState
                      message={
                        tab === 'unread'
                          ? t('notifications.noUnread')
                          : tab === 'read'
                            ? t('notifications.noRead')
                            : t('notifications.noMessages')
                      }
                    />
                  ) : (
                    filteredNotifs.map((notif) => (
                      <NotifCard key={notif.id} notif={notif} onRead={handleRead} />
                    ))
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ── Past Alerts (collapsible) ── */}
            {pastAlerts.length > 0 && (
              <PastAlerts alerts={pastAlerts} />
            )}
          </>
        )}
      </div>
      </div>
    </div>
  );
}

// ─── Past Alerts (collapsible section) ───────────────────────────────────────
function PastAlerts({ alerts }: { alerts: Alert[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide transition hover:opacity-75"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        {t('notifications.pastAlerts')} ({alerts.length})
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: 'easeOut' }}
            className="overflow-hidden mt-3 space-y-2"
          >
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={() => {}}
                acknowledging={null}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
