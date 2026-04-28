const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const TOKEN_KEY = 'cardioplace_admin_token';
export const REFRESH_TOKEN_KEY = 'cardioplace_admin_refresh_token';

let activeRefresh: Promise<string | null> | null = null;

async function attemptTokenRefresh(): Promise<string | null> {
  if (activeRefresh) return activeRefresh;

  activeRefresh = (async () => {
    try {
      const storedRefreshToken = localStorage.getItem(REFRESH_TOKEN_KEY);
      const res = await fetch(`${API_URL}/api/v2/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedRefreshToken ? { refreshToken: storedRefreshToken } : {}),
      });

      if (!res.ok) return null;

      const data: { accessToken?: string; refreshToken?: string } = await res.json();
      const newAccess = data.accessToken;
      if (!newAccess) return null;

      localStorage.setItem(TOKEN_KEY, newAccess);
      document.cookie = `cardioplace_admin_token=${newAccess}; path=/; max-age=604800; SameSite=Lax`;

      if (data.refreshToken) {
        localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
      }

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
  document.cookie = 'cardioplace_admin_token=; path=/; max-age=0; SameSite=Lax';
}

/**
 * Wrap `fetch` with a tiny retry-once on transient network errors.
 * `TypeError: Failed to fetch` happens when the browser can't even start
 * the request — typically a dev backend hot-reload, brief connection
 * drop, or tab-switch abort. One immediate retry covers the common case
 * without masking real outages (a second failure throws as before).
 */
async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    // Only retry on the network-level TypeError. AbortError / generic Errors
    // pass through so we don't paper over genuine bugs.
    if (err instanceof TypeError && /fetch/i.test(err.message)) {
      // Tiny back-off so we don't slam a backend that's mid-restart.
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
    headers: buildHeaders(localStorage.getItem(TOKEN_KEY)),
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

  clearAuthStorage();
  window.location.href = '/sign-in';
  return response;
}

export const ADMIN_TOKEN_KEY = TOKEN_KEY;
export const ADMIN_COOKIE_NAME = 'cardioplace_admin_token';
