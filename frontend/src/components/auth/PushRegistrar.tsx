'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { registerPush } from '@/lib/services/push.service';

/**
 * Registers Web Push once the patient is signed in, so PUSH-channel
 * Notifications reach them with the app closed. Isolated from AuthProvider on
 * purpose: registerPush() is fully self-contained and never throws, so a push
 * problem can never affect the auth flow. Renders nothing.
 */
export default function PushRegistrar() {
  const { isAuthenticated, user } = useAuth();
  const attempted = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || attempted.current) return;
    // Patient app is patient-only, but guard anyway — push is a patient feature.
    const isPatient = !user?.roles || user.roles.includes('PATIENT');
    if (!isPatient) return;
    attempted.current = true;
    void registerPush();
  }, [isAuthenticated, user]);

  return null;
}
