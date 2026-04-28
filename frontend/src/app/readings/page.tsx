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
import { getBMI } from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import type { TranslationKey } from '@/i18n';

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
  // V2 structured Level-2 symptom booleans (mirror backend serializeEntry).
  severeHeadache?: boolean;
  visualChanges?: boolean;
  alteredMentalStatus?: boolean;
  chestPainOrDyspnea?: boolean;
  focalNeuroDeficit?: boolean;
  severeEpigastricPain?: boolean;
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
  | 'newOnsetHeadache'
  | 'ruqPain'
  | 'edema';

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
  medication: 'yes' | 'no' | '';
  // V2 structured symptoms — checkbox grid in the modal
  severeHeadache: boolean;
  visualChanges: boolean;
  alteredMentalStatus: boolean;
  chestPainOrDyspnea: boolean;
  focalNeuroDeficit: boolean;
  severeEpigastricPain: boolean;
  newOnsetHeadache: boolean;
  ruqPain: boolean;
  edema: boolean;
  /** Patient's "anything else" freeform note. */
  otherSymptomsText: string;
  notes: string;
};

const SYMPTOM_KEYS: SymptomKey[] = [
  'severeHeadache',
  'visualChanges',
  'alteredMentalStatus',
  'chestPainOrDyspnea',
  'focalNeuroDeficit',
  'severeEpigastricPain',
  'newOnsetHeadache',
  'ruqPain',
  'edema',
];

