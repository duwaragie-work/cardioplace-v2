'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { consolidateAlertsByEntry } from '@/lib/alerts/consolidate';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import PatientAlertCard from '@/components/alerts/PatientAlertCard';

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
  /** Engine rule that fired. P1 — the bell's tier-based bucketing mislabels
   *  rules whose engine tier doesn't match their patient meaning (e.g.
   *  RULE_HF_DECOMPENSATION claims the sbp-low axis → tier BP_LEVEL_1_LOW, so
   *  it bucketed as "Low blood pressure"). bucketize() consults ruleId first. */
  ruleId?: string | null;
  /** Three-tier patient-facing message. Backend always populates this on
   *  v2 alerts; falling back to the legacy BP/value rendering when null. */
  patientMessage?: string | null;
  severity?: AlertSeverity | string | null;
  magnitude?: number | null;
  baselineValue?: number | null;
  actualValue?: number | null;
  status?: AlertStatus | string;
  escalated?: boolean;
  /** False when the alert may NOT be cleared by the patient (Tier 1
   *  contraindication, BP Level 2 emergency). Backend marks these
   *  dismissible:false; UI must hide the Acknowledge button so the patient
   *  can't accidentally halt the provider escalation ladder per
   *  CLINICAL_SPEC §V2-C. */
  dismissible?: boolean;
  /** Set to the admin's userId once the alert is terminally resolved.
   *  Drives the "Reviewed by care team" badge so patients can tell at a
   *  glance which alerts have provider action without opening each one. */
  resolvedBy?: string | null;
  resolutionAction?: string | null;
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

/** Patient-facing bell bucket. Tier-derived for most rules, with a rule-aware
 *  override (P1) for rules whose engine tier doesn't match their patient
 *  meaning. */
export type TierBucketKey =
  | 'emergency'
  | 'tier1'
  | 'high'
  | 'heartFailure'
  | 'low'
  | 'info'
  | 'other';

export function bucketizeAlert(a: Alert): TierBucketKey {
  const tier = a.tier ?? null;
  const ruleId = a.ruleId ?? null;
  const sbp = a.journalEntry?.systolicBP ?? 0;
  const dbp = a.journalEntry?.diastolicBP ?? 0;
  // P1 — rule-aware override. RULE_HF_DECOMPENSATION claims the sbp-low axis
  // (engine tier BP_LEVEL_1_LOW) but is a fluid / heart-failure alert, not low
  // blood pressure. Bucket it by rule before the tier branches so it stops
  // reading "Low blood pressure". Other special-cased rules can join here.
  if (ruleId === 'RULE_HF_DECOMPENSATION') return 'heartFailure';
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'emergency';
  if (sbp >= 180 || dbp >= 120) return 'emergency';
  if (tier === 'TIER_1_CONTRAINDICATION') return 'tier1';
  if (tier === 'BP_LEVEL_1_LOW' || (sbp > 0 && sbp < 90) || (dbp > 0 && dbp < 60)) return 'low';
  if (tier === 'BP_LEVEL_1_HIGH') return 'high';
  if (tier === 'TIER_3_INFO') return 'info';
  // F32 — patient-visible Tier 2 medication-discrepancy alerts (those that
  // survived the patientMessage filter) bucket under Info.
  if (tier === 'TIER_2_DISCREPANCY') return 'info';
  if (a.severity === 'HIGH' || (a.type ?? '').includes('BP')) return 'high';
  return 'other';
}

