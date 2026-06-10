'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  Pencil,
  Trash2,
  X,
  Activity,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Layers,
} from 'lucide-react';
import {
  getJournalEntries,
  updateJournalEntry,
  deleteJournalEntry,
} from '@/lib/services/journal.service';
import { getMyPatientProfile } from '@/lib/services/intake.service';
import {
  listMyMedications,
  type PatientMedication,
} from '@/lib/services/patient-medications.service';
import { getBMI, JOURNAL_NOTE_MAX_LENGTH } from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';
import AudioButton from '@/components/intake/AudioButton';
import MicButton from '@/components/intake/MicButton';
import BpPhotoButton from '@/components/intake/BpPhotoButton';
import SymptomTagInput from '@/components/intake/SymptomTagInput';
import { kgToLbs, lbsToKg } from '@/lib/units';

type TFn = (key: TranslationKey) => string;

// ─── Types ────────────────────────────────────────────────────────────────────
type Entry = {
  id: string;
  /** ISO 8601 UTC timestamp — replaces v1 entryDate + measurementTime. */
  measuredAt: string;
  /** Groups multiple readings (≤30 min apart) for averaging. */
  sessionId?: string | null;
  systolicBP?: number;
  diastolicBP?: number;
  pulse?: number | null;
  weight?: number;
  position?: 'SITTING' | 'STANDING' | 'LYING' | null;
  medicationTaken?: boolean | null;
  medicationScheduledLater?: boolean;
  missedDoses?: number | null;
  /** Per-medication miss detail. Stored as JSON on the journal entry. */
  missedMedications?: Array<{
    medicationId?: string;
    drugName?: string;
    drugClass?: string;
    reason?: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER' | null;
    missedDoses?: number;
  }> | null;
  /** Per-medication status snapshot for every answered med (taken / missed /
   *  not due yet). Authoritative source for reconstructing the edit modal — the
   *  aggregate flags can't disambiguate mixed answers. Null on legacy rows. */
  medicationStatuses?: Array<{
    medicationId?: string;
    drugName?: string;
    drugClass?: string;
    taken?: 'yes' | 'no' | 'scheduledLater';
    reason?: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER' | null;
    missedDoses?: number;
  }> | null;
  // V2 structured Level-2 symptom booleans (mirror backend serializeEntry).
  severeHeadache?: boolean;
  visualChanges?: boolean;
  alteredMentalStatus?: boolean;
  chestPainOrDyspnea?: boolean;
  focalNeuroDeficit?: boolean;
  severeEpigastricPain?: boolean;
  // Cluster 6/7/8 symptoms — same set the check-in surfaces.
  dizziness?: boolean;
  syncope?: boolean;
  palpitations?: boolean;
  legSwelling?: boolean;
  fatigue?: boolean;
  shortnessOfBreath?: boolean;
  dryCough?: boolean;
  faceSwelling?: boolean;
  throatTightness?: boolean;
  newOnsetHeadache?: boolean;
  ruqPain?: boolean;
  edema?: boolean;
  /** Legacy freeform symptoms (v1). v2 uses structured booleans + otherSymptoms. */
  symptoms?: string[];
  otherSymptoms?: string[];
  notes?: string;
};

type SymptomKey =
  | 'severeHeadache'
  | 'visualChanges'
  | 'alteredMentalStatus'
  | 'chestPainOrDyspnea'
  | 'focalNeuroDeficit'
  | 'severeEpigastricPain'
  | 'dizziness'
  | 'syncope'
  | 'palpitations'
  | 'legSwelling'
  | 'fatigue'
  | 'shortnessOfBreath'
  | 'dryCough'
  | 'faceSwelling'
  | 'throatTightness'
  | 'newOnsetHeadache'
  | 'ruqPain'
  | 'edema';

type MissedReason = 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER';

type MedEntry = {
  taken: 'yes' | 'no' | 'scheduledLater' | null;
  reason: MissedReason | null;
  missedDoses: number;
};

const DEFAULT_MED_ENTRY: MedEntry = { taken: null, reason: null, missedDoses: 1 };

type EditForm = {
  /** Split date + time so the patient sees two clean pickers (cleaner than
      datetime-local on small screens). Combined into ISO 8601 at save time. */
  measuredDate: string; // YYYY-MM-DD
  measuredTime: string; // HH:mm
  position: 'SITTING' | 'STANDING' | 'LYING' | '';
  systolic: string;
  diastolic: string;
  pulse: string;
  weight: string;
  /** Per-medication adherence keyed by medicationId — mirrors CheckIn's
   *  StepMedication so the editor shows every active med with its selected
   *  status (taken / missed / not due yet) and lets the patient change each. */
  medicationStatus: Record<string, MedEntry>;
  // V2 structured symptoms — checkbox grid in the modal
  severeHeadache: boolean;
  visualChanges: boolean;
  alteredMentalStatus: boolean;
  chestPainOrDyspnea: boolean;
  focalNeuroDeficit: boolean;
  severeEpigastricPain: boolean;
  dizziness: boolean;
  syncope: boolean;
  palpitations: boolean;
  legSwelling: boolean;
  fatigue: boolean;
  shortnessOfBreath: boolean;
  dryCough: boolean;
  faceSwelling: boolean;
  throatTightness: boolean;
  newOnsetHeadache: boolean;
  ruqPain: boolean;
  edema: boolean;
  /** Patient-typed custom symptom chips → JournalEntry.otherSymptoms. */
  otherSymptoms: string[];
  /** Free-text note → JournalEntry.notes. */
  notes: string;
};

const SYMPTOM_KEYS: SymptomKey[] = [
  'severeHeadache',
  'visualChanges',
  'alteredMentalStatus',
  'chestPainOrDyspnea',
  'focalNeuroDeficit',
  'severeEpigastricPain',
  'dizziness',
  'syncope',
  'palpitations',
  'legSwelling',
  'fatigue',
  'shortnessOfBreath',
  'dryCough',
  'faceSwelling',
  'throatTightness',
  'newOnsetHeadache',
  'ruqPain',
  'edema',
];

// Pregnancy-specific symptoms (CheckIn B3) — only relevant to a pregnant
// patient, so they're hidden from everyone else (e.g. male accounts) in the
// edit modal, matching the patient check-in flow.
const PREGNANCY_SYMPTOM_KEYS: SymptomKey[] = ['newOnsetHeadache', 'ruqPain', 'edema'];

// Symptom labels reuse Flow B's reviewer-approved copy (checkin.b3.symptom*)
// so intake and readings present identical wording in every locale.
const SYMPTOM_LABEL_KEYS: Record<SymptomKey, TranslationKey> = {
  severeHeadache: 'checkin.b3.symptomSevereHeadache',
  visualChanges: 'checkin.b3.symptomVision',
  alteredMentalStatus: 'checkin.b3.symptomConfusion',
  chestPainOrDyspnea: 'checkin.b3.symptomChestPain',
  focalNeuroDeficit: 'checkin.b3.symptomNeuro',
  severeEpigastricPain: 'checkin.b3.symptomStomach',
  dizziness: 'checkin.b3.symptomDizziness',
  syncope: 'checkin.b3.symptomSyncope',
  palpitations: 'checkin.b3.symptomPalpitations',
  legSwelling: 'checkin.b3.symptomLegSwelling',
  fatigue: 'checkin.b3.symptomFatigue',
  shortnessOfBreath: 'checkin.b3.symptomShortnessOfBreath',
  dryCough: 'checkin.b3.symptomDryCough',
  faceSwelling: 'checkin.b3.symptomFaceSwelling',
  throatTightness: 'checkin.b3.symptomThroatTightness',
  newOnsetHeadache: 'checkin.b3.symptomNewHeadache',
  ruqPain: 'checkin.b3.symptomRuq',
  edema: 'checkin.b3.symptomEdema',
};

/** CheckIn-style validation. Returns first error or null when OK.
 *  Reuses checkin.err.* keys from Flow B for the 7 shared concepts so that
 *  intake and readings-edit share identical phrasing per locale — Flow B's
 *  strings went through native-speaker review. bpBoth (edit-only affordance)
 *  and weightRange (not collected on Flow B) stay under readings.validate.*. */
