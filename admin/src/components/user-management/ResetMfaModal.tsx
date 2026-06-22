'use client';

// Admin MFA-reset confirm modal (Manisha 2026-06-12 Access Control §6).
// Required, audited reason. On confirm the target's TOTP secret + recovery
// codes are wiped and they re-enroll on next sign-in. Mirrors the structure
// of DeactivateConfirmModal but with the MFA framing + amber (not red) chrome
// — this is a recovery action, not a destructive one.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ShieldAlert, Loader2 } from 'lucide-react';

interface Props {
  open: boolean;
  name: string;
  onClose: () => void;
  /** Reason is required (min 3 chars) — the button stays disabled until met. */
  onConfirm: (reason: string) => Promise<void>;
}

export default function ResetMfaModal({ open, name, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason('');
    setSubmitting(false);
    setError(null);
    window.setTimeout(() => cancelRef.current?.focus(), 60);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !submitting) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, submitting, onClose]);

  const reasonValid = reason.trim().length >= 3;

  async function handleConfirm() {
    if (!reasonValid) return;
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reset MFA.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
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
            aria-hidden
            style={{ cursor: submitting ? 'not-allowed' : 'pointer' }}
          />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-full sm:max-w-md bg-white sm:rounded-3xl rounded-t-3xl flex flex-col overflow-hidden"
            style={{
              maxHeight: '92dvh',
              boxShadow: '0 8px 48px rgba(123,0,224,0.18)',
            }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="reset-mfa-title"
            aria-describedby="reset-mfa-body"
            data-testid="admin-reset-mfa-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-warning-amber, #D97706)' }}
                  aria-hidden
                >
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="reset-mfa-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    Reset two-factor for {name}?
                  </h2>
                  <p
                    id="reset-mfa-body"
                    className="text-[11px] mt-1 leading-relaxed"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    Their authenticator and recovery codes will be removed.
                    They&apos;ll set up two-factor again on their next sign-in.
                    This is recorded in the audit log.
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
                <X className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-3">
              <label
                htmlFor="reset-mfa-reason"
                className="block text-[12px] font-semibold"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                Reason (required)
              </label>
              <textarea
                id="reset-mfa-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Lost phone, confirmed identity over the phone"
                rows={3}
                maxLength={500}
                data-testid="admin-reset-mfa-reason"
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
                style={{
                  border: '1.5px solid var(--brand-border)',
                  color: 'var(--brand-text-primary)',
                }}
              />
              {error && (
                <p
                  className="text-[12px] font-semibold text-center px-3 py-2 rounded-lg"
                  style={{
                    color: 'var(--brand-alert-red)',
                    backgroundColor: 'var(--brand-alert-red-light)',
                  }}
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>

            <div
              className="shrink-0 px-5 py-3 flex gap-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              <button
                type="button"
                ref={cancelRef}
                onClick={onClose}
                disabled={submitting}
                className="btn-admin-secondary flex-1"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || !reasonValid}
                data-testid="admin-reset-mfa-confirm"
                className="flex-1 h-10 rounded-full font-semibold text-sm text-white inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                style={{ backgroundColor: 'var(--brand-warning-amber, #D97706)' }}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Resetting…
                  </>
                ) : (
                  'Reset MFA'
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