type Notif = {
  id: string;
  title: string;
  body: string;
  tips: string[];
  sentAt: string;
  watched: boolean;
  channel?: string;
  /** Backend-set when the notification is generated by an alert event
   *  (escalation dispatch, admin resolution). Tapping deep-links to the
   *  alert detail page so the patient lands on context, not a generic feed. */
  alertId?: string | null;
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

// Cluster-3 / B10: severity foregrounds were -600 shades on -50/-100 backs,
// all 3.0–3.95:1 ratios — fails AA. Bumped to -800 shades (~6:1+) while
// keeping the same hue families.
//
// Follow-up #3 (Cluster 6+): HIGH + MEDIUM swapped from hardcoded hex to
// brand tokens so the vibrant-red/amber CTA family applies here too — the
// border uses the vibrant `*` token at full saturation per the border
// policy, the chip text stays on `*-text` (dark -800) for AA, and the bg
// uses `*-light` (tinted -100). LOW kept on hardcoded green hex — green is
// explicitly out of scope for the vibrant migration.
const SEVERITY_META = {
  HIGH: {
    label: 'Urgent',
    bg: 'var(--brand-alert-red-light)',
    text: 'var(--brand-alert-red-text)',
    border: 'var(--brand-alert-red)',
    // Vibrant CTA bg (white text on it) — used for the Acknowledge button so
    // the card has a clear focal action, matching the patient dashboard's
    // top-alert "View details" pattern.
    cta: 'var(--brand-alert-red)',
  },
  MEDIUM: {
    label: 'Moderate',
    bg: 'var(--brand-warning-amber-light)',
    text: 'var(--brand-warning-amber-text)',
    border: 'var(--brand-warning-amber)',
    cta: 'var(--brand-warning-amber)',
  },
  LOW: {
    label: 'Low',
    bg: '#F0FDF4',
    text: '#166534',
    border: '#BBF7D0',
    cta: 'var(--brand-success-green)',
  },
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

// ─── Notification Card ────────────────────────────────────────────────────────
function NotifCard({
  notif,
  onRead,
}: {
  notif: Notif;
  onRead: (id: string) => void;
}) {
  const router = useRouter();
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const hasTips = notif.tips && notif.tips.length > 0;

  return (
    <motion.div
      layout
      data-testid={`notification-row-${notif.id}`}
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
        // Alert-linked notifications (admin resolution, escalation dispatch)
        // deep-link to the alert detail so the patient lands on context.
        // Generic notifications (gap reminders etc.) just mark-as-read.
        if (notif.alertId) {
          router.push(`/alerts?id=${notif.alertId}`);
        }
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
                className="text-[0.875rem] leading-snug"
                style={{
                  color: 'var(--brand-text-primary)',
                  fontWeight: notif.watched ? 500 : 700,
                }}
              >
                {notif.title}
              </p>
              <span
                data-testid="notification-date"
                className="text-[0.6875rem] shrink-0 mt-0.5"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {timeAgo(notif.sentAt, t)}
              </span>
            </div>
            <p
              className="text-[0.8125rem] mt-0.5 leading-relaxed"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {notif.body}
            </p>

            {/* Footer hint row.
                Alert-linked notification (alertId set) → show "View alert →"
                hint so the patient knows the card is tappable to navigate,
                plus a separate "Mark read" button that JUST marks read
                without navigating. The card body click still navigates.
                Unlinked notification (e.g. gap reminders) → keep the
                existing "Tap to mark as read" hint. */}
            {notif.alertId ? (
              <div className="mt-1.5 flex items-center justify-between gap-3">
                <span
                  data-testid={`notification-link-${notif.id}`}
                  className="inline-flex items-center gap-1 text-[0.6875rem] font-semibold"
                  style={{ color: 'var(--brand-primary-purple)' }}
                >
                  {t('notifications.viewAlert')}
                  <span aria-hidden>→</span>
                </span>
                {!notif.watched && (
                  <button
                    type="button"
                    data-testid={`notification-mark-read-button-${notif.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRead(notif.id);
                    }}
                    className="inline-flex items-center gap-1 px-2 h-6 rounded-full text-[0.6875rem] font-semibold cursor-pointer transition hover:opacity-80"
                    style={{
                      backgroundColor: 'var(--brand-background)',
                      color: 'var(--brand-text-secondary)',
                      border: '1px solid var(--brand-border)',
                    }}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                    {t('notifications.markRead')}
                  </button>
                )}
              </div>
            ) : (
              !notif.watched && (
                <span
                  className="inline-block mt-1.5 text-[0.6875rem] font-semibold"
                  style={{ color: 'var(--brand-primary-purple)' }}
                >
                  {t('notifications.tapToRead')}
                </span>
              )
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
              className="flex items-center gap-1.5 text-[0.75rem] font-semibold transition hover:opacity-75"
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
                      className="flex items-start gap-2 text-[0.75rem] leading-relaxed"
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
          className="relative flex-1 h-8 rounded-lg text-[0.8125rem] font-semibold transition"
          style={{
            backgroundColor: active === tab.id ? 'white' : 'transparent',
            color: active === tab.id ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
            boxShadow: active === tab.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {tab.label}
          {tab.id === 'unread' && unreadCount > 0 && (
            <span
              className="absolute -top-1 -right-1 w-4 h-4 rounded-full text-[0.5625rem] font-bold text-white flex items-center justify-center"
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

// ─── Top tab bar (Alerts | Notifications) ──────────────────────────────────
type TopTab = 'alerts' | 'notifications';

function TopTabBar({
  active,
  onChange,
  alertsCount,
  notifsCount,
}: {
  active: TopTab;
  onChange: (t: TopTab) => void;
  alertsCount: number;
  notifsCount: number;
}) {
  const { t } = useLanguage();
  const tabs: { id: TopTab; label: string; count: number }[] = [
    { id: 'alerts', label: t('notifications.topTab.alerts'), count: alertsCount },
    { id: 'notifications', label: t('notifications.topTab.notifications'), count: notifsCount },
  ];
  return (
    <div
      className="flex items-center gap-1 p-1 rounded-xl w-full"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-testid={tab.id === 'alerts' ? 'notifications-tab-alerts' : 'notifications-tab-notifications'}
          onClick={() => onChange(tab.id)}
          className="relative flex-1 h-10 rounded-lg text-[0.84375rem] sm:text-[0.875rem] font-semibold transition flex items-center justify-center gap-2 cursor-pointer"
          style={{
            backgroundColor: active === tab.id ? 'white' : 'transparent',
            color: active === tab.id ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
            boxShadow: active === tab.id ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
          }}
        >
          {tab.label}
          {tab.count > 0 && (
            <span
              className="min-w-[18px] h-[18px] px-1.5 rounded-full text-[0.625rem] font-bold text-white flex items-center justify-center"
              style={{
                backgroundColor:
                  active === tab.id
                    ? 'var(--brand-primary-purple)'
                    : 'var(--brand-text-muted)',
              }}
            >
              {tab.count > 99 ? '99+' : tab.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────
function SectionLabel({ children, count, testId }: { children: React.ReactNode; count?: number; testId?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3 mt-1">
      <span
        data-testid={testId}
        className="text-[0.75rem] font-bold uppercase tracking-wide"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {children}
      </span>
      {count != null && count > 0 && (
        <span
          className="px-1.5 py-0.5 rounded-full text-[0.625rem] font-bold text-white"
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
      <p className="text-[0.875rem] font-semibold" style={{ color: 'var(--brand-text-secondary)' }}>
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
  const [topTab, setTopTab] = useState<TopTab>('alerts');
  const [acknowledging, setAcknowledging] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  // Round 2 J — alerts list tier filter (admin parity). The buckets the alerts
  // top-tab renders (emergency / tier1 / high / low / info) collapse to one
  // when this filter narrows to a single tier. 'ALL' (default) keeps every
  // patient-visible bucket. Tier 2 is admin-only per spec — the page already
  // strips it upstream — so it's intentionally absent from the chip set.
  const [alertTierFilter, setAlertTierFilter] = useState<
    'ALL' | 'emergency' | 'tier1' | 'high' | 'heartFailure' | 'low' | 'info'
  >('ALL');

  // First load shows the skeleton; subsequent polls refresh state silently
  // so the user doesn't see a "page refresh" flash every 30s. The motion-list
  // animations smooth over the in-place card updates.
  const load = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    try {
      const [alertData, notifData] = await Promise.all([
        getAlerts().catch(() => []),
        getNotifications('all').catch(() => []),
      ]);
      const alertArr: Alert[] = Array.isArray(alertData) ? alertData : [];
      const notifArr: Notif[] = Array.isArray(notifData) ? notifData : [];
      // F32 — Tier 2 medication-discrepancy alerts are admin-only UNLESS the
      // rule engine populated a patient-facing message (e.g. the A5-3
      // beta-blocker carve-out: RULE_MEDICATION_MISSED fires TIER_2_DISCREPANCY
      // WITH a patientMessage). Mirror the Tier-3 safety-net rule — a non-empty
      // patientMessage means the alert is meant for the patient. Strip only the
      // silent (admin-only) Tier-2 rows.
      const patientVisible = alertArr.filter(
        (a) =>
          a.tier !== 'TIER_2_DISCREPANCY' ||
          (typeof a.patientMessage === 'string' &&
            a.patientMessage.trim().length > 0),
      );
      setAlerts(patientVisible.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
      // L-2 — the in-app inbox must render DASHBOARD notifications too (e.g.
      // SUPPORT_REPLY / SUPPORT_RESOLVE are DASHBOARD-only), not just PUSH.
      // Catch: the daily reminder creates BOTH a DASHBOARD and a PUSH row per
      // dispatch, so showing every row would double it. Dedupe by content —
      // prefer the DASHBOARD row and drop any PUSH row that has a DASHBOARD twin
      // (same title+body). Net result: DASHBOARD-only (support) shows, PUSH-only
      // (monthly re-ask) shows, and the reminder collapses to one card. EMAIL
      // rows are already excluded server-side; the `!channel` guard keeps any
      // legacy channel-less rows.
      const contentKey = (n: Notif) => `${n.title} ${n.body}`;
      const dashboardKeys = new Set(
        notifArr.filter((n) => n.channel === 'DASHBOARD').map(contentKey),
      );
      const inApp = notifArr.filter((n) => {
        if (n.channel === 'EMAIL') return false;
        if (n.channel === 'PUSH' && dashboardKeys.has(contentKey(n))) return false;
        return true;
      });
      setNotifs(inApp.sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime()));
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // Background poll — silent so the skeleton doesn't flash every 30s.
    const interval = setInterval(() => { load({ silent: true }); }, 30_000);
    return () => clearInterval(interval);
  }, [load]);

  // Deep-link support: /notifications?tab=notifications opens straight to the
  // Notifications tab (the dashboard panel + bell link here). Read client-side
  // to avoid a useSearchParams Suspense boundary. Defaults to Alerts otherwise.
  useEffect(() => {
    const tabParam = new URLSearchParams(window.location.search).get('tab');
    if (tabParam === 'notifications') setTopTab('notifications');
    else if (tabParam === 'alerts') setTopTab('alerts');
  }, []);

  // Sibling components (e.g. the Navbar bell) keep their own count and
  // cache their own state. After any local mutation that changes the
  // alert/notification surface, broadcast a window-level event so they can
  // refetch on the same tick instead of waiting for the next 30s poll.
  const broadcastChange = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('cardio:notifications-changed'));
    }
  };

  async function handleAcknowledge(id: string) {
    setAcknowledging(id);
    try {
      // Cards on this page can be merged from multiple alerts that share a
      // journalEntry (e.g. systolic + diastolic from one reading). The card
      // surfaces only one id, so acking that id alone leaves siblings OPEN
      // and the merge logic keeps the card visible. Resolve all OPEN
      // siblings in the same group so the card moves to Past Alerts.
      const target = alerts.find((a) => a.id === id);
      const groupKey = target?.journalEntry?.id ?? id;
      const groupIds = alerts
        .filter(
          (a) =>
            (a.journalEntry?.id ?? a.id) === groupKey
            && a.status === 'OPEN'
            // CLINICAL_SPEC §V2-C — never ack a non-dismissable sibling
            // (Tier 1 / BP L2). Patient-ack stops the escalation cron, so
            // even when the merged-card UI happens to show the button we
            // must skip dismissible=false rows here too.
            && a.dismissible !== false,
        )
        .map((a) => a.id);
      const idsToAck = groupIds.length > 0 ? groupIds : [id];
      await Promise.all(idsToAck.map((gid) => acknowledgeAlert(gid)));
      setAlerts((prev) =>
        prev.map((a) =>
          idsToAck.includes(a.id) ? { ...a, status: 'ACKNOWLEDGED' as AlertStatus } : a,
        ),
      );
      broadcastChange();
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
      broadcastChange();
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
      broadcastChange();
    } catch {
      // partial update is ok
    } finally {
      setMarkingAll(false);
    }
  }

  // Consolidate alerts from the same journal entry into one card (e.g. systolic
  // + diastolic from the same reading). Logic extracted to a tested helper.
  const consolidatedAlerts = consolidateAlertsByEntry(alerts);

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
    <main id="main" className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
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
                <p className="text-[0.75rem]" style={{ color: 'var(--brand-text-muted)' }}>
                  {openAlerts.length > 0
                    ? `${openAlerts.length} ${openAlerts.length > 1 ? t('notifications.actionsNeededPlural') : t('notifications.actionsNeeded')} · ${unreadCount} ${t('notifications.unread')}`
                    : unreadCount > 0
                      ? `${unreadCount} ${t('notifications.unread')}`
                      : t('notifications.allCaughtUp')}
                </p>
              )}
            </div>
          </div>

          {topTab === 'notifications' && unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 h-9 px-3 rounded-full text-[0.75rem] font-semibold transition hover:opacity-80 disabled:opacity-50"
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

        {/* Top tabs — Alerts (default) | Notifications. Counts on each tab
            keep the user oriented when switching. */}
        {!loading && (
          <div className="mb-5">
            <TopTabBar
              active={topTab}
              onChange={setTopTab}
              alertsCount={openAlerts.length}
              notifsCount={unreadCount}
            />
          </div>
        )}

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
        ) : topTab === 'alerts' ? (
          <>
            {/* Round 2 J — tier filter chips (admin parity). Default ALL keeps
                the existing bucket grouping; selecting a tier narrows the list
                to that bucket. Tier 2 is admin-only per CLINICAL_SPEC §V2-C —
                already stripped upstream — so no chip for it. */}
            {(openAlerts.length > 0 || pastAlerts.length > 0) && (
              <div
                className="flex flex-wrap gap-1.5 mb-3"
                data-testid="alerts-tier-filter"
                role="tablist"
                aria-label="Filter alerts by tier"
              >
                {(
                  [
                    ['ALL', 'All'],
                    ['emergency', 'Emergency'],
                    ['tier1', 'Tier 1'],
                    ['high', 'High BP'],
                    ['heartFailure', 'Heart failure'],
                    ['low', 'Low BP'],
                    ['info', 'Info'],
                  ] as const
                ).map(([key, label]) => {
                  const active = alertTierFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-testid={`alerts-tier-filter-${key}`}
                      onClick={() => setAlertTierFilter(key)}
                      className="px-2.5 h-7 rounded-full text-[0.71875rem] font-semibold transition cursor-pointer"
                      style={{
                        backgroundColor: active
                          ? 'var(--brand-primary-purple)'
                          : 'var(--brand-primary-purple-light)',
                        color: active ? 'white' : 'var(--brand-primary-purple)',
                        border: '1px solid transparent',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Alerts grouped by tier (E1) — emergency first, then Tier 1
                contraindications, BP Level 1 high, BP Level 1 low, info, then
                anything that the rule engine hasn't classified. Each section
                renders only when it has at least one open alert. */}
            {openAlerts.length === 0 && pastAlerts.length === 0 && (
              <EmptyState message={t('notifications.allCaughtUp')} />
            )}
            {openAlerts.length > 0 && (() => {
              const order: TierBucketKey[] = ['emergency', 'tier1', 'high', 'heartFailure', 'low', 'info', 'other'];
              const headings: Record<TierBucketKey, string> = {
                emergency: t('notifications.bucket.emergency'),
                tier1: t('notifications.bucket.tier1'),
                high: t('notifications.bucket.high'),
                heartFailure: t('notifications.bucket.heartFailure'),
                low: t('notifications.bucket.low'),
                info: t('notifications.bucket.info'),
                other: t('notifications.bucket.other'),
              };
              const buckets = new Map<TierBucketKey, typeof openAlerts>();
              for (const a of openAlerts) {
                const k = bucketizeAlert(a);
                if (!buckets.has(k)) buckets.set(k, []);
                buckets.get(k)!.push(a);
              }
              const sectionTestIds: Partial<Record<TierBucketKey, string>> = {
                emergency: 'alerts-section-emergency',
                high: 'alerts-section-elevated',
                heartFailure: 'alerts-section-heart-failure',
              };
              return order
                .filter((k) => buckets.has(k))
                // Round 2 J — narrow to the selected tier chip ('ALL' = all
                // patient-visible buckets; 'other' is bundled into 'ALL').
                .filter((k) => alertTierFilter === 'ALL' || alertTierFilter === k)
                .map((k) => (
                  <div key={k}>
                    <SectionLabel count={buckets.get(k)!.length} testId={sectionTestIds[k]}>{headings[k]}</SectionLabel>
                    <div className="space-y-3">
                      <AnimatePresence mode="popLayout">
                        {buckets.get(k)!.map((alert) => (
                          <PatientAlertCard
                            key={alert.id}
                            alert={alert}
                            onAcknowledge={handleAcknowledge}
                            acknowledging={acknowledging}
                            testIdPrefix="notification-row"
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </div>
                ));
            })()}

            {/* ── Past Alerts (collapsible) ── */}
            {pastAlerts.length > 0 && (
              <PastAlerts alerts={pastAlerts} />
            )}
          </>
        ) : (
          <>
            {/* ── Notifications tab — filter (all/unread/read) + list ── */}
            <div>
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
          </>
        )}
      </div>
      </div>
    </main>
  );
}

// ─── Past Alerts (collapsible section) ───────────────────────────────────────
function PastAlerts({ alerts }: { alerts: Alert[] }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        data-testid="alerts-section-past"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[0.75rem] font-bold uppercase tracking-wide transition hover:opacity-75"
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
              <PatientAlertCard
                key={alert.id}
                alert={alert}
                onAcknowledge={() => {}}
                acknowledging={null}
                testIdPrefix="notification-row"
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
