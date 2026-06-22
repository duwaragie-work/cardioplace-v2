'use client';

// Recovery-codes modal (profile Security surface). Two phases:
//   1. confirm  — warn that regenerating invalidates the old codes
//   2. codes    — show the fresh codes ONCE with copy / download
//
// Regeneration goes through POST /auth/mfa/recovery-codes/regenerate, which
// replaces every prior code server-side. The plaintext set is shown here once
// and never retrievable again — same contract as enrollment.

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  KeyRound,
  Loader2,
  Copy,
  Check,
  Download,
  AlertTriangle,
} from 'lucide-react';
import { regenerateRecoveryCodes } from '@/lib/services/mfa.service';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function RecoveryCodesModal({ open, onClose }: Props) {
  const [phase, setPhase] = useState<'confirm' | 'codes'>('confirm');
  const [codes, setCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset to the confirm phase each time the modal opens.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase('confirm');
    setCodes([]);
    setLoading(false);
    setError(null);
    setCopied(false);
  }, [open]);

  // Esc closes (only when idle).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !loading) onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const { recoveryCodes } = await regenerateRecoveryCodes();
      setCodes(recoveryCodes);
      setPhase('codes');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not generate new codes.',
      );
    } finally {
      setLoading(false);
    }
  }

  function copyCodes() {
    void navigator.clipboard?.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        'Cardioplace — two-factor recovery codes\n',
        'Keep these somewhere safe. Each code works once.\n\n',
        codes.join('\n'),
        '\n',
      ],
      { type: 'text/plain' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'cardioplace-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
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
            onClick={loading ? undefined : onClose}
            style={{ cursor: loading ? 'not-allowed' : 'pointer' }}
            aria-hidden
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
            role="dialog"
            aria-modal="true"
            aria-labelledby="recovery-codes-title"
            data-testid="admin-recovery-codes-modal"
          >
            <div
              className="shrink-0 flex items-start justify-between gap-3 px-5 pt-4 pb-3"
              style={{ borderBottom: '1px solid var(--brand-border)' }}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div
                  className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center text-white"
                  style={{ backgroundColor: 'var(--brand-primary-purple)' }}
                  aria-hidden
                >
                  <KeyRound className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="recovery-codes-title"
                    className="text-[14px] font-bold leading-tight"
                    style={{ color: 'var(--brand-text-primary)' }}
                  >
                    {phase === 'confirm'
                      ? 'Generate new recovery codes'
                      : 'Your new recovery codes'}
                  </h2>
                  <p
                    className="text-[11px] mt-0.5 leading-snug"
                    style={{ color: 'var(--brand-text-muted)' }}
                  >
                    {phase === 'confirm'
                      ? 'This replaces your existing codes.'
                      : 'Save these now — they won’t be shown again.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-gray-100 cursor-pointer disabled:opacity-50"
                aria-label="Close"
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--brand-text-muted)' }} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto thin-scrollbar p-5">
              {error && (
                <p
                  className="mb-4 text-[12px] font-semibold text-center px-3 py-2 rounded-lg"
                  style={{
                    color: 'var(--brand-alert-red)',
                    backgroundColor: 'var(--brand-alert-red-light)',
                  }}
                  role="alert"
                >
                  {error}
                </p>
              )}

              {phase === 'confirm' ? (
                <div
                  className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]"
                  style={{
                    backgroundColor: 'var(--brand-warning-amber-light, #FEF3C7)',
                    color: 'var(--brand-warning-amber, #92400E)',
                  }}
                  role="status"
                >
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    Your current recovery codes will stop working immediately.
                    You’ll get 10 new one-time codes to save in their place.
                  </span>
                </div>
              ) : (
                <>
                  <ul
                    data-testid="admin-recovery-codes-list"
                    className="grid grid-cols-2 gap-2 rounded-xl border border-[#e5d9f2] bg-gray-50 p-4 font-mono text-[13px] tracking-wider text-gray-800"
                  >
                    {codes.map((rc) => (
                      <li key={rc} className="text-center py-1">
                        {rc}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex gap-3">
                    <button
                      type="button"
                      onClick={copyCodes}
                      className="flex-1 h-11 rounded-lg border border-[#e5d9f2] font-semibold text-sm text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      {copied ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                      {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      onClick={downloadCodes}
                      className="flex-1 h-11 rounded-lg border border-[#e5d9f2] font-semibold text-sm text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </button>
                  </div>
                </>
              )}
            </div>

            <div
              className="shrink-0 px-5 py-3 flex gap-3"
              style={{ borderTop: '1px solid var(--brand-border)' }}
            >
              {phase === 'confirm' ? (
                <>
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={loading}
                    className="btn-admin-secondary flex-1"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void generate()}
                    disabled={loading}
                    data-testid="admin-recovery-codes-generate"
                    className="btn-admin-primary flex-1"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>Generate codes</>
                    )}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  data-testid="admin-recovery-codes-done"
                  className="btn-admin-primary flex-1"
                >
                  Done
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
