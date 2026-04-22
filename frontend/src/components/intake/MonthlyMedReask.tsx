'use client';

// E4 — Monthly medication re-check.
//
// Surfaces a full-screen modal once every 30 days asking the patient if
// their medications are still the same. Tap "Yes" → records timestamp and
// dismisses. Tap "Update them" → records timestamp and deep-links to the
// wizard's medications step (A5).
//
// Trigger logic is local-first (localStorage timestamp) so it works without
// a backend cron firing client-side. The backend monthly-reask cron
// (phase/17) sends a separate push notification — both can coexist.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { Pill, Check, ArrowRight, X } from 'lucide-react';

const STORAGE_PREFIX = 'cardioplace_med_reask_at:';
const REASK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function readLastReaskAt(userId: string): number | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeLastReaskAt(userId: string, ts: number) {
  if (typeof window === 'undefined' || !userId) return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, String(ts));
  } catch {
    // ignore quota / private mode
  }
}

interface Props {
  userId: string | null | undefined;
  /** Patient's medications — modal only shows when there's something to confirm. */
  hasMedications: boolean;
  /** True only when the patient has actually completed clinical intake. */
  intakeComplete: boolean;
}

export default function MonthlyMedReask({ userId, hasMedications, intakeComplete }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!userId || !hasMedications || !intakeComplete) return;
    const last = readLastReaskAt(userId);
    if (last == null) {
      // First-ever check after intake — don't pop immediately. Stamp now so
      // the cycle starts here; the next prompt will fire 30 days from today.
      writeLastReaskAt(userId, Date.now());
      return;
    }
    if (Date.now() - last >= REASK_INTERVAL_MS) {
      setOpen(true);
    }
  }, [userId, hasMedications, intakeComplete]);

  function handleYes() {
    if (userId) writeLastReaskAt(userId, Date.now());
    setOpen(false);
  }

  function handleUpdate() {
    if (userId) writeLastReaskAt(userId, Date.now());
    setOpen(false);
    router.push('/clinical-intake?step=A5');
  }

  function handleClose() {
    // Soft dismiss — re-prompt on next dashboard visit (don't stamp).
    setOpen(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(15,23,42,0.55)' }}
          role="dialog"
          aria-modal="true"
          aria-label="Monthly medication check"
        >
          <motion.div
            initial={{ scale: 0.92, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 16 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="relative bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 text-center"
            style={{
              boxShadow: '0 24px 60px rgba(0,0,0,0.22)',
              paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 1.75rem)',
            }}
          >
            {/* Soft close — keep low-key so it doesn't compete with the action buttons */}
            <button
              type="button"
              onClick={handleClose}
              aria-label="Ask me later"
              className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center cursor-pointer transition hover:opacity-70"
              style={{ backgroundColor: 'var(--brand-background)' }}
            >
              <X className="w-4 h-4" style={{ color: 'var(--brand-text-muted)' }} />
            </button>

            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              }}
            >
              <Pill className="w-8 h-8 text-white" />
            </div>

            <p
              className="text-[11px] font-bold uppercase tracking-wider mb-1"
              style={{ color: 'var(--brand-primary-purple)' }}
            >
              Monthly check-in
            </p>
            <h2
              className="text-[20px] font-bold leading-tight mb-2"
              style={{ color: 'var(--brand-text-primary)', wordBreak: 'break-word' }}
            >
              Are you still taking the same medicines?
            </h2>
            <p
              className="text-[13px] mb-6 leading-relaxed"
              style={{ color: 'var(--brand-text-secondary)' }}
            >
              We ask once a month so your care team always sees what you&apos;re actually taking right now.
            </p>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={handleYes}
                className="w-full h-12 rounded-full font-bold text-white text-[14px] flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
                style={{
                  backgroundColor: 'var(--brand-primary-purple)',
                  boxShadow: 'var(--brand-shadow-button)',
                }}
              >
                <Check className="w-4 h-4" strokeWidth={3} />
                Yes, same medicines
              </button>
              <button
                type="button"
                onClick={handleUpdate}
                className="w-full h-12 rounded-full font-bold text-[14px] flex items-center justify-center gap-2 cursor-pointer transition"
                style={{
                  backgroundColor: 'var(--brand-warning-amber-light)',
                  color: 'var(--brand-warning-amber)',
                  border: '1.5px solid var(--brand-warning-amber)',
                }}
              >
                Update my medicines
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
