"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Eye, EyeOff } from "lucide-react";
import { useAuth, type AdminAuthResponse } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { hasAdminRole } from "@/lib/roleGates";
import { getOrCreateDeviceId } from "@/lib/device";
import { MFA_CHALLENGE_STORAGE_KEY } from "@/lib/services/mfa.service";

// Where a rehydrated NON-admin user (the shared API refresh-token cookie can
// resolve a PATIENT profile on the admin origin) gets sent — their own app.
const PATIENT_URL = process.env.NEXT_PUBLIC_PATIENT_URL || "http://localhost:3000";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n";
import LandingHeader from "@/components/LandingHeader";
import LandingFooter from "@/components/LandingFooter";
import SessionExpiredBanner from "@/components/auth/SessionExpiredBanner";

const OTP_LENGTH = 6;

function getBrowserTimezone(): string | undefined {
  try {
    if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat === "undefined") return undefined;
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function isEmailValid(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Map known backend English messages to translation keys. Stored at module
// level so the lookup is independent of language — callers translate the
// returned key via t() at render time, which re-runs on language switch.
const BACKEND_MSG_KEY_MAP: Record<string, TranslationKey> = {
  'OTP sent successfully': 'register.otpSentSuccess',
  'Please wait 60 seconds before requesting a new OTP': 'register.pleaseWait',
  'Invalid OTP': 'register.invalidOtp',
  'Verification failed': 'register.verificationFailed',
  // Admin-app gate (auth.service.ts assertAdminAccessAllowed). Both rejection
  // paths — unknown email and known email without an admin role — collapse
  // to one friendly "no permission" message.
  'No admin account exists for this email': 'register.adminAccessDenied',
  'This account is not authorized to access the admin app': 'register.adminAccessDenied',
  'Account is suspended': 'register.accountSuspended',
  'Account is blocked': 'register.accountBlocked',
};

function backendMsgToKey(msg: string | undefined): TranslationKey | null {
  if (!msg) return null;
  for (const [en, key] of Object.entries(BACKEND_MSG_KEY_MAP)) {
    if (msg.includes(en)) return key;
  }
  return null;
}

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();

  const { user, isLoading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  // Status + error both store a translation key (not a resolved string) so
  // the rendered text re-translates live when the language is switched.
  const [statusKey, setStatusKey] = useState<TranslationKey | null>(null);
  const [errorKey, setErrorKey] = useState<TranslationKey | null>(null);
  const statusMessage = statusKey ? t(statusKey) : "";
  const errorMessage = errorKey ? t(errorKey) : "";
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimerRef = useRef<number | null>(null);
  // When we're handing off to forced MFA enrollment we call login() (to set
  // the session) but must NOT let the "already-signed-in → dashboard" effect
  // below fire — it would race our push to /sign-in/mfa-enroll and flash the
  // dashboard. A ref updates synchronously and is read on the next render.
  const skipAuthedRedirect = useRef(false);
  // Admin app is OTP-only — magic-link mode was removed.

  const [showOtp, setShowOtp] = useState(false);
  const [mounted, setMounted] = useState(false);
  // Set after an admin invitee activates their account — they're sent here
  // (instead of auto-logged-in) to sign in with OTP. We prefill their email
  // and show a one-line "account activated" notice.
  const [justActivated, setJustActivated] = useState(false);
  const emailTrimmed = email.trim();
  const emailIsValid = useMemo(() => isEmailValid(emailTrimmed), [emailTrimmed]);
  // Inline-validation hint: only show "invalid email" once the user has
  // typed something — empty input shouldn't yell at them on first paint.
  const showEmailError = emailTrimmed.length > 0 && !emailIsValid;
  const canVerifyOtp = otp.length === OTP_LENGTH;
  // OTP-length hint: shown while the user is mid-typing (1–5 digits) and
  // hidden as soon as they hit the full 6 — quiet UI when nothing's wrong.
  const showOtpLengthHint = otp.length > 0 && otp.length < OTP_LENGTH;

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMounted(true); }, []);

  // Read the post-activation handoff params (?activated=1&email=…) from the
  // URL on mount. Done via window.location to avoid a useSearchParams Suspense
  // boundary; client-only so it never runs during SSR.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('activated') !== '1') return;
    const email = params.get('email');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJustActivated(true);
    if (email) setEmail(email);
  }, []);

  useEffect(() => {
    if (isLoading || !user) return;
    // Forced-enrollment handoff in progress — let handleVerifyOtp's push to
    // /sign-in/mfa-enroll win instead of redirecting to the dashboard.
    if (skipAuthedRedirect.current) return;
    // A live session resolved. If it carries an admin-tier role, go to the
    // admin dashboard. If NOT (e.g. a PATIENT whose shared API refresh-token
    // cookie rehydrated here), cross-redirect to the patient app instead of
    // router.replace("/dashboard") — that bounced off proxy.ts back to
    // /sign-in?reason=forbidden in an infinite loop (blank page).
    if (hasAdminRole(user.roles)) {
      router.replace("/dashboard");
    } else {
      window.location.href = `${PATIENT_URL}/dashboard`;
    }
  }, [isLoading, user, router]);

  useEffect(() => {
    return () => {
      if (resendTimerRef.current !== null) window.clearInterval(resendTimerRef.current);
    };
  }, []);

  // Render nothing until mounted to avoid SSR/client hydration mismatch
  if (!mounted || isLoading || user) return null;

  async function sendOtpRequest(emailToUse: string) {
    const deviceId = getOrCreateDeviceId();
    const timezone = getBrowserTimezone();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/otp/send`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        ...(timezone ? { "X-Timezone": timezone } : {}),
      },
      // appContext='admin' tells the backend to gate by role — unknown
      // emails and PATIENT-only users are rejected before any OTP is sent.
      body: JSON.stringify({ email: emailToUse, deviceId, appContext: "admin" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Something went wrong.");
    return data;
  }

  function startResendCooldown(seconds = 60) {
    if (resendTimerRef.current !== null) window.clearInterval(resendTimerRef.current);
    setResendCooldown(seconds);
    resendTimerRef.current = window.setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (resendTimerRef.current !== null) {
            window.clearInterval(resendTimerRef.current);
            resendTimerRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSendOtp() {
    if (!emailIsValid || isRequestingOtp) return;
    setErrorKey(null);
    setStatusKey(null);
    setIsRequestingOtp(true);
    try {
      await sendOtpRequest(email.trim());
      setOtpSent(true);
      setOtp("");
      setStatusKey('register.otpSentSuccess');
      startResendCooldown();
    } catch (err) {
      setErrorKey(backendMsgToKey(err instanceof Error ? err.message : '') ?? 'register.failedOtp');
    } finally {
      setIsRequestingOtp(false);
    }
  }

  async function handleResendOtp() {
    if (!otpSent || resendCooldown > 0 || isResendingOtp) return;
    setErrorKey(null);
    setStatusKey(null);
    setIsResendingOtp(true);
    try {
      await sendOtpRequest(email.trim());
      setStatusKey('register.otpResent');
      startResendCooldown();
    } catch (err) {
      setErrorKey(backendMsgToKey(err instanceof Error ? err.message : '') ?? 'register.failedResend');
    } finally {
      setIsResendingOtp(false);
    }
  }

  async function handleVerifyOtp() {
    if (!canVerifyOtp || isVerifyingOtp || !otpSent) return;
    setErrorKey(null);
    setStatusKey(null);
    setIsVerifyingOtp(true);
    try {
      const deviceId = getOrCreateDeviceId();
      const timezone = getBrowserTimezone();
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/otp/verify`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Device-Id": deviceId,
          ...(timezone ? { "X-Timezone": timezone } : {}),
        },
        body: JSON.stringify({ email: email.trim(), otp, deviceId, appContext: "admin" }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorKey(backendMsgToKey(data.message) ?? 'register.verificationFailed');
        throw new Error(data.message || "Verification failed.");
      }
      // Phase/practice-identity (Manisha 2026-06-12 §1) — multi-practice
      // provider must pick which practice they're acting as before tokens
      // are issued. Stash the challenge + the choices in sessionStorage
      // (survives a refresh; tab-scoped) and route to the selector page.
      if (data && data.status === 'PRACTICE_SELECT_REQUIRED') {
        try {
          sessionStorage.setItem(
            'cp_admin_practice_challenge',
            JSON.stringify({
              challengeToken: data.challengeToken,
              practices: data.practices,
            }),
          );
        } catch {
          // sessionStorage unavailable (private mode etc.) — fall back to
          // URL params; the selector page reads both.
        }
        router.push('/sign-in/select-practice');
        return;
      }
      // MFA (Manisha 2026-06-12 §6) — an enrolled provider/admin gets a
      // challenge token instead of tokens. Stash it (tab-scoped) and route to
      // the second-factor page, mirroring the practice-select handoff above.
      if (data && data.status === 'MFA_REQUIRED') {
        try {
          sessionStorage.setItem(
            MFA_CHALLENGE_STORAGE_KEY,
            JSON.stringify({ challengeToken: data.challengeToken }),
          );
        } catch {
          // sessionStorage unavailable — the challenge page reads URL params too.
        }
        router.push('/sign-in/mfa-challenge');
        return;
      }
      // Forced enrollment (MFA_ENFORCEMENT_ENABLED on + not yet enrolled) —
      // set the guard BEFORE login() so the "already-signed-in → dashboard"
      // effect skips this case, then route to the chrome-free setup page.
      // Tokens were issued, so the session keeps the enroll endpoints working;
      // we just don't flash the dashboard on the way.
      const forceEnroll = !!(data && data.mfaEnrollmentRequired);
      if (forceEnroll) skipAuthedRedirect.current = true;
      login(data as AdminAuthResponse);
      if (forceEnroll) {
        router.push("/sign-in/mfa-enroll?required=1");
        return;
      }
      router.push("/dashboard");
    } catch (err) {
      setErrorKey(backendMsgToKey(err instanceof Error ? err.message : '') ?? 'register.invalidOtp');
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  return (
    <Suspense>
    <div className="bg-white">
      <LandingHeader activeLink="" />
      <main id="main" tabIndex={-1} className="lg:min-h-screen pt-24 lg:pt-[64px] pb-10 lg:pb-0 flex flex-col items-stretch lg:items-center justify-start lg:justify-center px-4 sm:px-6 lg:px-12">
      <SessionExpiredBanner />
      <div className="w-full max-w-300 mx-auto">
        <div className="flex flex-col items-center md:items-center md:flex-row gap-8 lg:gap-20">
          {/* Left side - Form */}
          <div className="flex-1 w-full max-w-[400px] md:max-w-105 lg:max-w-130">
            {/* Heading */}
            <div className="mb-5 md:mb-8 flex flex-col items-center md:items-start gap-3">
              <h2 className="font-bold leading-[1.2] text-[#170c1d] text-[22px] sm:text-[26px] lg:text-[33px] tracking-[-0.4px] text-center md:text-left">
                {t('register.signIn')}
              </h2>
            </div>

            <div className="mb-6 md:mb-10 w-full">
              <p className="font-normal leading-relaxed text-[#4b5563] text-sm sm:text-base lg:text-[18px] text-center md:text-left">
                {t('register.enterEmail')}
              </p>
            </div>

            {/* Post-activation notice — admin invitees land here to sign in. */}
            {justActivated && (
              <div
                className="mb-6 w-full max-w-105 flex items-start gap-2.5 rounded-xl px-4 py-3 text-sm"
                style={{
                  backgroundColor: 'var(--brand-success-green-light, #DCFCE7)',
                  color: 'var(--brand-success-green, #166534)',
                }}
                role="status"
              >
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  Your account is activated. Sign in with your email to continue.
                </span>
              </div>
            )}


            {/* Form */}
            <div className="space-y-6 w-full">
              {/* Email input */}
              <div className="w-full max-w-105">
                <label htmlFor="signin-email" className="block font-semibold text-[#171717] text-xs lg:text-sm mb-2">
                  {t('register.emailAddress')}
                </label>
                <input
                  id="signin-email"
                  data-testid="admin-signin-email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (otpSent) { setOtpSent(false); setOtp(""); }
                    if (statusKey) setStatusKey(null);
                    if (errorKey) setErrorKey(null);
                  }}
                  onKeyDown={(e) => {
                    // WCAG 2.1.1 (Keyboard): Enter on the email field sends
                    // (or resends) the OTP instead of doing nothing. Admin
                    // app is OTP-only — no magic-link branch.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (otpSent) handleResendOtp();
                    else handleSendOtp();
                  }}
                  placeholder={t('register.emailPlaceholder')}
                  autoComplete="email"
                  aria-invalid={showEmailError}
                  className={`w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] rounded-lg text-sm lg:text-base text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all border ${
                    showEmailError ? 'border-[var(--brand-alert-red)]' : 'border-[#e5d9f2]'
                  }`}
                />
                {/* Inline email format error — quiet until user has typed */}
                {showEmailError && (
                  <p
                    className="mt-1.5 text-[11px] lg:text-xs"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    Please enter a valid email address.
                  </p>
                )}

                {/* OTP-only flow (admin app) — single primary button toggles
                    Send / Resend so older users see one obvious target. */}
                <button
                  type="button"
                  data-testid="admin-signin-send-otp"
                  onClick={otpSent ? handleResendOtp : handleSendOtp}
                  disabled={!emailIsValid || isRequestingOtp || isResendingOtp || (otpSent && resendCooldown > 0)}
                  className="w-full h-12 lg:h-14 rounded-lg flex items-center justify-center border border-[#6B00D1] mt-3 mb-7 transition-opacity enabled:cursor-pointer enabled:hover:bg-[#7B00E0]/5 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="font-semibold text-[#6B00D1] text-base lg:text-medium">
                    {isRequestingOtp
                      ? t('register.sendingOtp')
                      : isResendingOtp
                        ? t('register.resending')
                        : otpSent
                          ? (resendCooldown > 0
                              ? t('register.resendIn').replace('{s}', String(resendCooldown))
                              : t('register.resendCode'))
                          : t('register.sendOtp')}
                  </span>
                </button>

                {otpSent && (
                  <>
                    <label htmlFor="signin-otp" className="block font-semibold text-[#171717] text-xs lg:text-sm mb-2">
                      {t('register.enterOtp')}
                    </label>
                    <div className="relative mb-1">
                      <input
                        id="signin-otp"
                        data-testid="admin-signin-otp"
                        type={showOtp ? "text" : "password"}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        value={otp}
                        onChange={(e) => {
                          setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH));
                          if (statusKey) setStatusKey(null);
                          if (errorKey) setErrorKey(null);
                        }}
                        onKeyDown={(e) => {
                          // WCAG 2.1.1: Enter on the OTP field triggers
                          // Continue (verify) once 6 digits are entered.
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleVerifyOtp();
                          }
                        }}
                        placeholder="••••••"
                        maxLength={OTP_LENGTH}
                        className="w-full h-11 lg:h-12 pl-4 lg:pl-5 pr-11 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-base lg:text-lg text-center tracking-[8px] text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => setShowOtp((s) => !s)}
                        aria-label={showOtp ? t('register.hideOtp') : t('register.showOtp')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#737373] hover:text-[#7B00E0] transition-colors cursor-pointer"
                      >
                        {showOtp ? <EyeOff aria-hidden="true" className="w-4 h-4" /> : <Eye aria-hidden="true" className="w-4 h-4" />}
                      </button>
                    </div>
                    {/* OTP-length hint: only while user is mid-typing */}
                    {showOtpLengthHint && (
                      <p className="text-[11px] lg:text-xs text-[#a16207] mb-2">
                        {t('register.otpLengthHint').replace('{n}', String(otp.length))}
                      </p>
                    )}
                  </>
                )}

                {/* Feedback messages — <output> has implicit role="status". */}
                {(statusMessage || errorMessage) && (
                  <output
                    className={`block mt-2 text-xs lg:text-sm ${errorMessage ? '' : 'text-green-500'}`}
                    style={errorMessage ? { color: 'var(--brand-alert-red)' } : undefined}
                  >
                    {errorMessage || statusMessage}
                  </output>
                )}
                {/* "Enter code" prompt — shown when OTP just sent and field empty */}
                {otpSent && otp.length === 0 && !statusMessage && !errorMessage && (
                  <p className="mt-2 text-[#737373] text-xs lg:text-sm">
                    {t('register.enterCode')}
                  </p>
                )}
              </div>

              {/* Continue button */}
              <div className="pt-4 w-full max-w-105">
                <button
                  type="button"
                  data-testid="admin-signin-verify"
                  onClick={handleVerifyOtp}
                  disabled={!canVerifyOtp || isVerifyingOtp}
                  className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isVerifyingOtp ? t('register.verifying') : t('register.continue')}
                </button>
              </div>

              {/* Terms */}
              <div className=" w-full max-w-105">
                <p className="text-[#737373] text-[11px] lg:text-xs leading-relaxed text-center">
                  {t('register.terms')}{" "}
                  <a
                    href="/terms"
                    className="font-medium text-[#7B00E0] hover:underline"
                  >
                    {t('register.termsOfService')}
                  </a>{" "}
                  {t('register.and')}{" "}
                  <a
                    href="/privacy"
                    className="font-medium text-[#7B00E0] hover:underline"
                  >
                    {t('register.privacyPolicy')}
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>

          {/* Right side - Info Panel (admin app — OTP-only) */}
          <div className="hidden md:flex flex-1 items-center justify-center lg:justify-end">
            <div className="bg-linear-to-br from-[#f3e8ff] to-[#e9d5ff] rounded-3xl p-6 lg:p-8 md:w-80 lg:w-120 flex">
              <div className="space-y-5 my-auto w-full">
                <h3 className="font-bold text-[#170c1d] text-base lg:text-xl">
                  How it works
                </h3>

                <div className="bg-white/60 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="bg-[#7B00E0] size-8 rounded-lg flex items-center justify-center">
                      <KeyRound className="w-4 h-4 text-white" strokeWidth={2.5} />
                    </div>
                    <h4 className="font-bold text-[#170c1d] text-sm lg:text-base">
                      One-time code
                    </h4>
                  </div>
                  <p className="text-[#4b3b55] text-xs lg:text-sm leading-relaxed">
                    We email you a 6-digit code. Type it here to sign in.
                  </p>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <CheckCircle2 className="w-4 h-4 text-[#7B00E0] shrink-0" strokeWidth={2.5} />
                  <p className="text-[#4b3b55] text-xs lg:text-sm">
                    Admin access is restricted to authorized clinical staff only.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </main>
      <LandingFooter />
    </div>
    </Suspense>
  );
}

