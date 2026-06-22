'use client';

/**
 * TOTP enrollment wizard (Manisha 2026-06-12 Access Control §6).
 *
 * Three steps:
 *   1. intro    — explain + "Begin setup" (calls enroll/start → QR + token)
 *   2. verify   — scan QR / enter manual key, type the first 6-digit code
 *   3. recovery — show the 10 one-time recovery codes ONCE (copy / download)
 *
 * Reached three ways:
 *   • voluntarily from the profile "Security" entry
 *   • forced right after sign-in (?required=1) — verifyOtp returns
 *     mfaEnrollmentRequired when enforcement is on + the user isn't enrolled,
 *     and the sign-in page redirects here before the dashboard ever renders.
 *     fetchWithAuth's 403 redirect is the fallback for direct navigation.
 *   • after a recovery-code sign-in (?reEnroll=1 — the old secret was rotated)
 *
 * Lives under /sign-in/* so AdminShell renders it chrome-free (no sidebar /
 * top bar) — the same treatment as the sign-in and MFA-challenge pages. It
 * only calls the enroll endpoints, which the force-enrollment guard always
 * allows, so it works even while every other route is blocked.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import {
  ShieldCheck,
  Loader2,
  Copy,
  Check,
  Download,
  AlertTriangle,
  KeyRound,
  ChevronLeft,
} from 'lucide-react';
import {
  startEnrollment,
  completeEnrollment,
  type EnrollStartResponse,
} from '@/lib/services/mfa.service';
import { useAuth } from '@/lib/auth-context';
import LandingHeader from '@/components/LandingHeader';
import LandingFooter from '@/components/LandingFooter';

const CODE_LENGTH = 6;

/** Pull the base32 secret out of the otpauth:// URI for the manual-entry path
 *  (users whose authenticator can't scan a QR). */
function secretFromUri(uri: string): string | null {
  try {
    const params = new URL(uri).searchParams;
    return params.get('secret');
  } catch {
    return null;
  }
}

