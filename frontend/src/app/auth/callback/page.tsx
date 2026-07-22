'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { shouldShowOnboardingForUser } from '@/lib/onboarding';
import SpinnerIndicator from '@/components/ui/SpinnerIndicator';

// A3 (PHI audit 1.3) — the access token used to arrive here as `?access=<JWT>`
// in the query string, which CloudFront/S3 would log verbatim. It is no longer
// read from the URL. The session is established from the HttpOnly refresh cookie
// by the auth-context's mount-time rehydrate (this route is NOT in the
// magic-link skip, so that rehydrate runs and calls POST /auth/refresh with
// credentials:'include'). This page only routes once the session resolves — so
// no credential is ever carried in the URL.
export default function AuthCallbackPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  useEffect(() => {
    if (isLoading) return; // wait for the cookie rehydrate to settle
    if (!user) {
      router.replace('/sign-in');
      return;
    }
    const needsOnboarding = shouldShowOnboardingForUser({
      userId: user.id,
      onboardingStatus: user.onboardingStatus,
      onboardingRequiredHint: user.onboardingRequired,
    });
    router.replace(needsOnboarding ? '/onboarding' : '/dashboard');
  }, [user, isLoading, router]);

  return <SpinnerIndicator />;
}
