"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { fetchWithAuth } from "@/lib/services/token";
import {
  markOnboardingSkipped,
  shouldShowOnboardingForUser,
} from "@/lib/onboarding";
import { POLICY_VERSION } from "@cardioplace/shared";
import { CheckCircle2, ShieldCheck, Ban, UserCheck, Lock } from "lucide-react";
import SpinnerIndicator from "@/components/ui/SpinnerIndicator";
import { useLanguage } from "@/contexts/LanguageContext";
import LandingHeader from "@/components/cardio/LandingHeader";
import LandingFooter from "@/components/cardio/LandingFooter";
import AudioButton from "@/components/intake/AudioButton";
import MicButton from "@/components/intake/MicButton";

function getBrowserTimezone(): string | undefined {
  if (typeof Intl === "undefined" || typeof Intl.DateTimeFormat === "undefined") return undefined;
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

// N8 (2026-07-13) — 30-min slot options. Reminder is capped at 21:00 per
// spec §N8 ("6:00 AM – 9:00 PM") — the last slot MUST be 21:00, no 21:30
// tail. Quiet-hours pickers span the full day (00:00–23:30) so users can
// carve any window; `includeHalfAtEnd=true` emits the trailing :30 slot at
// endHour.
function halfHourSlots(startHour: number, endHour: number, includeHalfAtEnd = true): string[] {
  const out: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    out.push(`${String(h).padStart(2, "0")}:00`);
    if (h < endHour || includeHalfAtEnd) {
      out.push(`${String(h).padStart(2, "0")}:30`);
    }
  }
  return out;
}
// Reminder cap: 06:00 → 21:00 inclusive, NO 21:30 tail (spec §N8).
const ONBOARDING_REMINDER_SLOTS = halfHourSlots(6, 21, false);
// Quiet hours: 00:00 → 23:30 inclusive.
const ONBOARDING_QUIET_SLOTS = halfHourSlots(0, 23, true);

