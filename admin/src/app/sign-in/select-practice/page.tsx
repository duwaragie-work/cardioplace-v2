'use client';

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1).
 *
 * Renders the practice selector when a multi-practice provider has just
 * verified their OTP / magic-link credentials but hasn't yet picked WHICH
 * practice they're acting as. The verify endpoint returned a short-lived
 * challenge token (5-min TTL); POSTing it here with the chosen practiceId
 * exchanges it for the real token pair and the activePracticeId persists
 * on the new AuthSession.
 *
 * Zero-state: a stale URL or a refresh past the 5-min TTL lands here with
 * no challenge — show "session expired, please sign in again" + a link.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, ArrowRight, Loader2, AlertTriangle } from 'lucide-react';
import { useAuth, type AdminAuthResponse } from '@/lib/auth-context';
import { useLanguage } from '@/contexts/LanguageContext';
import { MFA_CHALLENGE_STORAGE_KEY } from '@/lib/services/mfa.service';
import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type Challenge = {
  challengeToken: string;
  practices: Array<{ id: string; name: string }>;
};

function readChallenge(): Challenge | null {
  if (typeof window === 'undefined') return null;
  // Prefer sessionStorage (set by sign-in page on the verify response).
  try {
    const raw = sessionStorage.getItem('cp_admin_practice_challenge');
    if (raw) return JSON.parse(raw) as Challenge;
  } catch {
    /* sessionStorage unavailable — fall through */
  }
  // Fallback to URL params (magic-link redirect path).
  try {
    const params = new URLSearchParams(window.location.search);
    const challengeToken = params.get('challengeToken');
    const practicesRaw = params.get('practices');
    if (challengeToken && practicesRaw) {
      return {
        challengeToken,
        practices: JSON.parse(practicesRaw) as Challenge['practices'],
      };
    }
  } catch {
    /* fall through */
  }
  return null;
}

export default function SelectPracticePage() {
  const router = useRouter();
  const { login } = useAuth();
  const { t } = useLanguage();
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChallenge(readChallenge());
  }, []);

  if (challenge === null) {
    // First render before useEffect runs.
    return null;
  }

  if (!challenge.challengeToken) {
    return (
      <div className="bg-white flex flex-col min-h-screen">
        <LandingHeader activeLink="" />
        <main
          id="main"
          tabIndex={-1}
          className="flex-1 pt-24 lg:pt-[64px] pb-12 px-4 sm:px-6 flex items-start lg:items-center justify-center"
        >
          <div className="w-full max-w-md flex flex-col items-center text-center">
            <span
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white mb-4"
              style={{
                background: 'linear-gradient(135deg, #7B00E0 0%, #9333EA 100%)',
                boxShadow: '0 4px 16px rgba(123,0,224,0.28)',
              }}
              aria-hidden
            >
              <AlertTriangle className="w-7 h-7" />
            </span>
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              {t('signIn.selectPractice.expired.title')}
            </h1>
            <p className="text-gray-600 text-sm mb-6">
              {t('signIn.selectPractice.expired.body')}
            </p>
            <a
              href="/sign-in"
              className="inline-flex items-center justify-center h-12 px-6 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm hover:bg-[#6600BC] transition-colors"
            >
              {t('signIn.selectPractice.expired.back')}
            </a>
          </div>
        </main>
        <LandingFooter />
      </div>
    );
  }

  async function selectPractice(practiceId: string) {
    if (submitting || !challenge) return;
    setSubmitting(practiceId);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/v2/auth/select-practice`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeToken: challenge.challengeToken,
          practiceId,
        }),
      });
      const data = (await res.json()) as AdminAuthResponse & {
        message?: string;
        status?: string;
        challengeToken?: string;
        mfaEnrollmentRequired?: boolean;
      };
      if (!res.ok) {
        throw new Error(data?.message ?? t('signIn.selectPractice.error'));
      }
      try {
        sessionStorage.removeItem('cp_admin_practice_challenge');
      } catch {
        /* sessionStorage unavailable */
      }
      // MFA (Manisha 2026-06-12 §6) — an enrolled multi-practice provider gets
      // a challenge after picking a practice; hand off to the second-factor
      // page instead of issuing tokens here.
      if (data.status === 'MFA_REQUIRED' && data.challengeToken) {
        try {
          sessionStorage.setItem(
            MFA_CHALLENGE_STORAGE_KEY,
            JSON.stringify({ challengeToken: data.challengeToken }),
          );
        } catch {
          /* sessionStorage unavailable — challenge page falls back to URL */
        }
        router.push('/sign-in/mfa-challenge');
        return;
      }
      login(data);
      // Forced enrollment after the practice pick — same handoff as the OTP
      // sign-in page; go to the chrome-free setup page, not the dashboard.
      if (data.mfaEnrollmentRequired) {
        router.push('/sign-in/mfa-enroll?required=1');
        return;
      }
      router.push('/dashboard');
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('signIn.selectPractice.error'),
      );
      setSubmitting(null);
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
              <Building2 className="w-7 h-7" />
            </span>
            <h1 className="text-2xl font-semibold text-gray-900">
              {t('signIn.selectPractice.title')}
            </h1>
            <p className="text-gray-600 mt-2 text-sm">
              {t('signIn.selectPractice.intro')}
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

          <ul className="space-y-3">
            {challenge.practices.map((p) => {
              const isSubmitting = submitting === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => void selectPractice(p.id)}
                    disabled={submitting !== null}
                    className="group w-full rounded-2xl border border-[#e5d9f2] bg-white px-4 py-4 text-left transition-all hover:border-[#7B00E0] hover:bg-[rgba(243,232,255,0.35)] hover:shadow-[0px_8px_20px_rgba(123,0,224,0.12)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#7B00E0] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <div className="flex items-center gap-4">
                      <span
                        className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[rgba(243,232,255,0.6)] text-[#7B00E0] transition-colors group-hover:bg-[#7B00E0] group-hover:text-white"
                        aria-hidden
                      >
                        <Building2 className="w-5 h-5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-[#170c1d]">
                          {p.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-[#737373]">
                          {isSubmitting
                            ? t('signIn.selectPractice.signingIn')
                            : t('signIn.selectPractice.continue')}
                        </span>
                      </div>
                      {isSubmitting ? (
                        <Loader2
                          className="w-5 h-5 shrink-0 animate-spin text-[#7B00E0]"
                          aria-hidden
                        />
                      ) : (
                        <ArrowRight
                          className="w-5 h-5 shrink-0 text-[#737373] transition-colors group-hover:text-[#7B00E0]"
                          aria-hidden
                        />
                      )}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          <p className="mt-8 text-center text-sm text-[#737373]">
            <a
              href="/sign-in"
              className="font-medium text-[#7B00E0] hover:underline"
            >
              {t('signIn.selectPractice.contactAdmin')}
            </a>
          </p>
        </div>
      </main>
      <LandingFooter />
    </div>
  );
}
