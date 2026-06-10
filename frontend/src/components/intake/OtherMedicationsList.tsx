'use client';

// Phase/28 — list of OTHER_UNVERIFIED meds (added via OCR scan or A8 freeform
// "Other" input). Renders as a tile grid below the catalog tiles on A5 + A8.
// Each tile is selectable / unselectable (body click toggles), editable
// (pencil → opens OtherMedEditModal), and deletable (trash → removes
// immediately). Selection state mirrors catalog tiles so the UI feels
// consistent — but the underlying model is "in selectedMedications" vs
// "removed from selectedMedications", same as the toggle helpers in
// clinical-intake/page.tsx.

import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Trash2, Pill } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';
import type { SelectedMedication } from '@/lib/intake/types';

interface Props {
  meds: SelectedMedication[];
  /** Toggle = unselect = remove from selectedMedications (instant-undo). */
  onToggle: (med: SelectedMedication) => void;
  /** Open the edit modal for this med. */
  onEdit: (med: SelectedMedication) => void;
  /** Hard delete from selectedMedications. */
  onDelete: (med: SelectedMedication) => void;
}

/**
 * Returns a stable React key for a med. Uses serverId when present (loaded
 * from a prior session); falls back to drugName for in-session adds. The
 * caller must guarantee drugName uniqueness within OTHER_UNVERIFIED rows
 * (findExistingMedIndex enforces this on add).
 */
function medKey(m: SelectedMedication): string {
  return m.serverId ?? `freeform:${m.drugName.toLowerCase()}`;
}

export default function OtherMedicationsList({
  meds,
  onToggle,
  onEdit,
  onDelete,
}: Props) {
  const { t } = useLanguage();

  if (meds.length === 0) return null;

  // Compose audio readout: "Your other medications: Drug A, frequency, purpose. Drug B, ..."
  const audioText = (() => {
    const parts: string[] = [
      `${t('intake.a5.otherMedsTitle')}.`,
    ];
    const sentences = meds.map((m) => {
      const freq = m.frequency ? frequencyAudioPhrase(m.frequency, t) : '';
      const purpose = m.plainLanguageDescription ? `. ${m.plainLanguageDescription}` : '';
      return `${m.drugName}${freq ? `, ${freq}` : ''}${purpose}`;
    });
    parts.push(`${sentences.join('. ')}.`);
    return parts.join(' ');
  })();

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-1">
        <h3
          className="text-[0.875rem] font-bold"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {t('intake.a5.otherMedsTitle')} ({meds.length})
        </h3>
        <AudioButton size="sm" text={audioText} lang="en" />
      </div>
      <div className="flex flex-col gap-2">
        <AnimatePresence initial={false}>
          {meds.map((m) => (
            <motion.div
              key={medKey(m)}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4, height: 0 }}
              transition={{ duration: 0.18 }}
            >
              <OtherMedTile
                med={m}
                onToggle={() => onToggle(m)}
                onEdit={() => onEdit(m)}
                onDelete={() => onDelete(m)}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function OtherMedTile({
  med,
  onToggle,
  onEdit,
  onDelete,
}: {
  med: SelectedMedication;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useLanguage();
  const freqLabel = med.frequency
    ? frequencyVisualLabel(med.frequency, t)
    : t('intake.freq.unset');

  // Tile body acts like the catalog tile — body click toggles. The action
  // icons stop propagation so they don't double-fire onToggle when tapped.
  return (
    <div
      className="rounded-xl p-3 flex items-start gap-3 cursor-pointer transition-colors"
      style={{
        border: '2px solid var(--brand-primary-purple)',
        backgroundColor: 'var(--brand-primary-purple-light)',
        boxShadow: '0 2px 8px rgba(123,0,224,0.08)',
      }}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      {med.pillImageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={med.pillImageUrl}
          alt=""
          aria-hidden="true"
          className="w-9 h-9 mt-0.5 rounded-md object-cover shrink-0"
          style={{ border: '1px solid var(--brand-border)' }}
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = 'none';
          }}
        />
      ) : (
        <Pill
          className="w-5 h-5 mt-1 shrink-0"
          style={{ color: 'var(--brand-primary-purple)' }}
          aria-hidden="true"
        />
      )}
      <div className="flex-1 min-w-0">
        <p
          className="text-[0.875rem] font-bold leading-tight"
          lang="en"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {med.drugName}
        </p>
        {med.plainLanguageDescription && (
          <p
            className="text-[0.71875rem] mt-0.5 leading-snug"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {med.plainLanguageDescription}
          </p>
        )}
        <p
          className="text-[0.75rem] mt-0.5"
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {freqLabel}
        </p>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={t('intake.a5.otherMedEdit')}
          className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)]"
        >
          <Pencil
            className="w-4 h-4"
            style={{ color: 'var(--brand-primary-purple)' }}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          data-testid="intake-medication-delete-button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label={t('intake.a5.otherMedDelete')}
          className="w-9 h-9 rounded-full flex items-center justify-center cursor-pointer transition-colors hover:bg-white/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)]"
        >
          <Trash2
            className="w-4 h-4"
            style={{ color: 'var(--brand-alert-red)' }}
            aria-hidden="true"
          />
        </button>
      </div>
    </div>
  );
}

// ── Local label helpers ──────────────────────────────────────────────────────
// Two flavours of the same data: a short visual label for the tile, and a
// natural-language phrase for the AudioButton readout. Kept local because
// the component owns its own text style and we don't want to leak more
// frequency-formatting helpers into the global namespace.

type FrequencyKey = NonNullable<SelectedMedication['frequency']>;
type T = ReturnType<typeof useLanguage>['t'];

function frequencyVisualLabel(f: FrequencyKey, t: T): string {
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

function frequencyAudioPhrase(f: FrequencyKey, t: T): string {
  // Same labels work for audio — they read naturally. If we add custom
  // audio phrasing later (e.g. "morning and evening" instead of "Twice
  // a day"), this is the seam.
  return frequencyVisualLabel(f, t).toLowerCase();
}
