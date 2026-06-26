const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Re-exported for backward-compat with imports that referenced the localStorage
// key names. Both keys are no longer used — tokens live ONLY in (a) the
// backend's HttpOnly cookies on the API origin, (b) in-memory state via
// `setAccessToken` below. See cluster-1 / B5+B6 in qa/reports/RESULTS.md.
export const ADMIN_TOKEN_KEY = 'cardioplace_admin_token';
export const REFRESH_TOKEN_KEY = 'cardioplace_admin_refresh_token';
export const ADMIN_COOKIE_NAME = 'cardioplace_admin_token';

let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

let activeRefresh: Promise<string | null> | null = null;

async function attemptTokenRefresh(): Promise<string | null> {
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    try {
      // Refresh is cookie-only: the HttpOnly `refresh_token` cookie carries
      // the credential. credentials:'include' attaches it to this CORS call.
      const res = await fetch(`${API_URL}/api/v2/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!res.ok) return null;

      const data: { accessToken?: string; refreshToken?: string } = await res.json();
      const newAccess = data.accessToken;
      if (!newAccess) return null;

      currentAccessToken = newAccess;
      return newAccess;
    } catch {
      return null;
    } finally {
      activeRefresh = null;
    }
  })();

  return activeRefresh;
}

function clearAuthMemory() {
  currentAccessToken = null;
  // Best-effort: clean any legacy localStorage from prior builds.
  try {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore — quota / private-mode etc.
  }
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      await new Promise((r) => setTimeout(r, 250));
      return await fetch(input, init);
    }
    throw err;
  }
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(url, options);
  }

  const buildHeaders = (token: string | null): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  const response = await fetchWithRetry(url, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(currentAccessToken),
  });

  // MFA force-enrollment gate (Manisha 2026-06-12 §6). Once
  // MFA_ENFORCEMENT_ENABLED is on, the backend MfaRequiredGuard 403s every
  // route except the enroll endpoints for a not-yet-enrolled provider/admin.
  // Bounce them to the enrollment wizard (which only calls enroll routes, so
  // it loads fine). Guard against a redirect loop if we're already there.
  if (response.status === 403) {
    try {
      const cloned = response.clone();
      const data = (await cloned.json()) as { errorCode?: string };
      if (
        data?.errorCode === 'mfa_enrollment_required' &&
        !window.location.pathname.startsWith('/sign-in/mfa-enroll')
      ) {
        window.location.href = '/sign-in/mfa-enroll?required=1';
        return response;
      }
      // Practice-selection gate (Manisha 2026-06-12 §1). A multi-practice
      // clinician with a null-practice session (e.g. reloaded the dashboard
      // mid-flow) is bounced to the selector. The selector page itself is
      // exempt server-side, so this can't loop.
      if (
        data?.errorCode === 'practice_select_required' &&
        !window.location.pathname.startsWith('/sign-in/select-practice')
      ) {
        window.location.href = '/sign-in/select-practice';
        return response;
      }
    } catch {
      // Not JSON — fall through and return the 403 to the caller.
    }
    return response;
  }

  if (response.status !== 401) return response;

  // Phase/practice-identity — JwtStrategy throws PRACTICE_MEMBERSHIP_REVOKED
  // when a signed-in user's last membership in their active practice was
  // removed. Don't try to refresh (the refresh would either succeed with
  // the same stale claim, or hit the same membership check). Bounce to
  // the selector page directly so the user re-picks.
  try {
    const cloned = response.clone();
    const data = (await cloned.json()) as { errorCode?: string };
    if (data?.errorCode === 'PRACTICE_MEMBERSHIP_REVOKED') {
      clearAuthMemory();
      window.location.href = '/sign-in/select-practice?reason=membership-changed';
      return response;
    }
  } catch {
    // Not JSON or empty body — fall through to standard refresh path.
  }

  const newToken = await attemptTokenRefresh();

  if (newToken) {
    return fetchWithRetry(url, {
      ...options,
      credentials: 'include',
      headers: buildHeaders(newToken),
    });
  }

  clearAuthMemory();
  window.location.href = '/sign-in';
  return response;
}

export function clearTokenState() {
  clearAuthMemory();
}

export function rehydrateFromCookie(): Promise<string | null> {
  return attemptTokenRefresh();
}
