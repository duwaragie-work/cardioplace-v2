'use client';

// Phase/27 chatbot v2 — BP-from-photo confirmation card.
// Tool returns parsed numbers; THIS card lets the patient verify before the
// bot calls submit_checkin. Confirm → bot saves; Edit → patient types
// manually; Re-take → opens camera again.
//
// Pattern mirrors BpPhotoConfirmModal from the OCR PR (Phase/27 commit
// 0dac339) but rendered as a chat card instead of a fullscreen modal so it
// flows in the chat history.

import { motion } from 'framer-motion';
import { Camera, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import AudioButton from '@/components/intake/AudioButton';
import type { BPPhotoSummary } from '@/hooks/useVoiceSession';

interface Props {
  summary: BPPhotoSummary;
  onConfirm: () => void;
  onEdit: () => void;
  onRetake: () => void;
}

export default function BPPhotoCard({
  summary,
  onConfirm,
  onEdit,
  onRetake,
}: Props) {
  const { t } = useLanguage();

  // Failure path — render a friendly retry CTA, no number display.
  if (!summary.parsed || summary.sbp == null || summary.dbp == null) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="mx-auto w-full max-w-md rounded-2xl my-2 overflow-hidden"
        style={{
          backgroundColor: 'white',
          border: '1.5px solid var(--brand-border)',
          boxShadow: '0 4px 20px rgba(0,0,0,0.09)',
        }}
      >
        <div className="px-5 py-4 flex items-start gap-2">
          <AlertCircle className="w-5 h-5 shrink-0" style={{ color: "var(--brand-alert-red)" }} aria-hidden="true" />
          <div className="flex-1">
            <p
              className="font-bold text-[0.9375rem]"
              style={{ color: 'var(--brand-text-primary)' }}
            >
              {t('chat.card.photoFailed')}
            </p>
            <p
              className="text-[0.8125rem] mt-1 leading-relaxed"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              {summary.message}
            </p>
          </div>
        </div>
        <div
          className="px-5 py-4 flex items-center gap-2"
          style={{ borderTop: '1px solid var(--brand-border)' }}
        >
          <button
            onClick={onRetake}
            className="flex-1 h-11 rounded-xl font-semibold text-[0.8125rem] transition hover:opacity-90"
            style={{
              backgroundColor: 'var(--brand-primary-purple-light)',
              color: 'var(--brand-primary-purple)',
            }}
          >
            {t('chat.card.photoRetake')}
          </button>
          <button
            onClick={onEdit}
            className="flex-1 h-11 rounded-xl font-semibold text-[0.8125rem] text-white transition hover:opacity-90"
            style={{
              background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            }}
          >
            {t('chat.card.photoTypeInstead')}
          </button>
        </div>
      </motion.div>
    );
  }

  const audio = `We read ${summary.sbp} over ${summary.dbp}${summary.pulse != null ? `, pulse ${summary.pulse}` : ''}. Is that right?`;
  const lowConfidence = (summary.confidence ?? 0) < 0.6;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="mx-auto w-full max-w-md rounded-2xl my-2 overflow-hidden"
      style={{
        backgroundColor: 'white',
        border: '1.5px solid var(--brand-border)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.09)',
      }}
    >
      <div
        className="flex items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        <div className="flex items-center gap-2">
          <Camera
            className="w-5 h-5 shrink-0"
            style={{ color: 'var(--brand-primary-purple)' }}
            aria-hidden="true"
          />
          <p
            className="font-bold text-[0.9375rem]"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {t('chat.card.photoConfirmTitle')}
          </p>
        </div>
        <AudioButton size="sm" text={audio} lang="en" />
      </div>

      <div className="px-5 py-4 flex items-center gap-4">
        {summary.previewUrl && (
          <img
            src={summary.previewUrl}
            alt=""
            aria-hidden="true"
            className="w-24 h-24 rounded-xl object-cover shrink-0"
            style={{ border: '1px solid var(--brand-border)' }}
          />
        )}
        <div className="flex-1 min-w-0">
          <p
            lang="en"
            className="text-[2.25rem] font-bold leading-none"
            style={{ color: 'var(--brand-text-primary)' }}
          >
            {summary.sbp} / {summary.dbp}
          </p>
          {summary.pulse != null && (
            <p
              lang="en"
              className="mt-1 text-[0.875rem] font-semibold"
              style={{ color: 'var(--brand-text-muted)' }}
            >
              pulse {summary.pulse}
            </p>
          )}
          {summary.confidence != null && (
            <p
              className="mt-1 text-[0.625rem]"
              style={{
                color: lowConfidence
                  ? 'var(--brand-warning-amber)'
                  : 'var(--brand-text-muted)',
              }}
            >
              Confidence: {(summary.confidence * 100).toFixed(0)}%
              {lowConfidence ? ' — please double-check' : ''}
            </p>
          )}
        </div>
      </div>

      <p
        className="px-5 pb-3 text-[0.8125rem] leading-relaxed"
        style={{ color: 'var(--brand-text-secondary)' }}
      >
        {t('chat.card.photoConfirmHelp')}
      </p>

      <div
        className="px-5 py-4 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <button
          onClick={onConfirm}
          disabled={lowConfidence}
          className="flex-1 h-11 rounded-xl font-bold text-[0.8125rem] text-white transition hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            background: 'linear-gradient(135deg, #7B00E0, #9333EA)',
            boxShadow: lowConfidence ? 'none' : '0 4px 14px rgba(123,0,224,0.28)',
          }}
        >
          {t('chat.card.photoConfirm')}
        </button>
        <button
          onClick={onEdit}
          className="flex-1 h-11 rounded-xl font-semibold text-[0.8125rem] transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-background)',
            color: 'var(--brand-text-primary)',
          }}
        >
          {t('chat.card.photoEdit')}
        </button>
        <button
          onClick={onRetake}
          className="flex-1 h-11 rounded-xl font-semibold text-[0.8125rem] transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-primary-purple-light)',
            color: 'var(--brand-primary-purple)',
          }}
        >
          {t('chat.card.photoRetake')}
        </button>
      </div>
    </motion.div>
  );
}
