'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { CheckCircle2, X } from 'lucide-react';

/**
 * Minimal transient-confirmation toast.
 *
 * The app had no toast system — only per-component `setDone` success cards
 * (SupportContactForm, locked-out) and two purpose-built one-offs
 * (IdleWarningToast, the LanguageContext "coming soon" message). The support
 * lifecycle needs confirmation for actions that DON'T replace the surface
 * they're triggered from — sending a reply or reopening a request leaves you on
 * the thread — so an inline "replace the form with a success card" pattern
 * doesn't fit.
 *
 * Deliberately small: one message at a time, auto-dismissing, no queue, no
 * variants beyond success/error. The existing inline success cards are kept
 * where they already work (and the Playwright specs assert their test ids).
 */
type ToastTone = 'success' | 'error';

interface ToastState {
  message: string;
  tone: ToastTone;
  /** Bumped on every show so repeating the same message restarts the timer. */
  key: number;
}

interface ToastContextValue {
  showToast: (message: string, tone?: ToastTone) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4000;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = 'success') => {
    setToast({ message, tone, key: Date.now() });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), AUTO_DISMISS_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div
          // polite, not assertive: these confirm an action the user just took,
          // so they must not interrupt whatever a screen reader is announcing.
          role="status"
          aria-live="polite"
          data-testid="app-toast"
          className="fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border px-4 py-2.5 text-[13px] shadow-lg"
          style={
            toast.tone === 'error'
              ? { background: '#fef2f2', borderColor: '#fecaca', color: '#991b1b' }
              : { background: '#ecfdf5', borderColor: '#a7f3d0', color: '#065f46' }
          }
        >
          {toast.tone === 'success' && <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => setToast(null)}
            aria-label="Dismiss"
            className="ml-1 opacity-60 transition-opacity hover:opacity-100"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </ToastContext.Provider>
  );
}

/**
 * Returns a no-op outside a ToastProvider rather than throwing — a missing
 * confirmation toast must never break the action it was confirming.
 */
export function useToast(): ToastContextValue {
  return useContext(ToastContext) ?? { showToast: () => {} };
}
