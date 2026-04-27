'use client';

// Flow H5 — chronological audit log.
//
// Merges three streams client-side:
//   • ProfileVerificationLog rows (medication changes, profile corrections,
//     verifications, rejections — all field-level changes)
//   • DeviationAlert events (alert created, alert resolved)
//   • EscalationEvent ladder steps (T+0, T+4h, T+24h…) per alert
//
// Renders newest-first, grouped by day. Each entry timestamped with actor +
// event type. Filters: all / profile-only / meds-only / alerts-only.

import { useMemo, useState } from 'react';
import {
  Clock,
  ShieldCheck,
  ShieldAlert,
  Pill,
  Bell,
  CheckCircle2,
  ArrowUp,
  AlertTriangle,
  Edit3,
  X as XIcon,
  Loader2,
} from 'lucide-react';
import type {
  ProfileVerificationLog,
  PatientAlert,
  PatientMedication,
} from '@/lib/services/patient-detail.service';

interface Props {
  logs: ProfileVerificationLog[];
  alerts: PatientAlert[];
  medications: PatientMedication[];
  logsLoading: boolean;
  alertsLoading: boolean;
}

type FeedFilter = 'ALL' | 'PROFILE' | 'MEDICATION' | 'ALERT';

interface FeedEntry {
  id: string;
  ts: string;
  filter: FeedFilter;
  icon: React.ReactNode;
  color: string;
  bg: string;
  title: string;
  body?: string;
  /** Optional second line shown after the body (e.g. clinical rationale when
   *  the body slot was used for a prev→new diff). */
  secondary?: string;
  actor?: string;
}

