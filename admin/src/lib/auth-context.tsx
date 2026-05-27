'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import {
  fetchWithAuth,
  setAccessToken,
  clearTokenState,
  rehydrateFromCookie,
} from '@/lib/services/token';
import {
  AUTH_MARKER_COOKIE,
  AUTH_ROLE_COOKIE,
  LEGACY_MARKER_COOKIES,
} from '@/lib/cookie-names';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export type AdminAuthResponse = {
  accessToken?: string;
  refreshToken?: string;
  userId?: string | number;
  roles?: string[];
  name?: string | null;
  email?: string;
  access_token?: string;
  user?: {
    id: string;
    email: string | null;
    name: string | null;
    roles: string[];
  };
};

type AdminUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles?: string[];
};

interface AuthContextType {
  token: string | null;
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (response: AdminAuthResponse) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

// Non-token marker cookies for proxy.ts to gate page navigation. Mirror of
// the patient app's pattern — the JWT itself never sees JS-readable storage.
function writeAuthMarkers(roles: string[]) {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_MARKER_COOKIE}=1; path=/; max-age=2592000; SameSite=Lax`;
  document.cookie = `${AUTH_ROLE_COOKIE}=${encodeURIComponent(roles.join(','))}; path=/; max-age=2592000; SameSite=Lax`;
}

function clearAuthMarkers() {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_MARKER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${AUTH_ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  // Clear pre-fix unscoped names too so a local session created before the
  // app-scoped rename doesn't leave a stale "logged in" marker behind.
  for (const name of LEGACY_MARKER_COOKIES) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  }
}

async function fetchProfile(accessToken: string): Promise<AdminUser | null> {
  try {
    const res = await fetch(`${API_URL}/api/v2/auth/profile`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      id: data.id,
      email: data.email,
      name: data.name,
      roles: data.roles,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  // Always start in loading state — we have to attempt a cookie-based
  // rehydrate before we can know whether the session is live.
  const [isLoading, setIsLoading] = useState(true);

  // On mount: try a silent refresh against the HttpOnly refresh_token cookie.
  useEffect(() => {
    // Skip rehydrate when we're handling a fresh magic-link sign-in.
    // MagicLinkHandler is about to call login() with the tokens from the
    // URL params; running /refresh here would consume the just-issued
    // refresh token and race with the destination page's own mount-time
    // rehydrate. Refresh-token rotation is single-use, so whichever fetch
    // reaches the backend second gets a 401 — and the loser's rehydrate
    // clears user state, which bounces the destination page to /sign-in.
    if (
      typeof window !== 'undefined' &&
      window.location.pathname === '/auth/magic-link' &&
      new URLSearchParams(window.location.search).has('accessToken')
    ) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    async function rehydrate() {
      const newAccess = await rehydrateFromCookie();
      if (cancelled) return;
      if (!newAccess) {
        clearTokenState();
        clearAuthMarkers();
        setToken(null);
        setUser(null);
        setIsLoading(false);
        return;
      }
      const profile = await fetchProfile(newAccess);
      if (cancelled) return;
      if (profile) {
        setToken(newAccess);
        setUser(profile);
        writeAuthMarkers(profile.roles ?? []);
      } else {
        clearTokenState();
        clearAuthMarkers();
        setToken(null);
        setUser(null);
      }
      setIsLoading(false);
    }
    rehydrate();
    return () => {
      cancelled = true;
    };
  }, []);

  // Browser bfcache restore: if the admin logged out and pressed back, the
  // browser revives the cached page bypassing proxy.ts. Force a reload when
  // there's no in-memory token so proxy.ts can redirect to /sign-in.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted && !token) {
        window.location.reload();
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, [token]);

  const login = (response: AdminAuthResponse) => {
    const newToken = response.access_token || response.accessToken || null;

    const newUser: AdminUser | null = response.user
      ? {
          id: response.user.id,
          email: response.user.email,
          name: response.user.name,
          roles: response.user.roles,
        }
      : response.userId
        ? {
            id: String(response.userId),
            email: response.email,
            name: response.name,
            roles: response.roles,
          }
        : null;

    setToken(newToken);
    setUser(newUser);

    if (newToken) {
      setAccessToken(newToken);
    }
    if (newUser?.roles) {
      writeAuthMarkers(newUser.roles);
    }
    // Refresh token deliberately NOT persisted client-side — the backend
    // already set the HttpOnly refresh_token cookie on the verify-OTP
    // response. Keeping it out of JS closes the XSS path.
  };

  const logout = async () => {
    // Await the server round-trip so its Set-Cookie clear headers land
    // before we redirect. See frontend/src/lib/auth-context.tsx logout()
    // for the full rationale — same race condition.
    try {
      await fetch(`${API_URL}/api/v2/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch (err) {
      console.error('Logout request failed:', err);
    }
    setToken(null);
    setUser(null);
    clearTokenState();
    clearAuthMarkers();
    window.location.href = '/sign-in';
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isAuthenticated: !!token,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
