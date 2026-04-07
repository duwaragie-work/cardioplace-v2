"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { useAuth, type OtpVerifyResponse } from "@/lib/auth-context";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";
import { getOrCreateDeviceId } from "@/lib/device";
import { useLanguage } from "@/contexts/LanguageContext";
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

  const [mounted, setMounted] = useState(false);
  const emailIsValid = useMemo(() => isEmailValid(email.trim()), [email]);
  const canVerifyOtp = otp.length === OTP_LENGTH;

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!isLoading && user) {
      if (user.onboardingRequired) {
        router.replace("/onboarding");
      } else if (user.email === 'support@healplace.com') {
        router.replace("/provider/dashboard");
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
      login(data as OtpVerifyResponse);
      if (data.onboarding_required) {
        router.push("/onboarding");
      } else if (data.email === 'support@healplace.com') {
        router.push("/provider/dashboard");
      } else {
        router.push("/dashboard");
      }
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
              {/* Email / OTP section (swaps in-place) */}
              <div className="w-full max-w-105">
                <>
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

                  <button
                    onClick={handleSendOtp}
                    disabled={!emailIsValid || isRequestingOtp}
                    className="w-full cursor-pointer h-12 lg:h-14 rounded-lg flex items-center justify-center border border-[#6B00D1] mt-3 mb-7"
                  >
                    <span className="font-semibold text-[#6B00D1] text-base lg:text-medium">{isRequestingOtp ? t('register.sendingOtp') : t('register.sendOtp')}</span>
                  </button>
                </>
                {otpSent &&
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

                    {/* Feedback */}

                    {!(statusMessage || errorMessage) ? (
                      <p className="mt-2 text-[#737373] text-xs lg:text-sm">
                        {t('register.enterCode')}
                      </p>
                    ) : (
                      <div className="w-full max-w-105">

                        <p
                          role="status"
                          className={`mt-2 text-xs lg:text-sm ${errorMessage
                            ? "text-red-500"
                            : "text-green-500"
                            }`}
                        >
                          {errorMessage || statusMessage}
                        </p>
                      </div>
                    )}

                  </>
                }

              </div>

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
          <div className="hidden md:flex flex-1 items-center justify-center">
            <div className="bg-linear-to-br from-[#f3e8ff] to-[#e9d5ff] rounded-3xl md:p-6 lg:p-10 md:w-80 md:h-80 lg:w-105 lg:h-auto flex">
              <div className="space-y-4 my-auto w-full">
                <div className="flex items-center gap-3">
                  <div className="bg-[#7B00E0] size-12 lg:size-16 rounded-2xl flex items-center justify-center">
                    <CheckCircle2 className="w-6 h-6 lg:w-8 lg:h-8 text-white" strokeWidth={2} />
                  </div>
                  <h3 className="font-bold text-[#170c1d] text-base md:text-lg lg:text-2xl">
                    {t('register.secureAccess')}
                  </h3>
                </div>
                <p className="text-[#4b3b55] text-xs md:text-sm lg:text-base leading-relaxed">
                  {t('register.secureDesc')}
                </p>
                <div className="space-y-3 pt-2">
                  <div className="flex items-start gap-3">
                    <div className="bg-white rounded-full p-1 mt-1">
                      <CheckCircle2 className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs md:text-sm">
                      {t('register.noPassword')}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="bg-white rounded-full p-1 mt-1">
                      <CheckCircle2 className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs md:text-sm">
                      {t('register.codeExpires')}
                    </p>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="bg-white rounded-full p-1 mt-1">
                      <CheckCircle2 className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs md:text-sm">
                      {t('register.dataEncrypted')}
                    </p>
                  </div>
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

