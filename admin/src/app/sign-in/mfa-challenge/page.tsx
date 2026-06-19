'use client';

/**
 * MFA second factor (Manisha 2026-06-12 Access Control §6).
 *
 * Reached after an enrolled provider/admin clears the first factor (OTP /
 * magic-link) and, if multi-practice, the practice selector. Those steps
 * returned { status: 'MFA_REQUIRED', challengeToken } instead of tokens; the
 * sign-in / select-practice pages stash the token and route here. This page
 * exchanges the challenge token + a 6-digit authenticator code (or a one-time
 * recovery code) for the real session.
 *
 * Zero-state: a stale URL or a refresh past the 5-min challenge TTL lands here
 * with no token / an expired token — show "session expired, sign in again".
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import {
  MFA_CHALLENGE_STORAGE_KEY,
  verifyChallenge,
  verifyRecovery,
} from '@/lib/services/mfa.service';
import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

const CODE_LENGTH = 6;

function readChallengeToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(MFA_CHALLENGE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { challengeToken?: string };
      if (parsed.challengeToken) return parsed.challengeToken;
    }
  } catch {
    /* sessionStorage unavailable — fall through to URL param */
  }
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get('challengeToken');
  } catch {
    return null;
  }
}

function clearStoredChallenge() {
  try {
    sessionStorage.removeItem(MFA_CHALLENGE_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export default function MfaChallengePage() {
  const router = useRouter();
  const { login } = useAuth();

  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState<'totp' | 'recovery'>('totp');
  const [code, setCode] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // One-shot read of the stashed challenge token on mount. Intentional
    // synchronous set — mirrors the select-practice page's handoff pattern.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChallengeToken(readChallengeToken());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready && challengeToken) inputRef.current?.focus();
  }, [ready, challengeToken, mode]);

  if (!ready) return null;

  if (!challengeToken) {
    return (
      <div className="bg-white flex flex-col min-h-screen">
        <LandingHeader activeLink="" />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 pt-24 lg:pt-[64px] pb-12 px-4 sm:px-6 flex items-start lg:items-center justify-center"
        >
          <div className="max-w-md text-center">
            <h1 className="text-2xl font-semibold mb-3 text-gray-900">
              Your sign-in session expired
            </h1>
            <p className="text-gray-600 mb-6">
              For your security, please sign in again to continue.
            </p>
            <a
              href="/sign-in"
              className="inline-block rounded-lg bg-[#7B00E0] px-5 py-2.5 text-white font-semibold"
            >
              Back to sign in
            </a>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  async function handleVerifyTotp() {
    if (submitting || code.length !== CODE_LENGTH || !challengeToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await verifyChallenge(challengeToken, code);
      clearStoredChallenge();
      login(data);
      router.push('/dashboard');
    } catch (err) {
      const e = err as Error & { errorCode?: string };
      // A hard lockout invalidates this challenge — bounce to sign-in.
      if (e.errorCode === 'mfa_locked_admin') {
        setError(e.message);
      } else {
        setError(e.message || 'Invalid code. Try again.');
      }
      setCode('');
      setSubmitting(false);
    }
  }

  async function handleVerifyRecovery() {
    if (submitting || recoveryCode.trim().length < 8 || !challengeToken) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await verifyRecovery(challengeToken, recoveryCode.trim());
      clearStoredChallenge();
      login(data);
      // Standard backup login — the authenticator is untouched, so go straight
      // to the dashboard. A user who actually lost their app re-enrolls from
      // settings; we don't force it here.
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid recovery code.');
      setSubmitting(false);
    }
  }

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 pt-24 lg:pt-[64px] pb-12 px-4 sm:px-6 flex items-start lg:items-center justify-center"
      >
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center text-center mb-6">
          <span
            className="w-14 h-14 rounded-2xl flex items-center justify-center text-white mb-4"
            style={{
              background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
              boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
            }}
            aria-hidden
          >
            <ShieldCheck className="w-7 h-7" />
          </span>
          <h1 className="text-2xl font-semibold text-gray-900">
            Two-factor authentication
          </h1>
          <p className="text-gray-600 mt-2 text-sm">
            {mode === 'totp'
              ? 'Enter the 6-digit code from your authenticator app.'
              : 'Enter one of your saved recovery codes.'}
          </p>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {mode === 'totp' ? (
          <>
            <label htmlFor="mfa-code" className="sr-only">
              Authenticator code
            </label>
            <input
              id="mfa-code"
              ref={inputRef}
              data-testid="admin-mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleVerifyTotp();
                }
              }}
              placeholder="••••••"
              maxLength={CODE_LENGTH}
              className="w-full h-14 px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-2xl text-center tracking-[12px] text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
            />
            <button
              type="button"
              data-testid="admin-mfa-verify"
              onClick={() => void handleVerifyTotp()}
              disabled={code.length !== CODE_LENGTH || submitting}
              className="mt-5 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('recovery');
                setError(null);
              }}
              className="mt-5 w-full text-center text-sm font-medium text-[#7B00E0] hover:underline cursor-pointer"
            >
              Use a recovery code instead
            </button>
          </>
        ) : (
          <>
            <label htmlFor="mfa-recovery" className="sr-only">
              Recovery code
            </label>
            <input
              id="mfa-recovery"
              ref={inputRef}
              data-testid="admin-mfa-recovery"
              type="text"
              autoComplete="off"
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleVerifyRecovery();
                }
              }}
              placeholder="XXXXX-XXXXX"
              className="w-full h-14 px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-lg text-center tracking-[4px] uppercase text-[#171717] placeholder:text-[#737373] placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
            />
            <button
              type="button"
              data-testid="admin-mfa-recovery-verify"
              onClick={() => void handleVerifyRecovery()}
              disabled={recoveryCode.trim().length < 8 || submitting}
              className="mt-5 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? 'Verifying…' : 'Sign in with recovery code'}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('totp');
                setError(null);
              }}
              className="mt-5 w-full text-center text-sm font-medium text-[#7B00E0] hover:underline cursor-pointer inline-flex items-center justify-center gap-1.5"
            >
              <KeyRound className="w-3.5 h-3.5" />
              Back to authenticator code
            </button>
          </>
        )}

        <p className="mt-8 text-center text-xs text-gray-400">
          <a href="/sign-in" className="hover:underline">
            Cancel and return to sign in
          </a>
        </p>
      </div>
      </main>
      <LandingFooter />
    </div>
  );
}
