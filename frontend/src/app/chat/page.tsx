'use client';

import { Suspense } from 'react';
import AIChatInterface from '@/components/cardio/AIChatInterface';

export default function ChatPage() {
  return (
    <Suspense>
      <AIChatInterface />
    </Suspense>
  );
}
