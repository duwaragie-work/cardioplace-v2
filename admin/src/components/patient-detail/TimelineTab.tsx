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
  Search,
  CalendarDays,
  User,
  ChevronRight,
  ChevronDown,
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
  title: string;
  body?: string;
  /** Optional second line shown after the body (e.g. clinical rationale when
   *  the body slot was used for a prev→new diff). */
  secondary?: string;
  actor?: string;
  /** Normalized actor (name or role, without the medication suffix) used to
   *  populate the actor filter dropdown. Logs set this explicitly; alert
   *  entries fall back to `actor` since they carry no medication suffix. */
  actorKey?: string;
  /** When set, this entry is a collapsed burst (e.g. one profile submission
   *  that wrote many field rows). The children are the individual events. */
  children?: FeedEntry[];
  /** Number of grouped child events (only set on burst-group entries). */
  count?: number;
}

type CategoryKey = Exclude<FeedFilter, 'ALL'>;

/** A merged feed entry enriched with derived fields used only for filtering. */
type DisplayEntry = FeedEntry & { actorResolved: string | null; search: string };

/** How many entries to render per "Load more" page. */
const PAGE_SIZE = 40;

const VERIF_ICON: Record<string, { icon: React.ReactNode; color: string }> = {
  PATIENT_REPORT: { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-primary-purple)' },
  ADMIN_VERIFY: { icon: <ShieldCheck className="w-3 h-3" />, color: 'var(--brand-success-green)' },
  ADMIN_CORRECT: { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-warning-amber)' },
  ADMIN_REJECT: { icon: <XIcon className="w-3 h-3" />, color: 'var(--brand-alert-red)' },
};

// All audit timestamps render in a single fixed clinical timezone (#8) so two
// admins in different locations read the same wall-clock time on the trail.
// Cohort sites are Ward 7 & 8 DC → Eastern Time.
const CLINIC_TZ = 'America/New_York';
const CLINIC_TZ_LABEL = 'ET';

const tzDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CLINIC_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const tzTimeFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: CLINIC_TZ,
  hour: 'numeric',
  minute: '2-digit',
});

function dayKey(iso: string): string {
  // YYYY-MM-DD in clinic TZ — stable group + sort key independent of viewer.
  // Adopted over H3 #87's viewer-local day (dev-merge, JCAHO audit timeline
  // must group identically regardless of who views/exports it). dayLabel()
  // derives Today/Yesterday by calling dayKey() itself, so #87's old
  // local-vs-UTC mismatch can't recur with this implementation.
  return tzDayFmt.format(new Date(iso));
}

function timeOf(iso: string): string {
  return tzTimeFmt.format(new Date(iso));
}

