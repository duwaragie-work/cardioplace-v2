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
  /** Optional test hook forwarded to the root element for Playwright. */
  testId?: string;
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
  testId,
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
      data-testid={testId}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={`relative w-full rounded-2xl transition-all cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary-purple)] ${className ?? ''}`}
      style={{
        padding: compact ? '12px 8px' : '18px 18px',
        backgroundColor: selected ? accentBg : 'white',
        border: `2px solid ${selected ? accent : 'var(--brand-border)'}`,
        boxShadow: selected ? '0 4px 14px rgba(123,0,224,0.12)' : 'none',
      }}
      whileHover={{ scale: 1.015 }}
      whileTap={{ scale: 0.98 }}
      aria-pressed={selected}
    >
      {compact ? (
        // Vertical stack: icon on top, title centered below — works in tight
        // 3-up / 4-up grids without text overflowing or icons overlapping.
        // When a speaker button is present it sits absolutely in the top-left
        // corner (44px WCAG tap target), so reserve top room for it; otherwise
        // it overlaps the centered icon on narrow phones.
        <div className={`flex flex-col items-center gap-2 text-center ${audioText ? 'pt-9' : ''}`}>
          <div
            className="shrink-0 flex items-center justify-center rounded-xl"
            style={{
              width: 36,
              height: 36,
              backgroundColor: selected ? accent : accentBg,
              color: selected ? 'white' : accent,
            }}
          >
            {icon}
          </div>
          <p
            className="text-[12px] sm:text-[13px] font-semibold leading-tight"
            style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
          >
            {title}
          </p>
          {description && (
            <p
              className="text-[10.5px] leading-snug"
              style={{ color: 'var(--brand-text-muted)', wordBreak: 'break-word' }}
            >
              {description}
            </p>
          )}
        </div>
      ) : (
        // Horizontal layout for full-width / single-column cards with
        // descriptions — icon on the left, text + audio on the right.
        <div className="flex items-start gap-3 text-left">
          <div
            className="shrink-0 flex items-center justify-center rounded-xl"
            style={{
              width: 48,
              height: 48,
              backgroundColor: selected ? accent : accentBg,
              color: selected ? 'white' : accent,
            }}
          >
            {icon}
          </div>

          <div className="flex-1 min-w-0">
            <p
              className="text-[15px] font-semibold"
              style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
            >
              {title}
            </p>
            {description && (
              <p
                className="text-[13px] mt-1 leading-relaxed"
                style={{ color: 'var(--brand-text-muted)', wordBreak: 'break-word' }}
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
      )}

      {selected && (
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="absolute top-2 right-2 rounded-full flex items-center justify-center"
          style={{ width: 20, height: 20, backgroundColor: accent }}
        >
          <Check className="w-3 h-3 text-white" strokeWidth={3} />
        </motion.div>
      )}

      {/* Compact cards used to auto-speak `audioText` on tap with no way for
          the patient to stop the utterance. Now they expose a real speaker
          button at the top-left — symmetric with the selection check on the
          top-right. AudioButton calls e.stopPropagation() on click so it
          doesn't double-fire the card's onClick. */}
      {compact && audioText && (
        <div className="absolute top-1 left-1">
          <AudioButton text={audioText} lang={audioLang} size="sm" />
        </div>
      )}
    </motion.div>
  );
}