const VERIF_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  PATIENT_REPORT: { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-primary-purple)' },
  ADMIN_VERIFY: { icon: <ShieldCheck className="w-3 h-3" />, color: 'var(--brand-success-green)' },
  ADMIN_CORRECT: { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-warning-amber)' },
  ADMIN_REJECT: { icon: <XIcon className="w-3 h-3" />, color: 'var(--brand-alert-red)' },
};

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, now)) return 'Today';
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (sameDay(d, yest)) return 'Yesterday';
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function tierLabel(t: string | null): string {
  if (!t) return 'alert';
  return t.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Field-path → human label maps ───────────────────────────────────────────
// Backend writes paths like:
//   profile.gender          profile.hasCAD          profile.verificationStatus
//   medication:{uuid}       medication:{uuid}.drugName   medication:{uuid}.verificationStatus
// We surface these as friendly clinical labels so the timeline reads like a
// nurse's note instead of a JSON dump.

const PROFILE_FIELD_LABELS: Record<string, string> = {
  gender: 'Sex',
  heightCm: 'Height',
  isPregnant: 'Pregnancy status',
  pregnancyDueDate: 'Pregnancy due date',
  historyPreeclampsia: 'History of preeclampsia',
  diagnosedHypertension: 'Diagnosed hypertension',
  hasHeartFailure: 'Heart failure',
  heartFailureType: 'Heart failure type',
  hasAFib: 'Atrial fibrillation',
  hasCAD: 'Coronary artery disease',
  hasHCM: 'Hypertrophic cardiomyopathy',
  hasDCM: 'Dilated cardiomyopathy',
  hasTachycardia: 'Tachycardia',
  hasBradycardia: 'Bradycardia',
  verificationStatus: 'Profile verification',
};

const MEDICATION_FIELD_LABELS: Record<string, string> = {
  drugName: 'Drug name',
  drugClass: 'Drug class',
  frequency: 'Dosing frequency',
  isCombination: 'Combination flag',
  combinationComponents: 'Combination components',
  source: 'Reporting source',
  verificationStatus: 'Verification status',
  discontinuedAt: 'Discontinuation',
  notes: 'Clinical notes',
  rawInputText: 'Raw input',
};

interface ParsedPath {
  scope: 'profile' | 'medication';
  /** Friendly label for the field (or "Medication" if the whole row was added). */
  field: string;
  /** Raw field key (after the prefix), useful for special-casing e.g. "verificationStatus". */
  fieldKey: string | null;
  /** Truncated medication id when scope === 'medication' (for the badge). */
  medIdShort?: string;
  /** Full medication id for lookups. */
  medId?: string;
  /** True when the action was a wholesale add/remove of a medication row. */
  rowLevel?: boolean;
}

function parseFieldPath(path: string): ParsedPath {
  if (path.startsWith('medication:')) {
    const after = path.slice('medication:'.length);
    const dot = after.indexOf('.');
    const medId = dot >= 0 ? after.slice(0, dot) : after;
    const fieldName = dot >= 0 ? after.slice(dot + 1) : null;
    return {
      scope: 'medication',
      field: fieldName ? (MEDICATION_FIELD_LABELS[fieldName] ?? prettifyKey(fieldName)) : 'Medication record',
      fieldKey: fieldName,
      medIdShort: medId.slice(0, 6),
      medId,
      rowLevel: !fieldName,
    };
  }
  if (path.startsWith('profile.')) {
    const f = path.slice('profile.'.length);
    return { scope: 'profile', field: PROFILE_FIELD_LABELS[f] ?? prettifyKey(f), fieldKey: f };
  }
  return { scope: 'profile', field: prettifyKey(path), fieldKey: path };
}

function prettifyKey(k: string): string {
  // hasCAD → "Has CAD"; pregnancyDueDate → "Pregnancy due date"
  return k
    .replace(/([A-Z]+)/g, ' $1')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

function actionVerb(changeType: string, scope: 'profile' | 'medication', rowLevel?: boolean): string {
  switch (changeType) {
    case 'PATIENT_REPORT':
      return rowLevel ? 'added by patient' : 'updated by patient';
    case 'ADMIN_VERIFY':
      return 'verified by admin';
    case 'ADMIN_CORRECT':
      return 'corrected by admin';
    case 'ADMIN_REJECT':
      return 'rejected by admin';
    default:
      return 'changed';
  }
}

/**
 * Build a natural verb phrase for a verificationStatus change. The raw enum
 * transitions ("UNVERIFIED → AWAITING_PROVIDER", "AWAITING_PROVIDER → VERIFIED")
 * are accurate but unfriendly to a clinician scanning the timeline.
 */
function verificationStatusVerb(prev: unknown, next: unknown): string {
  const n = typeof next === 'string' ? next : '';
  switch (n) {
    case 'VERIFIED':
      return 'verified by admin';
    case 'REJECTED':
      return 'marked rejected by admin';
    case 'AWAITING_PROVIDER':
      return 'placed on hold by admin';
    case 'UNVERIFIED':
      return prev === 'VERIFIED'
        ? 'returned to unverified by admin'
        : 'reset to unverified by admin';
    case 'CORRECTED':
      return 'corrected by admin';
    default:
      return 'changed by admin';
  }
}

function formatValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'string') {
    if (v.length === 0) return null;
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return prettifyEnumValue(v);
  }
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ');
  if (typeof v === 'object') {
    // Try to detect known object shapes and summarize them in plain English
    // before falling back to a truncated JSON blob.
    const med = formatMedicationObject(v);
    if (med) return med;
    return null; // intentionally hide raw blobs from non-technical readers
  }
  return String(v);
}

/**
 * Whole-medication adds carry the entire row in `newValue`. Summarize it as
 * "Drug name · Class · Frequency" so the timeline reads like a chart note
 * instead of a JSON dump.
 */
function formatMedicationObject(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o.drugName !== 'string') return null;
  const parts: string[] = [o.drugName];
  if (typeof o.drugClass === 'string') parts.push(prettifyEnumValue(o.drugClass));
  if (typeof o.frequency === 'string') parts.push(prettifyEnumValue(o.frequency));
  return parts.join(' · ');
}

