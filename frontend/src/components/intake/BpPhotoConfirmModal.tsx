'use client';

// Phase/27 BP photo OCR confirmation modal (NIVA_SILENT_LITERACY_PLAN §3).
// MUST be the gating step between Gemini's read and the form fields — values
// never auto-populate. Modal ARIA mirrors PersonalInfoModal/EditModal:
// role=dialog + aria-modal=true + aria-labelledby pointing at the heading.
//
// Numbers render with lang="en" so screen readers say "one forty-two" not
// the locale-localised string — same convention as the alerts list.

import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from './AudioButton';
import type { BpOcrSuccess } from '@/lib/services/ocr.service';

interface Props {
  result: BpOcrSuccess;
  previewUrl: string;
  onConfirm: () => void;
  onCancel: () => void;
  onRetake: () => void;
}

export default function BpPhotoConfirmModal({
  result,
  previewUrl,
  onConfirm,
  onCancel,
  onRetake,
}: Props) {
  const { t } = useLanguage();

  // Compose the spoken summary so eyes-closed users can verify by ear.
  // Pulse part is appended only when present so the speech doesn't say
  // "pulse null" or trail off awkwardly.
  const audioText = (() => {
    const tmpl = t('ocr.bp.audioTemplate');
    const pulsePart = result.pulse != null
      ? t('ocr.bp.audioPulsePart').replace('{pulse}', String(result.pulse))
      : '';
    return tmpl
      .replace('{sbp}', String(result.sbp))
      .replace('{dbp}', String(result.dbp))
      .replace('{pulsePart}', pulsePart);
  })();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ backgroundColor: 'rgba(15,23,42,0.5)' }}
    >
      <button
        type="button"
        aria-label={t('accessibility.closeDialog')}
        className="absolute inset-0 cursor-default"
        onClick={onCancel}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bp-confirm-title"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 340, damping: 30 }}
        className="relative w-full sm:max-w-md bg-white sm:rounded-2xl rounded-t-2xl flex flex-col overflow-hidden"
        style={{
          maxHeight: '90dvh',
          boxShadow: '0 8px 48px rgba(0,0,0,0.18)',
        }}
      >
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--brand-border)' }}
        >
          <div className="flex items-center gap-2">
            <h2
              id="bp-confirm-title"
              className="text-[16px] font-bold"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('ocr.bp.confirmTitle')}
            </h2>
            <AudioButton size="sm" text={audioText} lang="en" />
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="w-11 h-11 rounded-full flex items-center justify-center cursor-pointer"
            style={{ backgroundColor: 'var(--brand-background)' }}
            aria-label={t('accessibility.closeDialog')}
          >
            <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex flex-col gap-4">
          <div className="flex items-center gap-4">
            {/* Photo thumbnail — alt text is decorative because the numbers
                are the actual content. The photo is just a visual reminder
                of what the patient just snapped. */}
            <img
              src={previewUrl}
              alt=""
              aria-hidden="true"
              className="w-24 h-24 rounded-xl object-cover shrink-0"
              style={{ border: '1px solid var(--brand-border)' }}
            />
            <div className="flex-1 min-w-0">
              {/* lang="en" so screen readers speak "one forty-two over eighty-eight"
                  rather than the locale-localised pronunciation of the digits. */}
              <p
                lang="en"
                className="text-[36px] font-bold leading-none"
                style={{ color: 'var(--brand-text-primary)' }}
              >
                {result.sbp} / {result.dbp}
              </p>
              {result.pulse != null && (
                <p
                  lang="en"
                  className="mt-1 text-[14px] font-semibold"
                  style={{ color: 'var(--brand-text-muted)' }}
                >
                  pulse {result.pulse}
                </p>
              )}
            </div>
          </div>

          <p
            className="text-[13px] leading-relaxed"
            style={{ color: 'var(--brand-text-secondary)' }}
          >
            {t('ocr.bp.helpText')}
          </p>
        </div>

        {/* Footer — three buttons, all 44×44 with focus rings */}
        <div
          className="shrink-0 px-5 py-4 flex flex-col sm:flex-row gap-2"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 h-11 rounded-xl font-bold text-white cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{ backgroundColor: 'var(--brand-primary-purple)' }}
          >
            {t('ocr.bp.confirm')}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 h-11 rounded-xl font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              backgroundColor: 'var(--brand-background)',
              color: 'var(--brand-text-primary)',
            }}
          >
            {t('ocr.bp.edit')}
          </button>
          <button
            type="button"
            onClick={onRetake}
            className="flex-1 h-11 rounded-xl font-semibold cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--brand-primary-purple)]"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            {t('ocr.bp.retake')}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
