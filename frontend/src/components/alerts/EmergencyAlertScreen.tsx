'use client';

// C1 + C2 — BP Level 2 emergency screen.
//   C1: full-bleed red takeover (covers navbar via z-[100] fixed inset-0).
//        Auto-plays the message, big 911 button, "I understand" gate.
//   C2: T+2h follow-up. If the patient previously tapped "I understand" and
//        more than ~2h have elapsed without acknowledgment, we surface a
//        "Have you called 911?" prompt instead. Picking "Not yet" reverts
//        back to C1.
//
// Persistence is local-only for the MVP — backend cron will eventually drive
// the T+2h transition (V2-D §D.5). The localStorage flag mirrors that
// behavior so the screen feels coherent without the server piece.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Phone, Check, X } from 'lucide-react';
import type { DeviationAlertDto } from '@/lib/services/journal.service';
import { useLanguage } from '@/contexts/LanguageContext';

interface Props {
  alert: DeviationAlertDto;
  onAcknowledge: () => Promise<void> | void;
}

// Clinical patient copy for BP Level 2 — intentionally NOT i18n'd. This
// wording is the same content as shared/alert-messages.ts and needs
// Dr. Singal sign-off per locale before translation.
const MESSAGE_TITLE = 'Your blood pressure is very high.';
const MESSAGE_BODY =
  'If you have chest pain, severe headache, difficulty breathing, or vision changes, call 911 now.';
const REASSURANCE = 'Your care team has been notified.';
const FULL_AUDIO = `${MESSAGE_TITLE} ${MESSAGE_BODY} ${REASSURANCE}`;
const FOLLOWUP_AUDIO =
  "Have you called 911 yet? Tap Yes if you have, or Not yet if you haven't.";

const STORAGE_PREFIX = 'cardioplace_emergency_understood:';
const FOLLOWUP_DELAY_MS = 2 * 60 * 60 * 1000; // 2 hours

function speak(text: string, lang = 'en-US'): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = 0.92;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    return false;
  }
}

function readUnderstoodAt(alertId: string): number | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${alertId}`);
    if (!raw) return null;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

function writeUnderstoodAt(alertId: string, ts: number) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${alertId}`, String(ts));
  } catch {
    // quota / private mode — ignore
  }
}

