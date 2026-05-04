'use client';

// Phase/27 medication-list OCR confirmation modal.
//
// MUST be the gating step between Gemini extraction and the wizard's
// medication state — values never auto-populate. The patient can:
//   • Edit any drug name inline (badge updates live as catalog match changes)
//   • Pick a frequency from the 4-value enum
//   • Skip a row (toggle keep flag — opacity drops, won't be added)
//   • Tap Add all — only kept rows flow back via onConfirm
//
// Catalog match runs on every keystroke via matchToCatalog from
// @cardioplace/shared, so the patient sees "In catalog" / "Will be added as
// freeform" badges that adapt as they correct OCR misreads.

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { X, AlertTriangle, Check, Pill } from 'lucide-react';
import {
  matchToCatalog,
  normaliseFrequency,
  type CatalogMatch,
} from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from './AudioButton';
import type { MedOcrItem } from '@/lib/services/ocr.service';

export interface ConfirmedMedication {
  /** What the user finalised in the modal — may differ from the OCR raw. */
  drugName: string;
  /** 4-value enum from the dropdown. */
  frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'UNSURE';
  /** Catalog match (or null if patient chose to keep it as freeform). */
  match: CatalogMatch | null;
  /** Original OCR snippet — preserved on PatientMedication.rawInputText. */
  raw: string;
}

interface Props {
  medications: MedOcrItem[];
  confidence: number;
  previewUrl: string;
  onConfirm: (kept: ConfirmedMedication[]) => void;
  onCancel: () => void;
  onRetake: () => void;
}

/** Internal row state — adds the editable drugName + selected frequency on
 *  top of the OCR-extracted MedOcrItem. */
interface RowState {
  drugName: string;
  frequency: 'ONCE_DAILY' | 'TWICE_DAILY' | 'THREE_TIMES_DAILY' | 'UNSURE';
  raw: string;
  doseText: string;
  kept: boolean;
}

const FREQUENCIES: ReadonlyArray<RowState['frequency']> = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'UNSURE',
];

