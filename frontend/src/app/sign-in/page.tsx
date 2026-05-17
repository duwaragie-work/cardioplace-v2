"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Mail, KeyRound, Eye, EyeOff } from "lucide-react";
import { useAuth, type OtpVerifyResponse } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import { getOrCreateDeviceId } from "@/lib/device";
import { useLanguage } from "@/contexts/LanguageContext";
import type { TranslationKey } from "@/i18n";
import { shouldShowOnboardingForUser } from "@/lib/onboarding";
import LandingHeader from "@/components/cardio/LandingHeader";
import LandingFooter from "@/components/cardio/LandingFooter";

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
  'Please wait 60 seconds before requesting a new magic link': 'register.pleaseWaitMagicLink',
  'Invalid OTP': 'register.invalidOtp',
  'Verification failed': 'register.verificationFailed',
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

// Mirrors admin/src/proxy.ts ADMIN_ROLES — any of these means the user
// belongs on the admin app, not the patient app.
const ADMIN_ROLES = new Set(['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS']);

function hasAdminRole(roles: unknown): boolean {
  return Array.isArray(roles) && roles.some((r) => typeof r === 'string' && ADMIN_ROLES.has(r));
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
  const [authMode, setAuthMode] = useState<"otp" | "magic_link">("magic_link");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);

  const [showOtp, setShowOtp] = useState(false);
  const [mounted, setMounted] = useState(false);
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

  useEffect(() => {
    if (!isLoading && user) {
      // Admin-role tokens may be present from a prior sign-in or a stale
      // rehydrate. Bridge to the admin app instead of letting proxy.ts do
      // a cross-origin redirect that admin can't honor (no cookie there).
      if (hasAdminRole(user.roles)) {
        const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';
        // Cookie-only handoff: the backend already set HttpOnly access +
        // refresh cookies on the verify-OTP response, scoped to the API
        // origin. The admin app on first mount calls /api/v2/auth/refresh
        // with `credentials: 'include'` (auth-context.rehydrate) — that
        // request carries the refresh_token cookie and gets back a fresh
        // access token. No tokens in URL params (those leak via Referer
        // and history) and no localStorage (XSS surface — closed by
        // cluster 1, B5/B6 in qa/reports/RESULTS.md).
        window.location.href = `${adminUrl}/dashboard`;
        return;
      }
      // Honor the localStorage skip flag — a previously-skipped user
      // shouldn't bounce through /onboarding on every login just to redirect
      // back out (onboardingStatus stays NOT_COMPLETED after a skip per
      // ONB-20 — admin needs that to distinguish skipped from completed).
      if (user.onboardingRequired && shouldShowOnboardingForUser({ userId: user.id })) {
        router.replace("/onboarding");
      } else {
        router.replace("/dashboard");
      }
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
      body: JSON.stringify({ email: emailToUse, deviceId }),
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

  async function sendMagicLinkRequest(emailToUse: string) {
    const deviceId = getOrCreateDeviceId();
    const timezone = getBrowserTimezone();
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/magic-link/send`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-Device-Id": deviceId,
        ...(timezone ? { "X-Timezone": timezone } : {}),
      },
      body: JSON.stringify({ email: emailToUse }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || "Something went wrong.");
    return data;
  }

  async function handleSendMagicLink() {
    if (!emailIsValid || isSendingMagicLink) return;
    setErrorKey(null);
    setStatusKey(null);
    setIsSendingMagicLink(true);
    try {
      await sendMagicLinkRequest(email.trim());
      setMagicLinkSent(true);
      setStatusKey('register.magicLinkSent');
      startResendCooldown();
    } catch (err) {
      setErrorKey(backendMsgToKey(err instanceof Error ? err.message : '') ?? 'register.failedMagicLink');
    } finally {
      setIsSendingMagicLink(false);
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
        body: JSON.stringify({ email: email.trim(), otp, deviceId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorKey(backendMsgToKey(data.message) ?? 'register.verificationFailed');
        throw new Error(data.message || "Verification failed.");
      }
      // Admin-role users belong on the admin subdomain. Bridge tokens via
      // URL params instead of calling local login() — otherwise the patient
      // proxy redirects to admin which has no cookie and re-prompts sign-in.
      if (hasAdminRole(data.roles)) {
        const adminUrl = process.env.NEXT_PUBLIC_ADMIN_URL || 'http://localhost:3001';
        const params = new URLSearchParams({
          accessToken: data.accessToken ?? '',
          refreshToken: data.refreshToken ?? '',
          userId: String(data.userId ?? ''),
          email: data.email ?? '',
          name: data.name ?? '',
          roles: (data.roles as string[]).join(','),
        });
        window.location.href = `${adminUrl}/auth/magic-link?${params.toString()}`;
        return;
      }
      login(data as OtpVerifyResponse);
      const userIdForSkip = data.userId !== undefined ? String(data.userId) : '';
      if (data.onboarding_required && shouldShowOnboardingForUser({ userId: userIdForSkip })) {
        router.push("/onboarding");
      } else {
        router.push("/dashboard");
      }
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
      <main id="main" className="lg:min-h-screen pt-[64px] pb-10 lg:pb-0 flex items-start lg:items-center justify-center px-4 sm:px-6 lg:px-12">
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

            {!otpSent && !magicLinkSent && (
              <div className="mb-6 md:mb-10 w-full">
                <p className="font-normal leading-relaxed text-[#4b5563] text-sm sm:text-base lg:text-[18px] text-center md:text-left">
                  {t('register.enterEmail')}
                </p>
              </div>
            )}


            {/* Form */}
            <div className="space-y-6 w-full">
              {/* Auth mode toggle */}
              <div className="w-full max-w-105 flex rounded-lg border border-[#e5d9f2] overflow-hidden">
                <button
                  type="button"
                  data-testid="signin-magic-tab"
                  onClick={() => { setAuthMode("magic_link"); setErrorKey(null); setStatusKey(null); setOtpSent(false); setOtp(""); }}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${authMode === "magic_link" ? "bg-[#7B00E0] text-white" : "bg-white text-[#6B00D1]"}`}
                >
                  {t('register.magicLinkTab') || 'Magic Link'}
                </button>
                <button
                  type="button"
                  data-testid="signin-otp-tab"
                  onClick={() => { setAuthMode("otp"); setErrorKey(null); setStatusKey(null); setMagicLinkSent(false); }}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${authMode === "otp" ? "bg-[#7B00E0] text-white" : "bg-white text-[#6B00D1]"}`}
                >
                  {t('register.otpTab') || 'OTP Code'}
                </button>
              </div>

              {/* Email input (shared) */}
              <div className="w-full max-w-105">
                <label htmlFor="signin-email" className="block font-semibold text-[#171717] text-xs lg:text-sm mb-2">
                  {t('register.emailAddress')}
                </label>
                <input
                  id="signin-email"
                  data-testid="signin-email-input"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (magicLinkSent) setMagicLinkSent(false);
                    if (otpSent) { setOtpSent(false); setOtp(""); }
                    if (statusKey) setStatusKey(null);
                    if (errorKey) setErrorKey(null);
                  }}
                  onKeyDown={(e) => {
                    // WCAG 2.1.1 (Keyboard): Enter on the email field submits
                    // whichever flow is currently active — Magic Link or OTP
                    // (send vs resend) — instead of doing nothing.
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    if (authMode === "otp") {
                      if (otpSent) handleResendOtp();
                      else handleSendOtp();
                    } else {
                      handleSendMagicLink();
                    }
                  }}
                  placeholder={t('register.emailPlaceholder')}
                  autoComplete="email"
                  aria-invalid={showEmailError}
                  className={`w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] rounded-lg text-base text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all border ${
                    showEmailError ? 'border-[var(--brand-alert-red)]' : 'border-[#e5d9f2]'
                  }`}
                />
                {/* Inline email format error — quiet until user has typed */}
                {showEmailError && (
                  <p
                    className="mt-1.5 text-[11px] lg:text-xs"
                    style={{ color: 'var(--brand-alert-red)' }}
                  >
                    {t('register.invalidEmail')}
                  </p>
                )}

                {/* OTP flow — single primary button toggles Send / Resend
                    so older users see one obvious action target. */}
                {authMode === "otp" && (
                  <>
                    <button
                      type="button"
                      data-testid="signin-send-otp-btn"
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
                            data-testid="signin-otp-input"
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
                  </>
                )}

                {/* Magic link flow — single primary button (Send / Resend).
                    Sent confirmation shown via the shared green status line
                    below to stay consistent with OTP. */}
                {authMode === "magic_link" && (
                  <button
                    type="button"
                    onClick={handleSendMagicLink}
                    disabled={!emailIsValid || isSendingMagicLink || (magicLinkSent && resendCooldown > 0)}
                    className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors enabled:cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                  >
                    {isSendingMagicLink
                      ? (t('register.sendingMagicLink') || 'Sending...')
                      : magicLinkSent
                        ? (resendCooldown > 0
                            ? t('register.resendIn').replace('{s}', String(resendCooldown))
                            : (t('register.sendAnother') || 'Send another link'))
                        : (t('register.sendMagicLink') || 'Send magic link')}
                  </button>
                )}

                {/* Feedback messages — <output> has implicit role="status". */}
                {(statusMessage || errorMessage) && (
                  <output
                    data-testid={errorMessage ? 'signin-error' : 'signin-status'}
                    className={`block mt-2 text-xs lg:text-sm ${errorMessage ? '' : 'text-green-500'}`}
                    style={errorMessage ? { color: 'var(--brand-alert-red)' } : undefined}
                  >
                    {errorMessage || statusMessage}
                  </output>
                )}
                {authMode === "otp" && otpSent && otp.length === 0 && !statusMessage && !errorMessage && (
                  <p className="mt-2 text-[#737373] text-xs lg:text-sm">
                    {t('register.enterCode')}
                  </p>
                )}
              </div>

              {/* Continue button (OTP mode only) */}
              {authMode === "otp" && (
                <div className="pt-4 w-full max-w-105">
                  <button
                    type="button"
                    data-testid="signin-verify-btn"
                    onClick={handleVerifyOtp}
                    disabled={!canVerifyOtp || isVerifyingOtp}
                    className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isVerifyingOtp ? t('register.verifying') : t('register.continue')}
                  </button>
                </div>
              )}

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

          {/* Right side - Info Panel */}
          <div className="hidden md:flex flex-1 items-center justify-center lg:justify-end">
            <div className="bg-linear-to-br from-[#f3e8ff] to-[#e9d5ff] rounded-3xl p-6 lg:p-8 md:w-80 lg:w-120 flex">
              <div className="space-y-5 my-auto w-full">
                <h3 className="font-bold text-[#170c1d] text-base lg:text-xl">
                  {t('register.chooseMethod') || 'Choose how to sign in'}
                </h3>

                {/* Magic Link info */}
                <div className="bg-white/60 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="bg-[#7B00E0] size-8 rounded-lg flex items-center justify-center">
                      <Mail aria-hidden="true" className="w-4 h-4 text-white" strokeWidth={2.5} />
                    </div>
                    <h4 className="font-bold text-[#170c1d] text-sm lg:text-base">
                      {t('register.magicLinkTitle') || 'Magic Link'}
                    </h4>
                  </div>
                  <p className="text-[#4b3b55] text-xs lg:text-sm leading-relaxed">
                    {t('register.magicLinkInfo') || 'We email you a secure link. Tap it from your email and you are signed in, no codes to type.'}
                  </p>
                </div>

                {/* OTP info */}
                <div className="bg-white/60 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="bg-[#7B00E0] size-8 rounded-lg flex items-center justify-center">
                      <KeyRound aria-hidden="true" className="w-4 h-4 text-white" strokeWidth={2.5} />
                    </div>
                    <h4 className="font-bold text-[#170c1d] text-sm lg:text-base">
                      {t('register.otpTitle') || 'OTP Code'}
                    </h4>
                  </div>
                  <p className="text-[#4b3b55] text-xs lg:text-sm leading-relaxed">
                    {t('register.otpInfo') || 'We email you a 6-digit code. Type it here to sign in.'}
                  </p>
                </div>

                {/* Shared security note */}
                <div className="flex items-center gap-2 pt-1">
                  <CheckCircle2 aria-hidden="true" className="w-4 h-4 text-[#7B00E0] shrink-0" strokeWidth={2.5} />
                  <p className="text-[#4b3b55] text-xs lg:text-sm">
                    {t('register.noPassword')}
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

