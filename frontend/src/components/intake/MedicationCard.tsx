'use client';

// Visual medication card for A5 (core meds) + A6 (combo pills) + A8 (category
// meds). Layout: pill icon left, brand + generic + purpose center, audio
// button + take/don't toggle right. NDHP CCBs (Diltiazem/Verapamil) get a
// subtle purple-edged border so the provider-side coding distinction
// described in V2-B is visible without showing the patient any clinical
// jargon.

import { motion } from 'framer-motion';
import { Check, X } from 'lucide-react';
import type { DrugClassInput } from '@cardioplace/shared';
import AudioButton from './AudioButton';
import PillIcon from './PillIcon';

interface Props {
  brandName: string;
  genericName?: string;
  purpose: string;
  drugClass: DrugClassInput;
  isCombination?: boolean;
  /** True for Diltiazem + Verapamil — shows subtle distinguishing border. */
  isNdhpCcb?: boolean;
  selected: boolean;
  onToggle: () => void;
  audioText?: string;
  audioLang?: string;
}

export default function MedicationCard({
  brandName,
  genericName,
  purpose,
  drugClass,
  isCombination = false,
  isNdhpCcb = false,
  selected,
  onToggle,
  audioText,
  audioLang,
}: Props) {
  const accent = 'var(--brand-primary-purple)';

  // Border priority: selected > NDHP-CCB hint > default
  const borderColor = selected
    ? accent
    : isNdhpCcb
      ? '#9333EA' // purple variant — subtle clue without jargon
      : 'var(--brand-border)';

  const borderStyle = isNdhpCcb && !selected ? 'dashed' : 'solid';

  return (
    <motion.div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      aria-pressed={selected}
      className="relative rounded-2xl p-4 cursor-pointer transition-all"
      style={{
        backgroundColor: selected ? 'var(--brand-primary-purple-light)' : 'white',
        // Use the `border` shorthand alone — mixing it with `borderWidth` makes
        // React warn about conflicting style updates on re-render.
        border: `2px ${borderStyle} ${borderColor}`,
        boxShadow: selected ? '0 4px 14px rgba(123,0,224,0.15)' : 'none',
      }}
      whileHover={{ scale: 1.01 }}
      whileTap={{ scale: 0.99 }}
    >
      {isCombination && (
        <span
          className="absolute -top-2.5 left-4 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider"
          style={{
            backgroundColor: 'var(--brand-accent-teal)',
            color: 'white',
          }}
        >
          2-in-1
        </span>
      )}

      <div className="flex items-center gap-3">
        <div className="shrink-0">
          <PillIcon drugClass={drugClass} combo={isCombination} size={56} />
        </div>

        <div className="flex-1 min-w-0">
          <p
            className="text-[15px] font-bold leading-tight"
            style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
          >
            {brandName}
          </p>
          {genericName && (
            <p
              className="text-[12px] leading-tight"
              style={{ color: 'var(--brand-text-muted)', wordBreak: 'break-word' }}
            >
              {genericName}
            </p>
          )}
          <p
            className="text-[12px] mt-1.5 leading-snug"
            style={{ color: 'var(--brand-text-secondary)', wordBreak: 'break-word' }}
          >
            {purpose}
          </p>
        </div>

        <div className="shrink-0 flex flex-col items-center gap-1.5">
          {audioText && <AudioButton text={audioText} lang={audioLang} size="sm" />}
          <div
            className="rounded-full flex items-center justify-center transition-all"
            style={{
              width: 28,
              height: 28,
              backgroundColor: selected ? 'var(--brand-success-green)' : 'transparent',
              border: `2px solid ${selected ? 'var(--brand-success-green)' : 'var(--brand-border)'}`,
            }}
          >
            {selected ? (
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
            ) : (
              <X className="w-3 h-3" style={{ color: 'var(--brand-text-muted)' }} />
            )}
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span
          className="text-[11px] font-semibold uppercase tracking-wider"
          style={{ color: selected ? 'var(--brand-success-green)' : 'var(--brand-text-muted)' }}
        >
          {selected ? '✓ I take this' : "Tap if you take this"}
        </span>
      </div>
    </motion.div>
  );
}
