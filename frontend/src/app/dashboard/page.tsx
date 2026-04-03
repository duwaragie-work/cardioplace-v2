'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import Dashboard from '@/components/cardio/Dashboard';

export default function DashboardPage() {
  const { user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (user?.roles?.includes('SUPER_ADMIN')) {
      router.replace('/provider/dashboard');
    }
  }, [user, router]);

  if (user?.roles?.includes('SUPER_ADMIN')) return null;

  return <Dashboard />;
}