function clearUnderstood(alertId: string) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${STORAGE_PREFIX}${alertId}`);
  } catch {
    // ignore
  }
}

export default function EmergencyAlertScreen({ alert, onAcknowledge }: Props) {
  const router = useRouter();
  const { t } = useLanguage();
  type Mode = 'urgent' | 'followup' | 'closed';
  const [mode, setMode] = useState<Mode>('urgent');
  const [audioBlocked, setAudioBlocked] = useState(false);

  const isResolved = alert.status === 'ACKNOWLEDGED' || alert.status === 'RESOLVED';

  // Decide initial mode on mount: if previously dismissed + T+2h elapsed
  // + alert still open → C2. Otherwise → C1. If the backend has marked
  // it acknowledged we just show closed.
  useEffect(() => {
    if (isResolved) {
      setMode('closed');
      return;
    }
    const understoodAt = readUnderstoodAt(alert.id);
    if (understoodAt && Date.now() - understoodAt >= FOLLOWUP_DELAY_MS) {
      setMode('followup');
    } else {
      setMode('urgent');
    }
  }, [alert.id, isResolved]);

  // Auto-play the appropriate message on mount / mode change. Most browsers
  // block autoplay until the user has interacted with the page — if blocked,
  // surface a "Tap to hear" hint and let the patient trigger it manually.
  useEffect(() => {
    if (mode === 'closed') return;
    const text = mode === 'followup' ? FOLLOWUP_AUDIO : FULL_AUDIO;
    const ok = speak(text);
    if (!ok) setAudioBlocked(true);
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [mode]);

  function manualPlay() {
    const text = mode === 'followup' ? FOLLOWUP_AUDIO : FULL_AUDIO;
    speak(text);
    setAudioBlocked(false);
  }

  async function handleUnderstand() {
    // Local "I understood, stop showing me this takeover" — written to
    // localStorage so the same alert doesn't re-prompt every page load.
    writeUnderstoodAt(alert.id, Date.now());
    // CLINICAL_SPEC V2-C — non-dismissable alerts (Tier 1 + BP Level 2)
    // must NOT be acknowledged server-side by the patient. The backend
    // acknowledge endpoint stops the provider escalation ladder, which is
    // a clinical-safety hole if a patient could trigger it. Skip the API
    // call when dismissible=false; the local writeUnderstoodAt above is
    // enough to get the patient out of the overlay.
    if (alert.dismissible !== false) {
      try {
        await onAcknowledge();
      } catch {
        // surface failure isn't blocking — the patient still gets out of
        // the overlay and the cron will retry the ack server-side
      }
    }
    setMode('closed');
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    router.push('/dashboard');
  }

  function handleFollowupYes() {
    void handleUnderstand();
  }

  function handleFollowupNotYet() {
    // Re-show urgent message and clear the dismiss flag so the next visit
    // starts the T+2h countdown again.
    clearUnderstood(alert.id);
    setMode('urgent');
  }

  if (mode === 'closed') {
    // Already resolved — nothing to interrupt with. Caller will render the
    // resolved banner via TierAlertView.
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-[100] flex flex-col text-white"
      style={{ backgroundColor: 'var(--brand-alert-red)' }}
      role="alertdialog"
      aria-modal="true"
      aria-label={t('alerts.emergency.ariaLabel')}
    >
      {/* Top safe-area padding for notched phones */}
      <div style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }} />

      {/* Audio-blocked hint banner */}
      <AnimatePresence>
        {audioBlocked && (
          <motion.button
            type="button"
            onClick={manualPlay}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="mx-4 mt-3 sm:mx-auto sm:mt-4 sm:max-w-md py-2 rounded-full text-[12.5px] font-bold cursor-pointer"
            style={{ backgroundColor: 'rgba(0,0,0,0.18)', color: 'white' }}
          >
            {t('alerts.emergency.audioHint')}
          </motion.button>
        )}
      </AnimatePresence>

      {/* Main message — vertically centered, with room above for the audio
          hint and below for the action buttons. */}
      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 sm:px-8 py-6 max-w-xl mx-auto w-full">
        <motion.div
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 280, damping: 22 }}
          className="rounded-full bg-white flex items-center justify-center mb-6"
          style={{ width: 88, height: 88 }}
          aria-hidden
        >
          <AlertTriangle
            className="w-12 h-12"
            style={{ color: 'var(--brand-alert-red)' }}
            strokeWidth={2.5}
          />
        </motion.div>

        {mode === 'urgent' ? (
          // lang="en" on clinical copy: MESSAGE_TITLE/body/REASSURANCE stay in
          // English until Dr. Singal signs off per-locale (matches alert-messages.ts).
          // Without this, screen readers + TTS try to pronounce English as the
          // page locale on es/fr/de/am.
          <>
            <h1
              lang="en"
              className="text-[26px] sm:text-[32px] font-extrabold leading-tight mb-4"
              style={{ wordBreak: 'break-word' }}
            >
              {MESSAGE_TITLE}
            </h1>
            <p lang="en" className="text-[16px] sm:text-[18px] leading-relaxed mb-3 opacity-95">
              If you have <b>chest pain</b>, <b>severe headache</b>, <b>difficulty breathing</b>, or <b>vision changes</b>, call 911 now.
            </p>
            <p lang="en" className="text-[13px] sm:text-[14px] opacity-90">{REASSURANCE}</p>
          </>
        ) : (
          <>
            <h1
              className="text-[26px] sm:text-[32px] font-extrabold leading-tight mb-3"
              style={{ wordBreak: 'break-word' }}
            >
              {t('alerts.emergency.followupTitle')}
            </h1>
            <p className="text-[14px] sm:text-[15px] opacity-95">
              {t('alerts.emergency.followupBody')}
            </p>
          </>
        )}
      </main>

      {/* Action buttons — sticky bottom with safe-area inset. */}
      <div
        className="px-5 pt-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 1.25rem)' }}
      >
        {mode === 'urgent' ? (
          <div className="max-w-md mx-auto space-y-3">
            <a
              href="tel:911"
              className="block w-full text-center rounded-full py-4 sm:py-5 font-extrabold text-[20px] sm:text-[22px] active:scale-[0.98] transition"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-alert-red)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
              }}
              aria-label={t('alerts.emergency.callAria')}
            >
              <span className="inline-flex items-center justify-center gap-3">
                <Phone className="w-6 h-6" strokeWidth={2.5} />
                {t('alerts.emergency.callLabel')}
              </span>
            </a>
            <button
              type="button"
              onClick={handleUnderstand}
              className="w-full rounded-full py-3 font-bold text-[14px] cursor-pointer transition"
              style={{
                backgroundColor: 'rgba(0,0,0,0.18)',
                color: 'white',
              }}
            >
              {t('alerts.emergency.understand')}
            </button>
          </div>
        ) : (
          <div className="max-w-md mx-auto grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={handleFollowupYes}
              className="rounded-full py-4 font-extrabold text-[16px] flex items-center justify-center gap-2 cursor-pointer transition active:scale-[0.98]"
              style={{
                backgroundColor: 'white',
                color: 'var(--brand-alert-red)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
              }}
            >
              <Check className="w-5 h-5" strokeWidth={3} /> {t('alerts.emergency.followupYes')}
            </button>
            <button
              type="button"
              onClick={handleFollowupNotYet}
              className="rounded-full py-4 font-extrabold text-[16px] flex items-center justify-center gap-2 cursor-pointer transition"
              style={{
                backgroundColor: 'rgba(0,0,0,0.22)',
                color: 'white',
              }}
            >
              <X className="w-5 h-5" strokeWidth={3} /> {t('alerts.emergency.followupNotYet')}
            </button>
          </div>
        )}
      </div>
    </motion.div>
  );
}
