import { ONBOARDED_MARKER_COOKIE } from './cookie-names';

const ONBOARDING_SKIPPED_KEY = 'healplace_onboarding_skipped';

interface OnboardingCheckParams {
  userId: number | string;
  onboardingStatus?: string;
  onboardingRequiredHint?: boolean;
}

export function shouldShowOnboardingForUser(
  params: OnboardingCheckParams | number | string,
): boolean {
  const userId =
    typeof params === 'object' ? params.userId : params;
  const status =
    typeof params === 'object' ? params.onboardingStatus : undefined;

  if (status === 'COMPLETED') return false;

  if (typeof window === 'undefined') return false;
  return !isOnboardingSkippedOnDevice(userId);
}

/**
 * Has this patient dismissed onboarding on THIS device? Device-local by
 * design: identity is optional, so a patient who skipped it here is not nagged
 * again here, but another device still asks (that is the only "re-ask"
 * condition). Never call this to decide server state.
 */
export function isOnboardingSkippedOnDevice(userId: number | string): boolean {
  if (typeof window === 'undefined') return false;
  return !!localStorage.getItem(`${ONBOARDING_SKIPPED_KEY}_${userId}`);
}

export function markOnboardingSkipped(userId: number | string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${ONBOARDING_SKIPPED_KEY}_${userId}`, 'true');
  // The route guard runs in proxy.ts, which cannot see localStorage — mirror
  // the decision into the marker cookie or the patient would be bounced back
  // to /onboarding on their next navigation.
  writeOnboardedMarker(true);
}

/** Mirror the onboarding gate bit into the cookie proxy.ts reads. */
export function writeOnboardedMarker(onboarded: boolean): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ONBOARDED_MARKER_COOKIE}=${onboarded ? '1' : '0'}; path=/; max-age=2592000; SameSite=Lax`;
}

export function clearOnboardedMarker(): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${ONBOARDED_MARKER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
}
