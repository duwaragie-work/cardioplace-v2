'use client';

// Patient-typed custom symptom tag input. Used in the daily check-in (Flow B
// step 5) and the readings edit modal so both surfaces add/edit/remove custom
// symptoms identically. Stored per reading in JournalEntry.otherSymptoms.
//
//   - Type + press Enter (or tap Add) → adds a chip
//   - Tap the × on a chip → removes it
//   - Tap a chip body → loads it back into the input for editing (and removes
//     the chip, so re-adding saves the corrected text)
//   - Mic button dictates into the draft input (voice parity with the rest of
//     the form); the patient reviews then adds
//
// Bounds (per-item length + total count) mirror the backend @MaxLength /
// @ArrayMaxSize guards via the shared journal-limits constants.

import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH,
  JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT,
} from '@cardioplace/shared';
import MicButton from '@/components/intake/MicButton';

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
  /** id for the draft <input> — threads to the label + MicButton aria-controls. */
  inputId: string;
  label: string;
  placeholder: string;
  /** Visible text + aria-label for the Add button. */
  addLabel: string;
  /** aria-label prefix for each chip's remove button (e.g. "Remove"). */
  removeLabel: string;
  /** aria-label prefix for editing a chip (e.g. "Edit"). */
  editLabel: string;
  maxItems?: number;
  maxLength?: number;
  /** Optional test-id prefix for QA hooks. */
  testIdPrefix?: string;
}

export default function SymptomTagInput({
  value,
  onChange,
  inputId,
  label,
  placeholder,
  addLabel,
  removeLabel,
  editLabel,
  maxItems = JOURNAL_CUSTOM_SYMPTOMS_MAX_COUNT,
  maxLength = JOURNAL_CUSTOM_SYMPTOM_MAX_LENGTH,
  testIdPrefix,
}: Props) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const atCapacity = value.length >= maxItems;
  const trimmed = draft.trim();
  const isDuplicate = value.some((s) => s.toLowerCase() === trimmed.toLowerCase());
  const canAdd = trimmed.length > 0 && !atCapacity && !isDuplicate;

  // Add a raw string as a chip (trim, clamp, dedupe, capacity). Returns whether
  // it was added so callers can decide what to do with the leftover text.
  const addValue = (raw: string): boolean => {
    const v = raw.trim().slice(0, maxLength);
    if (!v || value.length >= maxItems) return false;
    if (value.some((s) => s.toLowerCase() === v.toLowerCase())) return false;
    onChange([...value, v]);
    return true;
  };

  const add = () => {
    if (addValue(draft)) {
      setDraft('');
      inputRef.current?.focus();
    }
  };

  const removeAt = (i: number) => {
    onChange(value.filter((_, idx) => idx !== i));
  };

  // Edit = pop the chip back into the draft so the patient corrects it and
  // re-adds. Keeps the interaction model tiny (no inline-edit state machine).
  const editAt = (i: number) => {
    setDraft(value[i]);
    onChange(value.filter((_, idx) => idx !== i));
    inputRef.current?.focus();
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <label
          htmlFor={inputId}
          className="block text-[0.8125rem] font-semibold"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {label}
        </label>
        <MicButton
          inputId={inputId}
          onTranscript={(text) => {
            // Voice adds the spoken symptom straight to the chip list. If it
            // can't be added (duplicate / at capacity), keep the words in the
            // draft so nothing is lost and the patient can adjust.
            if (addValue(text)) setDraft('');
            else setDraft((d) => (d ? `${d} ${text}`.trim() : text).slice(0, maxLength));
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          id={inputId}
          data-testid={testIdPrefix ? `${testIdPrefix}-input` : undefined}
          type="text"
          value={draft}
          maxLength={maxLength}
          onChange={(e) => setDraft(e.target.value.slice(0, maxLength))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          aria-describedby={atCapacity ? `${inputId}-cap` : undefined}
          className="flex-1 min-w-0 h-11 px-4 rounded-xl text-[0.875rem] outline-none transition"
          style={{
            border: '2px solid var(--brand-border)',
            color: 'var(--brand-text-primary)',
            backgroundColor: 'white',
          }}
        />
        <button
          type="button"
          data-testid={testIdPrefix ? `${testIdPrefix}-add` : undefined}
          onClick={add}
          disabled={!canAdd}
          aria-label={addLabel}
          className="shrink-0 h-11 px-4 rounded-xl text-[0.8125rem] font-semibold flex items-center gap-1.5 transition disabled:opacity-40 disabled:cursor-not-allowed enabled:cursor-pointer"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light)',
            color: 'var(--brand-primary-purple)',
          }}
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">{addLabel}</span>
        </button>
      </div>

      {atCapacity && (
        <p id={`${inputId}-cap`} className="mt-1 text-[0.6875rem]" style={{ color: 'var(--brand-text-muted)' }}>
          {value.length}/{maxItems}
        </p>
      )}

      {value.length > 0 && (
        <div
          data-testid={testIdPrefix ? `${testIdPrefix}-chips` : undefined}
          className="flex flex-wrap gap-2 mt-3"
        >
          {value.map((symptom, i) => (
            <span
              key={`${symptom}-${i}`}
              className="inline-flex items-center gap-1.5 pl-3 pr-1.5 py-1 rounded-full text-[0.78125rem] font-medium"
              style={{
                backgroundColor: 'var(--brand-primary-purple-light)',
                color: 'var(--brand-primary-purple)',
              }}
            >
              <button
                type="button"
                onClick={() => editAt(i)}
                aria-label={`${editLabel}: ${symptom}`}
                className="max-w-[200px] truncate cursor-pointer outline-none focus-visible:underline"
              >
                {symptom}
              </button>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`${removeLabel}: ${symptom}`}
                className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center transition hover:bg-white/60 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
