'use client';

// IVR-19 — styled confirm shown when a patient re-selects a medication their
// care team previously REJECTED (option c: warn, then allow). Replaces the
// native window.confirm so the prompt matches the rest of the app. The actual
// add is performed by the caller's onConfirm; on cancel the selection is left
// unchanged.

import { AnimatePresence, motion } from 'framer-motion';
import { ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  open: boolean;
  /** Display name (brand) of the drug being re-added, fills the {drug} slot. */
  drugName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ReAddConfirmModal({ open, drugName, onConfirm, onCancel }: Props) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const body = t('intake.reAddRejectedConfirm').replace('{drug}', drugName);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
        >
          <div className="absolute inset-0" onClick={onCancel} aria-hidden />
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 340, damping: 30 }}
            className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl overflow-hidden"
            style={{ boxShadow: '0 8px 48px rgba(0,0,0,0.18)' }}
            role="dialog"
            aria-modal="true"
            aria-label={t('intake.reAddRejectedTitle')}
            data-testid="readd-rejected-modal"
          >
            <div className="p-5">
              <div className="flex items-start gap-3">
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-warning-amber)' }}
                  aria-hidden
                >
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-[16px] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                    {t('intake.reAddRejectedTitle')}
                  </h2>
                  <p className="text-[13.5px] mt-1.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
                    {body}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 px-5 pb-5">
              <button
                type="button"
                onClick={onCancel}
                data-testid="readd-rejected-cancel"
                className="flex-1 h-11 rounded-full text-[14px] font-bold cursor-pointer transition hover:opacity-85"
                style={{ border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-secondary)', backgroundColor: 'white' }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                data-testid="readd-rejected-confirm"
                className="flex-1 h-11 rounded-full text-[14px] font-bold text-white cursor-pointer transition hover:opacity-90"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {t('intake.reAddRejectedConfirmBtn')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
