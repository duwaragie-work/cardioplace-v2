'use client';

// Phase/28 — small modal launched from the OtherMedicationsList edit pencil.
// Lets the patient amend an OTHER_UNVERIFIED med's drugName + frequency.
// Validates non-empty drug name + rejects renaming into an existing entry
// (mirrors A8's freeform addOther dedup-error pattern). Surfaces a friendly
// hint when the new name happens to match a catalog entry — but never
// auto-promotes (drugClass change is a clinical decision deferred to
// Dr. Singal's review). ARIA-correct dialog + ESC closes.

import { useState, useEffect, useId } from 'react';
import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { matchToCatalog } from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import type { SelectedMedication } from '@/lib/intake/types';
import type { MedicationFrequencyInput } from '@cardioplace/shared';

const FREQUENCIES: ReadonlyArray<MedicationFrequencyInput> = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'AS_NEEDED',
  'UNSURE',
];

interface Props {
  med: SelectedMedication;
  /** Caller decides whether the proposed rename collides with another row.
   *  Returns true when the new name matches a different existing med, in
   *  which case Save shows the dup-error inline instead of mutating state. */
  isDuplicateName: (proposedName: string, currentMed: SelectedMedication) => boolean;
  onSave: (med: SelectedMedication, patch: { drugName: string; frequency?: MedicationFrequencyInput }) => void;
  onCancel: () => void;
}

export default function OtherMedEditModal({
  med,
  isDuplicateName,
  onSave,
  onCancel,
}: Props) {
  const { t } = useLanguage();
  const titleId = useId();
  const [drugName, setDrugName] = useState(med.drugName);
  const [frequency, setFrequency] = useState<MedicationFrequencyInput>(
    med.frequency ?? 'UNSURE',
  );
  const [error, setError] = useState<string | null>(null);

  // Catalog hint — when the patient is renaming the row to something that's
  // actually in our 33-entry cardio catalog, surface a one-line nudge so
  // they consider tapping the catalog tile instead. Doesn't block save.
  const trimmed = drugName.trim();
  const catalogMatch =
    trimmed && trimmed.toLowerCase() !== med.drugName.toLowerCase()
      ? matchToCatalog(trimmed)
      : null;

  // ESC closes the dialog (matches existing modal patterns in this app).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const handleSave = () => {
    setError(null);
    if (!trimmed) {
      setError(t('intake.a5.otherMedDrugLabel'));
      return;
    }
    if (trimmed.length > 60) {
      // Same 60-char limit as A8's addOther — keeps the row label readable
      // on the tile and matches PatientMedication.drugName persistence.
      setError(t('intake.a5.otherMedDrugLabel'));
      return;
    }
    if (isDuplicateName(trimmed, med)) {
      setError(
        t('intake.a5.otherMedDupError').replace('{name}', trimmed),
      );
      return;
    }
    onSave(med, { drugName: trimmed.slice(0, 60), frequency });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <button
        type="button"
        aria-label={t('accessibility.closeDialog')}
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
      >
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <h2
            id={titleId}
            className="text-[16px] font-bold"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('intake.a5.otherMedEditModalTitle')}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="w-11 h-11 rounded-full flex items-center justify-center cursor-pointer shrink-0"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('accessibility.closeDialog')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="other-med-name"
              className="text-[12px] font-semibold"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {t('intake.a5.otherMedDrugLabel')}
            </label>
            <input
              id="other-med-name"
              type="text"
              lang="en"
              maxLength={60}
              value={drugName}
              onChange={(e) => {
                setDrugName(e.target.value);
                if (error) setError(null);
              }}
              className="h-11 px-3 rounded-lg text-[14px] outline-none box-border bg-white"
              style={{
                border: error
                  ? '2px solid var(--brand-alert-red)'
                  : '2px solid var(--brand-border)',
                color: 'var(--brand-text-primary)',
              }}
            />
            {catalogMatch && !error && (
              <p
                className="text-[11px] mt-0.5 leading-snug"
                style={{ color: 'var(--brand-primary-purple)' }}
              >
                {t('intake.a5.otherMedCatalogHint').replace(
                  '{name}',
                  catalogMatch.drugName,
                )}
              </p>
            )}
            {error && (
              <p
                role="alert"
                className="text-[12px] mt-0.5 leading-snug"
                style={{ color: 'var(--brand-alert-red)' }}
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="other-med-freq"
              className="text-[12px] font-semibold"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {t('intake.a5.otherMedFrequencyLabel')}
            </label>
            <select
              id="other-med-freq"
              value={frequency}
              onChange={(e) =>
                setFrequency(e.target.value as MedicationFrequencyInput)
              }
              className="h-11 px-3 rounded-lg text-[14px] outline-none cursor-pointer box-border bg-white"
              style={{
                border: '2px solid var(--brand-border)',
                color: 'var(--brand-text-primary)',
              }}
            >
              {FREQUENCIES.map((f) => (
                <option key={f} value={f}>
                  {frequencyLabel(f, t)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="shrink-0 px-5 py-4 flex gap-2"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <button
            type="button"
            data-testid="intake-medication-save-button"
            onClick={handleSave}
            className="flex-1 h-11 rounded-xl font-bold text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
              boxShadow: '0 4px 14px rgba(123,0,224,0.28)',
            }}
          >
            {t('intake.a5.otherMedSave')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              backgroundColor: 'var(--brand-background)',
              color: 'var(--brand-text-primary)',
            }}
          >
            {t('intake.a5.otherMedCancel')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

type T = ReturnType<typeof useLanguage>['t'];

function frequencyLabel(f: MedicationFrequencyInput, t: T): string {
  switch (f) {
    case 'ONCE_DAILY':
      return t('profile.freqOnceDaily');
    case 'TWICE_DAILY':
      return t('profile.freqTwiceDaily');
    case 'THREE_TIMES_DAILY':
      return t('profile.freqThreeTimesDaily');
    case 'AS_NEEDED':
      return t('profile.freqAsNeeded');
    case 'UNSURE':
      return t('profile.freqUnknown');
  }
}
