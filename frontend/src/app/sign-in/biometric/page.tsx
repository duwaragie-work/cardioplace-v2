'use client';

/**
 * Patient biometric second factor (Face ID / fingerprint) — REQUIRED once a
 * patient has set it up. First factor is the email code / magic link; this is
 * the mandatory second factor.
 *
 * Reached after the first factor returns { status: 'WEBAUTHN_REQUIRED',
 * challengeToken }. We run the WebAuthn assertion; on success we exchange it
 * for the session.
 *
 * The ONLY fallback (no email bypass) is a one-time recovery code — used when
 * biometric can't run on this device (e.g. a desktop passkey that can't travel
 * to a phone). A recovery-code sign-in regenerates the set, which we show once
 * before continuing. If the patient has lost both their devices and their
 * codes, they must contact support (admin reset).
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, Loader2, ShieldCheck, KeyRound, CheckCircle2 } from 'lucide-react';
import { useAuth, type OtpVerifyResponse } from '@/lib/auth-context';
import {
  WEBAUTHN_CHALLENGE_STORAGE_KEY,
  authenticateBiometric,
  signInWithRecoveryCode,
} from '@/lib/services/webauthn.service';
import LandingHeader from '@/components/cardio/LandingHeader';
import LandingFooter from '@/components/cardio/LandingFooter';

function readChallengeToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(WEBAUTHN_CHALLENGE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { challengeToken?: string };
      if (parsed.challengeToken) return parsed.challengeToken;
    }
  } catch {
    /* sessionStorage unavailable — fall through to URL param */
  }
  try {
    return new URLSearchParams(window.location.search).get('challengeToken');
  } catch {
    return null;
  }
}

