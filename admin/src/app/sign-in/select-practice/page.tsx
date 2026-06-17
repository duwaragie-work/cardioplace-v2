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
import { useAuth, type AdminAuthResponse } from '@/lib/auth-context';

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
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setChallenge(readChallenge());
  }, []);

  if (challenge === null) {
    // First render before useEffect runs.
    return null;
  }

  if (!challenge.challengeToken) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold mb-3">Sign-in session expired</h1>
          <p className="text-gray-600 mb-6">
            For your security, the practice-selection step has a 5-minute window.
            Please sign in again to continue.
          </p>
          <a
            href="/sign-in"
            className="inline-block rounded-lg bg-purple-600 px-5 py-2.5 text-white"
          >
            Back to sign in
          </a>
        </div>
      </main>
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
      };
      if (!res.ok) {
        throw new Error(data?.message ?? `Practice selection failed (${res.status})`);
      }
      try {
        sessionStorage.removeItem('cp_admin_practice_challenge');
      } catch {
        /* sessionStorage unavailable */
      }
      login(data);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to select practice');
      setSubmitting(null);
    }
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="min-h-screen bg-white px-4 py-12 flex items-start justify-center"
    >
      <div className="w-full max-w-xl">
        <h1 className="text-3xl font-semibold text-gray-900 mb-2">
          Which practice are you acting as?
        </h1>
        <p className="text-gray-600 mb-8">
          You&apos;re a member of more than one practice. Pick the one you&apos;ll be
          working in for this session — every action you take will be audited under
          the practice you choose. You can switch later from the top bar.
        </p>

        {error && (
          <div
            role="alert"
            className="mb-6 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
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
                  className="w-full rounded-xl border border-gray-200 bg-white px-5 py-4 text-left transition hover:border-purple-400 hover:bg-purple-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-500 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{p.name}</span>
                    <span className="text-sm text-gray-500">
                      {isSubmitting ? 'Signing in…' : 'Continue →'}
                    </span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <p className="mt-8 text-sm text-gray-500">
          Not seeing the right practice?{' '}
          <a href="/sign-in" className="text-purple-700 underline">
            Sign out and contact your admin.
          </a>
        </p>
      </div>
    </main>
  );
}