export default function MedicationPhotoConfirmModal({
  medications,
  confidence,
  previewUrl,
  onConfirm,
  onCancel,
  onRetake,
}: Props) {
  const { t } = useLanguage();

  // Initial rows — derive frequency from Gemini's free text, default kept=true.
  const [rows, setRows] = useState<RowState[]>(() =>
    medications.map((m) => ({
      drugName: m.drugName,
      frequency: normaliseFrequency(m.frequency),
      raw: m.raw || m.drugName,
      doseText: m.doseText,
      kept: true,
    })),
  );

  const updateRow = (i: number, patch: Partial<RowState>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleConfirm = () => {
    const kept: ConfirmedMedication[] = rows
      .filter((r) => r.kept && r.drugName.trim().length > 0)
      .map((r) => ({
        drugName: r.drugName.trim(),
        frequency: r.frequency,
        match: matchToCatalog(r.drugName),
        raw: r.raw,
      }));
    onConfirm(kept);
  };

  const audioText = useMemo(() => {
    const count = rows.length;
    return `I read ${count} medication${count === 1 ? '' : 's'} from your photo. Tap each to verify before adding.`;
  }, [rows.length]);

  const lowConfidence = confidence < 0.6;
  const keptCount = rows.filter((r) => r.kept && r.drugName.trim()).length;

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
        aria-labelledby="med-confirm-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{ maxHeight: '90dvh', boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4 gap-3"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="flex items-center gap-2">
            <h2
              id="med-confirm-title"
              className="text-[16px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('ocr.med.confirmTitle')}
            </h2>
            <AudioButton size="sm" text={audioText} lang="en" />
          </div>
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

        {/* Body — preview + scrollable rows */}
        <div className="flex-1 overflow-y-auto thin-scrollbar">
          <div className="p-5 flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <img
                src={previewUrl}
                alt=""
                aria-hidden="true"
                className="w-20 h-20 rounded-xl object-cover shrink-0"
                style={{ border: '1px solid var(--brand-border)' }}
              />
              <div className="flex-1 min-w-0">
                <p
                  className="text-[13px] leading-relaxed"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  {t('ocr.med.helpText').replace('{count}', String(rows.length))}
                </p>
                {lowConfidence && (
                  <p
                    className="text-[11px] mt-1"
                    style={{ color: 'var(--brand-warning-amber)' }}
                  >
                    {t('ocr.med.lowConfidenceWarning')}
                  </p>
                )}
              </div>
            </div>

            {/* Rows */}
            <div className="flex flex-col gap-3">
              {rows.map((row, i) => (
                <RowCard
                  key={i}
                  row={row}
                  onChange={(patch) => updateRow(i, patch)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          className="shrink-0 px-5 py-4 flex flex-col sm:flex-row gap-2"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <button
            type="button"
            onClick={handleConfirm}
            disabled={keptCount === 0}
            className="flex-1 h-11 rounded-xl font-bold text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)] disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
              boxShadow:
                keptCount === 0 ? 'none' : '0 4px 14px rgba(123,0,224,0.28)',
            }}
          >
            {keptCount === 0
              ? t('ocr.med.addAllEmpty')
              : t('ocr.med.addAll').replace('{count}', String(keptCount))}
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
            {t('ocr.med.cancel')}
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="flex-1 h-11 rounded-xl font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            {t('ocr.med.retake')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ─── Row card ────────────────────────────────────────────────────────────────

function RowCard({
  row,
  onChange,
}: {
  row: RowState;
  onChange: (patch: Partial<RowState>) => void;
}) {
  const { t } = useLanguage();
  const match = useMemo(() => matchToCatalog(row.drugName), [row.drugName]);

  return (
    <div
      className="rounded-xl p-3 flex flex-col gap-2 transition-opacity"
      style={{
        border: '1px solid var(--brand-border)',
        backgroundColor: row.kept ? 'white' : 'var(--brand-background)',
        opacity: row.kept ? 1 : 0.55,
      }}
    >
      {/* Drug name + match badge */}
      <div className="flex items-start gap-2">
        <Pill
          className="w-5 h-5 mt-1 shrink-0"
          style={{ color: 'var(--brand-primary-purple)' }}
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0">
          <input
            type="text"
            lang="en"
            value={row.drugName}
            onChange={(e) => onChange({ drugName: e.target.value })}
            className="w-full text-[14px] font-semibold outline-none bg-transparent"
            style={{ color: 'var(--brand-text-primary)' }}
            aria-label={t('ocr.med.rowDrugNameLabel')}
            disabled={!row.kept}
          />
          {row.doseText && (
            <p
              lang="en"
              className="text-[11px] mt-0.5"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {row.doseText}
            </p>
          )}
        </div>
        <MatchBadge match={match} />
      </div>

      {/* Frequency + skip toggle */}
      <div className="flex items-center justify-between gap-2">
        <select
          value={row.frequency}
          onChange={(e) =>
            onChange({ frequency: e.target.value as RowState['frequency'] })
          }
          disabled={!row.kept}
          className="text-[12px] h-9 px-2 rounded-lg outline-none cursor-pointer"
          style={{
            border: '1px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
          aria-label={t('ocr.med.rowFrequencyLabel')}
        >
          {FREQUENCIES.map((f) => (
            <option key={f} value={f}>
              {frequencyLabel(f, t)}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onChange({ kept: !row.kept })}
          className="text-[12px] font-semibold px-3 h-9 rounded-lg transition-colors cursor-pointer"
          style={{
            backgroundColor: row.kept
              ? 'var(--brand-background)'
              : 'var(--brand-primary-purple-light)',
            color: row.kept
              ? 'var(--brand-text-secondary)'
              : 'var(--brand-primary-purple)',
          }}
        >
          {row.kept ? t('ocr.med.skip') : t('ocr.med.unskip')}
        </button>
      </div>
    </div>
  );
}

function MatchBadge({ match }: { match: CatalogMatch | null }) {
  const { t } = useLanguage();
  if (match) {
    return (
      <span
        className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
        style={{
          backgroundColor: 'var(--brand-success-green-light)',
          color: 'var(--brand-success-green)',
        }}
      >
        <Check className="w-3 h-3" aria-hidden="true" />
        {t('ocr.med.badgeInCatalog')}
      </span>
    );
  }
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider"
      style={{
        backgroundColor: 'var(--brand-warning-amber-light)',
        color: 'var(--brand-warning-amber)',
      }}
      title="Not in catalog — will be added as freeform with provider review"
    >
      <AlertTriangle className="w-3 h-3" aria-hidden="true" />
      {t('ocr.med.badgeFreeform')}
    </span>
  );
}

function frequencyLabel(
  f: RowState['frequency'],
  t: (
    key:
      | 'ocr.med.freqOnce'
      | 'ocr.med.freqTwice'
      | 'ocr.med.freqThrice'
      | 'ocr.med.freqUnsure',
  ) => string,
): string {
  switch (f) {
    case 'ONCE_DAILY':
      return t('ocr.med.freqOnce');
    case 'TWICE_DAILY':
      return t('ocr.med.freqTwice');
    case 'THREE_TIMES_DAILY':
      return t('ocr.med.freqThrice');
    case 'UNSURE':
      return t('ocr.med.freqUnsure');
  }
}