function clearStoredChallenge() {
  try {
    sessionStorage.removeItem(WEBAUTHN_CHALLENGE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

type Mode = 'prompt' | 'recovery' | 'used';

export default function BiometricSignInPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<Mode>('prompt');
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [remaining, setRemaining] = useState<number | null>(null);
  const autoTried = useRef(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChallengeToken(readChallengeToken());
    setReady(true);
  }, []);

  function goToApp(data: OtpVerifyResponse) {
    const onboardingRequired =
      (data as { onboarding_required?: boolean }).onboarding_required === true;
    router.push(onboardingRequired ? '/onboarding' : '/dashboard');
  }

  async function runBiometric() {
    if (busy || !challengeToken) return;
    setBusy(true);
    setError(null);
    try {
      const data = await authenticateBiometric(challengeToken);
      clearStoredChallenge();
      login(data);
      goToApp(data);
    } catch (err) {
      const e = err as Error & { code?: string };
      setError(e.message || 'Biometric sign-in failed.');
      setShowFallback(true);
      setBusy(false);
    }
  }

  // Auto-prompt once on mount.
  useEffect(() => {
    if (ready && challengeToken && mode === 'prompt' && !autoTried.current) {
      autoTried.current = true;
      void runBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, challengeToken]);

  async function handleRecoverySubmit() {
    if (submitting || recoveryCode.trim().length < 8 || !challengeToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await signInWithRecoveryCode(challengeToken, recoveryCode);
      clearStoredChallenge();
      login(data);
      // Only that one code was used — tell the patient how many remain, then
      // let them continue (they can set up biometric on this device later).
      setRemaining(data.recoveryRemaining ?? null);
      setMode('used');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid recovery code.');
      setSubmitting(false);
    }
  }

  if (!ready) return null;

  const expired = !challengeToken;

  return (
    <div className="bg-white">
      <LandingHeader activeLink="" />
      <main
        id="main"
        className="min-h-[100dvh] pt-24 pb-12 px-4 sm:px-6 flex items-start sm:items-center justify-center"
      >
        <div className="w-full max-w-md">
          {expired ? (
            <div className="text-center">
              <span
                className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-white mb-5"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                  boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
                }}
                aria-hidden
              >
                <ShieldCheck className="w-8 h-8" />
              </span>
              <h1 className="text-2xl font-bold text-[#170c1d] mb-2">
                Your sign-in expired
              </h1>
              <p className="text-[#6b7280] mb-6 text-sm">
                For your security, please sign in again to continue.
              </p>
              <a
                href="/sign-in"
                className="inline-block rounded-full bg-[#7B00E0] px-6 py-3 text-white font-semibold"
              >
                Back to sign in
              </a>
            </div>
          ) : mode === 'used' ? (
            <div className="text-center">
              <span
                className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-white mb-5"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                }}
                aria-hidden
              >
                <CheckCircle2 className="w-8 h-8" />
              </span>
              <h1 className="text-2xl font-bold text-[#170c1d] mb-2">
                You&apos;re signed in
              </h1>
              <p className="text-[#6b7280] mb-2 text-sm">
                You used a recovery code.
                {remaining !== null && (
                  <>
                    {' '}
                    <span className="font-semibold text-[#170c1d]">
                      {remaining} of 10 left.
                    </span>
                  </>
                )}
              </p>
              <p className="text-[#6b7280] mb-6 text-sm">
                Tip: set up Face ID / fingerprint on this device from Settings so
                you won&apos;t need a code next time.
              </p>
              <button
                type="button"
                onClick={() => router.push('/dashboard')}
                className="w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors cursor-pointer"
              >
                Continue
              </button>
            </div>
          ) : mode === 'recovery' ? (
            <div className="text-center">
              <span
                className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-white mb-5"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                }}
                aria-hidden
              >
                <KeyRound className="w-8 h-8" />
              </span>
              <h1 className="text-2xl font-bold text-[#170c1d] mb-2">
                Enter a recovery code
              </h1>
              <p className="text-[#6b7280] mb-6 text-sm">
                Use one of the codes you saved when you set up Face ID /
                fingerprint.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-left"
                >
                  {error}
                </div>
              )}

              <input
                data-testid="recovery-code-input"
                type="text"
                autoComplete="off"
                value={recoveryCode}
                onChange={(e) => setRecoveryCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRecoverySubmit();
                  }
                }}
                placeholder="XXXXX-XXXXX"
                className="w-full h-14 px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-lg text-center tracking-[4px] uppercase text-[#171717] placeholder:text-[#737373] placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
              />
              <button
                type="button"
                data-testid="recovery-code-submit"
                onClick={() => void handleRecoverySubmit()}
                disabled={recoveryCode.trim().length < 8 || submitting}
                className="mt-5 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {submitting && <Loader2 className="w-5 h-5 animate-spin" />}
                {submitting ? 'Signing you in…' : 'Sign in with recovery code'}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMode('prompt');
                  setError(null);
                }}
                className="mt-5 w-full text-center text-sm font-medium text-[#7B00E0] hover:underline cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <Fingerprint className="w-3.5 h-3.5" />
                Back to Face ID / fingerprint
              </button>

              <p className="mt-6 text-xs text-[#9ca3af]">
                Lost your codes and your device too?{' '}
                <a href="/sign-in" className="text-[#7B00E0] hover:underline">
                  Contact support
                </a>{' '}
                to reset your account.
              </p>
            </div>
          ) : (
            <div className="text-center">
              <span
                className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-white mb-5"
                style={{
                  background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                  boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
                }}
                aria-hidden
              >
                <Fingerprint className="w-8 h-8" />
              </span>
              <h1 className="text-2xl font-bold text-[#170c1d] mb-2">
                Confirm it&apos;s you
              </h1>
              <p className="text-[#6b7280] mb-6 text-sm">
                Use Face ID or your fingerprint to finish signing in.
              </p>

              {error && (
                <div
                  role="alert"
                  className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 text-left"
                >
                  {error}
                </div>
              )}

              <button
                type="button"
                data-testid="biometric-prompt-btn"
                onClick={() => void runBiometric()}
                disabled={busy}
                className="w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
              >
                {busy ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Waiting for biometric…
                  </>
                ) : (
                  <>
                    <Fingerprint className="w-5 h-5" />
                    Use Face ID / fingerprint
                  </>
                )}
              </button>

              {showFallback && (
                <div className="mt-6 border-t border-[#f0e6fa] pt-5">
                  <p className="text-[#6b7280] text-sm mb-3">
                    Can&apos;t use Face ID / fingerprint on this device?
                  </p>
                  <button
                    type="button"
                    data-testid="use-recovery-code-btn"
                    onClick={() => {
                      setMode('recovery');
                      setError(null);
                    }}
                    className="w-full h-12 rounded-full border border-[#7B00E0] font-semibold text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors cursor-pointer inline-flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-4 h-4" />
                    Use a recovery code
                  </button>
                </div>
              )}

              <p className="mt-8 text-xs text-[#9ca3af]">
                <a href="/sign-in" className="hover:underline">
                  Cancel and return to sign in
                </a>
              </p>
            </div>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
