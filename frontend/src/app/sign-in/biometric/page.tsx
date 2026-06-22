'use client';

/**
 * Patient biometric second factor (Face ID / fingerprint).
 *
 * Reached after a patient with a registered device clears the first factor
 * (OTP / magic-link). That step returned { status: 'WEBAUTHN_REQUIRED',
 * challengeToken } instead of tokens; the sign-in page stashes the token (or
 * the magic-link redirect carries it in the URL) and routes here. We run the
 * WebAuthn assertion and, on success, exchange it for the real session.
 *
 * Graceful fallbacks:
 *   • Cancel / no passkey on this device → offer "try again" + "can't use it?
 *     remove biometric and sign in" (the challenge token already proves the
 *     first factor passed, so this can't be abused beyond OTP itself).
 *   • Expired / missing token → "sign in again".
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Fingerprint, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth, type OtpVerifyResponse } from '@/lib/auth-context';
import {
  WEBAUTHN_CHALLENGE_STORAGE_KEY,
  authenticateBiometric,
  recoverDisableBiometric,
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

export default function BiometricSignInPage() {
  const router = useRouter();
  const { login } = useAuth();

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFallback, setShowFallback] = useState(false);
  const autoTried = useRef(false);

  useEffect(() => {
    // One-shot read of the stashed challenge token on mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChallengeToken(readChallengeToken());
    setReady(true);
  }, []);

  function finishLogin(data: OtpVerifyResponse) {
    clearStoredChallenge();
    login(data);
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
      finishLogin(data);
    } catch (err) {
      const e = err as Error & { code?: string };
      setError(e.message || 'Biometric sign-in failed.');
      // Cancel / no-passkey-on-this-device → surface the recovery options.
      setShowFallback(true);
      setBusy(false);
    }
  }

  // Auto-prompt once on mount (most browsers still require the tap, but where
  // a gesture isn't needed this saves a step). Failures just reveal the button.
  useEffect(() => {
    if (ready && challengeToken && !autoTried.current) {
      autoTried.current = true;
      void runBiometric();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, challengeToken]);

  async function handleRecover() {
    if (recovering || !challengeToken) return;
    setRecovering(true);
    setError(null);
    try {
      const data = await recoverDisableBiometric(challengeToken);
      finishLogin(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not sign you in.');
      setRecovering(false);
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
        <div className="w-full max-w-md text-center">
          <span
            className="inline-flex w-16 h-16 rounded-2xl items-center justify-center text-white mb-5"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
            }}
            aria-hidden
          >
            {expired ? (
              <ShieldCheck className="w-8 h-8" />
            ) : (
              <Fingerprint className="w-8 h-8" />
            )}
          </span>

          {expired ? (
            <>
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
            </>
          ) : (
            <>
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
                disabled={busy || recovering}
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
                <div className="mt-6 border-t border-[#f0e6fa] pt-5 text-left">
                  <p className="text-[#6b7280] text-sm mb-3">
                    Can&apos;t use biometric on this device?
                  </p>
                  <button
                    type="button"
                    data-testid="biometric-recover-btn"
                    onClick={() => void handleRecover()}
                    disabled={recovering || busy}
                    className="w-full h-12 rounded-full border border-[#7B00E0] font-semibold text-[#7B00E0] hover:bg-[#7B00E0]/5 transition-colors disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
                  >
                    {recovering && <Loader2 className="w-4 h-4 animate-spin" />}
                    {recovering
                      ? 'Signing you in…'
                      : 'Turn off biometric and sign in'}
                  </button>
                  <p className="text-[#9ca3af] text-xs mt-2">
                    This removes Face ID / fingerprint from your account. You can
                    set it up again later from Settings.
                  </p>
                </div>
              )}

              <p className="mt-8 text-xs text-[#9ca3af]">
                <a href="/sign-in" className="hover:underline">
                  Cancel and return to sign in
                </a>
              </p>
            </>
          )}
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
