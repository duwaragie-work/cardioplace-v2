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
  /** F13 — 'rejected' (IVR-19, care team declined) or 'contraindicated'
   *  (ACE/ARB after a prior angioedema reaction). The contraindication variant
   *  shows the prior-reaction warning + "requires provider review" copy. */
  variant?: 'rejected' | 'contraindicated';
  /** When variant='contraindicated', tailors ACE vs ARB (cross-reactivity)
   *  wording. */
  drugClass?: string;
}

export default function ReAddConfirmModal({ open, drugName, onConfirm, onCancel, variant = 'rejected', drugClass }: Props) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  const isContra = variant === 'contraindicated';
  // F13 — clinical warning copy. Provided verbatim in the round-2 handoff; ACE
  // gets the direct "contraindicated" message, ARB the softer cross-reactivity
  // note (~2-5%). The med is held for provider review either way.
  const contraTitle = 'Adding this requires provider review';
  const contraBody =
    drugClass === 'ARB'
      ? `Your care team flagged ACE inhibitors as contraindicated for you because of a prior angioedema reaction. ${drugName} is an ARB, which can cross-react in a small number of people. Adding it requires provider review before it is used.`
      : `Your care team flagged ACE inhibitors as contraindicated for you because of a prior angioedema reaction. Adding ${drugName} requires provider review before it is used.`;
  const title = isContra ? contraTitle : t('intake.reAddRejectedTitle');
  const body = isContra
    ? contraBody
    : t('intake.reAddRejectedConfirm').replace('{drug}', drugName);

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
            aria-label={title}
            data-testid={isContra ? 'readd-contraindicated-modal' : 'readd-rejected-modal'}
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
                  <h2 className="text-[1rem] font-bold leading-tight" style={{ color: 'var(--brand-text-primary)' }}>
                    {title}
                  </h2>
                  <p className="text-[0.84375rem] mt-1.5 leading-relaxed" style={{ color: 'var(--brand-text-secondary)' }}>
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
                className="flex-1 h-11 rounded-full text-[0.875rem] font-bold cursor-pointer transition hover:opacity-85"
                style={{ border: '1.5px solid var(--brand-border)', color: 'var(--brand-text-secondary)', backgroundColor: 'white' }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                data-testid={isContra ? 'readd-contraindicated-confirm' : 'readd-rejected-confirm'}
                className="flex-1 h-11 rounded-full text-[0.875rem] font-bold text-white cursor-pointer transition hover:opacity-90"
                style={{ backgroundColor: 'var(--brand-primary-purple)' }}
              >
                {isContra ? 'I understand — add for review' : t('intake.reAddRejectedConfirmBtn')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
