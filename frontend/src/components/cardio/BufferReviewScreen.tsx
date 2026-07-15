'use client';

// Part 1 — FE buffer review screen (CTO Ruhim 2026-06-09 + Manisha Q1/Q3/Q4).
//
// A non-emergency reading is held on-device (sessionStorage) for the 5-min
// window; the backend doesn't see it until the patient taps "I'm good" or the
// countdown expires. This screen shows the buffered sitting (1–3 readings),
// a live countdown, the Q3 "take another reading" nudge, per-reading edit /
// remove, and the commit CTA. Emergencies never reach this screen — they post
// immediately (branching happens in CheckIn before the buffer).

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Clock, Pencil, Trash2, Plus, Check } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { remainingMs, type JournalDraft } from '@/lib/journalDraft';
import AudioButton from '@/components/intake/AudioButton';

const SESSION_MAX_READINGS = 3;

function positionLabel(
  p: 'SITTING' | 'STANDING' | 'LYING' | undefined,
  t: (k: 'checkin.b2.positionSitting' | 'checkin.b2.positionStanding' | 'checkin.b2.positionLying') => string,
): string | null {
  if (p === 'SITTING') return t('checkin.b2.positionSitting');
  if (p === 'STANDING') return t('checkin.b2.positionStanding');
  if (p === 'LYING') return t('checkin.b2.positionLying');
  return null;
}

