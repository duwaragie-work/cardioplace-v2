'use client';

// Option D — retake-to-confirm flow (Manisha 2026-06-12 Edit-Window + Session
// Policy sign-off, Q2). Shown when a patient submits a BP-only emergency
// reading (≥180/120) with NO co-occurring symptoms. The first reading is
// already persisted as AWAITING (held — no alert pages anyone) before this
// component renders; here we collect the confirmatory second reading.
//
// Three screens:
//   A  retake prompt — "very high, sit calmly 1 min, take a second reading"
//   B  second-reading entry — banner + BP inputs
//   C  decline fallback — shown if the patient can't/declines; the first
//      reading is flagged Tier 1 provider-only (UNCONFIRMED). 911 safety footer.
//
// Symptom-based emergencies BYPASS this entirely and fire immediately
// (Option A) — that decision is made in CheckIn before this renders.
//
// Wording is PLACEHOLDER (Manisha-drafted, pending formal CONFIRM) and lives in
// i18n (checkin.optionD.*) so a confirmed redline is a one-commit swap.

import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Activity, Phone } from 'lucide-react';
import { SINGLE_READING_FINALIZE_MS } from '@cardioplace/shared';
import { useLanguage } from '@/contexts/LanguageContext';
import MicButton from '@/components/intake/MicButton';

export type OptionDSecondReading = {
  systolicBP: number;
  diastolicBP: number;
  pulse?: number;
};

type Phase = 'screenA' | 'screenB' | 'screenC';

