'use client';

import { useState } from 'react';
import { CalendarDays } from 'lucide-react';

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  /** Hint shown (left-aligned) when the field is empty and unfocused. */
  placeholder: string;
  id?: string;
  max?: string;
  min?: string;
  testId?: string;
  ariaLabel?: string;
  /** Tailwind text-size class to match the surrounding form (default 18px). */
  textSizeClass?: string;
}

/**
 * Native `<input type="date">` renders inconsistently on mobile: several
 * Android browsers show a blank white field (no mm/dd/yyyy hint) plus a stray
 * picker chevron on the right, and iOS shows nothing until tapped. This wraps
 * the native input so every device shows the same thing — our own placeholder
 * when empty and a single calendar icon — while keeping the native date picker
 * (tap anywhere to open) fully functional. See the `.date-field` rules in
 * globals.css that hide the native indicator.
 */
export default function DateField({
  value,
  onChange,
  placeholder,
  id,
  max,
  min,
  testId,
  ariaLabel,
  textSizeClass = 'text-[18px]',
}: DateFieldProps) {
  const [focused, setFocused] = useState(false);
  // Show our placeholder only when empty AND not focused; once focused we let
  // the browser's own mm/dd/yyyy show so desktop typing stays visible.
  const showPlaceholder = !value && !focused;

  return (
    <div className="relative w-full">
      <input
        id={id}
        data-testid={testId}
        type="date"
        aria-label={ariaLabel}
        value={value}
        max={max}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        onFocus={(e) => {
          setFocused(true);
          e.currentTarget.style.borderColor = 'var(--brand-primary-purple)';
        }}
        onBlur={(e) => {
          setFocused(false);
          e.currentTarget.style.borderColor = 'var(--brand-border)';
        }}
        className={`date-field w-full h-14 pl-4 pr-12 rounded-xl ${textSizeClass} outline-none transition box-border`}
        style={{
          border: '2px solid var(--brand-border)',
          // Hide the native (often invisible/white) placeholder text while we
          // render our own; restore the real text colour once a date is set.
          color: showPlaceholder ? 'transparent' : 'var(--brand-text-primary)',
          backgroundColor: 'white',
          colorScheme: 'light',
        }}
      />
      {showPlaceholder && (
        <span
          className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 ${textSizeClass}`}
          style={{ color: 'var(--brand-text-muted)' }}
        >
          {placeholder}
        </span>
      )}
      <CalendarDays
        aria-hidden
        className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5"
        style={{ color: 'var(--brand-text-muted)' }}
      />
    </div>
  );
}