// Symptom labels reuse Flow B's reviewer-approved copy (checkin.b3.symptom*)
// so intake and readings present identical wording in every locale.
const SYMPTOM_LABEL_KEYS: Record<SymptomKey, TranslationKey> = {
  severeHeadache: 'checkin.b3.symptomSevereHeadache',
  visualChanges: 'checkin.b3.symptomVision',
  alteredMentalStatus: 'checkin.b3.symptomConfusion',
  chestPainOrDyspnea: 'checkin.b3.symptomChestPain',
  focalNeuroDeficit: 'checkin.b3.symptomNeuro',
  severeEpigastricPain: 'checkin.b3.symptomStomach',
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

function getBpStatus(sys: number, dia: number) {
  if (sys >= 180 || dia >= 120) return { label: 'Crisis', color: 'red' as const };
  if (sys >= 140 || dia >= 90) return { label: 'Elevated', color: 'amber' as const };
  return { label: 'Normal', color: 'green' as const };
}

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
  onEdit,
  onDelete,
}: {
  entry: Entry;
  /** From PatientProfile.heightCm — fixed at intake. Used to compute BMI
   *  next to the weight chip. Optional — when missing, BMI is hidden. */
  heightCm: number | null;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const hasBP = entry.systolicBP && entry.diastolicBP;
  const bpStatus = hasBP ? getBpStatus(entry.systolicBP!, entry.diastolicBP!) : null;
  // BMI is read-only and only shown when both weight AND height exist.
  // Pulse pressure is intentionally NOT rendered on the patient app per
  // Niva — patients shouldn't see clinical signals they can't action.
  const bmi = getBMI(heightCm, entry.weight);

  const statusColors = {
    red: { bg: '#FEE2E2', text: '#DC2626' },
    amber: { bg: 'var(--brand-warning-amber-light)', text: 'var(--brand-warning-amber)' },
    green: { bg: 'var(--brand-success-green-light)', text: 'var(--brand-success-green)' },
  };

  return (
    <motion.div
      className="bg-white rounded-2xl p-5"
      style={{ boxShadow: '0 1px 12px rgba(123,0,224,0.06)' }}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      layout
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Date + Time — derived from single measuredAt timestamp */}
          <div className="flex items-center gap-2 mb-2">
            <p
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
              {bpStatus && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{
                    backgroundColor: statusColors[bpStatus.color].bg,
                    color: statusColors[bpStatus.color].text,
                  }}
                >
                  {bpStatus.label === 'Crisis' ? t('readings.crisis') : bpStatus.label === 'Elevated' ? t('dashboard.elevated') : t('checkin.normal')}
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
                {entry.weight} {t('readings.lbs')}
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
                style={{ backgroundColor: '#FEE2E2', color: '#DC2626' }}
              >
                <AlertTriangle className="w-3 h-3" />
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

          {/* Notes preview */}
          {entry.notes && (
            <p
              className="text-[12px] mt-2 leading-relaxed line-clamp-2"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              &ldquo;{entry.notes}&rdquo;
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 shrink-0">
          <button
            onClick={onEdit}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-75"
            style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            aria-label="Edit"
          >
            <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
          </button>
          <button
            onClick={onDelete}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-75"
            style={{ backgroundColor: '#FEE2E2' }}
            aria-label="Delete"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Session Card ─────────────────────────────────────────────────────────────
// Wraps 2+ readings taken within the same session (≤30 min, same sessionId)
// in a collapsible shell. Header shows the average BP and reading count;
// expanding renders the individual EntryCards inside. Solo readings render
// as a plain EntryCard (no shell) so the list doesn't feel over-decorated.
function SessionCard({
  entries,
  heightCm,
  onEdit,
  onDelete,
}: {
  entries: Entry[];
  heightCm: number | null;
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
          {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
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
  onChange,
  onSave,
  onClose,
}: {
  form: EditForm;
  saving: boolean;
  error: string;
  /** True when at least one field differs from the original entry. */
  isDirty: boolean;
  onChange: (key: keyof EditForm, val: string | boolean) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();

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
          className="shrink-0 bg-white flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {t('readings.editReading')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-70 cursor-pointer"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('common.close')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        {/* Scrollable body — gets the thin teal scrollbar */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="p-5 space-y-5">
            {/* When — split date and time pickers (cleaner on small screens). */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.date')}
                </label>
                <input
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
                  className="block text-[12px] font-semibold mb-1.5"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.time')}
                </label>
                <input
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
                      {p === 'SITTING' ? 'Sitting' : p === 'STANDING' ? 'Standing' : 'Lying'}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* BP */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.bloodPressure')}
              </label>
              <div className="flex gap-3 items-center">
                <input
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
                <span className="text-[18px] font-semibold" style={{ color: 'var(--brand-text-muted)' }}>
                  /
                </span>
                <input
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
              </div>
            </div>

            {/* Pulse */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.pulseLabel')}
              </label>
              <input
                type="number"
                placeholder={t('readings.pulsePlaceholder')}
                value={form.pulse}
                onChange={(e) => onChange('pulse', e.target.value)}
                min={30}
                max={220}
                className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
            </div>

            {/* Weight */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.weightLbs')}
              </label>
              <input
                type="number"
                placeholder="e.g. 165"
                value={form.weight}
                onChange={(e) => onChange('weight', e.target.value)}
                min={20}
                max={600}
                className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
            </div>

            {/* Medication */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-2"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.medicationTaken')}
              </label>
              <div className="flex gap-3">
                {(['yes', 'no', ''] as const).map((val) => (
                  <button
                    key={val || 'na'}
                    type="button"
                    onClick={() => onChange('medication', val)}
                    className="flex-1 h-10 rounded-xl border-2 text-[13px] font-semibold transition cursor-pointer"
                    style={{
                      borderColor:
                        form.medication === val
                          ? 'var(--brand-primary-purple)'
                          : 'var(--brand-border)',
                      backgroundColor:
                        form.medication === val
                          ? 'var(--brand-primary-purple-light)'
                          : 'transparent',
                      color:
                        form.medication === val
                          ? 'var(--brand-primary-purple)'
                          : 'var(--brand-text-muted)',
                    }}
                  >
                    {val === '' ? t('common.na') : val === 'yes' ? t('common.yes') : t('common.no')}
                  </button>
                ))}
              </div>
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
                {SYMPTOM_KEYS.map((key) => {
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

            {/* Other / freeform symptoms */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('checkin.b3.otherLabel')}
              </label>
              <input
                type="text"
                value={form.otherSymptomsText}
                onChange={(e) => onChange('otherSymptomsText', e.target.value)}
                placeholder={t('checkin.b3.otherPlaceholder')}
                className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
            </div>

            {/* Notes */}
            <div>
              <label
                className="block text-[12px] font-semibold mb-1.5"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('readings.notes')}
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => onChange('notes', e.target.value)}
                placeholder={t('readings.notesPlaceholder')}
                rows={3}
                className="w-full px-3 py-2.5 rounded-xl border text-[14px] outline-none resize-none leading-relaxed"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
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
              style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
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
        className="relative w-full max-w-sm bg-white rounded-2xl p-6 text-center"
        style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.92, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: '#FEE2E2' }}
        >
          <Trash2 className="w-5 h-5 text-red-500" />
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
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 h-11 rounded-full text-white text-sm font-bold disabled:opacity-60"
            style={{ backgroundColor: '#DC2626' }}
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
        if (!cancelled) setHeightCm(p?.heightCm ?? null);
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
      weight: entry.weight?.toString() ?? '',
      medication:
        entry.medicationTaken === true
          ? 'yes'
          : entry.medicationTaken === false
            ? 'no'
            : '',
      severeHeadache: entry.severeHeadache ?? false,
      visualChanges: entry.visualChanges ?? false,
      alteredMentalStatus: entry.alteredMentalStatus ?? false,
      chestPainOrDyspnea: entry.chestPainOrDyspnea ?? false,
      focalNeuroDeficit: entry.focalNeuroDeficit ?? false,
      severeEpigastricPain: entry.severeEpigastricPain ?? false,
      newOnsetHeadache: entry.newOnsetHeadache ?? false,
      ruqPain: entry.ruqPain ?? false,
      edema: entry.edema ?? false,
      // Surface the v1 freeform symptoms array (and any v2 otherSymptoms) as
      // a single editable line so legacy data stays visible and editable.
      otherSymptomsText: [
        ...(entry.otherSymptoms ?? []),
        ...(entry.symptoms ?? []),
      ].join(', '),
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
      if (editForm.weight) payload.weight = parseFloat(editForm.weight);
      if (editForm.medication === 'yes') payload.medicationTaken = true;
      else if (editForm.medication === 'no') payload.medicationTaken = false;
      // Structured V2 symptoms — always send so toggling off is persisted.
      payload.severeHeadache = editForm.severeHeadache;
      payload.visualChanges = editForm.visualChanges;
      payload.alteredMentalStatus = editForm.alteredMentalStatus;
      payload.chestPainOrDyspnea = editForm.chestPainOrDyspnea;
      payload.focalNeuroDeficit = editForm.focalNeuroDeficit;
      payload.severeEpigastricPain = editForm.severeEpigastricPain;
      payload.newOnsetHeadache = editForm.newOnsetHeadache;
      payload.ruqPain = editForm.ruqPain;
      payload.edema = editForm.edema;
      payload.otherSymptoms = editForm.otherSymptomsText.trim()
        ? [editForm.otherSymptomsText.trim()]
        : [];
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
    <div className="min-h-screen" style={{ backgroundColor: '#FAFBFF' }}>
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6">
        {/* Page header */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #7B00E0, #9333EA)' }}
            >
              <Activity className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <h1
                className="text-xl font-bold truncate"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {t('readings.title')}
              </h1>
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
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('readings.newCheckin')}</span>
          </Link>
        </div>

        {/* List — grouped by date */}
        <div className="space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => <EntrySkeleton key={i} />)
        ) : entries.length === 0 ? (
          <div className="text-center py-20">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <Activity
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
              <Plus className="w-4 h-4" />
              {t('readings.startCheckin')}
            </Link>
          </div>
        ) : (
          (() => {
            // Group entries by date
            const grouped: { date: string; items: Entry[] }[] = [];
            const dateMap = new Map<string, Entry[]>();
            for (const entry of entries) {
              const dateKey = entry.measuredAt?.split('T')[0] ?? entry.measuredAt;
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
                    <div key={group.date} className="space-y-2">
                      {group.items.length > 1 && (
                        <p
                          className="text-[11px] font-bold uppercase tracking-wider px-1 pt-2"
                          style={{ color: 'var(--brand-text-muted)' }}
                        >
                          {formatDate(group.date)} — {group.items.length} readings
                        </p>
                      )}
                      {buckets.map((bucket, i) =>
                        bucket.sessionId && bucket.items.length > 1 ? (
                          <SessionCard
                            key={bucket.sessionId}
                            entries={bucket.items}
                            heightCm={heightCm}
                            onEdit={openEdit}
                            onDelete={(id) => setDeleteId(id)}
                          />
                        ) : (
                          <EntryCard
                            key={bucket.items[0].id + (bucket.sessionId ?? `solo-${i}`)}
                            entry={bucket.items[0]}
                            heightCm={heightCm}
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

      {/* Edit modal */}
      <AnimatePresence>
        {editEntry && editForm && (
          <EditModal
            form={editForm}
            saving={editSaving}
            error={editError}
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
    </div>
  );
}