function fmtMMSS(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function BufferReviewScreen({
  draft,
  hasAFib,
  committing,
  onTakeAnother,
  onCommit,
  onExpire,
  onEditReading,
  onDeleteReading,
}: {
  draft: JournalDraft;
  hasAFib: boolean;
  /** True while the commit POSTs are in flight — disables the CTAs. */
  committing: boolean;
  onTakeAnother: () => void;
  onCommit: () => void;
  /** Countdown reached 0 — the parent auto-commits the buffer. */
  onExpire: () => void;
  onEditReading: (localId: string) => void;
  onDeleteReading: (localId: string) => void;
}) {
  const { t } = useLanguage();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [nowMs, setNowMs] = useState(() => draft.createdAt); // safe initial; effect ticks real time
  const firedExpire = useRef(false);

  // Move focus to the heading on mount (a11y — ACCESSIBILITY_CHECK_GUIDE).
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // 1-second countdown tick. When the window elapses, fire onExpire ONCE so the
  // parent commits the buffer (the server-side safety net of the old model is
  // replaced by this client timer per the FE-buffer policy).
  useEffect(() => {
    const tick = () => {
      const left = remainingMs(draft);
      setNowMs(Date.now());
      if (left <= 0 && !firedExpire.current) {
        firedExpire.current = true;
        onExpire();
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [draft, onExpire]);

  void nowMs; // referenced only to force the per-second re-render
  const left = remainingMs(draft);
  const canAddMore = draft.readings.length < SESSION_MAX_READINGS;

  // Spoken summary of the whole review screen so a non-reader can hear the
  // title, what it means, and each buffered reading before tapping "I'm good".
  const audioSummary = [
    t('checkin.buffer.title'),
    t('checkin.buffer.subtitle'),
    ...draft.readings.map((r, i) => {
      const p = r.payload;
      const pos = positionLabel(p.position, t);
      const bp = `${p.systolicBP ?? '—'}/${p.diastolicBP ?? '—'} ${t('readings.mmHg')}`;
      const pulse = p.pulse != null ? `, ${p.pulse} ${t('checkin.buffer.bpm')}` : '';
      return (
        `${t('checkin.buffer.reading').replace('{n}', String(i + 1))}: ${bp}${pulse}` +
        (pos ? `, ${pos}` : '')
      );
    }),
  ].join('. ');

  return (
    // `justify-center` centres the card vertically. Safe against tall content (3
    // readings + the take-another nudge): the container is min-h, not a fixed h,
    // so it simply grows past the viewport and the page scrolls — nothing gets
    // clipped off the top, which is what a fixed-height centre would do.
    <div
      className="min-h-[calc(100dvh-4rem)] flex flex-col justify-center"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      <main id="main" className="w-full max-w-md mx-auto px-4 sm:px-6 py-6">
        <div className="flex items-start gap-2">
          <h1
            ref={headingRef}
            tabIndex={-1}
            data-testid="checkin-buffer-title"
            className="text-[1.25rem] font-bold leading-tight outline-none"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('checkin.buffer.title')}
          </h1>
          <div className="shrink-0 mt-0.5">
            <AudioButton size="sm" text={audioSummary} />
          </div>
        </div>
        <p className="text-[0.9375rem] mt-2 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
          {t('checkin.buffer.subtitle')}
        </p>

        {/* Countdown */}
        <div
          data-testid="checkin-buffer-countdown"
          aria-live="polite"
          className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[0.8125rem] font-semibold"
          style={{ backgroundColor: 'var(--brand-warning-amber-light)', color: 'var(--brand-warning-amber-text)' }}
        >
          <Clock className="w-4 h-4" aria-hidden="true" />
          {t('checkin.buffer.countdown').replace('{time}', fmtMMSS(left))}
        </div>

        {/* Buffered readings */}
        <div className="mt-5 space-y-2.5">
          {draft.readings.map((r, i) => {
            const p = r.payload;
            const pos = positionLabel(p.position, t);
            return (
              <motion.div
                key={r.localId}
                data-testid={`checkin-buffer-reading-${i}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl p-4 flex items-start justify-between gap-3"
                style={{ boxShadow: 'var(--brand-shadow-card)' }}
              >
                <div className="min-w-0">
                  <p className="text-[0.625rem] font-bold uppercase tracking-wider" style={{ color: 'var(--brand-text-muted)' }}>
                    {t('checkin.buffer.reading').replace('{n}', String(i + 1))}
                  </p>
                  <p className="text-[1.5rem] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                    {p.systolicBP ?? '—'}/{p.diastolicBP ?? '—'}
                    <span className="text-[0.75rem] font-medium ml-1" style={{ color: 'var(--brand-text-muted)' }}>
                      {t('readings.mmHg')}
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[0.75rem]" style={{ color: 'var(--brand-text-secondary)' }}>
                    {p.pulse != null && <span>♥ {p.pulse} {t('checkin.buffer.bpm')}</span>}
                    {pos && <span>{pos}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid={`checkin-buffer-edit-${i}`}
                    onClick={() => onEditReading(r.localId)}
                    disabled={committing}
                    aria-label={t('checkin.buffer.edit')}
                    className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-75 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--brand-primary-purple-light)' }}
                  >
                    <Pencil className="w-3.5 h-3.5" style={{ color: 'var(--brand-primary-purple)' }} />
                  </button>
                  <button
                    type="button"
                    data-testid={`checkin-buffer-remove-${i}`}
                    onClick={() => onDeleteReading(r.localId)}
                    disabled={committing}
                    aria-label={t('checkin.buffer.remove')}
                    className="w-11 h-11 rounded-full flex items-center justify-center transition hover:opacity-75 disabled:opacity-50"
                    style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
                  >
                    <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--brand-alert-red)' }} />
                  </button>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Q3 take-another nudge (AFib asks for 3) — hidden once at the session max. */}
        {canAddMore && (
          <button
            type="button"
            data-testid="checkin-buffer-take-another"
            onClick={onTakeAnother}
            disabled={committing}
            className="mt-4 w-full h-12 rounded-full border-2 font-semibold text-[0.875rem] flex items-center justify-center gap-2 cursor-pointer transition hover:bg-[#f5f3ff] disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{ borderColor: 'var(--brand-primary-purple)', color: 'var(--brand-primary-purple)' }}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            {hasAFib && draft.readings.length < SESSION_MAX_READINGS
              ? t('checkin.buffer.takeAnotherAfib')
              : t('checkin.buffer.takeAnother')}
          </button>
        )}

        {/* Commit — "I'm good, send it" */}
        <button
          type="button"
          data-testid="checkin-buffer-im-good"
          onClick={onCommit}
          disabled={committing}
          className="mt-3 w-full h-12 rounded-full font-bold text-white text-[0.9375rem] flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60 outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
          style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
        >
          {committing ? (
            t('checkin.buffer.sending')
          ) : (
            <>
              <Check className="w-4 h-4" aria-hidden="true" />
              {t('checkin.buffer.imGood')}
            </>
          )}
        </button>
      </main>
    </div>
  );
}
