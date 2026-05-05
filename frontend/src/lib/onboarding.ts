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
  const skipped = localStorage.getItem(`${ONBOARDING_SKIPPED_KEY}_${userId}`);
  return !skipped;
}

export function markOnboardingSkipped(userId: number | string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(`${ONBOARDING_SKIPPED_KEY}_${userId}`, 'true');
}
