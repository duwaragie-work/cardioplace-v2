'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { getJwtRoles } from '@/lib/jwt-utils';
import SpinnerIndicator from '@/components/ui/SpinnerIndicator';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login } = useAuth();

  useEffect(() => {
    const accessToken = searchParams.get('access');
    const onboardingRequired = searchParams.get('onboarding_required');

    if (!accessToken) {
      router.replace('/register');
      return;
    }

    login({
      accessToken,
      onboarding_required: onboardingRequired === 'true',
    });

    if (onboardingRequired === 'true') {
      router.replace('/onboarding');
    } else {
      const roles = getJwtRoles(accessToken);
      const dest = roles.includes('SUPER_ADMIN') ? '/provider/dashboard' : '/dashboard';
      router.replace(dest);
    }
  }, [searchParams, login, router]);

  return <SpinnerIndicator />;
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<SpinnerIndicator />}>
      <CallbackHandler />
    </Suspense>
  );
}
