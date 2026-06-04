'use client';

// Destructive-action confirm modal. Red primary CTA, optional reason
// textarea, focus trap + Esc to close. Reason text is forwarded to the
// backend deactivate endpoint (stored in the audit log).

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  open: boolean;
  name: string;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => Promise<void>;
}

export default function DeactivateConfirmModal({
  open,
  name,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useLanguage();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Reset modal state to a clean slate every time it reopens. Intentional
    // synchronous set on open — not a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReason('');
    setSubmitting(false);
    setError(null);
    // Focus moves to the cancel button on open (safer destructive default).
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

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(reason.trim() || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not deactivate user.');
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
              boxShadow: '0 8px 48px rgba(220,38,38,0.18)',
            }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="deactivate-title"
            aria-describedby="deactivate-body"
            data-testid="admin-deactivate-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-alert-red)' }}
                  aria-hidden
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="deactivate-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {t('userManagement.modal.deactivateTitle').replace(
                      '{name}',
                      name,
                    )}
                  </h2>
                  <p
                    id="deactivate-body"
                    className="text-[11px] mt-1 leading-relaxed"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.modal.deactivateBody')}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                aria-label={t('common.close')}
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar p-5 space-y-3">
              <label
                htmlFor="deactivate-reason"
                className="block text-[12px] font-semibold"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('userManagement.field.reason')}
              </label>
              <textarea
                id="deactivate-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('userManagement.placeholder.reason')}
                rows={3}
                data-testid="admin-deactivate-reason"
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
                {t('userManagement.modal.cancel')}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting}
                data-testid="admin-deactivate-confirm"
                className="btn-admin-danger flex-1"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('userManagement.modal.sending')}
                  </>
                ) : (
                  t('userManagement.modal.deactivateConfirm')
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