function MfaEnrollInner() {
  const router = useRouter();
  const { logout } = useAuth();
  const searchParams = useSearchParams();
  const required = searchParams.get('required') === '1';
  const reEnroll = searchParams.get('reEnroll') === '1';

  const [step, setStep] = useState<'intro' | 'verify' | 'recovery'>('intro');
  const [enrollment, setEnrollment] = useState<EnrollStartResponse | null>(null);
  const [code, setCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [savedAck, setSavedAck] = useState(false);

  const manualKey = useMemo(
    () => (enrollment ? secretFromUri(enrollment.provisioningUri) : null),
    [enrollment],
  );

  // Forced enrollment (?required=1 / ?reEnroll=1) is mandatory, so trap the
  // browser Back button on this page. Without this, Back returns to /dashboard
  // (still in history), which 403s and bounces straight back here via token.ts
  // — a visible dashboard→enroll flicker. Pushing a sentinel state and
  // re-pushing on popstate keeps the user put; "Cancel and sign out" is the
  // only deliberate exit. (Voluntary enrollment doesn't trap — Back is fine.)
  useEffect(() => {
    if (!required && !reEnroll) return;
    window.history.pushState(null, '', window.location.href);
    const onPopState = () => {
      window.history.pushState(null, '', window.location.href);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [required, reEnroll]);

  const begin = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await startEnrollment();
      setEnrollment(data);
      setStep('verify');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start setup.');
    } finally {
      setLoading(false);
    }
  }, []);

  async function verify() {
    if (!enrollment || code.length !== CODE_LENGTH || loading) return;
    setLoading(true);
    setError(null);
    try {
      const { recoveryCodes: codes } = await completeEnrollment(
        enrollment.enrollmentToken,
        code,
      );
      setRecoveryCodes(codes);
      setStep('recovery');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code was not accepted.');
      setCode('');
    } finally {
      setLoading(false);
    }
  }

  function copyCodes() {
    void navigator.clipboard?.writeText(recoveryCodes.join('\n')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadCodes() {
    const blob = new Blob(
      [
        'Cardioplace — two-factor recovery codes\n',
        'Keep these somewhere safe. Each code works once.\n\n',
        recoveryCodes.join('\n'),
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

  function finish() {
    router.push('/dashboard');
  }

  return (
    <div className="bg-white flex flex-col min-h-screen">
      <LandingHeader activeLink="" />
      <main
        id="main"
        tabIndex={-1}
        className="flex-1 pt-24 lg:pt-[64px] pb-12 px-4 sm:px-6 flex items-start lg:items-center justify-center"
      >
      <div className="w-full max-w-lg py-6">
        {/* Header */}
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
            Set up two-factor authentication
          </h1>
        </div>

        {(required || reEnroll) && step !== 'recovery' && (
          <div
            className="mb-5 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
            style={{
              backgroundColor: 'var(--brand-warning-amber-light, #FEF3C7)',
              color: 'var(--brand-warning-amber, #92400E)',
            }}
            role="status"
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              {reEnroll
                ? 'You signed in with a recovery code, so your previous authenticator was reset. Set it up again to continue.'
                : 'Two-factor authentication is now required for your account. Complete setup to continue.'}
            </span>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            {error}
          </div>
        )}

        {/* Step 1 — intro */}
        {step === 'intro' && (
          <div className="text-center">
            <p className="text-gray-600 text-sm leading-relaxed mb-6">
              Two-factor authentication adds a second step at sign-in using an
              authenticator app such as Google Authenticator, Microsoft
              Authenticator, or Authy. You&apos;ll scan a QR code, then enter a
              6-digit code to confirm.
            </p>
            <button
              type="button"
              data-testid="admin-mfa-begin"
              onClick={() => void begin()}
              disabled={loading}
              className="w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Preparing…' : 'Begin setup'}
            </button>
            <button
              type="button"
              onClick={() =>
                required || reEnroll ? void logout() : router.push('/dashboard')
              }
              className="mt-5 w-full text-center text-sm font-medium text-gray-500 hover:text-gray-700 hover:underline cursor-pointer"
            >
              {required || reEnroll ? 'Cancel and sign out' : 'Maybe later'}
            </button>
          </div>
        )}

        {/* Step 2 — scan + verify */}
        {step === 'verify' && enrollment && (
          <div>
            <ol className="space-y-5">
              <li>
                <p className="text-sm font-semibold text-gray-900 mb-2">
                  1. Scan this QR code with your authenticator app
                </p>
                <div className="flex justify-center">
                  <div className="rounded-2xl border border-[#e5d9f2] p-3 bg-white">
                    {/* data URL from the backend (qrcode lib) */}
                    <Image
                      src={enrollment.qrCodeDataUrl}
                      alt="Two-factor QR code"
                      width={192}
                      height={192}
                      unoptimized
                      className="w-48 h-48"
                    />
                  </div>
                </div>
                {manualKey && (
                  <p className="mt-3 text-center text-xs text-gray-500">
                    Can&apos;t scan? Enter this key manually:
                    <br />
                    <code className="mt-1 inline-block break-all rounded bg-gray-100 px-2 py-1 font-mono text-[12px] tracking-wider text-gray-800">
                      {manualKey}
                    </code>
                  </p>
                )}
              </li>
              <li>
                <label
                  htmlFor="mfa-enroll-code"
                  className="block text-sm font-semibold text-gray-900 mb-2"
                >
                  2. Enter the 6-digit code it shows
                </label>
                <input
                  id="mfa-enroll-code"
                  data-testid="admin-mfa-enroll-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) =>
                    setCode(
                      e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH),
                    )
                  }
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void verify();
                    }
                  }}
                  placeholder="••••••"
                  maxLength={CODE_LENGTH}
                  className="w-full h-14 px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-2xl text-center tracking-[12px] text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                />
              </li>
            </ol>
            <button
              type="button"
              data-testid="admin-mfa-enroll-verify"
              onClick={() => void verify()}
              disabled={code.length !== CODE_LENGTH || loading}
              className="mt-6 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer inline-flex items-center justify-center gap-2"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? 'Verifying…' : 'Verify and turn on'}
            </button>
            <button
              type="button"
              onClick={() => {
                setStep('intro');
                setCode('');
                setError(null);
              }}
              disabled={loading}
              className="mt-5 w-full text-center text-sm font-medium text-[#7B00E0] hover:underline cursor-pointer inline-flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Cancel setup
            </button>
          </div>
        )}

        {/* Step 3 — recovery codes */}
        {step === 'recovery' && (
          <div>
            <div
              className="mb-4 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
              style={{
                backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                color: 'var(--brand-success-green, #166534)',
              }}
              role="status"
            >
              <Check className="w-4 h-4 mt-0.5 shrink-0" />
              <span>Two-factor authentication is on.</span>
            </div>

            <div className="flex items-center gap-2 mb-2">
              <KeyRound className="w-4 h-4 text-gray-700" />
              <h2 className="text-sm font-bold text-gray-900">
                Save your recovery codes
              </h2>
            </div>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              Store these somewhere safe. If you lose your phone, each code lets
              you sign in once. They won&apos;t be shown again.
            </p>

            <ul
              data-testid="admin-mfa-recovery-codes"
              className="grid grid-cols-2 gap-2 rounded-xl border border-[#e5d9f2] bg-gray-50 p-4 font-mono text-[13px] tracking-wider text-gray-800"
            >
              {recoveryCodes.map((rc) => (
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

            <label className="mt-5 flex items-start gap-2.5 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="admin-mfa-saved-ack"
                checked={savedAck}
                onChange={(e) => setSavedAck(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-[#7B00E0]"
              />
              <span className="text-sm text-gray-700">
                I&apos;ve saved my recovery codes somewhere safe.
              </span>
            </label>

            <button
              type="button"
              data-testid="admin-mfa-finish"
              onClick={finish}
              disabled={!savedAck}
              className="mt-5 w-full h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              Done — go to dashboard
            </button>
          </div>
        )}
      </div>
      </main>
      <LandingFooter />
    </div>
  );
}

export default function MfaEnrollPage() {
  return (
    <Suspense fallback={null}>
      <MfaEnrollInner />
    </Suspense>
  );
}
