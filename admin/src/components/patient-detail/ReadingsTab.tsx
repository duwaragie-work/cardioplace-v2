'use client';

// Flow H — patient detail "Readings" subtab.
//
// Provider-side longitudinal view of every BP journal entry the patient
// has logged, with the same fields the patient sees on their /readings
// page (per V2 feature request). Clinical write roles (SUPER_ADMIN /
// MEDICAL_DIRECTOR / PROVIDER — canManageReadings) can also add readings on
// the patient's behalf (clinic-floor entry, multi-reading sessions) and
// edit/delete via the per-row kebab; every mutation writes an
// ADMIN_READING_* audit row. Other roles see the original read-only view.
//
// Layout:
//   • Filter row — date range (7d / 30d / 90d / custom) and tier filter.
//   • One card per entry, newest first. Card surfaces date/time +
//     vitals + position/weight up top; symptoms, missed-med detail,
//     measurement-flags, notes, and any linked-alert tier badges below.
//   • Empty / loading skeletons match the rest of the patient-detail
//     tabs so the shell doesn't flash a different style on load.
//
// Reuses the existing GET /provider/patients/:userId/journal endpoint
// (no new endpoint). Authorized for the same four clinical roles as the
// rest of the provider controller (SUPER_ADMIN, MEDICAL_DIRECTOR,
// PROVIDER, HEALPLACE_OPS).

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  MoreHorizontal,
  Pencil,
  Pill,
  Plus,
  ShieldAlert,
  Smartphone,
  Stethoscope,
  Trash2,
  Weight as WeightIcon,
  XCircle,
} from 'lucide-react';
import {
  getPatientJournalEntries,
  getPatientRejectedReadings,
  type PatientJournalEntry,
  type RejectedReading,
} from '@/lib/services/provider.service';
import { getPatientMedications, getPatientProfile } from '@/lib/services/patient-detail.service';
import { hasLargeDiscrepancy } from '@cardioplace/shared';
import { useAuth } from '@/lib/auth-context';
import { canManageReadings } from '@/lib/roleGates';
import AddEditReadingModal, {
  DeleteReadingDialog,
  kgToLbs,
  type ReadingMedication,
} from './AddEditReadingModal';

interface Props {
  patientId: string;
}

type DateFilter = 'ALL' | '7D' | '30D' | '90D';
type TierFilter = 'ALL' | 'BP_L2' | 'TIER_1' | 'TIER_2' | 'BP_L1' | 'TIER_3';

const SYMPTOM_LABELS: Record<keyof Pick<PatientJournalEntry,
  'severeHeadache' | 'visualChanges' | 'alteredMentalStatus' |
  'chestPainOrDyspnea' | 'focalNeuroDeficit' | 'severeEpigastricPain' |
  'newOnsetHeadache' | 'ruqPain' | 'edema'>, string> = {
  severeHeadache: 'Severe headache',
  visualChanges: 'Vision changes',
  alteredMentalStatus: 'Confusion / altered mental status',
  chestPainOrDyspnea: 'Chest pain / shortness of breath',
  focalNeuroDeficit: 'Focal neuro deficit',
  severeEpigastricPain: 'Severe stomach pain',
  newOnsetHeadache: 'New-onset headache',
  ruqPain: 'RUQ pain',
  edema: 'Edema',
};

// Friendlier labels for the measurement-conditions checklist used in
// CheckIn flow B1. Falls through to the raw key for any unknown items
// (forward-compatible if new checklist items are added).
const CONDITION_LABELS: Record<string, string> = {
  noCaffeine: 'No caffeine',
  noSmoking: 'No smoking',
  noExercise: 'No exercise',
  bladderEmpty: 'Bladder empty',
  seatedQuietly: 'Seated quietly',
  posturalSupport: 'Postural support',
  notTalking: 'Not talking',
  cuffOnBareArm: 'Cuff on bare arm',
};

