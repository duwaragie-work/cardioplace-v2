'use client';

import { useEffect, useRef } from 'react';

/**
 * June 2026 — idle session timeout (Manisha 2026-06-12 Doc 3 Q7).
 * 15 min for web, 5 min for mobile. After the threshold, the user is
 * forced to re-auth. A T-1-min warning fires first so the user can
 * dismiss it by interacting.
 *
 * The backend (`AuthService.rotateRefreshToken`) enforces the same gate
 * — this hook just drives the UX. If a stale request reaches `/refresh`
 * past the idle window, it gets a 401 and `fetchWithAuth`'s existing
 * `auth:session-expired` path bounces the user out.
 *
 * Pass `enabled: false` to disarm when the user isn't signed in.
 */
export interface UseIdleTimeoutOptions {
  enabled: boolean;
  /** Override the resolved threshold (ms). Default = 15 min web, 5 min mobile. */
  thresholdMs?: number;
  /** Warning fires this far before threshold (default 60_000 ms). */
  warnBeforeMs?: number;
  /** Called once when the warning window starts. */
  onWarn?: () => void;
  /** Called once when the threshold is reached. */
  onTimeout: () => void;
}

const IDLE_TIMEOUT_WEB_MS = 15 * 60_000;
const IDLE_TIMEOUT_MOBILE_MS = 5 * 60_000;
const DEFAULT_WARN_MS = 60_000;
const ACTIVITY_DEBOUNCE_MS = 1_000;
const ACTIVITY_EVENTS: readonly string[] = [
  'mousemove',
  'mousedown',
  'keydown',
  'touchstart',
  'scroll',
];

function isMobileUserAgent(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Mobi|Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
}

export function resolveIdleThreshold(): number {
  return isMobileUserAgent() ? IDLE_TIMEOUT_MOBILE_MS : IDLE_TIMEOUT_WEB_MS;
}

export function useIdleTimeout({
  enabled,
  thresholdMs,
  warnBeforeMs = DEFAULT_WARN_MS,
  onWarn,
  onTimeout,
}: UseIdleTimeoutOptions): void {
  // Refs keep the latest callbacks reachable without re-arming timers on
  // every render — the effect below only re-runs on enabled/threshold
  // changes, not on every parent re-render.
  const onWarnRef = useRef(onWarn);
  const onTimeoutRef = useRef(onTimeout);
  useEffect(() => {
    onWarnRef.current = onWarn;
    onTimeoutRef.current = onTimeout;
  }, [onWarn, onTimeout]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    const limit = thresholdMs ?? resolveIdleThreshold();
    const warnAt = Math.max(0, limit - warnBeforeMs);

    let warnTimer: ReturnType<typeof setTimeout> | null = null;
    let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityResetAt = 0;

    const clearTimers = () => {
      if (warnTimer !== null) {
        clearTimeout(warnTimer);
        warnTimer = null;
      }
      if (timeoutTimer !== null) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }
    };

    const armTimers = () => {
      clearTimers();
      if (warnBeforeMs > 0 && warnAt > 0) {
        warnTimer = setTimeout(() => {
          onWarnRef.current?.();
        }, warnAt);
      }
      timeoutTimer = setTimeout(() => {
        onTimeoutRef.current?.();
      }, limit);
    };

    const handleActivity = () => {
      // Debounce — mousemove/scroll can fire hundreds of times per second
      // on an active user; clearing + setting timers every tick is wasted
      // work. 1s is invisible to humans but cuts the load to near-zero.
      const now = Date.now();
      if (now - lastActivityResetAt < ACTIVITY_DEBOUNCE_MS) return;
      lastActivityResetAt = now;
      armTimers();
    };

    const handleVisibility = () => {
      // Returning to the tab counts as activity (the user clicked back
      // in). visibilitychange isn't in ACTIVITY_EVENTS because it fires
      // on hidden→visible transitions and we want to reset specifically
      // on visible.
      if (document.visibilityState === 'visible') {
        lastActivityResetAt = Date.now();
        armTimers();
      }
    };

    armTimers();
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handleActivity, { passive: true });
    }
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleActivity);

    return () => {
      clearTimers();
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handleActivity);
      }
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleActivity);
    };
  }, [enabled, thresholdMs, warnBeforeMs]);
}