// Render a dayKey (YYYY-MM-DD) as an absolute, export-safe label. Noon anchors
// the date so the weekday/month/day never roll across the viewer's local tz.
function absoluteDayLabel(dk: string): string {
  return new Date(`${dk}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function dayLabel(dk: string): string {
  // Always include the full date (#11) so an exported/printed trail is
  // unambiguous; only prefix "Today/Yesterday" as an on-screen convenience.
  const today = dayKey(new Date().toISOString());
  const yesterday = dayKey(new Date(Date.now() - 86_400_000).toISOString());
  const abs = absoluteDayLabel(dk);
  if (dk === today) return `Today · ${abs}`;
  if (dk === yesterday) return `Yesterday · ${abs}`;
  return abs;
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
  historyHDP: 'History of hypertensive disorder of pregnancy (HDP)',
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

// User-scoped audit paths (e.g. user.enrollmentStatus from the IVR-04 re-gate,
// user.dateOfBirth from an admin correction). Without these the raw path would
// render as "User.enrollment Status".
const USER_FIELD_LABELS: Record<string, string> = {
  enrollmentStatus: 'Enrollment',
  dateOfBirth: 'Date of birth',
};

interface ParsedPath {
  scope: 'profile' | 'medication' | 'caregiver';
  /** Friendly label for the field (or "Medication" if the whole row was added). */
  field: string;
  /** Raw field key (after the prefix), useful for special-casing e.g. "verificationStatus". */
  fieldKey: string | null;
  /** Full medication id for lookups. */
  medId?: string;
  /** Caregiver id when scope === 'caregiver'. Frontend renders the resolved
   *  name from log.caregiverName instead of the raw id. */
  caregiverId?: string;
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
      medId,
      rowLevel: !fieldName,
    };
  }
  // Round 2 A4 — caregiver-scoped log (caregiver.service.ts writes
  // `caregiver:${id}` as the fieldPath on add/edit/remove). Backend resolves
  // log.caregiverName so the row reads "Caregiver Jane Doe (daughter)"
  // instead of "Caregiver:9a0446d9-…".
  if (path.startsWith('caregiver:')) {
    const id = path.slice('caregiver:'.length).trim();
    return {
      scope: 'caregiver',
      // Generic field label — the rendered subject uses the resolved name.
      field: 'Caregiver contact',
      fieldKey: null,
      caregiverId: id.length > 0 ? id : undefined,
      rowLevel: true,
    };
  }
  if (path.startsWith('profile.')) {
    const f = path.slice('profile.'.length);
    return { scope: 'profile', field: PROFILE_FIELD_LABELS[f] ?? prettifyKey(f), fieldKey: f };
  }
  if (path.startsWith('user.')) {
    const f = path.slice('user.'.length);
    return { scope: 'profile', field: USER_FIELD_LABELS[f] ?? prettifyKey(f), fieldKey: f };
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

/**
 * Map a role enum to the word shown in "… by <role>" phrases. Every admin-side
 * action used to render a flat "by admin"; we now surface the real role so the
 * trail reads "verified by provider" / "corrected by medical director". Only
 * SUPER_ADMIN (and the legacy coarse ADMIN) collapse to plain "admin".
 */
function roleWord(roleRaw: string): string {
  switch (roleRaw) {
    case 'PROVIDER':
      return 'provider';
    case 'MEDICAL_DIRECTOR':
      return 'medical director';
    case 'HEALPLACE_OPS':
      return 'ops';
    case 'PATIENT':
      return 'patient';
    case 'SUPER_ADMIN':
    case 'ADMIN':
      return 'admin';
    default:
      return roleRaw.replace(/_/g, ' ').toLowerCase();
  }
}

/** Verb phrase for a collapsed burst, e.g. "submitted by patient · 12 fields".
 *  Reads at the submission level rather than the field level. */
function groupVerb(changeType: string, actor: string): string {
  switch (changeType) {
    case 'PATIENT_REPORT':
      return `submitted by ${actor}`;
    case 'ADMIN_VERIFY':
      return `verified by ${actor}`;
    case 'ADMIN_CORRECT':
      return `corrected by ${actor}`;
    case 'ADMIN_REJECT':
      return `rejected by ${actor}`;
    default:
      return `updated by ${actor}`;
  }
}

function actionVerb(changeType: string, rowLevel: boolean | undefined, actor: string): string {
  switch (changeType) {
    case 'PATIENT_REPORT':
      return rowLevel ? `added by ${actor}` : `updated by ${actor}`;
    case 'ADMIN_VERIFY':
      return `verified by ${actor}`;
    case 'ADMIN_CORRECT':
      return `corrected by ${actor}`;
    case 'ADMIN_REJECT':
      return `rejected by ${actor}`;
    default:
      return 'changed';
  }
}

/**
 * Build a natural verb phrase for a verificationStatus change. The raw enum
 * transitions ("UNVERIFIED → AWAITING_PROVIDER", "AWAITING_PROVIDER → VERIFIED")
 * are accurate but unfriendly to a clinician scanning the timeline. `actor` is
 * the resolved role word (e.g. "provider"), not a flat "admin".
 */
function verificationStatusVerb(prev: unknown, next: unknown, actor: string): string {
  const n = typeof next === 'string' ? next : '';
  switch (n) {
    case 'VERIFIED':
      return `verified by ${actor}`;
    case 'REJECTED':
      return `marked rejected by ${actor}`;
    case 'HOLD':
      return `placed on hold by ${actor}`;
    case 'AWAITING_PROVIDER':
      return 'flagged for provider review';
    case 'UNVERIFIED':
      return prev === 'VERIFIED'
        ? `returned to unverified by ${actor}`
        : `reset to unverified by ${actor}`;
    case 'CORRECTED':
      return `corrected by ${actor}`;
    default:
      return `changed by ${actor}`;
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

// Units appended to a field's numeric value in the diff line (TL-071). Keyed by
// the raw field key from parseFieldPath (e.g. profile.heightCm → "heightCm").
const FIELD_UNITS: Record<string, string> = { heightCm: 'cm' };

function prettifyEnumValue(v: string): string {
  // ALL_CAPS_WITH_UNDERSCORES → "All caps with underscores"
  if (/^[A-Z0-9_]+$/.test(v)) {
    return v.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return v;
}

function describeChange(prev: unknown, next: unknown, unit?: string): string | null {
  const a = formatValue(prev);
  const b = formatValue(next);
  if (a == null && b == null) return null;
  // Append a unit (e.g. "cm") to real values so a height change reads
  // "170 cm → 175 cm" instead of a bare number (TL-071). Skip the "—" placeholder.
  const withUnit = (s: string | null) =>
    unit && s != null && s !== '—' ? `${s} ${unit}` : (s ?? '');
  if (a == null) return `Set to ${withUnit(b)}`;
  if (b == null) return `Was ${withUnit(a)}`;
  if (a === b) return null;
  return `${withUnit(a)} → ${withUnit(b)}`;
}

interface BuiltLog {
  entry: FeedEntry;
  /** Rows sharing this key were written by one action/submission and collapse
   *  into a single expandable group. */
  groupKey: string;
  changeType: string;
  scope: 'profile' | 'medication' | 'caregiver';
  drugName: string | null;
  actorWord: string;
  actor: string;
  actorKey: string;
}

function entriesFromLogs(
  logs: ProfileVerificationLog[],
  medById: Map<string, PatientMedication>,
): FeedEntry[] {
  const built: BuiltLog[] = logs.map((l) => {
    let chrome = VERIF_ICON[l.changeType] ?? { icon: <Edit3 className="w-3 h-3" />, color: 'var(--brand-text-muted)' };
    const parsed = parseFieldPath(l.fieldPath);
    const med = parsed.medId ? medById.get(parsed.medId) : null;
    const drugName = med?.drugName ?? null;
    // Resolved role word for "… by <role>" phrases. changedByRole is a coarse
    // "ADMIN" for every admin action, so prefer changedByRoleResolved.
    const actorWord = roleWord(l.changedByRoleResolved ?? l.changedByRole);

    let title: string;
    let body: string | undefined;

    // ── Special case: enrollment re-gate (IVR-04). Read as "Enrollment
    //    reverted" / "Patient enrolled" with the rationale below, rather than
    //    "Enrollment corrected by admin". The flip is system-driven off a
    //    condition change, so it gets its own alert/success chrome.
    if (parsed.fieldKey === 'enrollmentStatus') {
      const next = typeof l.newValue === 'string' ? l.newValue : '';
      title = next === 'ENROLLED' ? 'Patient enrolled' : 'Enrollment reverted';
      body = l.rationale ?? undefined;
      chrome =
        next === 'ENROLLED'
          ? { icon: <ShieldCheck className="w-3 h-3" />, color: 'var(--brand-success-green)' }
          : { icon: <ShieldAlert className="w-3 h-3" />, color: 'var(--brand-alert-red)' };
    }
    // ── Special case: status changes — use the action as the headline so it
    //    reads "Lisinopril verified by admin" instead of "Verification
    //    status verified by admin".
    else if (parsed.fieldKey === 'verificationStatus') {
      const verb = verificationStatusVerb(l.previousValue, l.newValue, actorWord);
      const subject =
        parsed.scope === 'medication'
          ? (drugName ?? 'Medication')
          : 'Profile';
      title = `${subject} ${verb}`;
      // Skip the prev → new line — the verb already tells the story.
      body = l.rationale ?? undefined;
    }
    // ── Round 2 A4 — caregiver-scoped log. Backend resolves caregiverName +
    //    caregiverRelationship; we render "Caregiver Jane Doe (daughter)
    //    contact updated by admin" instead of "caregiver:9a0446d9-… corrected
    //    by admin". A deleted caregiver falls back to "Caregiver contact".
    else if (parsed.scope === 'caregiver') {
      // dev-merge: actionVerb now takes (changeType, rowLevel, actor) — align
      // the caregiver branch (Round 2 A4) with its sibling calls.
      const verb = actionVerb(l.changeType, parsed.rowLevel, actorWord);
      const name = l.caregiverName?.trim();
      const subject = name
        ? `Caregiver ${name}${l.caregiverRelationship ? ` (${l.caregiverRelationship})` : ''}`
        : 'Caregiver contact';
      title = `${subject} ${verb}`;
      body = l.rationale ?? undefined;
    }
    // ── Whole-medication add: lead with the drug name.
    else if (parsed.rowLevel) {
      const medSummary = formatMedicationObject(l.newValue);
      const verb = actionVerb(l.changeType, parsed.rowLevel, actorWord);
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
      const verb = actionVerb(l.changeType, parsed.rowLevel, actorWord);
      const fieldLabel =
        parsed.scope === 'medication' && drugName
          ? `${drugName} · ${parsed.field}`
          : parsed.field;
      title = `${fieldLabel} ${verb}`;
      const unit = parsed.fieldKey ? FIELD_UNITS[parsed.fieldKey] : undefined;
      body = describeChange(l.previousValue, l.newValue, unit) ?? l.rationale ?? undefined;
    }

    // If we used the diff for body, surface the rationale on a third line
    // so the clinical context isn't lost.
    const usedDiffForBody = body != null && body.includes('→');
    const secondary = usedDiffForBody && l.rationale ? l.rationale : undefined;

    // Actor line: lead with the resolved user's name (falls back to role
    // when name is missing — e.g. self-served patient log without a name on
    // file). Suffix the drug name on medication-scoped events so the reader
    // can tell which med was changed without scanning IDs.
    const who = l.changedByName
      ? `${l.changedByName} (${actorWord})`
      : actorWord;
    const medSuffix =
      parsed.scope === 'medication'
        ? drugName
          ? ` · ${drugName}`
          : ' · an unnamed medication'
        : '';
    const actor = `${who}${medSuffix}`;

    const entry: FeedEntry = {
      id: `verif-${l.id}`,
      ts: l.createdAt,
      filter: parsed.scope === 'medication' ? 'MEDICATION' : 'PROFILE',
      icon: chrome.icon,
      color: chrome.color,
      title,
      body,
      secondary,
      actor,
      actorKey: who,
    };

    // Burst key: rows from one submission/action share actor + change type +
    // scope + (medication id) + timestamp-to-the-second. Enrollment re-gates
    // are distinct system events, so they always stay solo.
    const groupKey =
      parsed.fieldKey === 'enrollmentStatus'
        ? `solo-${l.id}`
        : `${l.changedBy}|${l.changeType}|${parsed.scope}|${parsed.medId ?? ''}|${l.createdAt.slice(0, 19)}`;

    return {
      entry,
      groupKey,
      changeType: l.changeType,
      scope: parsed.scope,
      drugName,
      actorWord,
      actor,
      actorKey: who,
    };
  });

  // Collapse same-burst rows so one profile submission doesn't flood the feed
  // with a dozen "… added by patient" lines. Singletons render as-is; bursts
  // become an expandable parent ("Profile submitted by patient · 12 fields").
  const groups = new Map<string, BuiltLog[]>();
  for (const b of built) {
    const arr = groups.get(b.groupKey) ?? [];
    arr.push(b);
    groups.set(b.groupKey, arr);
  }

  const out: FeedEntry[] = [];
  for (const members of groups.values()) {
    if (members.length === 1) {
      out.push(members[0].entry);
      continue;
    }
    const first = members[0];
    const subject = first.scope === 'medication' ? (first.drugName ?? 'Medication') : 'Profile';
    const newestTs = members.reduce((acc, m) => (m.entry.ts > acc ? m.entry.ts : acc), members[0].entry.ts);
    out.push({
      id: `group-${first.entry.id}`,
      ts: newestTs,
      filter: first.scope === 'medication' ? 'MEDICATION' : 'PROFILE',
      icon: first.entry.icon,
      color: first.entry.color,
      title: `${subject} ${groupVerb(first.changeType, first.actorWord)}`,
      count: members.length,
      children: members.map((m) => m.entry),
      actor: first.actor,
      actorKey: first.actorKey,
    });
  }
  return out;
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
      title: `${tlabel} alert opened`,
      body: a.patientMessage ?? undefined,
    });

    // Each escalation step
    for (const e of a.escalationEvents) {
      // Who fired the step: the scheduler (auto) or an admin action (BP_L2
      // retry). We don't carry the admin's name on the trigger row, so we
      // attribute the human case generically.
      const trigActor = e.dispatchedBySystem ? 'System · auto-escalation' : 'Scheduled by admin';
      out.push({
        id: `escal-${e.id}-trig`,
        ts: e.triggeredAt,
        filter: 'ALERT',
        icon: <ArrowUp className="w-3 h-3" />,
        color: 'var(--brand-warning-amber)',
        title: `Escalation ${e.escalationLevel} triggered`,
        body: e.reason ?? undefined,
        actor: trigActor,
        actorKey: e.dispatchedBySystem ? 'System' : undefined,
      });
      if (e.acknowledgedAt) {
        out.push({
          id: `escal-${e.id}-ack`,
          ts: e.acknowledgedAt,
          filter: 'ALERT',
          icon: <CheckCircle2 className="w-3 h-3" />,
          color: 'var(--brand-accent-teal)',
          title: `Escalation ${e.escalationLevel} acknowledged`,
          actor: e.acknowledgedByName ?? undefined,
          actorKey: e.acknowledgedByName ?? undefined,
        });
      }
      if (e.resolvedAt) {
        out.push({
          id: `escal-${e.id}-res`,
          ts: e.resolvedAt,
          filter: 'ALERT',
          icon: <CheckCircle2 className="w-3 h-3" />,
          color: 'var(--brand-success-green)',
          title: `Escalation ${e.escalationLevel} resolved`,
          actor: e.resolvedByName ?? undefined,
          actorKey: e.resolvedByName ?? undefined,
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
  // ── Filter state ──────────────────────────────────────────────────────────
  // Categories are multi-select: an empty set means "all". This lets a user
  // combine Profile + Medications without losing alerts the way the old
  // single-select chip row did.
  const [categories, setCategories] = useState<Set<CategoryKey>>(new Set());
  const [query, setQuery] = useState('');
  const [actorFilter, setActorFilter] = useState<string>('ALL');
  const [rangePreset, setRangePreset] = useState<'ALL' | '7' | '30' | '90' | 'CUSTOM'>('ALL');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Lookup table so we can resolve `medication:{uuid}` paths to the drug
  // name. Falls back gracefully when the meds list hasn't loaded yet.
  const medById = useMemo(() => {
    const m = new Map<string, PatientMedication>();
    for (const med of medications) m.set(med.id, med);
    return m;
  }, [medications]);

  // Build + merge once, then precompute a lowercase search blob and a resolved
  // actor key per entry so filtering stays cheap on every keystroke.
  const all: DisplayEntry[] = useMemo(() => {
    const merged = [...entriesFromLogs(logs, medById), ...entriesFromAlerts(alerts)];
    merged.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    return merged.map((e) => ({
      ...e,
      actorResolved: e.actorKey ?? e.actor ?? null,
      // Fold child text into the parent's search blob so a query still matches
      // a field that lives inside a collapsed burst group.
      search: `${e.title} ${e.body ?? ''} ${e.secondary ?? ''} ${e.actor ?? ''} ${(e.children ?? [])
        .map((c) => `${c.title} ${c.body ?? ''}`)
        .join(' ')}`.toLowerCase(),
    }));
  }, [logs, alerts, medById]);

  // Distinct actors for the dropdown ("everything Dr. X did").
  const actors = useMemo(() => {
    const s = new Set<string>();
    for (const e of all) if (e.actorResolved) s.add(e.actorResolved);
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [all]);

  // Resolve the active date window from preset / custom inputs.
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (rangePreset === 'CUSTOM') {
      return {
        rangeStart: customFrom ? new Date(`${customFrom}T00:00:00`) : null,
        rangeEnd: customTo ? new Date(`${customTo}T23:59:59.999`) : null,
      };
    }
    if (rangePreset === 'ALL') return { rangeStart: null, rangeEnd: null };
    const start = new Date();
    start.setDate(start.getDate() - Number(rangePreset));
    return { rangeStart: start, rangeEnd: null };
  }, [rangePreset, customFrom, customTo]);

  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (categories.size > 0 && !categories.has(e.filter as CategoryKey)) return false;
      if (actorFilter !== 'ALL' && e.actorResolved !== actorFilter) return false;
      if (q && !e.search.includes(q)) return false;
      if (rangeStart || rangeEnd) {
        const t = new Date(e.ts).getTime();
        if (rangeStart && t < rangeStart.getTime()) return false;
        if (rangeEnd && t > rangeEnd.getTime()) return false;
      }
      return true;
    });
  }, [all, categories, actorFilter, q, rangeStart, rangeEnd]);

  // Reset the render window whenever the active filters change so "Load more"
  // never carries a stale offset into a narrower/wider result set. Done during
  // render (React's "adjust state on input change" pattern) rather than in an
  // effect, which avoids a cascading extra render.
  const filterSig = `${[...categories].sort().join(',')}|${actorFilter}|${q}|${rangePreset}|${customFrom}|${customTo}`;
  const [prevFilterSig, setPrevFilterSig] = useState(filterSig);
  if (filterSig !== prevFilterSig) {
    setPrevFilterSig(filterSig);
    setVisibleCount(PAGE_SIZE);
  }

  const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const remaining = filtered.length - visible.length;

  const groups = useMemo(() => {
    const m = new Map<string, DisplayEntry[]>();
    for (const e of visible) {
      const k = dayKey(e.ts);
      const arr = m.get(k) ?? [];
      arr.push(e);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [visible]);

  const counts = useMemo(() => ({
    ALL: all.length,
    PROFILE: all.filter((e) => e.filter === 'PROFILE').length,
    MEDICATION: all.filter((e) => e.filter === 'MEDICATION').length,
    ALERT: all.filter((e) => e.filter === 'ALERT').length,
  }), [all]);

  const isLoading = logsLoading || alertsLoading;
  const filtersActive =
    categories.size > 0 || q.length > 0 || actorFilter !== 'ALL' || rangePreset !== 'ALL';

  const toggleCategory = (k: CategoryKey) =>
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });

  const clearFilters = () => {
    setCategories(new Set());
    setQuery('');
    setActorFilter('ALL');
    setRangePreset('ALL');
    setCustomFrom('');
    setCustomTo('');
  };

  return (
    <div className="space-y-4">
      {/* Toolbar: category toggles + search / actor / date-range */}
      <div className="bg-white rounded-2xl p-4 space-y-3" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
        {/* Category toggles — multi-select; "All" = nothing selected. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            ['ALL', 'All', counts.ALL, 'var(--brand-primary-purple)', 'var(--brand-primary-purple-light)'],
            ['PROFILE', 'Profile', counts.PROFILE, 'var(--brand-text-secondary)', 'var(--brand-background)'],
            ['MEDICATION', 'Medications', counts.MEDICATION, 'var(--brand-warning-amber)', 'var(--brand-warning-amber-light)'],
            ['ALERT', 'Alerts', counts.ALERT, 'var(--brand-alert-red)', 'var(--brand-alert-red-light)'],
          ] as [FeedFilter, string, number, string, string][]).map(([key, label, count, color, bg]) => {
            const active = key === 'ALL' ? categories.size === 0 : categories.has(key as CategoryKey);
            return (
              <button
                key={key}
                type="button"
                onClick={() => (key === 'ALL' ? setCategories(new Set()) : toggleCategory(key as CategoryKey))}
                data-testid={`admin-timeline-filter-${key}`}
                aria-pressed={active}
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

        {/* Search + actor + date range. On mobile: search takes its own full
            row, then actor + date share one row (half each). On sm+ they all
            sit inline. */}
        <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2">
          <div className="relative w-full sm:flex-1 sm:min-w-[180px]">
            <Search
              className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: 'var(--brand-text-muted)' }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search events, values, notes…"
              aria-label="Search events, values, notes"
              data-testid="admin-timeline-search"
              className="w-full h-8 pl-8 pr-2 rounded-lg text-[12px] outline-none"
              style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
            />
          </div>

          {/* Keep actor + date on a single row, even on the narrowest phones. */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:flex-none min-w-0">
              <User
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
              <select
                value={actorFilter}
                onChange={(e) => setActorFilter(e.target.value)}
                aria-label="Filter by actor"
                data-testid="admin-timeline-actor"
                className="w-full sm:w-auto h-8 pl-8 pr-2 rounded-lg text-[12px] outline-none cursor-pointer bg-white"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-primary)', maxWidth: 200 }}
              >
                <option value="ALL">All actors</option>
                {actors.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>

            <div className="relative flex-1 sm:flex-none min-w-0">
              <CalendarDays
                className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'var(--brand-text-muted)' }}
              />
              <select
                value={rangePreset}
                onChange={(e) => setRangePreset(e.target.value as typeof rangePreset)}
                aria-label="Filter by date range"
                data-testid="admin-timeline-range"
                className="w-full sm:w-auto h-8 pl-8 pr-2 rounded-lg text-[12px] outline-none cursor-pointer bg-white"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
              >
                <option value="ALL">All time</option>
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 90 days</option>
                <option value="CUSTOM">Custom range…</option>
              </select>
            </div>
          </div>

          {rangePreset === 'CUSTOM' && (
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                aria-label="Custom range from date"
                data-testid="admin-timeline-range-from"
                className="flex-1 sm:flex-none min-w-0 h-8 px-2 rounded-lg text-[12px] outline-none bg-white"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
              />
              <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>–</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                aria-label="Custom range to date"
                data-testid="admin-timeline-range-to"
                className="flex-1 sm:flex-none min-w-0 h-8 px-2 rounded-lg text-[12px] outline-none bg-white"
                style={{ border: '1px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
              />
            </div>
          )}

          {filtersActive && (
            <button
              type="button"
              onClick={clearFilters}
              data-testid="admin-timeline-clear"
              className="h-8 px-2.5 rounded-lg text-[11.5px] font-semibold inline-flex items-center justify-center gap-1 cursor-pointer w-full sm:w-auto"
              style={{ color: 'var(--brand-text-secondary)', border: '1px solid var(--brand-border)' }}
            >
              <XIcon className="w-3 h-3" />
              Clear
            </button>
          )}
        </div>

        <p className="text-[10.5px]" style={{ color: 'var(--brand-text-muted)' }}>
          All times shown in Eastern Time ({CLINIC_TZ_LABEL}).
        </p>
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
        <div className="bg-white rounded-2xl p-8 text-center" style={{ boxShadow: 'var(--brand-shadow-card)' }} data-testid="admin-timeline-empty">
          <Clock className="w-7 h-7 mx-auto mb-2" style={{ color: 'var(--brand-text-muted)' }} />
          {filtersActive ? (
            <>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                No matching events
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                Try widening the date range or clearing filters.
              </p>
              <button
                type="button"
                onClick={clearFilters}
                data-testid="admin-timeline-clear-empty"
                className="mt-3 h-8 px-3 rounded-lg text-[11.5px] font-semibold inline-flex items-center gap-1 cursor-pointer"
                style={{ color: 'var(--brand-primary-purple)', border: '1px solid var(--brand-border)' }}
              >
                <XIcon className="w-3 h-3" />
                Clear filters
              </button>
            </>
          ) : (
            <>
              <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                No history yet
              </p>
              <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
                Verification, medication, and alert events will show here in chronological order.
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3" data-testid="admin-timeline-list">
          {groups.map(([dk, entries]) => (
            <div key={dk} className="bg-white rounded-2xl overflow-hidden" style={{ boxShadow: 'var(--brand-shadow-card)' }}>
              <div className="px-5 py-2.5" style={{ backgroundColor: 'var(--brand-background)', borderBottom: '1px solid var(--brand-border)' }}>
                <p className="text-[10.5px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                  {dayLabel(dk)}
                </p>
              </div>
              <ol className="relative">
                {entries.map((e, i) => {
                  const isGroup = !!e.children?.length;
                  // Auto-expand groups while searching so a match inside a
                  // collapsed burst is actually visible.
                  const open = expanded.has(e.id) || (isGroup && q.length > 0);
                  return (
                    <li
                      key={e.id}
                      className="px-5 py-3 flex items-start gap-3"
                      data-testid={`admin-timeline-entry-${e.id}`}
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
                        {/* Header (clickable to expand on burst groups). */}
                        <div
                          className={isGroup ? 'cursor-pointer' : undefined}
                          onClick={isGroup ? () => toggleExpand(e.id) : undefined}
                          {...(isGroup
                            ? { role: 'button', 'aria-expanded': open, 'data-testid': `admin-timeline-group-${e.id}` }
                            : {})}
                        >
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <p className="text-[12.5px] font-bold leading-snug inline-flex items-center gap-1.5" style={{ color: 'var(--brand-text-primary)' }}>
                              {isGroup &&
                                (open ? (
                                  <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                                ) : (
                                  <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--brand-text-muted)' }} />
                                ))}
                              {e.title}
                              {isGroup && (
                                <span
                                  className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                                  style={{ backgroundColor: 'var(--brand-background)', color: 'var(--brand-text-secondary)' }}
                                >
                                  {e.count} fields
                                </span>
                              )}
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

                        {/* Expanded burst children — the individual field rows. */}
                        {isGroup && open && (
                          <ul
                            className="mt-2 space-y-2 pl-3"
                            style={{ borderLeft: '2px solid var(--brand-border)' }}
                            data-testid={`admin-timeline-group-children-${e.id}`}
                          >
                            {e.children!.map((c) => (
                              <li key={c.id} data-testid={`admin-timeline-entry-${c.id}`}>
                                <p className="text-[11.5px] font-semibold leading-snug" style={{ color: 'var(--brand-text-primary)' }}>
                                  {c.title}
                                </p>
                                {c.body && (
                                  <p
                                    className="text-[11px] mt-0.5 leading-relaxed"
                                    style={{
                                      color: 'var(--brand-text-secondary)',
                                      fontWeight: c.body.includes('→') ? 600 : 400,
                                    }}
                                  >
                                    {c.body}
                                  </p>
                                )}
                                {c.secondary && (
                                  <p className="text-[10.5px] mt-0.5 italic leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                                    “{c.secondary}”
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ))}

          {/* Load-more footer — windows the render so a long-tenure patient
              doesn't paint thousands of rows at once. */}
          {remaining > 0 && (
            <div className="text-center pt-1">
              <button
                type="button"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                data-testid="admin-timeline-loadmore"
                className="h-9 px-4 rounded-full text-[12px] font-semibold cursor-pointer transition-all"
                style={{
                  backgroundColor: 'white',
                  color: 'var(--brand-primary-purple)',
                  border: '1.5px solid var(--brand-primary-purple)',
                  boxShadow: 'var(--brand-shadow-card)',
                }}
              >
                Load {Math.min(PAGE_SIZE, remaining)} more
                <span style={{ color: 'var(--brand-text-muted)' }}> · {remaining} older</span>
              </button>
            </div>
          )}
          {remaining === 0 && filtered.length > PAGE_SIZE && (
            <p className="text-center text-[11px] pt-1" style={{ color: 'var(--brand-text-muted)' }}>
              Showing all {filtered.length} events
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Re-exports keep tree-shaking happy; these icons are imported for the legend
// area below if any caller wants to render their own variant.
export { ShieldCheck, ShieldAlert, Pill, AlertTriangle };