function tierBucket(t: string | null): TierFilter | 'OTHER' {
  if (t === 'BP_LEVEL_2' || t === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') return 'BP_L2';
  // Cluster 8 — angioedema buckets into TIER_1 (same red chrome on the
  // readings card) per Manisha "resolved like all Tier 1 alerts".
  if (t === 'TIER_1_CONTRAINDICATION' || t === 'TIER_1_ANGIOEDEMA') return 'TIER_1';
  if (t === 'TIER_2_DISCREPANCY') return 'TIER_2';
  if (t === 'BP_LEVEL_1_HIGH' || t === 'BP_LEVEL_1_LOW') return 'BP_L1';
  if (t === 'TIER_3_INFO') return 'TIER_3';
  return 'OTHER';
}

function tierChrome(b: TierFilter | 'OTHER'): { label: string; color: string; bg: string } {
  switch (b) {
    case 'BP_L2': return { label: 'BP L2', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_1': return { label: 'Tier 1', color: 'var(--brand-alert-red-text)', bg: 'var(--brand-alert-red-light)' };
    case 'TIER_2': return { label: 'Tier 2', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    case 'BP_L1': return { label: 'BP L1', color: 'var(--brand-warning-amber-text)', bg: 'var(--brand-warning-amber-light)' };
    // Manisha Open-Decisions sign-off 2026-06-06 (Decision 1) — Tier 3 = info-blue.
    case 'TIER_3': return { label: 'Tier 3', color: 'var(--brand-info-blue)', bg: 'var(--brand-info-blue-light)' };
    default: return { label: 'Other', color: 'var(--brand-text-muted)', bg: 'var(--brand-background)' };
  }
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
  });
}

function formatTime(iso: string, withSeconds = false): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    ...(withSeconds ? { second: '2-digit' } : {}),
  });
}