export default function OnboardingPage() {
  const router = useRouter();
  const { t } = useLanguage();
  const { user, isLoading, logout, markOnboardingComplete, updateUser } = useAuth();
  const [name, setName] = useState("");
  const [communicationPreference, setCommunicationPreference] = useState("");
  // N8 (2026-07-13) — Reminder & Engagement prefs. Defaults match backend
  // defaults so a patient who skips still ends up with usable values.
  const [reminderTime, setReminderTime] = useState("09:00");
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("07:00");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRedirecting, setIsRedirecting] = useState(false);
  // Privacy/trust screen shows FIRST (V2-E Gap 7) — patients in the immigrant
  // cohort must see the "your data is private, not shared with government /
  // employer / anyone else" promise BEFORE they disclose any clinical info,
  // or they won't enroll.
  //   "privacy"   → reassurance + Terms/Privacy consent
  //   "profile"   → identity fields (name + comm preference)
  //   "reminders" → daily reminder time + quiet hours
  // Only the identity step completes onboarding. Reminders always have a
  // usable default, so answering them says nothing about who the patient is.
  const [step, setStep] = useState<"privacy" | "profile" | "reminders">("privacy");
  // True once the patient has committed the identity step with data (Continue,
  // not Skip) — i.e. the server row is now COMPLETED. If they skipped it, the
  // only thing that lets them out of onboarding is this device's skip flag.
  const [profileSubmitted, setProfileSubmitted] = useState(false);
  // Server-side "reminders were already answered" (any device). null = not
  // loaded yet; treated as false so a fresh patient still sees the step. On a
  // re-ask (second device) this is true and the reminders step is skipped
  // entirely — reminders already have a value, so asking again is noise.
  const [reminderPreferenceSet, setReminderPreferenceSet] = useState<boolean | null>(null);
  // Terms + Privacy consent — collected once here on the privacy step. Only new
  // users reach onboarding, so returning users are never re-asked. Recorded on
  // the AuthLog audit trail (event 'policy_acknowledged') via POST /v2/auth/consent.
  const [agreedToTerms, setAgreedToTerms] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      router.replace("/sign-in");
      return;
    }

    const showOnboarding = shouldShowOnboardingForUser({
      userId: user.id,
      onboardingStatus: user.onboardingStatus,
      onboardingRequiredHint: user.onboardingRequired,
    });

    if (!showOnboarding) {
      if (typeof window !== "undefined") {
        // eslint-disable-next-line no-console
        console.debug("[onboarding] redirect away from onboarding page", {
          userId: user.id,
          onboardingStatus: user.onboardingStatus,
          onboardingRequired: user.onboardingRequired,
        });
      }
      setIsRedirecting(true);
      router.replace("/dashboard");
    }
  }, [user, isLoading, router]);

  // The auth response carries onboarding_required but not the reminder flag,
  // so read it from the profile. Resolves long before the patient can leave
  // the identity step, which is the only place it is consulted.
  useEffect(() => {
    if (isLoading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchWithAuth(
          `${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/profile`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled) setReminderPreferenceSet(!!data.reminderPreferenceSet);
      } catch {
        // Best-effort — null falls back to showing the reminders step, which
        // is the right default for a patient who has never answered it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, isLoading]);

  const isFormPartiallyFilled = name.trim() !== "" || communicationPreference !== "";

  // Synchronous "should we redirect?" check — if shouldShowOnboardingForUser
  // returns false, useEffect will router.replace('/dashboard') on the next
  // tick. Render the spinner instead of the form so the user never flashes
  // through the onboarding UI on their way out (AUTH-36).
  const willRedirectAway =
    !!user &&
    !shouldShowOnboardingForUser({
      userId: user.id,
      onboardingStatus: user.onboardingStatus,
      onboardingRequiredHint: user.onboardingRequired,
    });

  if (isLoading || !user || isRedirecting || willRedirectAway) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <SpinnerIndicator size={40} className="text-[#7B00E0]" />
      </div>
    );
  }

  /**
   * POST the given fields to /v2/auth/profile. The endpoint marks
   * onboardingStatus=COMPLETED only for payloads carrying identity (name or
   * comm preference); a reminder-only payload persists its fields and leaves
   * onboarding alone. Returns true on success. Deliberately does NOT navigate
   * or flip local onboarding state — callers own that, because the identity
   * step's Continue must land on the reminders step, not the dashboard.
   */
  async function postProfile(body: Record<string, unknown>): Promise<boolean> {
    setError("");
    setIsSubmitting(true);
    try {
      if (!user) {
        router.push("/sign-in");
        return false;
      }
      const timezone = getBrowserTimezone();
      const payload = timezone && !("timezone" in body) ? { ...body, timezone } : body;

      const res = await fetchWithAuth(
        `${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/profile`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(timezone ? { "X-Timezone": timezone } : {}),
          },
          body: JSON.stringify(payload),
        },
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || "Failed to save profile");
      }
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete onboarding");
      return false;
    } finally {
      setIsSubmitting(false);
    }
  }

  /** Leave onboarding as fully complete (server row is already COMPLETED). */
  function finishOnboarded() {
    markOnboardingComplete();
    if (name.trim()) updateUser({ name: name.trim() });
    router.push("/dashboard");
  }

  /**
   * Leave onboarding without identity. Nothing is persisted server-side, so
   * `onboardingStatus` stays NOT_COMPLETED and another device still asks. The
   * device flag (and the marker cookie it writes) is what stops the route
   * guard bouncing this browser straight back here.
   */
  function finishSkipped() {
    if (!user) {
      router.push("/sign-in");
      return;
    }
    markOnboardingSkipped(user.id);
    router.push("/dashboard");
  }

  // ─── Identity step ──────────────────────────────────────────────────────
  // Continue: persist identity (this is what marks COMPLETED server-side).
  // Advance to reminders unless they're already answered — on a re-ask there
  // is nothing left to ask, so finish here. We do NOT finalize locally before
  // the reminders step: flipping onboardingStatus trips the redirect-away
  // effect and would skip it.
  async function handleProfileContinue() {
    if (!isFormPartiallyFilled || isSubmitting) return;
    const ok = await postProfile({
      name: name.trim() || null,
      communicationPreference: communicationPreference || null,
    });
    if (!ok) return;
    setProfileSubmitted(true);
    if (reminderPreferenceSet) {
      finishOnboarded();
      return;
    }
    setStep("reminders");
  }

  // Skip: no server call. Advance to reminders if they still need answering,
  // otherwise leave as un-onboarded-but-dismissed.
  function handleProfileSkip() {
    if (isSubmitting) return;
    setError("");
    if (reminderPreferenceSet) {
      finishSkipped();
      return;
    }
    setStep("reminders");
  }

  // ─── Reminders step ─────────────────────────────────────────────────────
  // Continue is the only exit (no Skip — daily reminders are always-on per
  // Manisha's Patient Reminder spec §1D, so a Skip would just apply the 09:00
  // default while implying it had opted out). Persisting reminders marks
  // reminderPreferenceSet but never completes onboarding: if identity was
  // skipped, the patient leaves as NOT_COMPLETED + device-dismissed.
  async function handleRemindersContinue() {
    if (isSubmitting) return;
    const ok = await postProfile({ reminderTime, quietHoursStart, quietHoursEnd });
    if (!ok) return;
    if (profileSubmitted) {
      finishOnboarded();
      return;
    }
    finishSkipped();
  }

  function handleRemindersBack() {
    if (isSubmitting) return;
    setError("");
    setStep("profile");
  }

  return (
    <div className="bg-white">
      <LandingHeader activeLink="" hideAuthCta />
      <main id="main" className="min-h-[100dvh] pt-24 pb-10 flex items-center-safe justify-center px-4 sm:px-6 lg:px-12">
      {step === "privacy" ? (
        /* ─── Privacy / Trust screen (V2-E Gap 7) ─────────────────────────────
           The hero fills exactly one viewport (min-h-[100dvh] on <main>, header
           is fixed) so the whole promise fits the default height with no inner
           scroll; the footer sits just below the fold. Spacing is compact +
           responsive across phone → desktop. */
        <div className="w-full max-w-xl mx-auto">
          <div className="bg-white border border-[#e5d9f2] rounded-3xl shadow-[0px_10px_40px_rgba(123,0,224,0.08)] p-4 sm:p-6">
            {/* Shield icon */}
            <div className="flex justify-center mb-2 sm:mb-3">
              <div className="bg-[#f3e8ff] size-12 sm:size-14 rounded-2xl flex items-center justify-center">
                <ShieldCheck aria-hidden="true" className="w-6 h-6 sm:w-7 sm:h-7 text-[#7B00E0]" strokeWidth={2} />
              </div>
            </div>

            {/* Title + read-aloud button */}
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-2">
              <h1 className="font-semibold text-[#171717] text-xl sm:text-2xl lg:text-3xl tracking-[-0.03em] text-center">
                {t('onboarding.privacy.title')}
              </h1>
              <AudioButton text={t('onboarding.privacy.audio')} size="md" />
            </div>

            {/* Intro promise */}
            <p className="text-[#4b5563] text-sm lg:text-base leading-relaxed text-center max-w-md mx-auto mb-3 sm:mb-4">
              {t('onboarding.privacy.intro')}
            </p>

            {/* The three promises — icon + few words (V2-E silent literacy) */}
            <ul className="space-y-2 max-w-md mx-auto mb-3 sm:mb-4">
              <li className="flex items-center gap-3 bg-[#fef2f2] border border-[#fecaca] rounded-2xl px-4 py-2 sm:py-3">
                <Ban aria-hidden="true" className="w-5 h-5 text-[#dc2626] shrink-0" strokeWidth={2.2} />
                <span className="text-[#171717] text-sm lg:text-base">{t('onboarding.privacy.point1')}</span>
              </li>
              <li className="flex items-center gap-3 bg-[#fef2f2] border border-[#fecaca] rounded-2xl px-4 py-2 sm:py-3">
                <Ban aria-hidden="true" className="w-5 h-5 text-[#dc2626] shrink-0" strokeWidth={2.2} />
                <span className="text-[#171717] text-sm lg:text-base">{t('onboarding.privacy.point2')}</span>
              </li>
              <li className="flex items-center gap-3 bg-[#f3e8ff] border border-[#e5d9f2] rounded-2xl px-4 py-2 sm:py-3">
                <UserCheck aria-hidden="true" className="w-5 h-5 text-[#7B00E0] shrink-0" strokeWidth={2.2} />
                <span className="text-[#171717] text-sm lg:text-base">{t('onboarding.privacy.point3')}</span>
              </li>
            </ul>

            {/* Closing reassurance */}
            <div className="flex items-center justify-center gap-2 text-[#4b5563] text-xs lg:text-sm mb-3 sm:mb-4">
              <Lock aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
              <span className="text-center">{t('onboarding.privacy.reassure')}</span>
            </div>

            {/* Terms + Privacy consent — required to continue. New users agree
                here once; the box toggles (small visible box + 44px tap target)
                and the links open the policies. */}
            <div className="max-w-md mx-auto mb-3 flex items-center gap-2">
              <label className="relative flex size-4 shrink-0 cursor-pointer">
                <input
                  id="onboarding-agree-terms"
                  data-no-min-target
                  data-testid="onboarding-agree-terms"
                  type="checkbox"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  aria-labelledby="onboarding-agree-terms-label"
                  className="size-4 shrink-0 rounded accent-[#7B00E0] focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[#7B00E0] cursor-pointer"
                />
                <span aria-hidden="true" className="absolute left-1/2 top-1/2 size-11 -translate-x-1/2 -translate-y-1/2" />
              </label>
              <span id="onboarding-agree-terms-label" className="text-[#4b5563] text-xs lg:text-sm leading-snug">
                {t('register.agreeToTerms')}{" "}
                <a href="/terms" target="_blank" rel="noopener noreferrer" className="font-medium text-[#7B00E0] hover:underline">
                  {t('register.termsOfService')}
                </a>{" "}
                {t('register.and')}{" "}
                <a href="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-[#7B00E0] hover:underline">
                  {t('register.privacyPolicy')}
                </a>
                .
              </span>
            </div>

            {/* Continue → records consent, then advances to the profile step */}
            <div className="max-w-md mx-auto">
              <button
                type="button"
                data-testid="onboarding-privacy-continue-btn"
                onClick={async () => {
                  if (!agreedToTerms) return;
                  try {
                    await fetchWithAuth(`${process.env.NEXT_PUBLIC_API_URL}/api/v2/auth/consent`, {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ policyVersion: POLICY_VERSION }),
                    });
                  } catch {
                    // best-effort — consent logging must not block onboarding
                  }
                  setStep("profile");
                }}
                disabled={!agreedToTerms}
                className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {t('onboarding.privacy.continue')}
              </button>
            </div>
          </div>
        </div>
      ) : (
      <div className="w-full max-w-300 mx-auto">
        <div className="flex flex-col items-center md:items-center md:flex-row gap-8 lg:gap-20">
          {/* Left side - Form */}
          <div className="flex-1 w-full max-w-[400px] md:max-w-105 lg:max-w-130">

            {/* Step indicator. Two steps normally; on a re-ask (reminders
                already answered on another device) identity is the only step,
                so the total collapses to 1 rather than promising a step 2
                that never comes. */}
            <div
              data-testid="onboarding-step-indicator"
              className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#7B00E0] text-center md:text-left"
            >
              {t('onboarding.stepIndicator')
                .replace('{n}', step === 'reminders' ? '2' : '1')
                .replace('{t}', reminderPreferenceSet ? '1' : '2')}
            </div>

            {/* Heading — step-aware */}
            <div className="mb-4 md:mb-6">
              <h1 className="font-semibold text-[#171717] text-2xl sm:text-3xl lg:text-4xl tracking-[-0.04em] mb-2 text-center md:text-left">
                {step === 'reminders' ? t('onboarding.reminders.title') : t('onboarding.title')}
              </h1>
              <p className="text-[#4b5563] text-sm lg:text-base leading-relaxed max-w-105 text-center md:text-left">
                {step === 'reminders' ? t('onboarding.reminders.subtitle') : t('onboarding.subtitle')}
              </p>
            </div>

            {/* Form */}
            <div className="space-y-6 w-full">
              {/* ─── Step 1 of 2: identity fields ─────────────────────────── */}
              {step === 'profile' && (
              <>
              {/* Name */}
              <div className="w-full max-w-105">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label htmlFor="onboarding-name" className="block font-semibold text-[#171717] text-xs lg:text-sm">
                    {t('onboarding.nameQuestion')}
                  </label>
                  <AudioButton text={t('onboarding.nameQuestion')} size="sm" />
                </div>
                <div className="flex items-center gap-2">
                  <input
                    id="onboarding-name"
                    data-testid="onboarding-name-input"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('onboarding.namePlaceholder')}
                    className="flex-1 h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] placeholder:text-[#737373] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                  />
                  <MicButton
                    inputId="onboarding-name"
                    onTranscript={(text) => setName(text)}
                  />
                </div>
              </div>

              {/* Date of birth moved to clinical-intake A1 (alongside sex
                  and height) — DOB is a clinical field the rule engine
                  needs before alerts fire, not a UX preference. Onboarding
                  stays purely identity (name + comm preference) so it can
                  be skipped without losing clinical data. */}

              {/* Communication Preference */}
              <div className="w-full max-w-105">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label htmlFor="onboarding-comm-pref" className="block font-semibold text-[#171717] text-xs lg:text-sm">
                    {t('onboarding.commPref')}
                  </label>
                  <AudioButton text={t('onboarding.commPref')} size="sm" />
                </div>
                <select
                  id="onboarding-comm-pref"
                  value={communicationPreference}
                  onChange={(e) => setCommunicationPreference(e.target.value)}
                  className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all appearance-none bg-[url('data:image/svg+xml;charset=UTF-8,%3csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2212%22%20height%3D%228%22%20viewBox%3D%220%200%2012%208%22%3E%3cpath%20fill%3D%22%23171717%22%20d%3D%22M6%208L0%200h12z%22%2F%3E%3c%2Fsvg%3E')] bg-size-[12px] bg-position-[center_right_1rem] bg-no-repeat"
                >
                  <option value="">{t('onboarding.selectPref')}</option>
                  <option value="TEXT_FIRST">{t('onboarding.textFirst')}</option>
                  <option value="AUDIO_FIRST">{t('onboarding.audioFirst')}</option>
                </select>
              </div>

              </>
              )}

              {/* ─── Step 2 of 2: reminder & quiet-hours pickers ──────────────
                  All three have sensible backend defaults, so a patient who
                  skips this step still ends up with usable values. */}
              {step === 'reminders' && (
              <>
              <div className="w-full max-w-105">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <label htmlFor="onboarding-reminder-time" className="block font-semibold text-[#171717] text-xs lg:text-sm">
                    {t('onboarding.reminders.timeLabel')}
                  </label>
                  <AudioButton text={t('onboarding.reminders.timeAudio')} size="sm" />
                </div>
                <select
                  id="onboarding-reminder-time"
                  data-testid="onboarding-reminder-time"
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                >
                  {ONBOARDING_REMINDER_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>{slot}</option>
                  ))}
                </select>
              </div>

              {/* Gap 5 (2026-07-13) — single header for the quiet-hours pair,
                  matching Profile RemindersModal + spec §N8 layout. */}
              <div className="w-full max-w-105">
                <div className="block font-semibold text-[#171717] text-xs lg:text-sm mb-3">
                  {t('onboarding.reminders.quietHoursHeading')}
                </div>

                {/* Start + End on one row (two columns). Stays side-by-side
                    down to the smallest width — the 30-min "HH:MM" values are
                    narrow, so two half-width selects still fit a phone. */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="onboarding-quiet-start" className="block text-[#525252] text-xs mb-1.5">
                      {t('profile.reminders.startLabel')}
                    </label>
                    <select
                      id="onboarding-quiet-start"
                      data-testid="onboarding-quiet-start"
                      value={quietHoursStart}
                      onChange={(e) => setQuietHoursStart(e.target.value)}
                      className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                    >
                      {ONBOARDING_QUIET_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="onboarding-quiet-end" className="block text-[#525252] text-xs mb-1.5">
                      {t('profile.reminders.endLabel')}
                    </label>
                    <select
                      id="onboarding-quiet-end"
                      data-testid="onboarding-quiet-end"
                      value={quietHoursEnd}
                      onChange={(e) => setQuietHoursEnd(e.target.value)}
                      className="w-full h-11 lg:h-12 px-4 lg:px-5 bg-[rgba(243,232,255,0.1)] border border-[#e5d9f2] rounded-lg text-sm lg:text-base text-[#171717] focus:outline-none focus:ring-2 focus:ring-[#7B00E0] focus:border-transparent transition-all"
                    >
                      {ONBOARDING_QUIET_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <p className="mt-3 text-xs font-semibold text-[#92400E] bg-[#FEF3C7] rounded-lg px-3 py-2">
                  {t('onboarding.reminders.emergencyDisclaimer')}
                </p>
              </div>
              </>
              )}

              {/* Error Message — vibrant-red palette routed through brand
                  tokens so the chip matches other validation states across
                  the app (border vibrant, bg tint, text dark-red on tint). */}
              {error && (
                <div className="w-full max-w-105">
                  <p
                    role="alert"
                    className="rounded-lg border px-3 py-2 text-xs"
                    style={{
                      backgroundColor: 'var(--brand-alert-red-light)',
                      color: 'var(--brand-alert-red-text)',
                      borderColor: 'var(--brand-alert-red)',
                    }}
                  >
                    {error}
                  </p>
                </div>
              )}

              {/* Action buttons — step-aware.
                  Step 1 Continue advances to reminders (does NOT reach the
                  dashboard); Step 2 Continue/Skip is the only exit. */}
              {step === 'profile' ? (
                <div className="pt-4 w-full max-w-105 space-y-2">
                  <button
                    type="button"
                    data-testid="onboarding-submit-btn"
                    onClick={handleProfileContinue}
                    disabled={!isFormPartiallyFilled || isSubmitting}
                    className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSubmitting ? t('common.saving') : t('onboarding.continue')}
                  </button>
                  <button
                    type="button"
                    data-testid="onboarding-skip-btn"
                    onClick={handleProfileSkip}
                    disabled={isSubmitting}
                    className="w-full text-sm text-[#737373] mt-4 cursor-pointer disabled:opacity-50"
                  >
                    {t('onboarding.skip')}
                  </button>
                </div>
              ) : (
                <div className="pt-4 w-full max-w-105 space-y-2">
                  <button
                    type="button"
                    data-testid="onboarding-reminders-submit-btn"
                    onClick={handleRemindersContinue}
                    disabled={isSubmitting}
                    className="w-full h-12 lg:h-14 bg-[#7B00E0] rounded-full shadow-[0px_10px_15px_rgba(123,0,224,0.25)] font-semibold text-white text-sm lg:text-base hover:bg-[#6600BC] transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                  >
                    {isSubmitting ? t('common.saving') : t('onboarding.continue')}
                  </button>
                  <button
                    type="button"
                    data-testid="onboarding-reminders-back-btn"
                    onClick={handleRemindersBack}
                    disabled={isSubmitting}
                    className="w-full text-sm text-[#7B00E0] font-medium cursor-pointer disabled:opacity-50"
                  >
                    ← {t('onboarding.back')}
                  </button>
                </div>
              )}
              {/* (Privacy note and sign out text removed per design) */}
            </div>
          </div>

          {/* Right side - Info Panel (match register panel) */}
          <div className="hidden md:flex flex-1 items-center justify-center lg:justify-end">
            <div className="bg-linear-to-br from-[#f3e8ff] to-[#e9d5ff] rounded-3xl md:p-6 lg:p-10 md:w-80 md:h-80 lg:w-110 lg:h-auto flex">
              <div className="space-y-4 my-auto w-full">
                <div className="flex items-center gap-3">
                  <div className="bg-[#7B00E0] size-10 lg:size-16 rounded-2xl flex items-center justify-center shrink-0">
                    <svg aria-hidden="true" className="w-5 h-5 lg:w-8 lg:h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                  </div>
                  <h3 className="font-bold text-[#170c1d] text-base lg:text-2xl leading-tight">
                    {t('onboarding.cardTitle')}
                  </h3>
                </div>
                <p className="text-[#4b3b55] text-xs lg:text-base leading-relaxed">
                  {t('onboarding.cardDesc')}
                </p>
                <div className="space-y-3 pt-2">
                  <div className="flex items-center gap-3">
                    <div className="bg-white rounded-full p-1">
                      <CheckCircle2 aria-hidden="true" className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs lg:text-sm">{t('onboarding.benefit1')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="bg-white rounded-full p-1">
                      <CheckCircle2 aria-hidden="true" className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs lg:text-sm">{t('onboarding.benefit2')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="bg-white rounded-full p-1">
                      <CheckCircle2 aria-hidden="true" className="w-3 h-3 lg:w-4 lg:h-4 text-[#7B00E0]" strokeWidth={2.5} />
                    </div>
                    <p className="text-[#4b3b55] text-xs lg:text-sm">{t('onboarding.benefit3')}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
      </main>
      <LandingFooter />
    </div>
  );
}
