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
  // Track WHICH user we last registered for — not just "have we tried once".
  // A second account signing in on the same browser (shared device, or an
  // account switch without a full page reload) must re-run registerPush() so
  // this browser's push subscription is claimed by the account that's actually
  // signed in — otherwise pushes keep mapping to the previous user.
  const registeredForUserId = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    // Patient app is patient-only, but guard anyway — push is a patient feature.
    const isPatient = !user.roles || user.roles.includes('PATIENT');
    if (!isPatient) return;
    // Same account as last time → nothing to do. Different (or first) account →
    // (re)register so the subscription upserts to this user on the backend.
    if (registeredForUserId.current === user.id) return;
    registeredForUserId.current = user.id;
    void registerPush();
  }, [isAuthenticated, user]);

  return null;
}
