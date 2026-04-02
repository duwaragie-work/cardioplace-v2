'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  X,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import {
  getJournalEntries,
  updateJournalEntry,
  deleteJournalEntry,
} from '@/lib/services/journal.service';
import { useLanguage } from '@/contexts/LanguageContext';

// ─── Types ────────────────────────────────────────────────────────────────────
type Entry = {
  id: string;
  entryDate: string;
  measurementTime?: string | null;
  systolicBP?: number;
  diastolicBP?: number;
  weight?: number;
  medicationTaken?: boolean | null;
  symptoms?: string[];
  notes?: string;
};

type EditForm = {
  entryDate: string;
  measurementTime: string;
  systolic: string;
  diastolic: string;
  weight: string;
  medication: 'yes' | 'no' | '';
  symptoms: string[];
  notes: string;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const SYMPTOM_OPTIONS = [
  'Chest Pain',
  'Severe Headache',
  'Shortness of Breath',
  'Dizziness',
  'Blurred Vision',
  'Fatigue',
  'Nausea',
  'Swelling',
  'Palpitations',
];

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
  onEdit,
  onDelete,
}: {
  entry: Entry;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const hasBP = entry.systolicBP && entry.diastolicBP;
  const bpStatus = hasBP ? getBpStatus(entry.systolicBP!, entry.diastolicBP!) : null;

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
          {/* Date + Time */}
          <div className="flex items-center gap-2 mb-2">
            <p
              className="text-[12px] font-semibold"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {formatDate(entry.entryDate)}
            </p>
            {entry.measurementTime && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded font-semibold"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {entry.measurementTime}
              </span>
            )}
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
                  mmHg
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

          {/* Detail chips */}
          <div className="flex flex-wrap gap-1.5 mt-1">
            {entry.weight != null && (
              <span
                className="text-[11px] px-2 py-0.5 rounded-md font-medium"
                style={{
                  backgroundColor: 'var(--brand-primary-purple-light)',
                  color: 'var(--brand-primary-purple)',
                }}
              >
                {entry.weight} lbs
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

// ─── Edit Modal ───────────────────────────────────────────────────────────────
function EditModal({
  form,
  saving,
  error,
  onChange,
  onSave,
  onClose,
}: {
  form: EditForm;
  saving: boolean;
  error: string;
  onChange: (key: keyof EditForm, val: string | string[]) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  function toggleSymptom(s: string) {
    const updated = form.symptoms.includes(s)
      ? form.symptoms.filter((x) => x !== s)
      : [...form.symptoms, s];
    onChange('symptoms', updated);
  }

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

      {/* Sheet */}
      <motion.div
        className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl overflow-y-auto"
        style={{
          maxHeight: '90dvh',
          boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
        }}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 bg-white flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <h2 className="text-[16px] font-bold" style={{ color: 'var(--brand-text-primary)' }}>
            {t('readings.editReading')}
          </h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center transition hover:opacity-70"
            style={{ backgroundColor: 'var(--brand-background)' }}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Date */}
          <div>
            <label
              className="block text-[12px] font-semibold mb-1.5"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {t('checkin.date')}
            </label>
            <input
              type="date"
              value={form.entryDate}
              onChange={(e) => onChange('entryDate', e.target.value)}
              className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-primary)',
              }}
            />
          </div>

          {/* Time */}
          <div>
            <label
              className="block text-[12px] font-semibold mb-1.5"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {t('checkin.time')}
            </label>
            <input
              type="time"
              value={form.measurementTime}
              onChange={(e) => onChange('measurementTime', e.target.value)}
              className="w-full h-11 px-3 rounded-xl border text-[14px] outline-none"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-primary)',
              }}
            />
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
                max={220}
                className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none"
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
                className="flex-1 h-11 px-3 rounded-xl border text-[14px] outline-none"
                style={{
                  borderColor: 'var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
            </div>
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
              min={50}
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
                  key={val}
                  onClick={() => onChange('medication', val)}
                  className="flex-1 h-10 rounded-xl border-2 text-[13px] font-semibold transition"
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

          {/* Symptoms */}
          <div>
            <label
              className="block text-[12px] font-semibold mb-2"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {t('readings.symptoms')}
            </label>
            <div className="flex flex-wrap gap-2">
              {SYMPTOM_OPTIONS.map((s) => {
                const active = form.symptoms.includes(s);
                return (
                  <button
                    key={s}
                    onClick={() => toggleSymptom(s)}
                    className="px-3 py-1.5 rounded-full border text-[12px] font-medium transition"
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
                    {s}
                  </button>
                );
              })}
            </div>
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

          {error && (
            <p className="text-[13px] text-center" style={{ color: 'var(--brand-alert-red)' }}>
              {error}
            </p>
          )}

          {/* Buttons */}
          <div className="flex gap-3 pb-1">
            <button
              onClick={onClose}
              className="flex-1 h-11 rounded-full border-2 text-sm font-semibold"
              style={{
                borderColor: 'var(--brand-border)',
                color: 'var(--brand-text-secondary)',
              }}
            >
              {t('common.cancel')}
            </button>
            <button
              onClick={onSave}
              disabled={saving}
              className="flex-1 h-11 rounded-full text-white text-sm font-bold disabled:opacity-60 transition"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
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
  const [editEntry, setEditEntry] = useState<Entry | null>(null);
  const [editForm, setEditForm] = useState<EditForm | null>(null);
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
          (a: Entry, b: Entry) =>
            new Date(b.entryDate).getTime() - new Date(a.entryDate).getTime(),
        );
        setEntries(sorted);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openEdit(entry: Entry) {
    setEditEntry(entry);
    setEditForm({
      entryDate: entry.entryDate?.split('T')[0] ?? '',
      measurementTime: entry.measurementTime ?? '',
      systolic: entry.systolicBP?.toString() ?? '',
      diastolic: entry.diastolicBP?.toString() ?? '',
      weight: entry.weight?.toString() ?? '',
      medication:
        entry.medicationTaken === true
          ? 'yes'
          : entry.medicationTaken === false
            ? 'no'
            : '',
      symptoms: entry.symptoms ?? [],
      notes: entry.notes ?? '',
    });
    setEditError('');
  }

  function closeEdit() {
    setEditEntry(null);
    setEditForm(null);
    setEditError('');
  }

  async function saveEdit() {
    if (!editEntry || !editForm) return;
    setEditSaving(true);
    setEditError('');
    try {
      const payload: Parameters<typeof updateJournalEntry>[1] = {};
      if (editForm.entryDate) payload.entryDate = editForm.entryDate;
      if (editForm.measurementTime) payload.measurementTime = editForm.measurementTime;
      if (editForm.systolic) payload.systolicBP = parseInt(editForm.systolic, 10);
      if (editForm.diastolic) payload.diastolicBP = parseInt(editForm.diastolic, 10);
      if (editForm.weight) payload.weight = parseFloat(editForm.weight);
      if (editForm.medication === 'yes') payload.medicationTaken = true;
      else if (editForm.medication === 'no') payload.medicationTaken = false;
      payload.symptoms = editForm.symptoms.filter((s) => s !== 'None of these');
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
    <div className="min-h-screen" style={{ backgroundColor: 'var(--brand-background)' }}>
      {/* Page header */}
      <div
        className="sticky top-16 z-30 bg-white/90 backdrop-blur-sm px-4 md:px-8 py-4"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/check-in"
              className="w-9 h-9 rounded-full flex items-center justify-center transition hover:opacity-75"
              style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
            >
              <ArrowLeft className="w-4 h-4" style={{ color: 'var(--brand-primary-purple)' }} />
            </Link>
            <div>
              <h1
                className="text-[18px] font-bold leading-tight"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {t('readings.title')}
              </h1>
              <p className="text-[12px]" style={{ color: 'var(--brand-text-muted)' }}>
                {loading ? 'Loading...' : `${entries.length} ${entries.length === 1 ? t('readings.totalEntry') : t('readings.totalEntries')}`}
              </p>
            </div>
          </div>

          <Link
            href="/check-in"
            className="h-9 px-4 rounded-full flex items-center gap-1.5 text-[13px] font-semibold text-white transition hover:opacity-85"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">{t('readings.newCheckin')}</span>
          </Link>
        </div>
      </div>

      {/* List — grouped by date */}
      <div className="max-w-2xl mx-auto px-4 md:px-8 py-6 space-y-3">
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
              const dateKey = entry.entryDate?.split('T')[0] ?? entry.entryDate;
              if (!dateMap.has(dateKey)) dateMap.set(dateKey, []);
              dateMap.get(dateKey)!.push(entry);
            }
            for (const [date, items] of dateMap) {
              grouped.push({ date, items });
            }

            return (
              <AnimatePresence mode="popLayout">
                {grouped.map((group) => (
                  <div key={group.date} className="space-y-2">
                    {group.items.length > 1 && (
                      <p
                        className="text-[11px] font-bold uppercase tracking-wider px-1 pt-2"
                        style={{ color: 'var(--brand-text-muted)' }}
                      >
                        {formatDate(group.date)} — {group.items.length} readings
                      </p>
                    )}
                    {group.items.map((entry) => (
                      <EntryCard
                        key={entry.id}
                        entry={entry}
                        onEdit={() => openEdit(entry)}
                        onDelete={() => setDeleteId(entry.id)}
                      />
                    ))}
                  </div>
                ))}
              </AnimatePresence>
            );
          })()
        )}
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editEntry && editForm && (
          <EditModal
            form={editForm}
            saving={editSaving}
            error={editError}
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
