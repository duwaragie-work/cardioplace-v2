'use client';

// Irreversible permanent-close confirm (phase/28). Same shell as
// DeactivateConfirmModal, plus a typed-DisplayID anti-typo gate: the confirm
// button stays disabled until the admin retypes the target's Display ID
// exactly. The backend enforces the same match, so this is UX defence only.

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  open: boolean;
  name: string;
  /** The target's Display ID — the admin must retype it to confirm. */
  displayId: string;
  onClose: () => void;
  onConfirm: (confirmDisplayId: string, reason: string | undefined) => Promise<void>;
}

export default function PermanentCloseConfirmModal({
  open,
  name,
  displayId,
  onClose,
  onConfirm,
}: Props) {
  const { t } = useLanguage();
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTyped('');
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

  const matches = typed.trim() === displayId;

  async function handleConfirm() {
    if (!matches) {
      setError(t('userManagement.modal.closeMismatch'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(typed.trim(), reason.trim() || undefined);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('userManagement.modal.closeConfirm'));
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
            style={{ maxHeight: '92dvh', boxShadow: '0 8px 48px rgba(220,38,38,0.18)' }}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="close-title"
            aria-describedby="close-body"
            data-testid="admin-permanent-close-modal"
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
                    id="close-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {t('userManagement.modal.closeTitle').replace('{name}', name)}
                  </h2>
                  <p
                    id="close-body"
                    className="text-[11px] mt-1 leading-relaxed"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {t('userManagement.modal.closeBody')}
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
                htmlFor="close-display-id"
                className="block text-[12px] font-semibold"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('userManagement.field.confirmDisplayId')}
              </label>
              <p className="text-[11px] font-mono" style={{ color: 'var(--brand-alert-red)' }}>
                {t('userManagement.modal.closeGate').replace('{displayId}', displayId)}
              </p>
              <input
                id="close-display-id"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                data-testid="admin-permanent-close-display-id"
                className="w-full px-3 py-2 rounded-lg text-[13px] font-mono outline-none"
                style={{ border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
              />
              <label
                htmlFor="close-reason"
                className="block text-[12px] font-semibold pt-1"
                style={{ color: 'var(--brand-text-secondary)' }}
              >
                {t('userManagement.field.reason')}
              </label>
              <textarea
                id="close-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('userManagement.placeholder.reason')}
                rows={2}
                className="w-full px-3 py-2 rounded-lg text-[13px] outline-none resize-y leading-relaxed"
                style={{ border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-primary)' }}
              />
              {error && (
                <p
                  className="text-[12px] font-semibold text-center px-3 py-2 rounded-lg"
                  style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
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
                disabled={submitting || !matches}
                data-testid="admin-permanent-close-confirm"
                className="btn-admin-danger flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('userManagement.modal.sending')}
                  </>
                ) : (
                  t('userManagement.modal.closeConfirm')
                )}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
