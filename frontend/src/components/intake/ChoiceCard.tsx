'use client';

// Generic icon-led choice card used for: gender (A1), conditions (A3),
// HF subtype (A4), category tabs (A8), and frequency (A9). Selection is
// visually loud (purple fill + checkmark) per V2-E silent-literacy spec.
// Optional audio button reads the title + description.

import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import AudioButton from './AudioButton';

interface Props {
  icon: ReactNode;
  title: string;
  description?: string;
  selected: boolean;
  onClick: () => void;
  audioText?: string;
  audioLang?: string;
  /** When true, renders a smaller variant suited to dense grids. */
  compact?: boolean;
  /** When true, uses red selection color (used for "None of these" style negative options). */
  destructiveSelected?: boolean;
  className?: string;
}

export default function ChoiceCard({
  icon,
  title,
  description,
  selected,
  onClick,
  audioText,
  audioLang,
  compact = false,
  destructiveSelected = false,
  className,
}: Props) {
  const accent = destructiveSelected
    ? 'var(--brand-alert-red)'
    : 'var(--brand-primary-purple)';
  const accentBg = destructiveSelected
    ? 'var(--brand-alert-red-light)'
    : 'var(--brand-primary-purple-light)';

  return (
    // div+role=button (not <button>) so the nested AudioButton doesn't
    // produce <button>-inside-<button> hydration warnings.
    <motion.div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`relative w-full text-left rounded-2xl transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)] ${className ?? ''}`}
      style={{
        padding: compact ? '14px 16px' : '18px 18px',
        backgroundColor: selected ? accentBg : 'white',
        border: `2px solid ${selected ? accent : 'var(--brand-border)'}`,
        boxShadow: selected ? '0 4px 14px rgba(123,0,224,0.12)' : 'none',
      }}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.98 }}
      aria-pressed={selected}
    >
      <div className="flex items-start gap-3">
        <div
          className="shrink-0 flex items-center justify-center rounded-xl"
          style={{
            width: compact ? 40 : 48,
            height: compact ? 40 : 48,
            backgroundColor: selected ? accent : accentBg,
            color: selected ? 'white' : accent,
          }}
        >
          {icon}
        </div>

        <div className="flex-1 min-w-0">
          <p
            className={compact ? 'text-[14px] font-semibold' : 'text-[15px] font-semibold'}
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {title}
          </p>
          {description && (
            <p
              className={compact ? 'text-[12px] mt-0.5' : 'text-[13px] mt-1 leading-relaxed'}
              style={{ color: 'var(--brand-text-muted)' }}
            >
              {description}
            </p>
          )}
        </div>

        {audioText && (
          <div className="shrink-0">
            <AudioButton text={audioText} lang={audioLang} size="sm" />
          </div>
        )}
      </div>

      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="absolute top-3 right-3 rounded-full flex items-center justify-center"
          style={{ width: 22, height: 22, backgroundColor: accent }}
        >
          <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />
        </motion.div>
      )}
    </motion.div>
  );
}