function validateEditForm(f: EditForm, t: TFn): string | null {
  if (!f.measuredDate || !f.measuredTime) return t('checkin.err.dateTime');
  const dt = new Date(`${f.measuredDate}T${f.measuredTime}`);
  if (isNaN(dt.getTime())) return t('checkin.err.dateInvalid');
  const now = Date.now();
  // A future *day* gets a date-specific message; a same-day time past now
  // (beyond the 5-min clock-skew grace) keeps the time-specific message.
  if (f.measuredDate > localDateKey(new Date().toISOString())) return t('checkin.err.dateFuture');
  if (dt.getTime() > now + 5 * 60 * 1000) return t('checkin.err.timeFuture');
  if (dt.getTime() < now - 30 * 24 * 60 * 60 * 1000) return t('checkin.err.timeOld');
  // BP — both required if either entered
  if ((f.systolic && !f.diastolic) || (!f.systolic && f.diastolic)) {
    return t('readings.validate.bpBoth');
  }
  if (f.systolic && f.diastolic) {
    const sys = parseInt(f.systolic, 10);
    const dia = parseInt(f.diastolic, 10);
    if (sys < 60 || sys > 250) return t('checkin.err.systolic');
    if (dia < 40 || dia > 150) return t('checkin.err.diastolic');
  }
  if (f.pulse) {
    const p = parseInt(f.pulse, 10);
    if (p < 30 || p > 220) return t('checkin.err.pulse');
  }
  if (f.weight) {
    const w = parseFloat(f.weight);
    if (w < 20 || w > 600) return t('readings.validate.weightRange');
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Legacy v1 freeform symptom list — replaced by SYMPTOM_KEYS structured
// booleans below. Kept here only as a reference of which strings might appear
// in the read-only `entry.symptoms` array on legacy rows.

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Grouping key in the patient's LOCAL timezone. Bucketing on
// `measuredAt.split('T')[0]` (the UTC date) pushes late-evening readings into
// the next day and disagrees with each card's date (which renders in local
// time), so derive Y-M-D from the local Date instead.
function localDateKey(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Reconstruct per-medication adherence for the edit modal from the entry's
// stored rollup (medicationTaken / medicationScheduledLater) + the
// missedMedications JSON snapshot. That snapshot only lists MISSED meds, so an
// active med absent from it is assumed taken when the reading recorded an
// explicit answer; "not due yet" applies when the whole reading was flagged
// scheduled-later; otherwise the med is left unanswered.
function buildMedStatus(
  entry: Entry,
  meds: { id: string }[],
): Record<string, MedEntry> {
  // Preferred path: the per-med status snapshot records each med's exact answer
  // (yes / no / not due yet), so no guessing is needed. Only present on entries
  // saved after the medicationStatuses column shipped.
  if (entry.medicationStatuses && entry.medicationStatuses.length > 0) {
    const byId = new Map<string, NonNullable<Entry['medicationStatuses']>[number]>();
    for (const s of entry.medicationStatuses) {
      if (s.medicationId) byId.set(s.medicationId, s);
    }
    const status: Record<string, MedEntry> = {};
    for (const med of meds) {
      const snap = byId.get(med.id);
      status[med.id] = snap?.taken
        ? {
            taken: snap.taken,
            reason: (snap.reason as MissedReason | null) ?? null,
            missedDoses: snap.missedDoses ?? 1,
          }
        : { taken: null, reason: null, missedDoses: 1 };
    }
    return status;
  }

  // Legacy fallback: reconstruct from the aggregate flags + missedMedications
  // snapshot. This can't disambiguate "med A taken, med B not due yet" — that's
  // exactly why medicationStatuses was added — but keeps old rows usable.
  const missedById = new Map<string, NonNullable<Entry['missedMedications']>[number]>();
  for (const m of entry.missedMedications ?? []) {
    if (m.medicationId) missedById.set(m.medicationId, m);
  }
  const status: Record<string, MedEntry> = {};
  for (const med of meds) {
    const missed = missedById.get(med.id);
    if (missed) {
      status[med.id] = {
        taken: 'no',
        reason: (missed.reason as MissedReason | null) ?? null,
        missedDoses: missed.missedDoses ?? 1,
      };
    } else if (entry.medicationScheduledLater) {
      status[med.id] = { taken: 'scheduledLater', reason: null, missedDoses: 1 };
    } else if (entry.medicationTaken === true || entry.medicationTaken === false) {
      status[med.id] = { taken: 'yes', reason: null, missedDoses: 1 };
    } else {
      status[med.id] = { taken: null, reason: null, missedDoses: 1 };
    }
  }
  return status;
}

// Phase/26 TTS pass 2 — humanise the reading audio summary into a single
// flowing paragraph rather than period-separated fragments. Reused by
// EntryCard and the EditModal's audio button so the patient hears the
// same prose style on the list and the edit sheet.
type ReadingShape = {
  measuredAt: string;
  systolicBP: number | null | undefined;
  diastolicBP: number | null | undefined;
  pulse: number | null | undefined;
  position: 'SITTING' | 'STANDING' | 'LYING' | '' | null | undefined;
  weight: number | null | undefined;
  bmi: number | null | undefined;
  medicationTaken: boolean | null | undefined;
  symptomCount: number;
  notes: string | null | undefined;
};

function humanizeReading(r: ReadingShape, t: TFn): string {
  try {
    const parts: string[] = [];
    const dt = new Date(r.measuredAt);
    const day = formatDate(r.measuredAt);
    const time = !Number.isNaN(dt.getTime())
      ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
      : '';
    const opener = time
      ? `On ${day} at ${time}, you logged a reading.`
      : `On ${day}, you logged a reading.`;
    parts.push(opener);

    if (r.systolicBP != null && r.diastolicBP != null) {
      let bp = `Your blood pressure was ${r.systolicBP} over ${r.diastolicBP}`;
      if (r.pulse != null) bp += `, with a pulse of ${r.pulse} beats per minute`;
      bp += '.';
      parts.push(bp);
    } else if (r.pulse != null) {
      parts.push(`Your pulse was ${r.pulse} beats per minute.`);
    }

    const positionLabel =
      r.position === 'SITTING'
        ? t('checkin.b2.positionSitting').toLowerCase()
        : r.position === 'STANDING'
          ? t('checkin.b2.positionStanding').toLowerCase()
          : r.position === 'LYING'
            ? t('checkin.b2.positionLying').toLowerCase()
            : null;

    const weightSentencePieces: string[] = [];
    if (positionLabel) weightSentencePieces.push(`You were ${positionLabel}`);
    if (r.weight != null) weightSentencePieces.push(`weighing ${kgToLbs(r.weight)} pounds`);
    if (r.bmi != null) weightSentencePieces.push(`with a BMI of ${r.bmi.toFixed(1)}`);
    if (weightSentencePieces.length > 0) {
      parts.push(`${weightSentencePieces.join(', ')}.`);
    }

    if (r.medicationTaken === true) parts.push('You took your medications.');
    else if (r.medicationTaken === false) parts.push('You missed at least one medication.');

    if (r.symptomCount > 0) {
      parts.push(
        `You reported ${r.symptomCount} symptom${r.symptomCount > 1 ? 's' : ''}.`,
      );
    } else {
      parts.push('You reported no symptoms.');
    }

    if (r.notes?.trim()) {
      parts.push(`You noted: ${r.notes.trim()}.`);
    }

    return parts.join(' ');
  } catch {
    return formatDate(r.measuredAt);
  }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────
function Bone({ w, h, rounded = 'rounded-lg' }: { w: number | string; h: number; rounded?: string }) {
  return (
    <div
      className={`animate-pulse ${rounded} shrink-0`}
      style={{ width: w, height: h, backgroundColor: '#EDE9F6' }}
    />
  );
}

function EntrySkeleton() {
  return (
    <div
      className="bg-white rounded-2xl p-5"
      style={{ boxShadow: '0 1px 12px rgba(123,0,224,0.06)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-3">
          <Bone w={130} h={12} />
          <div className="flex items-center gap-3">
            <Bone w={100} h={34} rounded="rounded-xl" />
            <Bone w={64} h={22} rounded="rounded-full" />
          </div>
          <div className="flex gap-2">
            <Bone w={72} h={18} rounded="rounded-md" />
            <Bone w={88} h={18} rounded="rounded-md" />
          </div>
        </div>
        <div className="flex gap-2 shrink-0">
          <Bone w={32} h={32} rounded="rounded-full" />
          <Bone w={32} h={32} rounded="rounded-full" />
        </div>
      </div>
    </div>
  );
}

// ─── Entry Card ───────────────────────────────────────────────────────────────
function EntryCard({
  entry,
  heightCm,
  onView,
  onEdit,
  onDelete,
}: {
  entry: Entry;
  /** From PatientProfile.heightCm — fixed at intake. Used to compute BMI
   *  next to the weight chip. Optional — when missing, BMI is hidden. */
  heightCm: number | null;
  /** Tapping the card body (not an action button) opens the read-only detail. */
  onView: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const hasBP = entry.systolicBP && entry.diastolicBP;
  // Bug 37 — chat's log_symptom_quick funnels symptom-only logs through
  // journal.create (so the rule engine sees the symptom boolean). Those
  // entries land in My Readings with no BP. Pre-fix they appeared as
  // confusing "No BP recorded" rows that looked like phantom BP readings.
  // Detect them by shape and render with a "Symptom log" badge instead.
  const trueStructuredSymptoms = SYMPTOM_KEYS.filter((k) => entry[k]);
  const otherSymptomsCount = entry.otherSymptoms?.length ?? 0;
  const isSymptomOnlyLog =
    !hasBP && (trueStructuredSymptoms.length > 0 || otherSymptomsCount > 0);
  // BMI is read-only and only shown when both weight AND height exist.
  // Pulse pressure is intentionally NOT rendered on the patient app per
  // Niva — patients shouldn't see clinical signals they can't action.
  const bmi = getBMI(heightCm, entry.weight);

  // Phase/26 TTS pass 2 — single humanised paragraph, composed via the
  // shared `humanizeReading` helper so EntryCard and EditModal speak in
  // the same prose style.
  const structuredSymptomCount = SYMPTOM_KEYS.reduce(
    (n, k) => (entry[k] ? n + 1 : n),
    0,
  );
  const legacySymptomCount = entry.symptoms?.length ?? 0;
  const audioSummary = humanizeReading(
    {
      measuredAt: entry.measuredAt,
      systolicBP: entry.systolicBP ?? null,
      diastolicBP: entry.diastolicBP ?? null,
      pulse: entry.pulse ?? null,
      position: entry.position ?? null,
      weight: entry.weight ?? null,
      bmi,
      medicationTaken: entry.medicationTaken ?? null,
      symptomCount: structuredSymptomCount + legacySymptomCount,
      notes: entry.notes ?? null,
    },
    t,
  );

  return (
    <motion.div
      data-testid={`readings-row-${entry.id}`}
      role="button"
      tabIndex={0}
      onClick={onView}
      onKeyDown={(e) => {
        // Only the card itself opens detail — not Enter/Space forwarded from a
        // focused inner action button (those handle their own keys).
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onView();
        }
      }}
      aria-label={t('readings.viewDetails')}
      className="bg-white rounded-2xl p-5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)]"
      style={{ boxShadow: '0 1px 12px rgba(123,0,224,0.06)' }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      layout
    >
      {/* Header row: date + time on the left, actions on the right. Keeping the
          actions here (instead of a fixed side column) lets the BP value and
          the detail chips use the full card width, so the chips wrap nicely on
          mobile rather than stacking one-per-line in a squeezed column. */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <p
            data-testid="reading-row-date"
            className="text-[12px] font-semibold"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {formatDate(entry.measuredAt)}
          </p>
          {(() => {
            const dt = new Date(entry.measuredAt);
            if (isNaN(dt.getTime())) return null;
            const hh = String(dt.getHours()).padStart(2, '0');
            const mi = String(dt.getMinutes()).padStart(2, '0');
            return (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {`${hh}:${mi}`}
              </span>
            );
          })()}
        </div>

        {/* Actions — stop click bubbling so tapping these doesn't also open
            the detail view (which the card body's onClick handles). */}
        <div
          className="flex items-center gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <AudioButton size="sm" text={audioSummary} />
          <button
            onClick={onEdit}
            className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-75"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            aria-label={t('accessibility.editReading')}
          >
            <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
          </button>
          <button
            data-testid={`readings-delete-button-${entry.id}`}
            onClick={onDelete}
            className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-75"
            style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
            aria-label={t('accessibility.deleteReading')}
          >
            <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--brand-alert-red)' }} />
          </button>
        </div>
      </div>

      {/* BP reading */}
      {hasBP ? (
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <div className="flex items-baseline gap-0.5">
                <span className="text-[30px] font-bold leading-none" style={{ color: 'var(--brand-text-primary)' }}>
                  {entry.systolicBP}
                </span>
                <span className="text-[18px] font-semibold mx-1" style={{ color: 'var(--brand-text-muted)' }}>
                  /
                </span>
                <span className="text-[30px] font-bold leading-none" style={{ color: 'var(--brand-text-primary)' }}>
                  {entry.diastolicBP}
                </span>
                <span className="text-[12px] ml-1.5" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('readings.mmHg')}
                </span>
              </div>
            </div>
          ) : isSymptomOnlyLog ? (
            // Bug 37 — symptom-only entries get a distinct red badge + the
            // symptom name(s) as the headline. Patient understands this is a
            // symptom log, not a BP reading with broken values.
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <span
                className="text-[11px] px-2 py-0.5 rounded-full font-semibold uppercase tracking-wider"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red)',
                }}
              >
                {t('readings.symptomLog')}
              </span>
              {trueStructuredSymptoms.length > 0 && (
                <span className="text-[15px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  {trueStructuredSymptoms
                    .map((k) => t(SYMPTOM_LABEL_KEYS[k]))
                    .join(', ')}
                </span>
              )}
              {trueStructuredSymptoms.length === 0 && otherSymptomsCount > 0 && (
                <span className="text-[15px] font-semibold" style={{ color: 'var(--brand-text-primary)' }}>
                  {entry.otherSymptoms?.join(', ')}
                </span>
              )}
            </div>
          ) : (
            <p className="text-[13px] mb-2" style={{ color: 'var(--brand-text-muted)' }}>
              {t('readings.noBpRecorded')}
            </p>
          )}

          {/* Detail chips — pulse, weight, BMI, position, meds, symptoms.
              Pulse pressure is intentionally hidden on the patient app per
              Niva's spec sign-off (patients shouldn't see clinical signals
              they can't action). It's still computed + visible to the
              admin/provider on the patient detail screen. */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {entry.pulse != null && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1"
                style={{
                  backgroundColor: 'var(--brand-accent-teal-light)',
                  color: 'var(--brand-accent-teal)',
                }}
              >
                ♥ {entry.pulse} {t('readings.bpm')}
              </span>
            )}
            {entry.position && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: '#F1F5F9',
                  color: 'var(--brand-text-secondary)',
                }}
              >
                {entry.position === 'SITTING' ? t('checkin.b2.positionSitting') : entry.position === 'STANDING' ? t('checkin.b2.positionStanding') : t('checkin.b2.positionLying')}
              </span>
            )}
            {entry.weight != null && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {kgToLbs(entry.weight)} {t('readings.lbs')}
              </span>
            )}
            {bmi != null && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
                title="BMI = weight ÷ height² (computed from your intake-time height)"
              >
                BMI {bmi.toFixed(1)}
              </span>
            )}
            {entry.medicationTaken != null && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: entry.medicationTaken
                    ? 'var(--brand-success-green-light)'
                    : 'var(--brand-warning-amber-light)',
                  color: entry.medicationTaken
                    ? 'var(--brand-success-green)'
                    : 'var(--brand-warning-amber)',
                }}
              >
                {t('readings.meds')}: {entry.medicationTaken ? t('readings.taken') : t('readings.missed')}
              </span>
            )}
            {entry.symptoms && entry.symptoms.length > 0 && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium flex items-center gap-1"
                style={{
                  backgroundColor: 'var(--brand-alert-red-light)',
                  color: 'var(--brand-alert-red-text)',
                }}
              >
                <AlertTriangle aria-hidden="true" className="w-3 h-3" />
                {entry.symptoms.length} symptom{entry.symptoms.length > 1 ? 's' : ''}
              </span>
            )}
            {entry.notes && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-accent-teal-light)',
                  color: 'var(--brand-accent-teal)',
                }}
              >
                {t('readings.note')}
              </span>
            )}
          </div>

          {/* Custom symptoms — patient-typed (otherSymptoms). Captioned + given
              a distinct amber tone so they don't read like the purple weight /
              BMI chips above. */}
          {entry.otherSymptoms && entry.otherSymptoms.length > 0 && (
            <div className="mt-2.5">
              <p
                className="text-[10px] font-bold uppercase tracking-wider mb-1"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {t('readings.otherSymptoms')}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {entry.otherSymptoms.map((s, i) => (
                  <span
                    key={`${s}-${i}`}
                    className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                    style={{
                      backgroundColor: 'var(--brand-warning-amber-light)',
                      color: 'var(--brand-warning-amber-text)',
                    }}
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Notes preview — clamped to 2 lines (ellipsis) on the card; the
              full note shows in the detail modal. */}
          {entry.notes && (
            <p
              className="text-[12px] mt-2.5 leading-relaxed line-clamp-2 break-words"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              &ldquo;{entry.notes}&rdquo;
            </p>
          )}
    </motion.div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────
// Wraps 2+ readings taken within the same session (≤5 min, same sessionId)
// in a collapsible shell. Header shows the average BP and reading count;
// expanding renders the individual EntryCards inside. Solo readings render
// as a plain EntryCard (no shell) so the list doesn't feel over-decorated.
function SessionCard({
  entries,
  heightCm,
  onView,
  onEdit,
  onDelete,
}: {
  entries: Entry[];
  heightCm: number | null;
  onView: (e: Entry) => void;
  onEdit: (e: Entry) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);

  // Average across readings that have BP. If none have BP, fall back to
  // showing a count-only header.
  const withBp = entries.filter((e) => e.systolicBP != null && e.diastolicBP != null);
  const avgSys = withBp.length
    ? Math.round(withBp.reduce((s, e) => s + (e.systolicBP ?? 0), 0) / withBp.length)
    : null;
  const avgDia = withBp.length
    ? Math.round(withBp.reduce((s, e) => s + (e.diastolicBP ?? 0), 0) / withBp.length)
    : null;

  const earliest = entries[entries.length - 1]?.measuredAt;
  const latest = entries[0]?.measuredAt;
  const span = (() => {
    if (!earliest || !latest) return '';
    const a = new Date(earliest).getTime();
    const b = new Date(latest).getTime();
    const min = Math.round(Math.abs(b - a) / 60000);
    return min > 0 ? `${min} min` : t('readings.sameMinute');
  })();

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl overflow-hidden"
      style={{
        backgroundColor: 'var(--brand-primary-purple-light)',
        border: '1.5px solid rgba(123,0,224,0.2)',
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer"
        aria-expanded={expanded}
      >
        <div
          className="shrink-0 rounded-xl flex items-center justify-center text-white"
          style={{ width: 36, height: 36, backgroundColor: 'var(--brand-primary-purple)' }}
        >
          <Layers className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--brand-primary-purple)' }}
          >
            {t('readings.sessionReadings').replace('{count}', String(entries.length))}{span ? ` · ${span}` : ''}
          </p>
          <p
            className="text-[14px] font-bold leading-tight"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {avgSys != null && avgDia != null ? (
              <>
                {t('readings.avg')} <span>{avgSys}/{avgDia}</span>{' '}
                <span className="text-[11px] font-medium" style={{ color: 'var(--brand-text-muted)' }}>
                  {t('readings.mmHg')}
                </span>
              </>
            ) : (
              <>{t('readings.readingsCount').replace('{count}', String(entries.length))}</>
            )}
          </p>
        </div>
        <div className="shrink-0" style={{ color: 'var(--brand-primary-purple)' }}>
          {expanded ? <ChevronUp aria-hidden="true" className="w-5 h-5" /> : <ChevronDown aria-hidden="true" className="w-5 h-5" />}
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 pt-0 space-y-2">
              {entries.map((e) => (
                <EntryCard
                  key={e.id}
                  entry={e}
                  heightCm={heightCm}
                  onView={() => onView(e)}
                  onEdit={() => onEdit(e)}
                  onDelete={() => onDelete(e.id)}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────
// Layout: title is OUTSIDE the scroll area (shrink-0 header), body scrolls
// with the thin teal scrollbar, footer (Cancel/Save) is OUTSIDE the scroll
// area (shrink-0 footer). The scroll only appears in the body region.
function EditModal({
  form,
  saving,
  error,
  isDirty,
  heightCm,
  isPregnant,
  medications,
  onChange,
  onSave,
  onClose,
}: {
  form: EditForm;
  saving: boolean;
  error: string;
  /** True when at least one field differs from the original entry. */
  isDirty: boolean;
  /** From PatientProfile.heightCm — used to compute BMI in the audio summary. */
  heightCm: number | null;
  /** From PatientProfile.isPregnant — gates the pregnancy-specific symptoms. */
  isPregnant: boolean;
  /** Active medications — rendered as a per-med adherence list. */
  medications: PatientMedication[];
  onChange: (key: keyof EditForm, val: string | string[] | boolean | number | Record<string, MedEntry>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  // Phase/26 TTS pass 2 — compose a humanised summary of the in-progress
  // form so the patient can hear what they're about to save. Reuses the
  // same helper as EntryCard so the prose style matches across the page.
  const formMeasuredAt = (() => {
    if (!form.measuredDate) return new Date().toISOString();
    const ts = `${form.measuredDate}T${form.measuredTime || '00:00'}`;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  })();
  const formSys = form.systolic ? parseInt(form.systolic, 10) : null;
  const formDia = form.diastolic ? parseInt(form.diastolic, 10) : null;
  const formPulse = form.pulse ? parseInt(form.pulse, 10) : null;
  const formWeightKg = form.weight ? parseFloat(form.weight) : null;
  const formBmi = getBMI(heightCm, formWeightKg ?? undefined);
  const formSymptomCount = SYMPTOM_KEYS.reduce((n, k) => (form[k] ? n + 1 : n), 0);
  // Roll the per-med statuses up to a single taken/missed/null for the audio
  // summary: missed if any med is "no", taken if at least one explicit yes/no
  // and none missed, null otherwise.
  const medTakens = medications
    .map((m) => form.medicationStatus[m.id]?.taken)
    .filter((s): s is 'yes' | 'no' | 'scheduledLater' => !!s);
  const anyMedExplicit = medTakens.some((s) => s === 'yes' || s === 'no');
  const anyMedMissed = medTakens.some((s) => s === 'no');
  const editAudio = humanizeReading(
    {
      measuredAt: formMeasuredAt,
      systolicBP: Number.isFinite(formSys) ? formSys : null,
      diastolicBP: Number.isFinite(formDia) ? formDia : null,
      pulse: Number.isFinite(formPulse) ? formPulse : null,
      position: form.position || null,
      weight: Number.isFinite(formWeightKg) ? formWeightKg : null,
      bmi: formBmi,
      medicationTaken: anyMedExplicit ? !anyMedMissed : null,
      symptomCount: formSymptomCount,
      notes: form.notes,
    },
    t,
  );

  // Per-med helpers — mirror CheckIn's StepMedication setters. Updates flow
  // through onChange('medicationStatus', nextMap) so the parent's generic
  // setEditForm spread persists them.
  const getMed = (id: string): MedEntry => form.medicationStatus[id] ?? DEFAULT_MED_ENTRY;
  const setMedTaken = (id: string, value: 'yes' | 'no' | 'scheduledLater') => {
    const cur = getMed(id);
    const next: MedEntry =
      value === 'no'
        ? { ...cur, taken: 'no' }
        : { taken: value, reason: null, missedDoses: 1 };
    onChange('medicationStatus', { ...form.medicationStatus, [id]: next });
  };
  const patchMed = (id: string, patch: Partial<MedEntry>) => {
    onChange('medicationStatus', {
      ...form.medicationStatus,
      [id]: { ...getMed(id), ...patch },
    });
  };
  const drugClassLabel = (cls: string) => cls.replace(/_/g, ' ').toLowerCase();

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet — flex column so header / scroll body / footer can share height */}
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-reading-title"
        className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{
          maxHeight: '90dvh',
          boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
        }}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      >
        {/* Header — shrink-0 so it never scrolls */}
        <div
          className="shrink-0 bg-white flex items-center justify-between px-5 py-4 gap-3"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <h2 id="edit-reading-title" className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
              {t('readings.editReading')}
            </h2>
            {/* Phase/26 TTS pass 2 — humanised summary of the in-progress
                form so the patient can hear what they'll save. */}
            <AudioButton size="sm" text={editAudio} />
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-70 cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('accessibility.closeDialog')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        {/* Scrollable body — gets the thin teal scrollbar */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="p-5 space-y-5">
            {/* When — split date and time pickers (cleaner on small screens). */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label
                  htmlFor="readings-edit-date"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.date')}
                </label>
                <input
                  id="readings-edit-date"
                  type="date"
                  value={form.measuredDate}
                  onChange={(e) => onChange('measuredDate', e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none min-w-0"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                    colorScheme: 'light',
                  }}
                />
              </div>
              <div>
                <label
                  htmlFor="readings-edit-time"
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.time')}
                </label>
                <input
                  id="readings-edit-time"
                  type="time"
                  value={form.measuredTime}
                  onChange={(e) => onChange('measuredTime', e.target.value)}
                  className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none min-w-0"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                    colorScheme: 'light',
                  }}
                />
              </div>
            </div>

            {/* Position — 3-up picker matching CheckIn */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-2"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.positionLabel')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(['SITTING', 'STANDING', 'LYING'] as const).map((p) => {
                  const active = form.position === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => onChange('position', p)}
                      className="h-11 rounded-xl border-2 text-[12.5px] font-semibold transition cursor-pointer"
                      style={{
                        borderColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
                        backgroundColor: active
                          ? 'var(--brand-primary-purple-light)'
                          : 'transparent',
                        color: active
                          ? 'var(--brand-primary-purple)'
                          : 'var(--brand-text-muted)',
                      }}
                    >
                      {p === 'SITTING'
                        ? t('checkin.b2.positionSitting')
                        : p === 'STANDING'
                          ? t('checkin.b2.positionStanding')
                          : t('checkin.b2.positionLying')}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* BP */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="readings-edit-systolic"
                  className="block text-[12px] font-semibold"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('readings.bloodPressure')}
                </label>
                <span className="flex items-center gap-2">
                  {/* Phase/27 BP photo OCR — re-edit path. Patient who realises
                      they typed the wrong number can re-snap and overwrite. */}
                  <BpPhotoButton
                    onConfirm={(r) => {
                      onChange('systolic', String(r.sbp));
                      onChange('diastolic', String(r.dbp));
                      if (r.pulse != null) onChange('pulse', String(r.pulse));
                    }}
                  />
                  <AudioButton size="sm" text={t('readings.bloodPressure')} />
                </span>
              </div>
              <div className="flex gap-3 items-center">
                <input
                  id="readings-edit-systolic"
                  type="number"
                  placeholder={t('checkin.systolic')}
                  value={form.systolic}
                  onChange={(e) => onChange('systolic', e.target.value)}
                  min={60}
                  max={250}
                  className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none min-w-0"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                  }}
                />
                <MicButton
                  inputId="readings-edit-systolic"
                  numeric
                  onTranscript={(text) => onChange('systolic', text)}
                />
                <span className="text-[18px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                  /
                </span>
                <input
                  id="readings-edit-diastolic"
                  type="number"
                  placeholder={t('checkin.diastolic')}
                  value={form.diastolic}
                  onChange={(e) => onChange('diastolic', e.target.value)}
                  min={40}
                  max={150}
                  className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none min-w-0"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                  }}
                />
                <MicButton
                  inputId="readings-edit-diastolic"
                  numeric
                  onTranscript={(text) => onChange('diastolic', text)}
                />
              </div>
            </div>

            {/* Pulse */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="readings-edit-pulse"
                  className="block text-[12px] font-semibold"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('readings.pulseLabel')}
                </label>
                <AudioButton size="sm" text={t('readings.pulseLabel')} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="readings-edit-pulse"
                  type="number"
                  placeholder={t('readings.pulsePlaceholder')}
                  value={form.pulse}
                  onChange={(e) => onChange('pulse', e.target.value)}
                  min={30}
                  max={220}
                  className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                  }}
                />
                <MicButton
                  inputId="readings-edit-pulse"
                  numeric
                  onTranscript={(text) => onChange('pulse', text)}
                />
              </div>
            </div>

            {/* Weight */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="readings-edit-weight"
                  className="block text-[12px] font-semibold"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('readings.weightLbs')}
                </label>
                <AudioButton size="sm" text={t('readings.weightLbs')} />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="readings-edit-weight"
                  type="number"
                  placeholder="e.g. 165"
                  value={form.weight}
                  onChange={(e) => onChange('weight', e.target.value)}
                  min={20}
                  max={600}
                  className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none"
                  style={{
                    borderColor: 'var(--brand-border)',
                    color: 'var(--brand-text-primary)',
                  }}
                />
                <MicButton
                  inputId="readings-edit-weight"
                  numeric
                  onTranscript={(text) => onChange('weight', text)}
                />
              </div>
            </div>

            {/* Medication — one row per active med, mirroring CheckIn's
                StepMedication. Each med shows its current status (taken / missed
                / not due yet) and can be changed independently; "No" reveals a
                per-med reason + missed-dose counter. */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-2"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.medicationTaken')}
              </label>

              {medications.length === 0 ? (
                <p
                  className="text-[12.5px] rounded-xl p-3 leading-relaxed"
                  style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-text-primary)' }}
                >
                  {t('checkin.b4.noMeds')}
                </p>
              ) : (
                <div className="space-y-3">
                  {medications.map((med) => {
                    const med_entry = getMed(med.id);
                    const missed = med_entry.taken === 'no';
                    const took = med_entry.taken === 'yes';
                    return (
                      <div
                        key={med.id}
                        className="rounded-xl border-2 transition"
                        style={{
                          borderColor: missed
                            ? 'var(--brand-warning-amber)'
                            : took
                              ? 'var(--brand-success-green)'
                              : 'var(--brand-border)',
                          backgroundColor: missed
                            ? 'var(--brand-warning-amber-light)'
                            : took
                              ? 'var(--brand-success-green-light)'
                              : 'white',
                        }}
                      >
                        <div className="px-3 py-3">
                          <div className="mb-2 min-w-0">
                            <p
                              className="text-[13.5px] font-semibold truncate"
                              style={{ color: 'var(--brand-text-primary)' }}
                            >
                              {med.drugName}
                            </p>
                            <p className="text-[11px]" style={{ color: 'var(--brand-text-muted)' }}>
                              {drugClassLabel(med.drugClass)}
                            </p>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            {(['yes', 'no', 'scheduledLater'] as const).map((val) => {
                              const active = med_entry.taken === val;
                              return (
                                <button
                                  key={val}
                                  type="button"
                                  onClick={() => setMedTaken(med.id, val)}
                                  className="h-10 rounded-xl border-2 text-[12px] font-semibold transition cursor-pointer"
                                  style={{
                                    borderColor: active ? 'var(--brand-primary-purple)' : 'var(--brand-border)',
                                    backgroundColor: active ? 'var(--brand-primary-purple-light)' : 'white',
                                    color: active ? 'var(--brand-primary-purple)' : 'var(--brand-text-muted)',
                                  }}
                                >
                                  {val === 'yes'
                                    ? t('common.yes')
                                    : val === 'no'
                                      ? t('common.no')
                                      : t('readings.notDueYet')}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {missed && (
                          <div className="px-3 pb-3 space-y-3 border-t" style={{ borderColor: 'var(--brand-border)' }}>
                            <div className="pt-3">
                              <label
                                htmlFor={`edit-missed-reason-${med.id}`}
                                className="block text-[11px] font-semibold uppercase tracking-wide mb-1"
                                style={{ color: 'var(--brand-text-muted)' }}
                              >
                                {t('readings.whyMissed')}
                              </label>
                              <select
                                id={`edit-missed-reason-${med.id}`}
                                value={med_entry.reason ?? ''}
                                onChange={(e) =>
                                  patchMed(med.id, { reason: (e.target.value || null) as MedEntry['reason'] })
                                }
                                className="w-full px-3 py-2 rounded-lg border text-[14px] bg-white"
                                style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
                              >
                                <option value="">{t('readings.selectReason')}</option>
                                <option value="FORGOT">{t('readings.reasonForgot')}</option>
                                <option value="SIDE_EFFECTS">{t('readings.reasonSideEffects')}</option>
                                <option value="RAN_OUT">{t('readings.reasonRanOut')}</option>
                                <option value="COST">{t('readings.reasonCost')}</option>
                                <option value="INTENTIONAL">{t('readings.reasonIntentional')}</option>
                                <option value="OTHER">{t('readings.reasonOther')}</option>
                              </select>
                            </div>

                            <fieldset className="border-0 p-0 m-0">
                              <legend
                                className="text-[11px] font-semibold uppercase tracking-wide"
                                style={{ color: 'var(--brand-text-muted)' }}
                              >
                                {t('readings.howManyDoses')}
                              </legend>
                              <div className="mt-1 flex items-center gap-3">
                                <button
                                  type="button"
                                  onClick={() => patchMed(med.id, { missedDoses: Math.max(1, med_entry.missedDoses - 1) })}
                                  className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer bg-white"
                                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                                  aria-label={t('readings.decreaseDoses')}
                                >
                                  −
                                </button>
                                <span
                                  className="text-[16px] font-bold w-6 text-center"
                                  style={{ color: 'var(--brand-text-primary)' }}
                                >
                                  {med_entry.missedDoses}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => patchMed(med.id, { missedDoses: Math.min(10, med_entry.missedDoses + 1) })}
                                  className="w-8 h-8 rounded-lg border flex items-center justify-center cursor-pointer bg-white"
                                  style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                                  aria-label={t('readings.increaseDoses')}
                                >
                                  +
                                </button>
                              </div>
                            </fieldset>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Symptoms — V2 structured booleans (matches CheckIn B3) */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-2"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.symptoms')}
              </label>
              <div className="space-y-2">
                {SYMPTOM_KEYS.filter(
                  (key) => isPregnant || !PREGNANCY_SYMPTOM_KEYS.includes(key),
                ).map((key) => {
                  const checked = Boolean(form[key]);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => onChange(key, !checked)}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-xl border transition text-left cursor-pointer"
                      style={{
                        borderColor: checked ? 'var(--brand-success-green)' : 'var(--brand-border)',
                        backgroundColor: checked ? 'var(--brand-success-green-light)' : 'white',
                      }}
                    >
                      <div
                        className="rounded-full flex items-center justify-center shrink-0 transition"
                        style={{
                          width: 20,
                          height: 20,
                          backgroundColor: checked ? 'var(--brand-success-green)' : 'transparent',
                          border: `2px solid ${checked ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
                        }}
                      >
                        {checked && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
                      </div>
                      <span
                        className="text-[12.5px] flex-1 min-w-0"
                        style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
                      >
                        {t(SYMPTOM_LABEL_KEYS[key])}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Other / custom symptoms — tag input (Enter / Add → chip, with
                edit + remove), matching CheckIn step 5. → otherSymptoms[]. */}
            <SymptomTagInput
              value={form.otherSymptoms}
              onChange={(next) => onChange('otherSymptoms', next)}
              inputId="readings-edit-other-symptoms"
              label={t('checkin.b3.otherSymptomsLabel')}
              placeholder={t('checkin.b3.otherPlaceholder')}
              addLabel={t('checkin.b3.addSymptom')}
              removeLabel={t('checkin.b3.removeSymptom')}
              editLabel={t('common.edit')}
              testIdPrefix="readings-edit-other-symptoms"
            />

            {/* Notes — free-text → JournalEntry.notes. Voice + bounded counter. */}
            <div>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor="readings-edit-notes"
                  className="block text-[12px] font-semibold"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('readings.notes')}
                </label>
                <MicButton
                  inputId="readings-edit-notes"
                  onTranscript={(text) =>
                    onChange(
                      'notes',
                      (form.notes ? `${form.notes} ${text}`.trim() : text).slice(0, JOURNAL_NOTE_MAX_LENGTH),
                    )
                  }
                />
              </div>
              <textarea
                id="readings-edit-notes"
                value={form.notes}
                maxLength={JOURNAL_NOTE_MAX_LENGTH}
                onChange={(e) => onChange('notes', e.target.value.slice(0, JOURNAL_NOTE_MAX_LENGTH))}
                placeholder={t('readings.notesPlaceholder')}
                rows={3}
                aria-describedby="readings-edit-notes-count"
                className="w-full px-3 py-2.5 rounded-xl border text-[14px] outline-none resize-none leading-relaxed"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
              <p
                id="readings-edit-notes-count"
                className="mt-1 text-[11px] text-right tabular-nums"
                style={{
                  color:
                    form.notes.length >= JOURNAL_NOTE_MAX_LENGTH
                      ? 'var(--brand-alert-red-text)'
                      : 'var(--brand-text-muted)',
                }}
              >
                {form.notes.length}/{JOURNAL_NOTE_MAX_LENGTH}
              </p>
            </div>
          </div>
        </div>

        {/* Footer — shrink-0, sticky at bottom of modal */}
        <div
          className="shrink-0 bg-white px-5 py-3"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          {error && (
            <p
              className="text-[12.5px] font-semibold text-center mb-2 px-3 py-1.5 rounded-lg"
              style={{ color: 'var(--brand-alert-red-text)', backgroundColor: 'var(--brand-alert-red-light)' }}
            >
              {error}
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-full border-2 text-sm font-semibold cursor-pointer"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-secondary)',
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving || !isDirty}
              className="flex-1 h-11 rounded-full text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              aria-label={!isDirty ? 'No changes to save' : undefined}
            >
              {saving ? t('common.saving') : t('readings.saveChanges')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// Small presentational helpers for the detail modal. Module-level so they
// aren't re-created on every render (react-hooks/static-components).
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-[12px] font-semibold shrink-0" style={{ color: 'var(--brand-text-muted)' }}>
        {label}
      </span>
      <span className="text-[13.5px] text-right" style={{ color: 'var(--brand-text-primary)' }}>
        {value}
      </span>
    </div>
  );
}

function DetailSectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="text-[10px] font-bold uppercase tracking-wider mb-1 mt-1"
      style={{ color: 'var(--brand-primary-purple)' }}
    >
      {children}
    </p>
  );
}

// ─── Reading Detail Modal ───────────────────────────────────────────────────────
// Read-only "see everything" view opened by tapping a reading card. Close
// dismisses; Edit hands off to the EditModal. Reuses the same per-med
// reconstruction (buildMedStatus) so it reflects the fixed yes/not-due-yet
// status, and the same symptom label keys as the check-in + edit modal.
function ReadingDetailModal({
  entry,
  heightCm,
  isPregnant,
  medications,
  onEdit,
  onClose,
}: {
  entry: Entry;
  heightCm: number | null;
  isPregnant: boolean;
  medications: PatientMedication[];
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const bmi = getBMI(heightCm, entry.weight);
  const medStatus = buildMedStatus(entry, medications);
  const dt = new Date(entry.measuredAt);
  const timeStr = !isNaN(dt.getTime())
    ? dt.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : '';

  const trueSymptoms = SYMPTOM_KEYS.filter(
    (k) => entry[k] && (isPregnant || !PREGNANCY_SYMPTOM_KEYS.includes(k)),
  );
  const legacySymptoms = entry.symptoms ?? [];

  const positionLabel = (p?: string | null) =>
    p === 'SITTING'
      ? t('checkin.b2.positionSitting')
      : p === 'STANDING'
        ? t('checkin.b2.positionStanding')
        : p === 'LYING'
          ? t('checkin.b2.positionLying')
          : '—';

  const reasonLabel = (r?: string | null) =>
    r === 'FORGOT'
      ? t('readings.reasonForgot')
      : r === 'SIDE_EFFECTS'
        ? t('readings.reasonSideEffects')
        : r === 'RAN_OUT'
          ? t('readings.reasonRanOut')
          : r === 'COST'
            ? t('readings.reasonCost')
            : r === 'INTENTIONAL'
              ? t('readings.reasonIntentional')
              : r === 'OTHER'
                ? t('readings.reasonOther')
                : '';

  const takenLabel = (taken: MedEntry['taken']) =>
    taken === 'yes'
      ? t('readings.taken')
      : taken === 'no'
        ? t('readings.missed')
        : taken === 'scheduledLater'
          ? t('readings.notDueYet')
          : '—';

  const structuredSymptomCount = SYMPTOM_KEYS.reduce((n, k) => (entry[k] ? n + 1 : n), 0);
  const audioSummary = humanizeReading(
    {
      measuredAt: entry.measuredAt,
      systolicBP: entry.systolicBP ?? null,
      diastolicBP: entry.diastolicBP ?? null,
      pulse: entry.pulse ?? null,
      position: entry.position ?? null,
      weight: entry.weight ?? null,
      bmi,
      medicationTaken: entry.medicationTaken ?? null,
      symptomCount: structuredSymptomCount + legacySymptoms.length,
      notes: entry.notes ?? null,
    },
    t,
  );

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-detail-title"
        data-testid="reading-detail-modal"
        className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90dvh', boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      >
        {/* Header */}
        <div
          className="shrink-0 bg-white flex items-center justify-between px-5 py-4 gap-3"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="min-w-0">
              <h2 id="reading-detail-title" className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
                {t('readings.detailTitle')}
              </h2>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {formatDate(entry.measuredAt)}{timeStr ? ` · ${timeStr}` : ''}
              </p>
            </div>
            <AudioButton size="sm" text={audioSummary} />
          </div>
          <button
            onClick={onClose}
            className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-70 cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('accessibility.closeDialog')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="p-5">
            {/* BP hero */}
            <div className="text-center mb-3">
              {entry.systolicBP && entry.diastolicBP ? (
                <div className="flex items-baseline gap-1.5 justify-center">
                  <span className="text-[34px] font-bold leading-none" style={{ color: 'var(--brand-primary-purple)' }}>
                    {entry.systolicBP}/{entry.diastolicBP}
                  </span>
                  <span className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>{t('readings.mmHg')}</span>
                </div>
              ) : (
                <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>{t('readings.noBpRecorded')}</p>
              )}
            </div>

            <div className="divide-y" style={{ borderColor: 'var(--brand-border)' }}>
              <DetailRow label={t('readings.pulseLabel')} value={entry.pulse != null ? `${entry.pulse} ${t('readings.bpm')}` : '—'} />
              <DetailRow label={t('readings.positionLabel')} value={positionLabel(entry.position)} />
              <DetailRow label={t('readings.weightLbs')} value={entry.weight != null ? `${kgToLbs(entry.weight)} ${t('readings.lbs')}` : '—'} />
              {bmi != null && <DetailRow label="BMI" value={bmi.toFixed(1)} />}
            </div>

            {/* Medications */}
            <div className="mt-3">
              <DetailSectionTitle>{t('readings.medicationTaken')}</DetailSectionTitle>
              {medications.length === 0 ? (
                entry.medicationTaken != null ? (
                  <p className="text-[13px]" style={{ color: 'var(--brand-text-primary)' }}>
                    {entry.medicationTaken ? t('readings.taken') : t('readings.missed')}
                  </p>
                ) : (
                  <p className="text-[13px]" style={{ color: 'var(--brand-text-muted)' }}>—</p>
                )
              ) : (
                <div className="space-y-1.5">
                  {medications.map((med) => {
                    const s = medStatus[med.id] ?? { taken: null, reason: null, missedDoses: 1 };
                    return (
                      <div key={med.id} className="flex items-baseline justify-between gap-3">
                        <span className="text-[13px] min-w-0 truncate" style={{ color: 'var(--brand-text-primary)' }}>
                          {med.drugName}
                        </span>
                        <span className="text-[12.5px] text-right shrink-0" style={{ color: 'var(--brand-text-secondary)' }}>
                          {takenLabel(s.taken)}
                          {s.taken === 'no' && s.reason ? ` · ${reasonLabel(s.reason)}` : ''}
                          {s.taken === 'no' && s.missedDoses ? ` · ${s.missedDoses}` : ''}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Symptoms */}
            {(trueSymptoms.length > 0 || legacySymptoms.length > 0) && (
              <div className="mt-3">
                <DetailSectionTitle>{t('readings.symptoms')}</DetailSectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {trueSymptoms.map((k) => (
                    <span
                      key={k}
                      className="text-[11.5px] px-2 py-0.5 rounded-md font-medium"
                      style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
                    >
                      {t(SYMPTOM_LABEL_KEYS[k])}
                    </span>
                  ))}
                  {legacySymptoms.map((s, i) => (
                    <span
                      key={`legacy-${s}-${i}`}
                      className="text-[11.5px] px-2 py-0.5 rounded-md font-medium"
                      style={{ backgroundColor: 'var(--brand-alert-red-light)', color: 'var(--brand-alert-red-text)' }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Custom symptoms */}
            {entry.otherSymptoms && entry.otherSymptoms.length > 0 && (
              <div className="mt-3">
                <DetailSectionTitle>{t('readings.otherSymptoms')}</DetailSectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {entry.otherSymptoms.map((s, i) => (
                    <span
                      key={`${s}-${i}`}
                      className="text-[11.5px] px-2 py-0.5 rounded-md font-medium"
                      style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes */}
            {entry.notes && (
              <div className="mt-3">
                <DetailSectionTitle>{t('readings.notes')}</DetailSectionTitle>
                <p
                  className="text-[13px] leading-relaxed whitespace-pre-wrap break-words"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {entry.notes}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 bg-white px-5 py-3" style={{ borderTop: '1px solid var(--brand-border)' }}>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 h-11 rounded-full border-2 text-sm font-semibold cursor-pointer"
              style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-secondary)' }}
            >
              {t('common.close')}
            </button>
            <button
              type="button"
              data-testid="reading-detail-edit-btn"
              onClick={onEdit}
              className="flex-1 h-11 rounded-full text-white text-sm font-bold transition cursor-pointer flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              <Pencil className="w-4 h-4" />
              {t('readings.editReading')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Delete Confirmation ───────────────────────────────────────────────────────
function DeleteConfirm({
  deleting,
  error,
  onConfirm,
  onCancel,
}: {
  deleting: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <motion.div
        data-testid="readings-delete-confirm-modal"
        className="relative w-full max-w-sm bg-white rounded-2xl p-6 text-center"
        style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
        >
          <Trash2 aria-hidden="true" className="w-5 h-5" style={{ color: 'var(--brand-alert-red)' }} />
        </div>
        <h3 className="text-[16px] font-bold mb-1" style={{ color: 'var(--brand-text-primary)' }}>
          {t('readings.deleteReading')}
        </h3>
        <p className="text-[13px] mb-6 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
          {t('readings.deleteWarning')}
        </p>
        {error && (
          <p className="text-[13px] mb-4 text-center" style={{ color: 'var(--brand-alert-red)' }}>
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 h-11 rounded-full border-2 text-sm font-semibold"
            style={{
              borderColor: 'var(--brand-border)',
              color: 'var(--brand-text-secondary)',
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            data-testid="readings-delete-confirm-button"
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 h-11 rounded-full text-white text-sm font-bold disabled:opacity-60"
            style={{ backgroundColor: 'var(--brand-alert-red)' }}
          >
            {deleting ? t('common.deleting') : t('common.delete')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReadingsPage() {
  const { t } = useLanguage();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  // Patient height (intake-time, fixed). Used to compute BMI per reading.
  // Fetched once alongside the journal list — small endpoint, never blocks
  // the page render (BMI just hides until it lands).
  const [heightCm, setHeightCm] = useState<number | null>(null);
  // Pregnancy flag — gates the pregnancy-specific symptoms in the edit modal so
  // they never show for patients who can't be pregnant (e.g. male accounts).
  const [isPregnant, setIsPregnant] = useState(false);
  // Active medications — fetched once so the edit modal can show every med with
  // its per-reading status (taken / missed / not due yet), matching CheckIn's
  // medication step. AS_NEEDED (PRN) meds are excluded: "missed today" is not
  // meaningful for them.
  const [medications, setMedications] = useState<PatientMedication[]>([]);
  // Read-only detail view opened by tapping a card. Separate from editEntry so
  // the two modals never fight; Edit inside it hands off to the edit modal.
  const [detailEntry, setDetailEntry] = useState<Entry | null>(null);
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
  // Snapshot of the form taken at openEdit time — used to compute isDirty
  // so the Save button only enables after the patient actually changes
  // something. Stringified comparison is cheap for an object this small.
  const [editFormInitial, setEditFormInitial] = useState<EditForm | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    getJournalEntries({ limit: 100 })
      .then((data) => {
        const arr = Array.isArray(data) ? data : [];
        const sorted = [...arr].sort(
          (a, b) =>
            new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime(),
        ) as Entry[];
        setEntries(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Fetch patient profile once for BMI height. Best-effort — readings still
  // render normally if this fails; the BMI chip just doesn't appear.
  useEffect(() => {
    let cancelled = false;
    getMyPatientProfile()
      .then((p) => {
        if (!cancelled) {
          setHeightCm(p?.heightCm ?? null);
          setIsPregnant(p?.isPregnant === true);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch active medications once so the edit modal can render the per-med
  // adherence list. Best-effort; on failure the modal just shows no meds.
  useEffect(() => {
    let cancelled = false;
    listMyMedications()
      .then((meds) => {
        if (!cancelled) setMedications(meds.filter((m) => m.frequency !== 'AS_NEEDED'));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openEdit(entry: Entry) {
    setEditEntry(entry);
    // Format ISO timestamp → separate date + time strings in the user's
    // local timezone (not UTC) so the pickers show the same wall-clock time
    // the patient originally entered.
    const dt = new Date(entry.measuredAt);
    const isValid = !isNaN(dt.getTime());
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    const hh = String(dt.getHours()).padStart(2, '0');
    const mi = String(dt.getMinutes()).padStart(2, '0');

    const populated: EditForm = {
      measuredDate: isValid ? `${yyyy}-${mm}-${dd}` : '',
      measuredTime: isValid ? `${hh}:${mi}` : '',
      position: entry.position ?? '',
      systolic: entry.systolicBP?.toString() ?? '',
      diastolic: entry.diastolicBP?.toString() ?? '',
      pulse: entry.pulse?.toString() ?? '',
      // Bug 39 — edit modal field is labelled "lbs" (readings.weightLbs).
      // Pre-fix this loaded entry.weight (kg from DB) as a raw string, so
      // a 150 lb reading (stored as 68.04 kg) displayed as "68.04" next to
      // a "lbs" label. Either the patient saw the wrong value and was
      // confused, or they tried to correct it to "150" — backend then
      // stored that as 150 kg (= 330 lbs) because the POST never went
      // through the lbs→kg conversion. Now we convert on load + save so
      // the form is consistently lbs end-to-end, matching the label and
      // matching CheckIn.tsx's submit flow.
      weight: entry.weight != null ? kgToLbs(entry.weight).toString() : '',
      medicationStatus: buildMedStatus(entry, medications),
      severeHeadache: entry.severeHeadache ?? false,
      visualChanges: entry.visualChanges ?? false,
      alteredMentalStatus: entry.alteredMentalStatus ?? false,
      chestPainOrDyspnea: entry.chestPainOrDyspnea ?? false,
      focalNeuroDeficit: entry.focalNeuroDeficit ?? false,
      severeEpigastricPain: entry.severeEpigastricPain ?? false,
      dizziness: entry.dizziness ?? false,
      syncope: entry.syncope ?? false,
      palpitations: entry.palpitations ?? false,
      legSwelling: entry.legSwelling ?? false,
      fatigue: entry.fatigue ?? false,
      shortnessOfBreath: entry.shortnessOfBreath ?? false,
      dryCough: entry.dryCough ?? false,
      faceSwelling: entry.faceSwelling ?? false,
      throatTightness: entry.throatTightness ?? false,
      newOnsetHeadache: entry.newOnsetHeadache ?? false,
      ruqPain: entry.ruqPain ?? false,
      edema: entry.edema ?? false,
      // Surface v2 otherSymptoms plus any legacy v1 freeform `symptoms` as
      // editable chips so old data stays visible, editable, and removable.
      otherSymptoms: [
        ...(entry.otherSymptoms ?? []),
        ...(entry.symptoms ?? []),
      ],
      notes: entry.notes ?? '',
    };
    setEditForm(populated);
    setEditFormInitial(populated); // baseline for dirty-check
    setEditError('');
  }

  function closeEdit() {
    setEditEntry(null);
    setEditForm(null);
    setEditFormInitial(null);
    setEditError('');
  }

  async function saveEdit() {
    if (!editEntry || !editForm) return;
    const validation = validateEditForm(editForm, t);
    if (validation) {
      setEditError(validation);
      return;
    }
    // Per-medication: a med marked "No" must carry a reason — the backend
    // requires `reason` on every missedMedications entry.
    const missingReason = medications.some(
      (m) =>
        editForm.medicationStatus[m.id]?.taken === 'no' &&
        !editForm.medicationStatus[m.id]?.reason,
    );
    if (missingReason) {
      setEditError(t('readings.validate.missedReason'));
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      const payload: Parameters<typeof updateJournalEntry>[1] = {};
      if (editForm.measuredDate && editForm.measuredTime) {
        payload.measuredAt = new Date(
          `${editForm.measuredDate}T${editForm.measuredTime}`,
        ).toISOString();
      }
      if (editForm.position) payload.position = editForm.position;
      if (editForm.systolic) payload.systolicBP = parseInt(editForm.systolic, 10);
      if (editForm.diastolic) payload.diastolicBP = parseInt(editForm.diastolic, 10);
      if (editForm.pulse) payload.pulse = parseInt(editForm.pulse, 10);
      // Bug 39 — form holds lbs (matching the visible label and the load
      // conversion above). Backend stores kg, so convert before POSTing.
      // This also fixes the "weight must not exceed 300" false rejection
      // patients hit when entering legitimate lbs values like 350 (= 159
      // kg, well under the @Max(300) DTO bound).
      if (editForm.weight) {
        const lbs = parseFloat(editForm.weight);
        if (Number.isFinite(lbs) && lbs > 0) payload.weight = lbsToKg(lbs);
      }
      // Per-medication adherence → the rollup shape the backend stores.
      // Mirrors CheckIn's submit: each med marked "no" becomes a
      // missedMedications entry (with its reason + dose count); "not due yet"
      // sets the scheduled-later flag; medicationTaken is true only when at
      // least one med got an explicit yes/no and none were missed, null when
      // every answer was "not due yet" (so the adherence rule doesn't fire).
      // Skipped entirely when the patient has no active meds, so existing
      // medication data on the entry is preserved rather than wiped.
      if (medications.length > 0) {
        const medEntries = medications.map((m) => ({
          med: m,
          state: editForm.medicationStatus[m.id] ?? DEFAULT_MED_ENTRY,
        }));
        const missedMedications = medEntries
          .filter((e) => e.state.taken === 'no' && e.state.reason)
          .map((e) => ({
            medicationId: e.med.id,
            drugName: e.med.drugName,
            drugClass: e.med.drugClass,
            reason: e.state.reason as MissedReason,
            missedDoses: e.state.missedDoses,
          }));
        const anyExplicitYesNo = medEntries.some(
          (e) => e.state.taken === 'yes' || e.state.taken === 'no',
        );
        const scheduledLater = medEntries.some((e) => e.state.taken === 'scheduledLater');
        payload.medicationTaken = anyExplicitYesNo ? missedMedications.length === 0 : null;
        payload.medicationScheduledLater = scheduledLater;
        payload.missedDoses = missedMedications.reduce((s, m) => s + (m.missedDoses ?? 0), 0);
        payload.missedMedications = missedMedications;
        // Per-med snapshot for every answered med so reopening the modal shows
        // each med's exact answer instead of guessing from the rollup.
        payload.medicationStatuses = medEntries
          .filter((e) => e.state.taken !== null)
          .map((e) => ({
            medicationId: e.med.id,
            drugName: e.med.drugName,
            drugClass: e.med.drugClass,
            taken: e.state.taken as 'yes' | 'no' | 'scheduledLater',
            ...(e.state.taken === 'no' && e.state.reason
              ? { reason: e.state.reason as MissedReason }
              : {}),
            ...(e.state.taken === 'no' ? { missedDoses: e.state.missedDoses } : {}),
          }));
      }
      // Structured V2 symptoms — always send so toggling off is persisted.
      payload.severeHeadache = editForm.severeHeadache;
      payload.visualChanges = editForm.visualChanges;
      payload.alteredMentalStatus = editForm.alteredMentalStatus;
      payload.chestPainOrDyspnea = editForm.chestPainOrDyspnea;
      payload.focalNeuroDeficit = editForm.focalNeuroDeficit;
      payload.severeEpigastricPain = editForm.severeEpigastricPain;
      payload.dizziness = editForm.dizziness;
      payload.syncope = editForm.syncope;
      payload.palpitations = editForm.palpitations;
      payload.legSwelling = editForm.legSwelling;
      payload.fatigue = editForm.fatigue;
      payload.shortnessOfBreath = editForm.shortnessOfBreath;
      payload.dryCough = editForm.dryCough;
      payload.faceSwelling = editForm.faceSwelling;
      payload.throatTightness = editForm.throatTightness;
      // Pregnancy-specific symptoms are only meaningful for a pregnant patient
      // and are hidden from everyone else, so force them false otherwise
      // (matches CheckIn's submit) rather than persisting a stale value.
      payload.newOnsetHeadache = isPregnant ? editForm.newOnsetHeadache : false;
      payload.ruqPain = isPregnant ? editForm.ruqPain : false;
      payload.edema = isPregnant ? editForm.edema : false;
      // Send the chip array as-is; trim each + drop blanks. Empty array clears
      // any previously-stored custom symptoms.
      payload.otherSymptoms = editForm.otherSymptoms
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      payload.notes = editForm.notes.trim();

      await updateJournalEntry(editEntry.id, payload);
      closeEdit();
      load();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
    } finally {
      setEditSaving(false);
    }
  }

  const [deleteError, setDeleteError] = useState('');

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    setDeleteError('');
    try {
      await deleteJournalEntry(deleteId);
      setDeleteId(null);
      load();
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete. Please try again.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    // Default browser page scroll — no custom scroll container or fixed
    // height wrapper. The thin-scrollbar utility is reserved for the edit
    // modal body where scroll is genuinely contained.
    <main id="main" className="min-h-[calc(100dvh-4rem)]" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Activity aria-hidden="true" className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1
                  className="text-xl font-bold truncate"
                  style={{ color: 'var(--brand-text-primary)' }}
                >
                  {t('readings.title')}
                </h1>
                {!loading && (
                  <AudioButton
                    size="sm"
                    text={`${t('readings.title')}. ${entries.length} ${entries.length === 1 ? t('readings.totalEntry') : t('readings.totalEntries')}.`}
                  />
                )}
              </div>
              {loading ? (
                <div className="mt-1">
                  <Bone w={90} h={10} rounded="rounded-md" />
                </div>
              ) : (
                <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                  {`${entries.length} ${entries.length === 1 ? t('readings.totalEntry') : t('readings.totalEntries')}`}
                </p>
              )}
            </div>
          </div>

          <Link
            href="/check-in"
            className="h-9 px-4 rounded-full flex items-center gap-1.5 text-[13px] font-semibold text-white transition hover:opacity-85 shrink-0"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            <Plus aria-hidden="true" className="w-4 h-4" />
            <span className="hidden sm:inline">{t('readings.newCheckin')}</span>
          </Link>
        </div>

        {/* List — grouped by date */}
        <div data-testid="readings-table" className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <EntrySkeleton key={i} />)
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <Activity
                aria-hidden="true"
                className="w-8 h-8"
                style={{ color: 'var(--brand-primary-purple)' }}
              />
            </div>
            <p
              className="text-[16px] font-bold mb-1.5"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('readings.noReadings')}
            </p>
            <p className="text-[13px] mb-5" style={{ color: 'var(--brand-text-muted)' }}>
              {t('readings.noReadingsDesc')}
            </p>
            <Link
              href="/check-in"
              className="inline-flex items-center gap-2 h-11 px-6 rounded-full text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              <Plus aria-hidden="true" className="w-4 h-4" />
              {t('readings.startCheckin')}
            </Link>
          </div>
        ) : (
          (() => {
            // Group entries by date
            const grouped: { date: string; items: Entry[] }[] = [];
            const dateMap = new Map<string, Entry[]>();
            for (const entry of entries) {
              const dateKey = localDateKey(entry.measuredAt);
              if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
              dateMap.get(dateKey)!.push(entry);
            }
            for (const [date, items] of dateMap) {
              grouped.push({ date, items });
            }

            return (
              <AnimatePresence mode="popLayout">
                {grouped.map((group) => {
                  // Within each date, sub-group consecutive entries by
                  // sessionId. Multi-reading sessions render as a collapsible
                  // SessionCard; solo readings stay as plain EntryCards.
                  type Bucket = { sessionId: string | null; items: Entry[] };
                  const buckets: Bucket[] = [];
                  for (const e of group.items) {
                    const sid = e.sessionId ?? null;
                    const last = buckets[buckets.length - 1];
                    if (sid && last && last.sessionId === sid) {
                      last.items.push(e);
                    } else {
                      buckets.push({ sessionId: sid, items: [e] });
                    }
                  }
                  return (
                    <div key={group.date} data-testid="reading-group" className="space-y-2">
                      <p
                        data-testid="reading-group-date"
                        className="text-[11px] font-bold uppercase tracking-wider px-1 pt-2"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        {formatDate(group.items[0].measuredAt)}
                        {group.items.length > 1
                          ? ` — ${t('readings.readingsCount').replace('{count}', String(group.items.length))}`
                          : ''}
                      </p>
                      {buckets.map((bucket, i) =>
                        bucket.sessionId && bucket.items.length > 1 ? (
                          <SessionCard
                            key={bucket.sessionId}
                            entries={bucket.items}
                            heightCm={heightCm}
                            onView={(e) => setDetailEntry(e)}
                            onEdit={openEdit}
                            onDelete={(id) => setDeleteId(id)}
                          />
                        ) : (
                          <EntryCard
                            key={bucket.items[0].id + (bucket.sessionId ?? `solo-${i}`)}
                            entry={bucket.items[0]}
                            heightCm={heightCm}
                            onView={() => setDetailEntry(bucket.items[0])}
                            onEdit={() => openEdit(bucket.items[0])}
                            onDelete={() => setDeleteId(bucket.items[0].id)}
                          />
                        ),
                      )}
                    </div>
                  );
                })}
              </AnimatePresence>
            );
          })()
        )}
        </div>
      </div>

      {/* Read-only detail modal — opened by tapping a card. Hidden while the
          edit modal is open so the handoff (Edit → edit modal) shows one sheet
          at a time. */}
      <AnimatePresence>
        {detailEntry && !editEntry && (
          <ReadingDetailModal
            entry={detailEntry}
            heightCm={heightCm}
            isPregnant={isPregnant}
            medications={medications}
            onClose={() => setDetailEntry(null)}
            onEdit={() => {
              openEdit(detailEntry);
              setDetailEntry(null);
            }}
          />
        )}
      </AnimatePresence>

      {/* Edit modal */}
      <AnimatePresence>
        {editEntry && editForm && (
          <EditModal
            form={editForm}
            saving={editSaving}
            error={editError}
            heightCm={heightCm}
            isPregnant={isPregnant}
            medications={medications}
            // JSON.stringify is fine here — EditForm is small + flat. Returns
            // false when the user reopens the modal without touching anything.
            isDirty={
              editFormInitial != null &&
              JSON.stringify(editForm) !== JSON.stringify(editFormInitial)
            }
            onChange={(key, val) =>
              setEditForm((prev) => (prev ? { ...prev, [key]: val } : prev))
            }
            onSave={saveEdit}
            onClose={closeEdit}
          />
        )}
      </AnimatePresence>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteId && (
          <DeleteConfirm
            deleting={deleting}
            error={deleteError}
            onConfirm={confirmDelete}
            onCancel={() => { setDeleteId(null); setDeleteError(''); }}
          />
        )}
      </AnimatePresence>
    </main>
  );
}
