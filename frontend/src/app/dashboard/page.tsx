'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Dashboard from '@/components/cardio/Dashboard';

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.email === 'support@healplace.com') {
      router.replace('/provider/dashboard');
    }
  }, [user, router]);

  if (user?.email === 'support@healplace.com') return null;

  return <Dashboard />;
}