export function OptionDFlow({
  firstSystolic,
  firstDiastolic,
  onSubmitSecond,
  onDecline,
  onDone,
}: {
  /** The held first-of-pair reading, shown on Screen A. */
  firstSystolic: number;
  firstDiastolic: number;
  /** Submit the confirmatory second reading. CheckIn builds the payload
   *  (same session + confirmsEntryId) and persists it. */
  onSubmitSecond: (reading: OptionDSecondReading) => Promise<void>;
  /** Patient declined / window expired — flag the first reading UNCONFIRMED. */
  onDecline: () => Promise<void>;
  /** Flow finished — navigate on (confirmation / dashboard). */
  onDone: () => void;
}) {
  const { t } = useLanguage();
  const [phase, setPhase] = useState<Phase>('screenA');
  const [sys, setSys] = useState('');
  const [dia, setDia] = useState('');
  const [pulse, setPulse] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Move focus to each screen's heading on transition so screen-reader users
  // and keyboard users land on the new content (a11y — ACCESSIBILITY_CHECK_GUIDE).
  useEffect(() => {
    headingRef.current?.focus();
  }, [phase]);

  // 5-min safety window — mirrors the backend hold / cron. If the patient sits
  // on Screen A or B without resolving, auto-decline so the first reading is
  // flagged UNCONFIRMED rather than held forever client-side. The server cron
  // is the app-closed backstop; this covers app-open-but-idle.
  useEffect(() => {
    if (phase === 'screenC') return;
    const handle = setTimeout(() => {
      void handleDecline();
    }, SINGLE_READING_FINALIZE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  async function handleDecline() {
    if (busy) return;
    setBusy(true);
    try {
      await onDecline();
    } catch {
      // Non-fatal — the server cron still finalizes the held reading.
    } finally {
      setBusy(false);
      setPhase('screenC');
    }
  }

  async function handleSubmitSecond() {
    const s = parseInt(sys, 10);
    const d = parseInt(dia, 10);
    const p = pulse ? parseInt(pulse, 10) : undefined;
    if (!sys || !dia || Number.isNaN(s) || Number.isNaN(d)) {
      setError(t('checkin.optionD.screenB.bothNumbers'));
      return;
    }
    if (s < 60 || s > 250) { setError(t('checkin.err.systolic')); return; }
    if (d < 40 || d > 150) { setError(t('checkin.err.diastolic')); return; }
    if (d >= s) { setError(t('checkin.err.implausible')); return; }
    if (p != null && (p < 30 || p > 220)) { setError(t('checkin.err.pulse')); return; }
    setError('');
    setBusy(true);
    try {
      await onSubmitSecond({ systolicBP: s, diastolicBP: d, pulse: p });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('checkin.err.submit'));
      setBusy(false);
    }
  }

  const bpLabel = `${firstSystolic}/${firstDiastolic}`;

  return (
    <div
      className="min-h-[calc(100dvh-4rem)] flex flex-col"
      style={{ backgroundColor: 'var(--brand-background)' }}
    >
      <main
        id="main"
        className="flex-1 flex items-center justify-center w-full max-w-md mx-auto px-4 sm:px-6 py-6"
      >
        <motion.div
          role="group"
          aria-labelledby="optiond-title"
          className="w-full flex flex-col items-center text-center"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {phase === 'screenA' && (
            <>
              <div
                className="rounded-full flex items-center justify-center mb-4"
                style={{ width: 64, height: 64, backgroundColor: 'var(--brand-warning-amber-light)' }}
              >
                <AlertTriangle className="w-8 h-8" style={{ color: 'var(--brand-warning-amber-text)' }} aria-hidden="true" />
              </div>
              <h2
                id="optiond-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-[1.25rem] font-bold leading-tight outline-none"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {t('checkin.optionD.screenA.title')}
              </h2>
              <p className="text-[0.9375rem] mt-3 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
                {t('checkin.optionD.screenA.body').replace('{bp}', bpLabel)}
              </p>
              <div className="w-full space-y-2 mt-6">
                <button
                  type="button"
                  data-testid="optiond-retake"
                  onClick={() => { setError(''); setPhase('screenB'); }}
                  className="w-full h-12 rounded-full font-bold text-white text-[0.9375rem] cursor-pointer"
                  style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
                >
                  {t('checkin.optionD.screenA.retake')}
                </button>
                <button
                  type="button"
                  data-testid="optiond-decline"
                  disabled={busy}
                  onClick={() => void handleDecline()}
                  className="w-full h-12 rounded-full font-bold text-[0.9375rem] cursor-pointer disabled:opacity-60"
                  style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.optionD.screenA.cantNow')}
                </button>
              </div>
            </>
          )}

          {phase === 'screenB' && (
            <>
              <div
                className="rounded-full flex items-center justify-center mb-4"
                style={{ width: 56, height: 56, backgroundColor: 'var(--brand-primary-purple-light)' }}
              >
                <Activity className="w-7 h-7" style={{ color: 'var(--brand-primary-purple)' }} aria-hidden="true" />
              </div>
              <h2
                id="optiond-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-[1.125rem] font-bold leading-tight outline-none"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {t('checkin.optionD.screenB.title')}
              </h2>
              <p className="text-[0.875rem] mt-2 mb-5 leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                {t('checkin.optionD.screenB.body')}
              </p>

              <div className="w-full text-left space-y-3">
                <div>
                  <label htmlFor="optiond-systolic" className="block text-[0.75rem] font-semibold mb-1.5" style={{ color: 'var(--brand-text-secondary)' }}>
                    {t('readings.bloodPressure')}
                  </label>
                  <div className="flex items-center gap-3">
                    <input
                      id="optiond-systolic"
                      data-testid="optiond-systolic"
                      type="number"
                      inputMode="numeric"
                      placeholder={t('checkin.systolic')}
                      value={sys}
                      min={60}
                      max={250}
                      aria-invalid={!!error}
                      aria-describedby={error ? 'optiond-error' : undefined}
                      onChange={(e) => setSys(e.target.value)}
                      className="flex-1 h-12 px-3 rounded-xl border text-[1rem] outline-none min-w-0"
                      style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
                    />
                    <MicButton inputId="optiond-systolic" numeric onTranscript={(txt) => setSys(txt)} />
                    <span className="text-[1.125rem] font-semibold" style={{ color: 'var(--brand-text-muted)' }} aria-hidden="true">/</span>
                    <input
                      id="optiond-diastolic"
                      data-testid="optiond-diastolic"
                      type="number"
                      inputMode="numeric"
                      placeholder={t('checkin.diastolic')}
                      value={dia}
                      min={40}
                      max={150}
                      aria-invalid={!!error}
                      aria-describedby={error ? 'optiond-error' : undefined}
                      onChange={(e) => setDia(e.target.value)}
                      className="flex-1 h-12 px-3 rounded-xl border text-[1rem] outline-none min-w-0"
                      style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
                    />
                    <MicButton inputId="optiond-diastolic" numeric onTranscript={(txt) => setDia(txt)} />
                  </div>
                </div>
                <div>
                  <label htmlFor="optiond-pulse" className="block text-[0.75rem] font-semibold mb-1.5" style={{ color: 'var(--brand-text-secondary)' }}>
                    {t('readings.pulseLabel')}
                  </label>
                  <input
                    id="optiond-pulse"
                    data-testid="optiond-pulse"
                    type="number"
                    inputMode="numeric"
                    placeholder={t('readings.pulsePlaceholder')}
                    value={pulse}
                    min={30}
                    max={220}
                    onChange={(e) => setPulse(e.target.value)}
                    className="w-full h-12 px-3 rounded-xl border text-[1rem] outline-none"
                    style={{ borderColor: 'var(--brand-border)', color: 'var(--brand-text-primary)' }}
                  />
                </div>
              </div>

              {error && (
                <p id="optiond-error" role="alert" className="text-[0.8125rem] mt-3 w-full text-left" style={{ color: 'var(--brand-alert-red)' }}>
                  {error}
                </p>
              )}

              <div className="w-full space-y-2 mt-6">
                <button
                  type="button"
                  data-testid="optiond-submit-second"
                  disabled={busy}
                  onClick={() => void handleSubmitSecond()}
                  className="w-full h-12 rounded-full font-bold text-white text-[0.9375rem] cursor-pointer disabled:opacity-60"
                  style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
                >
                  {t('checkin.optionD.screenB.submit')}
                </button>
                <button
                  type="button"
                  data-testid="optiond-decline-b"
                  disabled={busy}
                  onClick={() => void handleDecline()}
                  className="w-full h-12 rounded-full font-bold text-[0.9375rem] cursor-pointer disabled:opacity-60"
                  style={{ backgroundColor: 'white', border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-secondary)' }}
                >
                  {t('checkin.optionD.screenB.cantNow')}
                </button>
              </div>
            </>
          )}

          {phase === 'screenC' && (
            <>
              <h2
                id="optiond-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-[1.125rem] font-bold leading-tight outline-none"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {t('checkin.optionD.screenC.title')}
              </h2>
              <p className="text-[0.9375rem] mt-3 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
                {t('checkin.optionD.screenC.body')}
              </p>
              <div
                data-testid="optiond-safety-footer"
                className="w-full rounded-xl px-4 py-3 mt-5 flex items-start gap-2.5 text-left"
                style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
              >
                <Phone className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--brand-alert-red)' }} aria-hidden="true" />
                <p className="text-[0.84375rem] font-semibold leading-snug" style={{ color: 'var(--brand-alert-red-text)' }}>
                  {t('checkin.optionD.screenC.safetyFooter')}
                </p>
              </div>
              <button
                type="button"
                data-testid="optiond-done"
                onClick={onDone}
                className="w-full h-12 rounded-full font-bold text-white text-[0.9375rem] cursor-pointer mt-6"
                style={{ backgroundColor: 'var(--brand-primary-purple)', boxShadow: 'var(--brand-shadow-button)' }}
              >
                {t('checkin.optionD.screenC.done')}
              </button>
            </>
          )}
        </motion.div>
      </main>
    </div>
  );
}
