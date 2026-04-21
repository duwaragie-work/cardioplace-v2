"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Mail, KeyRound } from "lucide-react";
import { useAuth, type AdminAuthResponse } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { getOrCreateDeviceId } from "@/lib/device";
import { useLanguage } from "@/contexts/LanguageContext";
import LandingHeader from "@/components/LandingHeader";
import LandingFooter from "@/components/LandingFooter";

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

export default function RegisterPage() {
  const router = useRouter();
  const { t } = useLanguage();

  // Map known backend English messages to translated versions
  const backendMsgMap: Record<string, string> = {
    'OTP sent successfully': t('register.otpSentSuccess'),
    'Please wait 60 seconds before requesting a new OTP': t('register.pleaseWait'),
    'Invalid OTP': t('register.invalidOtp'),
    'Verification failed': t('register.verificationFailed'),
  };
  function translateBackendMsg(msg: string | undefined): string {
    if (!msg) return '';
    for (const [en, translated] of Object.entries(backendMsgMap)) {
      if (msg.includes(en)) return translated;
    }
    return msg;
  }

  const { user, isLoading, login } = useAuth();
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isRequestingOtp, setIsRequestingOtp] = useState(false);
  const [isResendingOtp, setIsResendingOtp] = useState(false);
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendTimerRef = useRef<number | null>(null);
  const [authMode, setAuthMode] = useState<"otp" | "magic_link">("magic_link");
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [isSendingMagicLink, setIsSendingMagicLink] = useState(false);

  const [mounted, setMounted] = useState(false);
  const emailIsValid = useMemo(() => isEmailValid(email.trim()), [email]);
  const canVerifyOtp = otp.length === OTP_LENGTH;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isLoading && user) {
      router.replace("/dashboard");
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
    setErrorMessage("");
    setStatusMessage("");
    setIsRequestingOtp(true);
    try {
      const data = await sendOtpRequest(email.trim());
      setOtpSent(true);
      setOtp("");
      setStatusMessage(translateBackendMsg(data.message) || t('register.otpSent'));
      startResendCooldown();
    } catch (err) {
      setErrorMessage(translateBackendMsg(err instanceof Error ? err.message : '') || t('register.failedOtp'));
    } finally {
      setIsRequestingOtp(false);
    }
  }

  async function handleResendOtp() {
    if (!otpSent || resendCooldown > 0 || isResendingOtp) return;
    setErrorMessage("");
    setStatusMessage("");
    setIsResendingOtp(true);
    try {
      const data = await sendOtpRequest(email.trim());
      setStatusMessage(translateBackendMsg(data.message) || t('register.otpResent'));
      startResendCooldown();
    } catch (err) {
      setErrorMessage(translateBackendMsg(err instanceof Error ? err.message : '') || t('register.failedResend'));
    } finally {
      setIsResendingOtp(false);
    }
  }

  async function handleSendMagicLink() {
    if (!emailIsValid || isSendingMagicLink) return;
    setErrorMessage("");
    setStatusMessage("");
    setIsSendingMagicLink(true);
    try {
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
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Something went wrong.");
      setMagicLinkSent(true);
      setStatusMessage(t('register.magicLinkSent') || "Magic link sent! Check your email.");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Failed to send magic link.");
    } finally {
      setIsSendingMagicLink(false);
    }
  }

  async function handleVerifyOtp() {
    if (!canVerifyOtp || isVerifyingOtp || !otpSent) return;
    setErrorMessage("");
    setStatusMessage("");
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
        setErrorMessage(translateBackendMsg(data.message) || t('register.verificationFailed'));
        throw new Error(data.message || "Verification failed.");
      }
      login(data as AdminAuthResponse);
      router.push("/dashboard");
    } catch (err) {
      setErrorMessage(translateBackendMsg(err instanceof Error ? err.message : '') || t('register.invalidOtp'));
    } finally {
      setIsVerifyingOtp(false);
    }
  }

  return (
    <Suspense>
    <div className="bg-white">
      <LandingHeader activeLink="" />
      <div className="lg:min-h-screen pt-24 lg:pt-[64px] pb-10 lg:pb-0 flex items-start lg:items-center justify-center px-4 sm:px-6 lg:px-12">
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


            {/* Form */}
            <div className="space-y-6 w-full">
              {/* Auth mode toggle */}
              <div className="w-full max-w-105 flex rounded-lg border border-[#e5d9f2] overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setAuthMode("magic_link"); setErrorMessage(""); setStatusMessage(""); setOtpSent(false); setOtp(""); }}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${authMode === "magic_link" ? "bg-[#7B00E0] text-white" : "bg-white text-[#6B00D1]"}`}
                >
                  {t('register.magicLinkTab') || 'Magic Link'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAuthMode("otp"); setErrorMessage(""); setStatusMessage(""); setMagicLinkSent(false); }}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors cursor-pointer ${authMode === "otp" ? "bg-[#7B00E0] text-white" : "bg-white text-[#6B00D1]"}`}
                >
                  {t('register.otpTab') || 'OTP Code'}
                </button>
              </div>

              {/* Email input (shared) */}
              <div className="w-full max-w-105">
                <label className="block font-semibold text-[#171717] text-xs lg:text-sm mb-2">
                  {t('register.emailAddress')}
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('register.emailPlaceholder')}
                  autoComplete="email"
                  className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] placeholder:text-[#a3a3a3] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                />

                {/* OTP flow */}
                {authMode === "otp" && (
                  <>
                    <button
                      onClick={handleSendOtp}
                      disabled={!emailIsValid || isRequestingOtp}
                      className="w-full cursor-pointer h-12 lg:h-14 rounded-lg flex items-center justify-center border border-[#6B00D1] mt-3 mb-7"
                    >
                      <span className="font-semibold text-[#6B00D1] text-base lg:text-medium">{isRequestingOtp ? t('register.sendingOtp') : t('register.sendOtp')}</span>
                    </button>

                    {otpSent && (
                      <>
                        <div className="flex items-center justify-between mb-2">
                          <label className="font-semibold text-[#171717] text-xs lg:text-sm">
                            {t('register.enterOtp')}
                          </label>
                          <button
                            type="button"
                            onClick={handleResendOtp}
                            disabled={resendCooldown > 0 || isResendingOtp}
                            className="font-medium text-[#7B00E0] text-xs lg:text-sm hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isResendingOtp
                              ? t('register.resending')
                              : resendCooldown > 0
                                ? t('register.resendIn').replace('{s}', String(resendCooldown))
                                : t('register.resendCode')}
                          </button>
                        </div>
                        <input
                          type="text"
                          value={otp}
                          onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, OTP_LENGTH))}
                          placeholder="••••••"
                          maxLength={OTP_LENGTH}
                          className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-base lg:text-lg text-center tracking-[8px] text-[#171717] placeholder:text-[#a3a3a3] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all mb-3"
                        />
                      </>
                    )}
                  </>
                )}

                {/* Magic link flow */}
                {authMode === "magic_link" && (
                  <>
                    {!magicLinkSent ? (
                      <button
                        onClick={handleSendMagicLink}
                        disabled={!emailIsValid || isSendingMagicLink}
                        className="w-full cursor-pointer h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-4"
                      >
                        {isSendingMagicLink ? (t('register.sendingMagicLink') || 'Sending...') : (t('register.sendMagicLink') || 'Send magic link')}
                      </button>
                    ) : (
                      <div className="mt-4 p-4 bg-[#f5f3ff] border border-[#e5d9f2] rounded-lg text-center">
                        <p className="text-[#7B00E0] font-semibold text-sm mb-1">{t('register.checkEmail') || 'Check your email!'}</p>
                        <p className="text-[#6b7280] text-xs">{t('register.magicLinkDesc') || 'We sent a sign-in link. Tap it to log in.'}</p>
                        <button
                          type="button"
                          onClick={() => { setMagicLinkSent(false); setStatusMessage(""); }}
                          className="mt-3 text-[#7B00E0] text-xs font-medium hover:underline cursor-pointer"
                        >
                          {t('register.sendAnother') || 'Send another link'}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Feedback messages */}
                {(statusMessage || errorMessage) && (
                  <p
                    role="status"
                    className={`mt-2 text-xs lg:text-sm ${errorMessage ? "text-red-500" : "text-green-500"}`}
                  >
                    {errorMessage || statusMessage}
                  </p>
                )}
                {authMode === "otp" && otpSent && !statusMessage && !errorMessage && (
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
                    href="#"
                    className="font-medium text-[#7B00E0] hover:underline"
                  >
                    {t('register.termsOfService')}
                  </a>{" "}
                  {t('register.and')}{" "} <br />
                  <a
                    href="#"
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
                      <Mail className="w-4 h-4 text-white" strokeWidth={2.5} />
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
                      <KeyRound className="w-4 h-4 text-white" strokeWidth={2.5} />
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
                  <CheckCircle2 className="w-4 h-4 text-[#7B00E0] shrink-0" strokeWidth={2.5} />
                  <p className="text-[#4b3b55] text-xs lg:text-sm">
                    {t('register.noPassword')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>
      <LandingFooter />
    </div>
    </Suspense>
  );
}

