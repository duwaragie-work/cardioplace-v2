const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const TOKEN_KEY = 'healplace_token';
export const REFRESH_TOKEN_KEY = 'healplace_refresh_token';

// Single in-flight refresh promise — prevents concurrent 401s from each
// triggering their own refresh call (which would rotate the token and
// invalidate each other).
let activeRefresh: Promise<string | null> | null = null;

async function attemptTokenRefresh(): Promise<string | null> {
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    try {
      // Read stored refresh token — may be absent for older sessions, but
      // the httpOnly cookie (set on login) is the primary mechanism.
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);

      const res = await fetch(`${API_URL}/api/v2/auth/refresh`, {
        method: 'POST',
        credentials: 'include', // sends the httpOnly refresh_token cookie
        headers: { 'Content-Type': 'application/json' },
        // Also send in body as fallback (backend accepts either)
        body: JSON.stringify(storedRefreshToken ? { refreshToken: storedRefreshToken } : {}),
      });

      if (!res.ok) return null;

      const data: { accessToken?: string; refreshToken?: string } = await res.json();
      const newAccess = data.accessToken;
      if (!newAccess) return null;

      localStorage.setItem(TOKEN_KEY, newAccess);
      // Keep cookie in sync with localStorage
      document.cookie = `access_token=${newAccess}; path=/; max-age=604800; SameSite=Lax`;

      if (data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      }

      // Notify AuthProvider so the in-memory `token` state stays in sync with
      // localStorage — otherwise components that read `token` from context
      // (e.g. voice realtime) keep using the stale one until a page reload.
      window.dispatchEvent(new CustomEvent('auth:token-refreshed', { detail: { accessToken: newAccess } }));

      return newAccess;
    } catch {
      return null;
    } finally {
      activeRefresh = null;
    }
  })();

  return activeRefresh;
}

function clearAuthStorage() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  document.cookie = 'access_token=; path=/; max-age=0; SameSite=Lax';
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

  // First attempt
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(localStorage.getItem(TOKEN_KEY)),
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
  clearAuthStorage();
  window.dispatchEvent(new CustomEvent('auth:session-expired'));
  window.location.href = '/';
  return response; // unreachable but satisfies return type
}
