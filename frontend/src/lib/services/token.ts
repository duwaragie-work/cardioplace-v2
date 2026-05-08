const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Re-exported for backward-compat with imports that still reference the
// localStorage key name. The key itself is no longer used — the refresh
// token lives ONLY in the backend's HttpOnly `refresh_token` cookie.
export const REFRESH_TOKEN_KEY = 'healplace_refresh_token';

// In-memory access token. The OTP-verify response sets this via
// `setAccessToken`; `attemptTokenRefresh` updates it on a silent refresh.
// We deliberately do NOT persist to localStorage — that's the XSS surface
// closed by phase/cluster-1 (B5/B6 in qa/reports/RESULTS.md).
let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

// Single in-flight refresh promise — prevents concurrent 401s from each
// triggering their own refresh call (which would rotate the token and
// invalidate each other).
let activeRefresh: Promise<string | null> | null = null;

async function attemptTokenRefresh(): Promise<string | null> {
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    try {
      // Refresh is cookie-only: the HttpOnly `refresh_token` cookie carries
      // the credential. We send `credentials: 'include'` so the browser
      // attaches it; no body needed (backend reads `req.cookies.refresh_token`
      // first, then falls back to body for legacy clients only).
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

      // Update in-memory token. Backend simultaneously refreshed the HttpOnly
      // `access_token` cookie via Set-Cookie on this same response, so server
      // routes (proxy.ts / RSC) see the new value too.
      currentAccessToken = newAccess;

      // Notify AuthProvider so the React state stays in sync — components
      // that read `token` from context (e.g. voice realtime) keep using the
      // stale one until this event fires.
      window.dispatchEvent(
        new CustomEvent('auth:token-refreshed', { detail: { accessToken: newAccess } }),
      );

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
  // Best-effort: clean up any legacy-session keys a previous build wrote.
  // Failure here is non-fatal — the user-visible session is already cleared.
  try {
    localStorage.removeItem('healplace_token');
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  } catch {
    // ignore — quota / private-mode etc.
  }
}

export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  if (typeof window === 'undefined') {
    return fetch(url, options);
  }

  // FormData bodies must NOT have Content-Type forced to application/json —
  // the browser sets multipart/form-data with the boundary itself, and any
  // explicit override prevents Multer (server) from parsing the parts.
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData;
  const buildHeaders = (token: string | null): Record<string, string> => ({
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  });

  // First attempt — Bearer header (in-memory) + credentials so the HttpOnly
  // cookie also rides along. Backend accepts either; both paths converge.
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(currentAccessToken),
  });

  if (response.status !== 401) return response;

  // 401 — try a silent refresh
  const newToken = await attemptTokenRefresh();

  if (newToken) {
    // Retry the original request with the new access token
    return fetch(url, {
      ...options,
      credentials: 'include',
      headers: buildHeaders(newToken),
    });
  }

  // Refresh failed — session is truly expired
  clearAuthMemory();
  window.dispatchEvent(new CustomEvent('auth:session-expired'));
  window.location.href = '/';
  return response; // unreachable but satisfies return type
}

// Exported for AuthProvider's logout() — clears the in-memory token after a
// successful POST /logout call (which clears the HttpOnly cookies server-side).
export function clearTokenState() {
  clearAuthMemory();
}

// Public refresh trigger for AuthProvider's mount-time rehydrate.
export function rehydrateFromCookie(): Promise<string | null> {
  return attemptTokenRefresh();
}
