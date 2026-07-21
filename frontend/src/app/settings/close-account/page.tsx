'use client';

// Patient permanent-close confirmation (phase/28). The 1-hour token arrives by
// email → this page confirms the irreversible close. Authenticated route: the
// patient is signed in (they just requested it), and the backend also checks
// the token's subject matches the session, so a stolen link is useless.

import { Suspense, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useLanguage } from '@/contexts/LanguageContext';
import { confirmSelfClose } from '@/lib/services/auth.service';

function CloseAccountInner() {
  const { t } = useLanguage();
  const router = useRouter();
  // F3 — capture the token ONCE (useRef initializes on the first render, while
  // it's still in the URL), then scrub it from the address bar + history ON LOAD
  // so it never lingers while the patient decides. The Confirm button reads the
  // ref, so it still works after the scrub. Backend enforces single-use + TTL.
  const token = useRef(useSearchParams().get('token') ?? '').current;

  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);

  async function confirm() {
    if (!token) {
      setState('error');
      setError(t('settings.close.invalidToken'));
      return;
    }
    setState('busy');
    setError(null);
    try {
      await confirmSelfClose(token);
      setState('done');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : t('settings.close.invalidToken'));
    }
  }

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4"
      style={{ backgroundColor: '#FAFBFF' }}
    >
      <div
        className="w-full max-w-md bg-white rounded-3xl p-6 sm:p-8"
        style={{ boxShadow: 'var(--brand-shadow-card)' }}
      >
        {state === 'done' ? (
          <div className="text-center">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-4"
              style={{ backgroundColor: 'var(--brand-success-green-light, #DCFCE7)' }}
            >
              <CheckCircle2 className="w-7 h-7" style={{ color: 'var(--brand-success-green, #16a34a)' }} />
            </div>
            <p className="text-[15px] font-semibold mb-5" style={{ color: 'var(--brand-text-primary)' }}>
              {t('settings.close.success')}
            </p>
            <button
              type="button"
              onClick={() => router.replace('/sign-in')}
              className="h-11 px-5 rounded-full font-semibold text-sm text-white cursor-pointer"
              style={{ backgroundColor: 'var(--brand-primary-purple)' }}
            >
              {t('settings.close.signIn')}
            </button>
          </div>
        ) : (
          <>
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-white"
              style={{ backgroundColor: 'var(--brand-alert-red)' }}
              aria-hidden
            >
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h1 className="text-xl font-bold mb-2" style={{ color: 'var(--brand-text-primary)' }}>
              {t('settings.close.pageTitle')}
            </h1>
            <p className="text-[13.5px] leading-relaxed mb-5" style={{ color: 'var(--brand-text-muted)' }}>
              {t('settings.close.pageDesc')}
            </p>
            {error && (
              <p
                role="alert"
                className="text-[13px] font-semibold px-3 py-2 rounded-lg mb-4"
                style={{ color: 'var(--brand-alert-red)', backgroundColor: 'var(--brand-alert-red-light)' }}
              >
                {error}
              </p>
            )}
            <button
              type="button"
              onClick={confirm}
              disabled={state === 'busy'}
              data-testid="close-account-confirm"
              className="w-full h-12 rounded-full font-semibold text-sm text-white inline-flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
              style={{ backgroundColor: 'var(--brand-alert-red)' }}
            >
              {state === 'busy' && <Loader2 className="w-4 h-4 animate-spin" />}
              {t('settings.close.confirmButton')}
            </button>
          </>
        )}
      </div>
    </main>
  );
}

export default function CloseAccountPage() {
  return (
    <Suspense fallback={null}>
      <CloseAccountInner />
    </Suspense>
  );
}
