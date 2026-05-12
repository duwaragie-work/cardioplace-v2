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

  if (response.status !== 401) return response;

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