function prettifyEnumValue(v: string): string {
  // ALL_CAPS_WITH_UNDERSCORES → "All caps with underscores"
  if (/^[A-Z0-9_]+$/.test(v)) {
    return v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return v;
}

function describeChange(prev: unknown, next: unknown): string | null {
  const a = formatValue(prev);
  const b = formatValue(next);
  if (a == null && b == null) return null;
  if (a == null) return `Set to ${b}`;
  if (b == null) return `Was ${a}`;
  if (a === b) return null;
  return `${a} → ${b}`;
}

function entriesFromLogs(
  logs: ProfileVerificationLog[],
  medById: Map<string, PatientMedication>,
): FeedEntry[] {
  return logs.map((l) => {
    const chrome = VERIF_ICON[l.changeType] ?? { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-text-muted)' };
    const parsed = parseFieldPath(l.fieldPath);
    const med = parsed.medId ? medById.get(parsed.medId) : null;
    const drugName = med?.drugName ?? null;

    let title: string;
    let body: string | undefined;

    // ── Special case: status changes — use the action as the headline so it
    //    reads "Lisinopril verified by admin" instead of "Verification
    //    status verified by admin".
    if (parsed.fieldKey === 'verificationStatus') {
      const verb = verificationStatusVerb(l.previousValue, l.newValue);
      const subject =
        parsed.scope === 'medication'
          ? (drugName ?? 'Medication')
          : 'Profile';
      title = `${subject} ${verb}`;
      // Skip the prev → new line — the verb already tells the story.
      body = l.rationale ?? undefined;
    }
    // ── Whole-medication add: lead with the drug name.
    else if (parsed.rowLevel) {
      const medSummary = formatMedicationObject(l.newValue);
      const verb = actionVerb(l.changeType, parsed.scope, parsed.rowLevel);
      if (medSummary) {
        const [drug, ...rest] = medSummary.split(' · ');
        title = `${drug} ${verb}`;
        body = rest.length > 0 ? rest.join(' · ') : undefined;
      } else if (drugName) {
        title = `${drugName} ${verb}`;
        body = l.rationale ?? undefined;
      } else {
        title = `Medication ${verb}`;
        body = l.rationale ?? undefined;
      }
    }
    // ── Standard field-level change: "Sex updated by patient" with a
    //    "Female → Male" diff line below. For medication fields, prefix the
    //    drug name so the user can tell which med was changed.
    else {
      const verb = actionVerb(l.changeType, parsed.scope, parsed.rowLevel);
      const fieldLabel =
        parsed.scope === 'medication' && drugName
          ? `${drugName} · ${parsed.field}`
          : parsed.field;
      title = `${fieldLabel} ${verb}`;
      body = describeChange(l.previousValue, l.newValue) ?? l.rationale ?? undefined;
    }

    // If we used the diff for body, surface the rationale on a third line
    // so the clinical context isn't lost.
    const usedDiffForBody = body != null && body.includes('→');
    const secondary = usedDiffForBody && l.rationale ? l.rationale : undefined;

    // Actor line: lead with the resolved user's name (falls back to role
    // when name is missing — e.g. self-served patient log without a name on
    // file). Suffix the drug name on medication-scoped events so the reader
    // can tell which med was changed without scanning IDs.
    const roleLabel = l.changedByRole.toLowerCase();
    const who = l.changedByName
      ? `${l.changedByName} (${roleLabel})`
      : roleLabel;
    const medSuffix =
      parsed.scope === 'medication'
        ? drugName
          ? ` · ${drugName}`
          : parsed.medIdShort
            ? ` · med ${parsed.medIdShort}…`
            : ''
        : '';
    const actor = `${who}${medSuffix}`;

    return {
      id: `verif-${l.id}`,
      ts: l.createdAt,
      filter: parsed.scope === 'medication' ? 'MEDICATION' : 'PROFILE',
      icon: chrome.icon,
      color: chrome.color,
      bg: chrome.color === 'var(--brand-success-green)'
        ? 'var(--brand-success-green-light)'
        : chrome.color === 'var(--brand-alert-red)'
          ? 'var(--brand-alert-red-light)'
          : chrome.color === 'var(--brand-warning-amber)'
            ? 'var(--brand-warning-amber-light)'
            : 'var(--brand-primary-purple-light)',
      title,
      body,
      secondary,
      actor,
    };
  });
}

function entriesFromAlerts(alerts: PatientAlert[]): FeedEntry[] {
  const out: FeedEntry[] = [];
  for (const a of alerts) {
    const tlabel = tierLabel(a.tier);

    // Created
    out.push({
      id: `alert-created-${a.id}`,
      ts: a.createdAt,
      filter: 'ALERT',
      icon: <Bell className="w-3 h-3" />,
      color: 'var(--brand-alert-red)',
      bg: 'var(--brand-alert-red-light)',
      title: `${tlabel} alert opened`,
      body: a.patientMessage ?? undefined,
    });

    // Each escalation step
    for (const e of a.escalationEvents) {
      out.push({
        id: `escal-${e.id}-trig`,
        ts: e.triggeredAt,
        filter: 'ALERT',
        icon: <ArrowUp className="w-3 h-3" />,
        color: 'var(--brand-warning-amber)',
        bg: 'var(--brand-warning-amber-light)',
        title: `Escalation ${e.escalationLevel} triggered`,
        body: e.reason ?? undefined,
      });
      if (e.acknowledgedAt) {
        out.push({
          id: `escal-${e.id}-ack`,
          ts: e.acknowledgedAt,
          filter: 'ALERT',
          icon: <CheckCircle2 className="w-3 h-3" />,
          color: 'var(--brand-accent-teal)',
          bg: 'var(--brand-accent-teal-light)',
          title: `Escalation ${e.escalationLevel} acknowledged`,
        });
      }
      if (e.resolvedAt) {
        out.push({
          id: `escal-${e.id}-res`,
          ts: e.resolvedAt,
          filter: 'ALERT',
          icon: <CheckCircle2 className="w-3 h-3" />,
          color: 'var(--brand-success-green)',
          bg: 'var(--brand-success-green-light)',
          title: `Escalation ${e.escalationLevel} resolved`,
        });
      }
    }

    // Resolved (alert-level)
    if (a.status === 'RESOLVED' && a.acknowledgedAt) {
      out.push({
        id: `alert-resolved-${a.id}`,
        ts: a.acknowledgedAt,
        filter: 'ALERT',
        icon: <ShieldCheck className="w-3 h-3" />,
        color: 'var(--brand-success-green)',
        bg: 'var(--brand-success-green-light)',
        title: `${tlabel} alert resolved`,
        body: a.resolutionRationale ?? a.resolutionAction ?? undefined,
        actor: a.resolvedByName
          ? `${a.resolvedByName} (provider)`
          : a.resolvedBy
            ? 'provider'
            : undefined,
      });
    }
  }
  return out;
}

export default function TimelineTab({ logs, alerts, medications, logsLoading, alertsLoading }: Props) {
  const [filter, setFilter] = useState<FeedFilter>('ALL');

  // Lookup table so we can resolve `medication:{uuid}` paths to the drug
  // name. Falls back gracefully when the meds list hasn't loaded yet.
  const medById = useMemo(() => {
    const m = new Map<string, PatientMedication>();
    for (const med of medications) m.set(med.id, med);
    return m;
  }, [medications]);

  const all: FeedEntry[] = useMemo(() => {
    const merged = [...entriesFromLogs(logs, medById), ...entriesFromAlerts(alerts)];
    merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return merged;
  }, [logs, alerts, medById]);

  const filtered = useMemo(() => {
    if (filter === 'ALL') return all;
    return all.filter((e) => e.filter === filter);
  }, [all, filter]);

  const groups = useMemo(() => {
    const m = new Map<string, FeedEntry[]>();
    for (const e of filtered) {
      const k = dayKey(e.ts);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const counts = useMemo(() => ({
    ALL: all.length,
    PROFILE: all.filter((e) => e.filter === 'PROFILE').length,
    MEDICATION: all.filter((e) => e.filter === 'MEDICATION').length,
    ALERT: all.filter((e) => e.filter === 'ALERT').length,
  }), [all]);

  const isLoading = logsLoading || alertsLoading;

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="bg-white rounded-2xl p-4 flex flex-wrap items-center gap-1.5" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        {([
          ['ALL', 'All', counts.ALL, 'var(--brand-primary-purple)', 'var(--brand-primary-purple-light)'],
          ['PROFILE', 'Profile', counts.PROFILE, 'var(--brand-text-secondary)', 'var(--brand-background)'],
          ['MEDICATION', 'Medications', counts.MEDICATION, 'var(--brand-warning-amber)', 'var(--brand-warning-amber-light)'],
          ['ALERT', 'Alerts', counts.ALERT, 'var(--brand-alert-red)', 'var(--brand-alert-red-light)'],
        ] as [FeedFilter, string, number, string, string][]).map(([key, label, count, color, bg]) => {
          const active = filter === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all inline-flex items-center gap-1.5 cursor-pointer"
              style={{
                backgroundColor: active ? color : bg,
                color: active ? 'white' : color,
                border: `1.5px solid ${active ? color : 'transparent'}`,
              }}
            >
              {label}
              <span
                className="text-[10px] font-bold px-1.5 rounded-full"
                style={{
                  backgroundColor: active ? 'rgba(255,255,255,0.25)' : 'white',
                  color: active ? 'white' : color,
                  minWidth: 18,
                  textAlign: 'center',
                }}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Feed */}
      {isLoading && all.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <Loader2 className="w-5 h-5 mx-auto animate-spin" style={{ color: 'var(--brand-text-muted)' }} />
          <p className="text-[12.5px] mt-2" style={{ color: 'var(--brand-text-muted)' }}>
            Loading timeline…
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
          <Clock className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
          <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
            No history yet
          </p>
          <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
            Verification, medication, and alert events will show here in chronological order.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([dk, entries]) => (
            <div key={dk} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <div className="px-5 py-2.5" style={{ backgroundColor: 'var(--brand-background)', borderBottom: '1px solid var(--brand-border)' }}>
                <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                  {dayLabel(dk)}
                </p>
              </div>
              <ol className="relative">
                {entries.map((e, i) => (
                  <li
                    key={e.id}
                    className="px-5 py-3 flex items-start gap-3"
                    style={{
                      borderTop: i > 0 ? '1px solid var(--brand-border)' : 'none',
                    }}
                  >
                    <div
                      className="shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-white"
                      style={{ backgroundColor: e.color }}
                      aria-hidden
                    >
                      {e.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <p className="text-[12.5px] font-bold leading-snug" style={{ color: 'var(--brand-text-primary)' }}>
                          {e.title}
                        </p>
                        <span className="text-[10.5px] inline-flex items-center gap-1 shrink-0" style={{ color: 'var(--brand-text-muted)' }}>
                          <Clock className="w-2.5 h-2.5" />
                          {timeOf(e.ts)}
                        </span>
                      </div>
                      {e.body && (
                        <p
                          className="text-[11.5px] mt-0.5 leading-relaxed"
                          style={{
                            color: 'var(--brand-text-secondary)',
                            // Highlight diff rows ("X → Y") with a slightly
                            // bolder, value-leaning treatment.
                            fontWeight: e.body.includes('→') ? 600 : 400,
                          }}
                        >
                          {e.body}
                        </p>
                      )}
                      {e.secondary && (
                        <p className="text-[11px] mt-0.5 italic leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                          “{e.secondary}”
                        </p>
                      )}
                      {e.actor && (
                        <p className="text-[10.5px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                          {e.actor}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Re-exports keep tree-shaking happy; these icons are imported for the legend
// area below if any caller wants to render their own variant.
export { ShieldCheck, ShieldAlert, Pill, AlertTriangle };
