'use client';

import { Suspense } from 'react';
import NotificationsScreen from '@/components/NotificationsScreen';

export default function NotificationsPage() {
  return (
    <Suspense fallback={null}>
      <NotificationsScreen />
    </Suspense>
  );
}