// Bug 15 — entry ids that share their local HH:MM with another entry in the
// list. Those render with seconds so two readings submitted moments apart (now
// stored at full-ms precision, no DB collision) don't both show "03:11 PM" and
// read like a duplicate. Mirrors the patient /readings rule (cross-app parity).
export function sameMinuteCollisionIds(
  entries: ReadonlyArray<{ id: string; measuredAt: string }>,
): Set<string> {
  const byMinute = new Map<string, string[]>();
  for (const e of entries) {
    const d = new Date(e.measuredAt);
    if (Number.isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`;
    const arr = byMinute.get(key);
    if (arr) arr.push(e.id);
    else byMinute.set(key, [e.id]);
  }
  const colliding = new Set<string>();
  for (const arr of byMinute.values()) {
    if (arr.length >= 2) for (const id of arr) colliding.add(id);
  }
  return colliding;
}

function dateFilterCutoff(filter: DateFilter): Date | null {
  if (filter === 'ALL') return null;
  const days = filter === '7D' ? 7 : filter === '30D' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(0, 0, 0, 0);
  return d;
}

// F25 — a single BP check-in writes one JournalEntry per reading, all sharing
// a sessionId. The flat list rendered them as N indistinguishable rows, so an
// admin couldn't tell three rows were one sitting. Group consecutive entries
// that share a non-null sessionId; a group of ≥2 becomes a bordered session
// card, singletons stay plain rows.
export type ReadingGroup =
  | { kind: 'session'; sessionId: string; entries: PatientJournalEntry[] }
  | { kind: 'single'; entry: PatientJournalEntry };

const READINGS_PROXIMITY_MS = 5 * 60 * 1000; // CLINICAL_SPEC §5.2 — 5-min window.

// Bug 5 (live-test 2026-06-15) — whether two consecutive readings belong to the
// same sitting. Explicit sessionId is authoritative: two non-null sessionIds
// group only when equal (and a null never merges into a sessioned group — the
// session boundary is respected). NULL-session rows (legacy data + chat-tool
// entries that never carried a sessionId) fall back to the 5-min time-proximity
// window, mirroring the patient app's grouping so the two surfaces agree.
function sameSitting(a: PatientJournalEntry, b: PatientJournalEntry): boolean {
  if (a.sessionId != null && b.sessionId != null) return a.sessionId === b.sessionId;
  if (a.sessionId == null && b.sessionId == null) {
    const ta = new Date(a.measuredAt).getTime();
    const tb = new Date(b.measuredAt).getTime();
    if (Number.isNaN(ta) || Number.isNaN(tb)) return false;
    return Math.abs(ta - tb) <= READINGS_PROXIMITY_MS;
  }
  return false;
}

export function groupReadingsBySession(entries: PatientJournalEntry[]): ReadingGroup[] {
  const groups: ReadingGroup[] = [];
  let i = 0;
  while (i < entries.length) {
    let j = i + 1;
    while (j < entries.length && sameSitting(entries[j - 1], entries[j])) j++;
    const slice = entries.slice(i, j);
    if (slice.length >= 2) {
      // Prefer a real sessionId for the key; null-proximity groups get a
      // synthetic key derived from the anchor entry's id.
      const sid = slice.find((e) => e.sessionId != null)?.sessionId ?? `proximity-${slice[0].id}`;
      groups.push({ kind: 'session', sessionId: sid, entries: slice });
    } else {
      groups.push({ kind: 'single', entry: slice[0] });
    }
    i = j;
  }
  return groups;
}

type ReadingModal =
  | { type: 'add' }
  | { type: 'view'; entry: PatientJournalEntry }
  | { type: 'edit'; entry: PatientJournalEntry }
  | { type: 'delete'; entry: PatientJournalEntry };

export default function ReadingsTab({ patientId }: Props) {
  const [entries, setEntries] = useState<PatientJournalEntry[]>([]);
  const [rejected, setRejected] = useState<RejectedReading[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>('30D');
  const [tierFilter, setTierFilter] = useState<TierFilter>('ALL');
  const [modal, setModal] = useState<ReadingModal | null>(null);

  const { user } = useAuth();
  const canManage = canManageReadings(user);

  // PatientProfile.isPregnant gates the modal's Pregnancy-specific symptom
  // section (patient-check-in parity). Non-blocking: a fetch failure (e.g. a
  // role without profile read) just hides the section for new entries —
  // entries that already carry a pregnancy symptom still show it.
  const [isPregnant, setIsPregnant] = useState(false);
  useEffect(() => {
    let cancelled = false;
    getPatientProfile(patientId)
      .then((p) => {
        if (!cancelled) setIsPregnant(p?.isPregnant === true);
      })
      .catch(() => {
        if (!cancelled) setIsPregnant(false);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  // Eligible meds for the modal's per-med "taken today?" question — same
  // filter as the patient check-in: scheduled only (no AS_NEEDED), no
  // HOLD/REJECTED, not discontinued. Non-blocking on failure.
  const [eligibleMeds, setEligibleMeds] = useState<ReadingMedication[]>([]);
  useEffect(() => {
    let cancelled = false;
    getPatientMedications(patientId)
      .then((list) => {
        if (cancelled) return;
        setEligibleMeds(
          list
            .filter(
              (m) =>
                m.frequency !== 'AS_NEEDED' &&
                m.verificationStatus !== 'HOLD' &&
                m.verificationStatus !== 'REJECTED' &&
                m.discontinuedAt == null,
            )
            .map((m) => ({ id: m.id, drugName: m.drugName, drugClass: m.drugClass })),
        );
      })
      .catch(() => {
        if (!cancelled) setEligibleMeds([]);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  // Silent (no skeleton) when reloading after a mutation — the list is
  // already on screen; a full skeleton flash would lose scroll position.
  const load = useCallback((opts?: { silent?: boolean }) => {
    let cancelled = false;
    if (!opts?.silent) setLoading(true);
    setError(null);
    getPatientJournalEntries(patientId, { limit: 200 })
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load readings.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // Rejected readings are a separate, non-blocking QA note — a fetch failure
    // here shouldn't break the main readings list.
    getPatientRejectedReadings(patientId, { limit: 20 })
      .then((data) => {
        if (!cancelled) setRejected(data);
      })
      .catch(() => {
        if (!cancelled) setRejected([]);
      });
    return () => { cancelled = true; };
  }, [patientId]);

  useEffect(() => load(), [load]);

  const reload = useCallback(() => {
    load({ silent: true });
  }, [load]);

  const filtered = useMemo(() => {
    const cutoff = dateFilterCutoff(dateFilter);
    return entries.filter((e) => {
      if (cutoff && new Date(e.measuredAt) < cutoff) return false;
      if (tierFilter !== 'ALL') {
        const hit = e.deviations.some((d) => tierBucket(d.tier) === tierFilter);
        if (!hit) return false;
      }
      return true;
    });
  }, [entries, dateFilter, tierFilter]);

  const counts = useMemo(() => ({ ALL: entries.length }), [entries]);

  return (
    <div className="space-y-4">
      {/* Add Reading — clinic-floor entry on the patient's behalf. Role-gated
          to the clinical write roles (mirror of the backend controller). */}
      {canManage && (
        <div className="flex justify-end">
          <button
            type="button"
            data-testid="admin-readings-add"
            onClick={() => setModal({ type: 'add' })}
            className="inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-[13px] font-bold text-white cursor-pointer"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            <Plus className="w-4 h-4" />
            Add Reading
          </button>
        </div>
      )}

      {/* Filter card */}
      <div
        className="bg-white rounded-2xl p-4 md:p-5 space-y-3"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        <div className="flex flex-wrap items-center gap-3">
          {/* Date range chips */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Date range
            </span>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['7D', 'Last 7 days'],
                ['30D', 'Last 30 days'],
                ['90D', 'Last 90 days'],
                ['ALL', 'All time'],
              ] as [DateFilter, string][]).map(([key, label]) => {
                const active = dateFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setDateFilter(key)}
                    data-testid={`admin-readings-date-filter-${key}`}
                    className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-primary-purple-light)',
                      color: active ? 'white' : 'var(--brand-primary-purple)',
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Tier filter chips */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Linked alert tier
            </span>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['ALL', 'All'],
                ['BP_L2', 'BP L2'],
                ['TIER_1', 'Tier 1'],
                ['TIER_2', 'Tier 2'],
                ['BP_L1', 'BP L1'],
                ['TIER_3', 'Tier 3'],
              ] as [TierFilter, string][]).map(([key, label]) => {
                const active = tierFilter === key;
                const chrome = key === 'ALL'
                  ? { color: 'var(--brand-primary-purple)', bg: 'var(--brand-primary-purple-light)' }
                  : tierChrome(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setTierFilter(key)}
                    data-testid={`admin-readings-tier-filter-${key}`}
                    className="px-2.5 h-7 rounded-full text-[11px] font-semibold transition-all cursor-pointer"
                    style={{
                      backgroundColor: active ? chrome.color : chrome.bg,
                      color: active ? 'white' : chrome.color,
                      border: `1.5px solid ${active ? chrome.color : 'transparent'}`,
                    }}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

        </div>

        <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
          Showing {filtered.length} of {counts.ALL} {counts.ALL === 1 ? 'reading' : 'readings'}
          {dateFilter !== 'ALL' && <> · {dateFilter === '7D' ? 'last 7 days' : dateFilter === '30D' ? 'last 30 days' : 'last 90 days'}</>}
          {tierFilter !== 'ALL' && <> · {tierChrome(tierFilter).label} alerts only</>}
        </p>
      </div>

      {/* Rejected-reading QA note (Manisha 5/24 Q1) — readings the patient
          tried to log with DBP ≥ SBP were rejected at entry (never persisted)
          to avoid a false Level-2 emergency. Surfaced so a provider can prompt
          a cuff check / re-measurement. */}
      {!loading && rejected.length > 0 && (
        <RejectedReadingsNote rejected={rejected} />
      )}

      {/* List */}
      {loading ? (
        <ReadingsSkeleton />
      ) : error ? (
        <ErrorBanner message={error} />
      ) : filtered.length === 0 ? (
        <EmptyCard hasReadings={entries.length > 0} />
      ) : (
        <div className="space-y-2" data-testid="admin-readings-list">
          {(() => {
            // Bug 15 — flag entries that share a minute so they render HH:MM:SS.
            const secondsIds = sameMinuteCollisionIds(filtered);
            return groupReadingsBySession(filtered).map((g) =>
              g.kind === 'session' ? (
                <SessionGroupCard
                  key={`session-${g.sessionId}`}
                  group={g}
                  secondsIds={secondsIds}
                  onView={(e) => setModal({ type: 'view', entry: e })}
                  onEdit={canManage ? (e) => setModal({ type: 'edit', entry: e }) : undefined}
                  onDelete={canManage ? (e) => setModal({ type: 'delete', entry: e }) : undefined}
                />
              ) : (
                <ReadingCard
                  key={g.entry.id}
                  entry={g.entry}
                  showSeconds={secondsIds.has(g.entry.id)}
                  onView={(e) => setModal({ type: 'view', entry: e })}
                  onEdit={canManage ? (e) => setModal({ type: 'edit', entry: e }) : undefined}
                  onDelete={canManage ? (e) => setModal({ type: 'delete', entry: e }) : undefined}
                />
              ),
            );
          })()}
        </div>
      )}

      {(modal?.type === 'add' || modal?.type === 'edit' || modal?.type === 'view') && (
        <AddEditReadingModal
          patientUserId={patientId}
          entry={modal.type === 'add' ? null : modal.entry}
          viewOnly={modal.type === 'view'}
          canEdit={canManage}
          isPregnant={isPregnant}
          medications={eligibleMeds}
          onClose={() => setModal(null)}
          onSaved={reload}
        />
      )}
      {modal?.type === 'delete' && (
        <DeleteReadingDialog
          patientUserId={patientId}
          entry={modal.entry}
          onClose={() => setModal(null)}
          onDeleted={reload}
        />
      )}
    </div>
  );
}

// ─── Session group ───────────────────────────────────────────────────────────

function SessionGroupCard({
  group,
  secondsIds,
  onView,
  onEdit,
  onDelete,
}: {
  group: Extract<ReadingGroup, { kind: 'session' }>;
  /** Bug 15 — ids whose minute collides with another reading, so the inner
   *  cards render HH:MM:SS. */
  secondsIds?: Set<string>;
  onView?: (entry: PatientJournalEntry) => void;
  onEdit?: (entry: PatientJournalEntry) => void;
  onDelete?: (entry: PatientJournalEntry) => void;
}) {
  const times = group.entries.map((e) => new Date(e.measuredAt).getTime());
  const first = new Date(Math.min(...times)).toISOString();
  const last = new Date(Math.max(...times)).toISOString();

  // Item B — Option D AWAITING + CONFIRMATORY pair. When the two BPs differ a
  // lot, surface a provider-side "Large discrepancy" flag: the first reading may
  // be a measurement error or transient spike rather than a true episode.
  const awaiting = group.entries.find(
    (e) => e.emergencyConfirmation === 'AWAITING' && e.systolicBP != null && e.diastolicBP != null,
  );
  const confirmatory = group.entries.find(
    (e) =>
      e.emergencyConfirmation === 'CONFIRMATORY' &&
      e.systolicBP != null &&
      e.diastolicBP != null &&
      (e.confirmsEntryId == null || e.confirmsEntryId === awaiting?.id),
  );
  const largeDiscrepancy =
    awaiting != null &&
    confirmatory != null &&
    hasLargeDiscrepancy(
      { systolicBP: awaiting.systolicBP!, diastolicBP: awaiting.diastolicBP! },
      { systolicBP: confirmatory.systolicBP!, diastolicBP: confirmatory.diastolicBP! },
    );

  return (
    <div
      data-testid={`admin-readings-session-${group.sessionId}`}
      className="rounded-2xl overflow-hidden"
      style={{
        border: '1.5px solid var(--brand-border)',
        backgroundColor: 'var(--brand-background)',
      }}
    >
      <div
        data-testid="admin-readings-session-header"
        className="px-4 py-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        <Clock className="w-3 h-3" />
        Session: {group.entries.length} readings · {formatTime(first)} – {formatTime(last)}
        {largeDiscrepancy && awaiting && confirmatory && (
          <span
            data-testid="admin-readings-discrepancy-badge"
            className="ml-auto inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor: 'var(--brand-warning-amber-light)',
              color: 'var(--brand-warning-amber-text)',
            }}
            title={`First reading ${awaiting.systolicBP}/${awaiting.diastolicBP}, second reading ${confirmatory.systolicBP}/${confirmatory.diastolicBP}. Possible measurement error or transient spike — review with patient.`}
          >
            <AlertTriangle className="w-3 h-3" />
            Large discrepancy
          </span>
        )}
      </div>
      <div className="px-2 pb-2 space-y-2">
        {group.entries.map((e) => (
          <ReadingCard
            key={e.id}
            entry={e}
            showSeconds={secondsIds?.has(e.id) ?? false}
            onView={onView}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Reading card ──────────────────────────────────────────────────────────

// Kebab (⋯) actions menu — rendered only when the caller passed handlers
// (i.e. the viewer holds a canManageReadings role). Plain useState dropdown;
// closes on action click or via the invisible backdrop.
function ReadingActionsMenu({
  entry,
  onEdit,
  onDelete,
}: {
  entry: PatientJournalEntry;
  onEdit: (entry: PatientJournalEntry) => void;
  onDelete: (entry: PatientJournalEntry) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      {/* stopPropagation throughout — the card itself opens the read-only
          view modal on click; kebab interactions must not bubble into it. */}
      <button
        type="button"
        data-testid={`admin-reading-kebab-${entry.id}`}
        aria-label="Reading actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-7 h-7 rounded-full inline-flex items-center justify-center cursor-pointer"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          {/* Click-away backdrop */}
          <div className="fixed inset-0 z-10" onClick={(e) => { e.stopPropagation(); setOpen(false); }} />
          <div
            role="menu"
            className="absolute right-0 top-8 z-20 w-32 rounded-xl bg-white py-1"
            style={{ boxShadow: 'var(--brand-shadow-card)', border: '1px solid var(--brand-border)' }}
          >
            <button
              type="button"
              role="menuitem"
              data-testid={`admin-reading-edit-${entry.id}`}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(entry); }}
              className="w-full px-3 py-1.5 text-left text-[12.5px] font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-gray-50"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid={`admin-reading-delete-${entry.id}`}
              onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(entry); }}
              className="w-full px-3 py-1.5 text-left text-[12.5px] font-semibold inline-flex items-center gap-2 cursor-pointer hover:bg-gray-50"
              style={{ color: 'var(--brand-alert-red-text)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function ReadingCard({
  entry,
  showSeconds = false,
  onView,
  onEdit,
  onDelete,
}: {
  entry: PatientJournalEntry;
  /** Bug 15 — render HH:MM:SS when this reading shares its minute with another. */
  showSeconds?: boolean;
  onView?: (entry: PatientJournalEntry) => void;
  onEdit?: (entry: PatientJournalEntry) => void;
  onDelete?: (entry: PatientJournalEntry) => void;
}) {
  const trueSymptoms = (
    Object.keys(SYMPTOM_LABELS) as Array<keyof typeof SYMPTOM_LABELS>
  ).filter((k) => entry[k] === true);

  const missedRows: Array<{
    drugName: string; reason?: string | null; missedDoses?: number | null;
  }> = Array.isArray(entry.missedMedications)
    ? (entry.missedMedications as Array<{
        drugName: string; reason?: string | null; missedDoses?: number | null;
      }>)
    : [];

  return (
    <div
      className={`bg-white rounded-2xl p-4 md:p-5${onView ? ' cursor-pointer' : ''}`}
      data-testid={`admin-readings-card-${entry.id}`}
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
      // Card press opens the same modal read-only (view → Edit switch). The
      // kebab and its menu stopPropagation so actions don't double-open it.
      onClick={onView ? () => onView(entry) : undefined}
    >
      {/* Header — date + time + source + suboptimal flag */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1 text-[12.5px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            <Calendar className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
            {formatDate(entry.measuredAt)}
          </span>
          <span
            data-testid={`admin-reading-time-${entry.id}`}
            className="inline-flex items-center gap-1 text-[12px]"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            <Clock className="w-3 h-3" />
            {formatTime(entry.measuredAt, showSeconds)}
          </span>
          <SourcePill source={entry.source} addedByName={entry.addedByName} />
          {entry.suboptimalMeasurement && (
            <span
              className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
              style={{
                backgroundColor: 'var(--brand-warning-amber-light)',
                color: 'var(--brand-warning-amber-text)',
              }}
              title="Patient missed at least one pre-measurement checklist item"
            >
              <AlertTriangle className="w-3 h-3" />
              Suboptimal
            </span>
          )}
        </div>
        {/* Right side: linked alert tier badges + actions kebab. Cluster 8.1
            Gap 5 (Manisha 5/18/26): a brady-surveillance deviation gets a
            distinct amber "Surveillance" pill so the provider sees the
            flagged reading at a glance (the doc's "reading flagged on the
            trend chart" — admin has no chart). */}
        <div className="flex items-center gap-1.5">
        {entry.deviations.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {entry.deviations.map((d) => {
              if (d.ruleId === 'RULE_BRADY_SURVEILLANCE') {
                return (
                  <span
                    key={d.id}
                    data-testid="admin-readings-brady-surveillance-pill"
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'var(--brand-warning-amber-light)',
                      color: 'var(--brand-warning-amber-text)',
                    }}
                    title="Asymptomatic bradycardia surveillance — physician trend review"
                  >
                    <ShieldAlert className="w-3 h-3" />
                    Surveillance
                  </span>
                );
              }
              const chrome = tierChrome(tierBucket(d.tier));
              return (
                <span
                  key={d.id}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: chrome.bg, color: chrome.color }}
                  title={d.tier ?? d.type ?? 'Alert'}
                >
                  <ShieldAlert className="w-3 h-3" />
                  {chrome.label}
                </span>
              );
            })}
          </div>
        )}
        {onEdit && onDelete && (
          <ReadingActionsMenu entry={entry} onEdit={onEdit} onDelete={onDelete} />
        )}
        </div>
      </div>

      {/* Vitals row */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-3">
        <Stat
          label="BP"
          value={
            entry.systolicBP != null && entry.diastolicBP != null
              ? `${entry.systolicBP}/${entry.diastolicBP}`
              : '—'
          }
          unit="mmHg"
          accent="var(--brand-text-primary)"
        />
        <Stat
          label="Pulse"
          value={entry.pulse != null ? String(entry.pulse) : '—'}
          unit="bpm"
        />
        <Stat
          label="Pulse pressure"
          value={entry.pulsePressure != null ? String(entry.pulsePressure) : '—'}
          unit="mmHg"
          accent={
            entry.pulsePressure != null && entry.pulsePressure > 60
              ? 'var(--brand-warning-amber)'
              : undefined
          }
        />
        {entry.position && (
          <Stat label="Position" value={entry.position[0] + entry.position.slice(1).toLowerCase()} />
        )}
        {entry.weight != null && (
          // Weight is stored in kg but shown in lbs (US standard) — matches
          // the patient readings page and the reading modal.
          <Stat
            label="Weight"
            value={kgToLbs(entry.weight).toFixed(1)}
            unit="lbs"
            icon={<WeightIcon className="w-3 h-3" />}
          />
        )}
        {entry.singleReadingFinalized && (
          // Cluster 6 Q2 (Manisha 5/9/26) — flag readings where the engine
          // had to fire on a single-reading session (5-min timeout finalized
          // before a second reading landed). Provider should treat the
          // threshold cross as provisional until next session.
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{
              // Chip pattern: amber-light bg + amber-800 chip text + vibrant
              // amber-500 border. Author previously used the non-existent
              // `--brand-warning-amber-bg` token (fell back to hex) and put
              // the BG-role `--brand-warning-amber` token as the text color;
              // after §B's revert to vibrant orange-500, that paired the chip
              // bg with vibrant-orange text → 3.31:1, failing AA Normal.
              backgroundColor: 'var(--brand-warning-amber-light)',
              color: 'var(--brand-warning-amber-text)',
              border: '1px solid var(--brand-warning-amber)',
            }}
            title="Threshold crossed on an unaveraged reading. Confirm with next session."
          >
            <Clock className="w-3 h-3" />
            Single-reading session
          </span>
        )}
      </div>

      {/* Narrow pulse-pressure artifact (Manisha 5/24 Q1) — PP < 15 at entry;
          physician-only flag, possible measurement artifact, no alert tier. */}
      {entry.narrowPpArtifact && (
        <div
          className="mb-3 inline-flex items-start gap-1.5 text-[11.5px] px-2.5 py-1.5 rounded-lg"
          data-testid={`admin-readings-narrow-pp-${entry.id}`}
          style={{
            backgroundColor: 'var(--brand-warning-amber-light)',
            color: 'var(--brand-warning-amber-text)',
          }}
        >
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>Narrow pulse pressure (&lt;15 mmHg) — possible measurement artifact.</span>
        </div>
      )}

      {/* Medication row */}
      {(entry.medicationTaken != null || missedRows.length > 0) && (
        <div className="mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
              Medication
            </span>
            {entry.medicationTaken === true && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-success-green-light)',
                  color: 'var(--brand-success-green)',
                }}
              >
                <CheckCircle2 className="w-3 h-3" />
                Taken
              </span>
            )}
            {entry.medicationTaken === false && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red-text)',
                }}
              >
                <XCircle className="w-3 h-3" />
                Not taken
              </span>
            )}
            {entry.medicationTaken == null && (
              <span className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                Not asked
              </span>
            )}
          </div>
          {missedRows.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {missedRows.map((m, i) => (
                <li
                  key={i}
                  className="text-[12px] inline-flex items-center gap-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  <Pill className="w-3 h-3 shrink-0" style={{ color: 'var(--brand-alert-red)' }} />
                  <span className="font-semibold">{m.drugName}</span>
                  {m.missedDoses != null && (
                    <span style={{ color: 'var(--brand-text-muted)' }}>
                      · {m.missedDoses} {m.missedDoses === 1 ? 'dose' : 'doses'} missed
                    </span>
                  )}
                  {m.reason && (
                    <span style={{ color: 'var(--brand-text-muted)' }}>
                      · {m.reason}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Symptom flags */}
      {(trueSymptoms.length > 0 || entry.otherSymptoms.length > 0) && (
        <div className="mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--brand-text-muted)' }}>
            Symptoms
          </span>
          <div className="flex flex-wrap gap-1.5">
            {trueSymptoms.map((k) => (
              <span
                key={k}
                className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red-text)',
                }}
              >
                <Activity className="w-3 h-3" />
                {SYMPTOM_LABELS[k]}
              </span>
            ))}
            {entry.otherSymptoms.map((s, i) => (
              <span
                key={`other-${i}`}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-background)',
                  color: 'var(--brand-text-secondary)',
                  border: '1px solid var(--brand-border)',
                }}
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Suboptimal — failed checklist items */}
      {entry.suboptimalMeasurement && entry.failedConditions.length > 0 && (
        <div className="mb-3">
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1.5" style={{ color: 'var(--brand-warning-amber-text)' }}>
            Failed checklist items
          </span>
          <div className="flex flex-wrap gap-1.5">
            {entry.failedConditions.map((c) => (
              <span
                key={c}
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  color: 'var(--brand-warning-amber-text)',
                }}
              >
                {CONDITION_LABELS[c] ?? c}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {entry.notes && (
        <div
          className="text-[12px] leading-relaxed pt-2"
          style={{
            color: 'var(--brand-text-secondary)',
            borderTop: '1px solid var(--brand-border)',
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: 'var(--brand-text-muted)' }}>
            Patient notes
          </span>
          {entry.notes}
        </div>
      )}
    </div>
  );
}

// ─── Atoms ─────────────────────────────────────────────────────────────────

function Stat({
  label,
  value,
  unit,
  accent,
  icon,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col">
      <span
        className="text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1"
        style={{ color: 'var(--brand-text-muted)' }}
      >
        {icon}
        {label}
      </span>
      <span
        className="text-[14px] font-bold leading-tight"
        style={{ color: accent ?? 'var(--brand-text-primary)' }}
      >
        {value}
        {unit && (
          <span className="text-[11px] font-normal ml-1" style={{ color: 'var(--brand-text-muted)' }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  );
}

function SourcePill({ source, addedByName }: { source: string; addedByName?: string | null }) {
  const isHealthkit = source === 'healthkit';
  // Admin-entered reading (source = ADMIN, JournalEntry.addedByUserId set) —
  // purple staff chip with the actor's name so the card reads as a
  // clinic-floor entry at a glance.
  if (source === 'admin') {
    return (
      <span
        data-testid="admin-readings-staff-pill"
        className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
        style={{
          backgroundColor: 'var(--brand-primary-purple-light)',
          color: 'var(--brand-primary-purple)',
          border: '1px solid var(--brand-primary-purple-light)',
        }}
        title={addedByName ? `Entered by ${addedByName}` : 'Entered by care-team staff'}
      >
        <Stethoscope className="w-3 h-3" />
        {addedByName ? `Staff · ${addedByName}` : 'Staff'}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-full"
      style={{
        backgroundColor: isHealthkit ? 'var(--brand-accent-teal-light)' : 'var(--brand-background)',
        color: isHealthkit ? 'var(--brand-accent-teal)' : 'var(--brand-text-secondary)',
        border: `1px solid ${isHealthkit ? 'var(--brand-accent-teal-light)' : 'var(--brand-border)'}`,
      }}
    >
      {isHealthkit ? <Smartphone className="w-3 h-3" /> : null}
      {isHealthkit ? 'HealthKit' : 'Manual'}
    </span>
  );
}

function ReadingsSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="bg-white rounded-2xl p-5 animate-pulse"
          style={{ boxShadow: 'var(--brand-shadow-card)' }}
        >
          <div className="h-3 w-40 rounded-full mb-3" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="h-5 w-64 rounded-full mb-2" style={{ backgroundColor: '#EDE9F6' }} />
          <div className="h-3 w-72 rounded-full" style={{ backgroundColor: '#F3EEFB' }} />
        </div>
      ))}
    </div>
  );
}

function EmptyCard({ hasReadings }: { hasReadings: boolean }) {
  return (
    <div
      className="bg-white rounded-2xl p-8 text-center"
      data-testid="admin-readings-empty"
      style={{ boxShadow: 'var(--brand-shadow-card)' }}
    >
      <div
        className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
        style={{ backgroundColor: 'var(--brand-background)' }}
      >
        <Activity className="w-7 h-7" style={{ color: 'var(--brand-text-muted)' }} />
      </div>
      <p className="text-[14px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
        {hasReadings ? 'No readings match your filters' : 'No readings yet'}
      </p>
      <p className="text-[12px] mt-1" style={{ color: 'var(--brand-text-muted)' }}>
        {hasReadings
          ? 'Widen the date range or clear the tier filter.'
          : "This patient hasn't logged any blood-pressure readings."}
      </p>
    </div>
  );
}

function RejectedReadingsNote({ rejected }: { rejected: RejectedReading[] }) {
  const latest = rejected[0];
  return (
    <div
      className="bg-white rounded-2xl p-4 flex items-start gap-3"
      data-testid="admin-readings-rejected-note"
      style={{
        boxShadow: 'var(--brand-shadow-card)',
        borderLeft: '4px solid var(--brand-warning-amber)',
      }}
    >
      <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-warning-amber)' }} />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
          {rejected.length} physiologically implausible {rejected.length === 1 ? 'reading' : 'readings'} rejected at entry
        </p>
        <p className="text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          The patient attempted to log {rejected.length === 1 ? 'a reading' : 'readings'} where the bottom
          number was not below the top number. These were not saved and did not
          trigger alerts. Consider prompting a cuff check or re-measurement.
        </p>
        {latest && (latest.systolicBP != null || latest.diastolicBP != null) && (
          <p className="text-[11.5px] mt-1.5" style={{ color: 'var(--brand-text-muted)' }}>
            Most recent: {latest.systolicBP ?? '—'}/{latest.diastolicBP ?? '—'} mmHg · {formatDate(latest.createdAt)} {formatTime(latest.createdAt)}
          </p>
        )}
      </div>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="bg-white rounded-2xl p-4 flex items-start gap-3"
      style={{
        boxShadow: 'var(--brand-shadow-card)',
        borderLeft: '4px solid var(--brand-alert-red)',
      }}
      role="alert"
    >
      <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--brand-alert-red)' }} />
      <div className="flex-1">
        <p className="text-[13px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
          Couldn&apos;t load readings
        </p>
        <p className="text-[11.5px] mt-0.5" style={{ color: 'var(--brand-text-secondary)' }}>{message}</p>
      </div>
    </div>
  );
}
