'use client';

// Modal for rejecting a patient-reported medication. The backend mandates
// a non-empty rationale on reject, so we collect it before firing instead
// of letting the API 400 and surfacing the failure as a toast.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
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
    key: 'patient-error',
    label: 'Patient error — not actually taking',
    rationale: 'Patient error — patient is not actually taking this medication.',
  },
  {
    key: 'other-provider-prescribed',
    label: 'Prescribed by another provider',
    rationale: 'Prescribed by another provider; does not belong on our active list.',
  },
  {
    key: 'other-provider-discontinued',
    label: 'Discontinued by another provider',
    rationale: 'Discontinued by another provider before today.',
  },
  { key: 'other', label: 'Other (free text)', rationale: '' },
];

export default function MedicationRejectModal({ med, open, onClose, onConfirmed }: Props) {
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
      await verifyMedication(med.id, 'REJECTED', rationale.trim());
      onConfirmed();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reject medication.');
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
            aria-label="Reject medication"
            data-testid="admin-med-reject-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-alert-red)' }}
                  aria-hidden
                >
                  <AlertTriangle className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <h2
                    className="text-[15px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Reject medication
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
                        data-testid={`admin-med-reject-pick-${q.key}`}
                        className="w-full text-left rounded-lg p-3 transition-colors cursor-pointer"
                        style={{
                          backgroundColor: selected ? 'var(--brand-alert-red-light)' : 'white',
                          border: `1.5px solid ${selected ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
                        }}
                      >
                        <div className="flex items-start gap-2.5">
                          <div
                            className="shrink-0 mt-0.5 w-4 h-4 rounded-full flex items-center justify-center"
                            style={{
                              backgroundColor: selected ? 'var(--brand-alert-red)' : 'transparent',
                              border: `2px solid ${selected ? 'var(--brand-alert-red)' : 'var(--brand-border)'}`,
                            }}
                          >
                            {selected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                          </div>
                          <p
                            className="text-[13px] font-semibold leading-snug"
                            style={{
                              color: selected ? 'var(--brand-alert-red)' : 'var(--brand-text-primary)',
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
                    <span style={{ color: 'var(--brand-alert-red)' }}> · required</span>
                  </label>
                  <textarea
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    data-testid="admin-med-reject-rationale"
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
                  data-testid="admin-med-reject-confirm"
                  className="btn-admin-primary flex-1"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Rejecting…
                    </>
                  ) : (
                    <>Reject medication</>
                  )}
                </button>
              </div>
              {picked && rationale.trim().length === 0 && (
                <p
                  className="text-[11px] mt-2 text-center"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  Rationale is required to reject.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
