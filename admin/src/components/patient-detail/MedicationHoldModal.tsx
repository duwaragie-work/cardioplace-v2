'use client';

// Modal for placing a patient-reported medication on HOLD. Mirrors
// MedicationRejectModal so the two equally-weighty actions share one UX.
// The backend mandates a non-empty rationale on hold (parallel to reject),
// so we collect it before firing instead of letting the API 400. On submit
// the backend also dispatches the systemMsgMedicationHold patient
// notification (CLINICAL_SPEC §14.2).

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, Loader2 } from 'lucide-react';
import {
  verifyMedication,
  type PatientMedication,
} from '@/lib/services/patient-detail.service';

interface Props {
  med: PatientMedication | null;
  open: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}

const QUICK_PICKS: { key: string; label: string; rationale: string }[] = [
  {
    key: 'side-effects',
    label: 'Possible side effects — pausing to review',
    rationale: 'Possible side effects reported — holding pending clinical review.',
  },
  {
    key: 'bp-too-low',
    label: 'BP running low — reassess dosing',
    rationale: 'Blood pressure trending low — holding to reassess dosing.',
  },
  {
    key: 'awaiting-labs',
    label: 'Awaiting labs / further review',
    rationale: 'Holding until lab results / further review are available.',
  },
  { key: 'other', label: 'Other (free text)', rationale: '' },
];

export default function MedicationHoldModal({ med, open, onClose, onConfirmed }: Props) {
  const [picked, setPicked] = useState<string>('');
  const [rationale, setRationale] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open && med) {
      setPicked('');
      setRationale('');
      setError('');
      setSubmitting(false);
    }
  }, [open, med]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const canSubmit = !submitting && rationale.trim().length > 0;

  function handlePick(key: string, presetRationale: string) {
    setPicked(key);
    setRationale(key === 'other' ? '' : presetRationale);
  }

  async function handleSubmit() {
    if (!med || !canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      await verifyMedication(med.id, 'HOLD', rationale.trim());
      onConfirmed();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place medication on hold.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && med && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
        >
          <div
            className="absolute inset-0"
            onClick={submitting ? undefined : onClose}
            style={{ cursor: submitting ? 'not-allowed' : 'pointer' }}
            aria-hidden
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-full sm:max-w-lg bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
            style={{ maxHeight: '92dvh', boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
            role="dialog"
            aria-label="Place medication on hold"
            data-testid="admin-med-hold-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-warning-amber)' }}
                  aria-hidden
                >
                  <Clock className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    className="text-[15px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Place medication on hold
                  </h2>
                  <p
                    className="text-[12px] mt-0.5 truncate"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {med.drugName}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-4">
              <p className="text-[12px] leading-relaxed" style={{ color: 'var(--brand-text-muted)' }}>
                The patient is notified to stop taking this medication until the
                care team clears it. A rationale is recorded in the audit log.
              </p>
              <div>
                <p
                  className="text-[12px] font-semibold mb-2"
                  style={{ color: 'var(--brand-text-secondary)' }}
                >
                  Reason
                </p>
                <div className="space-y-2">
                  {QUICK_PICKS.map((q) => {
                    const selected = picked === q.key;
                    return (
                      <button
                        key={q.key}
                        type="button"
                        onClick={() => handlePick(q.key, q.rationale)}
                        data-testid={`admin-med-hold-pick-${q.key}`}
                        className="w-full text-left rounded-lg p-3 transition-colors cursor-pointer"
                        style={{
                          backgroundColor: selected ? 'var(--brand-warning-amber-light)' : 'white',
                          border: `1.5px solid ${selected ? 'var(--brand-warning-amber)' : 'var(--brand-border)'}`,
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className="shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: selected ? 'var(--brand-warning-amber)' : 'transparent',
                              border: `2px solid ${selected ? 'var(--brand-warning-amber)' : 'var(--brand-border)'}`,
                            }}
                          >
                            {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <p
                            className="text-[13px] font-semibold leading-snug"
                            style={{
                              color: selected ? 'var(--brand-warning-amber-text)' : 'var(--brand-text-primary)',
                            }}
                          >
                            {q.label}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {picked && (
                <div>
                  <label
                    className="block text-[12px] font-semibold mb-1.5"
                    style={{ color: 'var(--brand-text-secondary)' }}
                  >
                    Clinical rationale
                    <span style={{ color: 'var(--brand-warning-amber-text)' }}> · required</span>
                  </label>
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    data-testid="admin-med-hold-rationale"
                    placeholder="Brief clinical note for the audit trail."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
                    style={{
                      border: '1.5px solid var(--brand-border)',
                      color: 'var(--brand-text-primary)',
                    }}
                  />
                </div>
              )}
            </div>

            <div
              className="shrink-0 px-5 py-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              {error && (
                <p
                  className="text-[12.5px] font-semibold text-center mb-2 px-3 py-1.5 rounded-lg"
                  style={{
                    color: 'var(--brand-alert-red-text)',
                    backgroundColor: 'var(--brand-alert-red-light)',
                  }}
                >
                  {error}
                </p>
              )}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="btn-admin-secondary flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={!canSubmit}
                  data-testid="admin-med-hold-confirm"
                  className="btn-admin-primary flex-1"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Placing on hold…
                    </>
                  ) : (
                    <>Place on hold</>
                  )}
                </button>
              </div>
              {picked && rationale.trim().length === 0 && (
                <p
                  className="text-[11px] mt-2 text-center"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Rationale is required to place on hold.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
