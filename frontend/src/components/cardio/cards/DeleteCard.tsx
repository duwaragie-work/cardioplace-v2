'use client';

// Phase/27 chatbot v2 — refined delete result card. Bigger header, undo
// link to the readings page where the patient can re-add a reading if they
// regret the deletion.

import { motion } from 'framer-motion';
import { CheckCircle, AlertCircle, Trash2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import type { DeleteSummary } from '@/hooks/useVoiceSession';

interface Props {
  summary: DeleteSummary;
  onDismiss: () => void;
}

export default function DeleteCard({ summary, onDismiss }: Props) {
  const { t } = useLanguage();
  const successLabel =
    summary.deletedCount === 1
      ? t('chat.card.deleted1')
      : t('chat.card.deletedN').replace('{count}', String(summary.deletedCount));

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
        className="flex items-center gap-2 px-5 py-4"
        style={{ borderBottom: '1px solid var(--brand-border)' }}
      >
        {summary.success ? (
          <CheckCircle
            className="w-5 h-5 shrink-0"
            style={{ color: 'var(--brand-alert-red)' }}
            aria-hidden="true"
          />
        ) : (
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" aria-hidden="true" />
        )}
        <p
          className="font-bold text-[15px]"
          style={{ color: 'var(--brand-text-primary)' }}
        >
          {summary.success ? successLabel : t('chat.card.deleteFailed')}
        </p>
      </div>

      <div className="px-5 py-4">
        <div
          className="flex items-center gap-3 rounded-xl px-3 py-3"
          style={{ backgroundColor: 'var(--brand-alert-red-light)' }}
        >
          <Trash2
            className="w-5 h-5 shrink-0"
            style={{ color: 'var(--brand-alert-red)' }}
            aria-hidden="true"
          />
          <div>
            <p
              lang="en"
              className="text-[16px] font-bold"
              style={{ color: 'var(--brand-alert-red)' }}
            >
              {summary.deletedCount}{' '}
              {summary.deletedCount === 1 ? 'reading' : 'readings'} removed
            </p>
            {summary.failedCount > 0 && (
              <p
                className="text-[12px] mt-0.5"
                style={{ color: 'var(--brand-text-muted)' }}
              >
                {summary.failedCount} could not be deleted
              </p>
            )}
          </div>
        </div>
        {summary.message && (
          <p
            className="text-[12px] mt-3 text-center"
            style={{ color: 'var(--brand-text-muted)' }}
          >
            {summary.message}
          </p>
        )}
      </div>

      <div
        className="px-5 py-4 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--brand-border)' }}
      >
        <Link
          href="/readings"
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] inline-flex items-center justify-center gap-1.5 transition hover:opacity-90"
          style={{
            backgroundColor: 'var(--brand-background)',
            color: 'var(--brand-text-primary)',
          }}
        >
          {t('chat.card.viewOnReadings')}
          <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
        </Link>
        <button
          onClick={onDismiss}
          className="flex-1 h-11 rounded-xl font-semibold text-[13px] text-white transition hover:opacity-90"
          style={{
            background: 'linear-gradient(135deg, #DC2626, #EF4444)',
            boxShadow: '0 4px 14px rgba(220,38,38,0.28)',
          }}
        >
          {t('chat.card.done')}
        </button>
      </div>
    </motion.div>
  );
}
