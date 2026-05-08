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
  getAccessToken,
  clearTokenState,
  rehydrateFromCookie,
} from '@/lib/services/token';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// Backend returns a flat AuthResponse (camelCase) from verifyOtp/googleLogin/etc.
// Also accepts legacy snake_case access_token for compatibility.
export type OtpVerifyResponse = {
  // Actual backend fields (camelCase)
  accessToken?: string;
  refreshToken?: string;
  userId?: string | number;
  onboarding_required?: boolean;
  roles?: string[];
  login_method?: string;
  name?: string | null;
  email?: string;
  // Legacy snake_case fallback
  access_token?: string;
  // Nested user object (matches backend DB shape)
  user?: {
    id: string;
    email: string | null;
    name: string | null;
    dateOfBirth: string | null;
    timezone: string | null;
    communicationPreference: 'TEXT_FIRST' | 'AUDIO_FIRST' | null;
    preferredLanguage: string | null;
    riskTier: 'STANDARD' | 'ELEVATED' | 'HIGH';
    primaryCondition: string | null;
    diagnosisDate: string | null;
    isVerified: boolean;
    roles: string[];
    onboardingStatus: 'NOT_COMPLETED' | 'COMPLETED';
    accountStatus: 'ACTIVE' | 'BLOCKED' | 'SUSPENDED';
    onboardingRequired?: boolean;
  };
  error?: string;
};

type AuthUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles?: string[];
  isVerified?: boolean;
  riskTier?: string;
  accountStatus?: string;
  onboardingStatus?: string;
  onboardingRequired?: boolean;
};

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (response: OtpVerifyResponse) => void;
  logout: () => void;
  markOnboardingComplete: () => void;
  updateUser: (fields: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
  markOnboardingComplete: () => {},
  updateUser: () => {},
});

// Non-token marker cookies for proxy.ts to gate page navigation. They carry
// no credential — only "logged in or not" + the role list. The actual auth
// happens via the HttpOnly access_token cookie + Bearer header on API calls.
// Tampering with these only affects which page shell renders; the backend
// rejects unauthenticated API calls regardless.
function writeAuthMarkers(roles: string[]) {
  if (typeof document === 'undefined') return;
  document.cookie = `auth_marker=1; path=/; max-age=2592000; SameSite=Lax`;
  document.cookie = `auth_role=${encodeURIComponent(roles.join(','))}; path=/; max-age=2592000; SameSite=Lax`;
}

function clearAuthMarkers() {
  if (typeof document === 'undefined') return;
  document.cookie = 'auth_marker=; path=/; max-age=0; SameSite=Lax';
  document.cookie = 'auth_role=; path=/; max-age=0; SameSite=Lax';
}

async function fetchProfile(accessToken: string): Promise<AuthUser | null> {
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
      isVerified: data.isVerified,
      riskTier: data.riskTier,
      accountStatus: data.accountStatus,
      onboardingStatus: data.onboardingStatus,
    };
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  // Always start in loading state on the client — we have to attempt a
  // cookie-based rehydrate before we can know whether the session is live.
  // (The HttpOnly `refresh_token` cookie isn't visible to JS so we can't
  // peek at storage to short-circuit.)
  const [isLoading, setIsLoading] = useState(true);

  // On mount: try a silent refresh against the HttpOnly refresh_token
  // cookie. If it succeeds we hydrate state with a fresh access token +
  // user profile; if it fails we treat the user as logged-out.
  useEffect(() => {
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

  // Keep the React state in sync when fetchWithAuth silently refreshes.
  // Without this, components that read `token` from context keep using the
  // stale value until the user hard-reloads the page.
  useEffect(() => {
    function handleTokenRefreshed(e: Event) {
      const detail = (e as CustomEvent<{ accessToken?: string }>).detail;
      if (detail?.accessToken) {
        setToken(detail.accessToken);
      }
    }
    function handleSessionExpired() {
      setToken(null);
      setUser(null);
    }
    window.addEventListener('auth:token-refreshed', handleTokenRefreshed);
    window.addEventListener('auth:session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth:token-refreshed', handleTokenRefreshed);
      window.removeEventListener('auth:session-expired', handleSessionExpired);
    };
  }, []);

  // Browser bfcache restore: if the user logged out and pressed back, the
  // browser revives the cached page bypassing proxy.ts. Force a reload when
  // there's no stored token so proxy.ts can redirect to /sign-in.
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted && !getAccessToken()) {
        window.location.reload();
      }
    }
    window.addEventListener('pageshow', handlePageShow);
    return () => window.removeEventListener('pageshow', handlePageShow);
  }, []);

  // Proactively refresh when the user returns to the tab after being idle.
  // fetchWithAuth handles the 401 -> refresh -> retry flow, and the
  // auth:token-refreshed event above keeps context state in sync.
  useEffect(() => {
    if (!token) return;
    let inFlight = false;
    async function pingSession() {
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        await fetchWithAuth(`${API_URL}/api/v2/auth/profile`);
      } catch {
        // ignore — any real auth failure triggers auth:session-expired above
      } finally {
        inFlight = false;
      }
    }
    document.addEventListener('visibilitychange', pingSession);
    window.addEventListener('focus', pingSession);
    return () => {
      document.removeEventListener('visibilitychange', pingSession);
      window.removeEventListener('focus', pingSession);
    };
  }, [token]);

  const login = (response: OtpVerifyResponse) => {
    const newToken = response.access_token || response.accessToken || null;

    // Normalize user from either nested user obj or flat response fields
    const newUser: AuthUser | null = response.user
      ? {
          id: response.user.id,
          email: response.user.email,
          name: response.user.name,
          roles: response.user.roles,
          isVerified: response.user.isVerified,
          riskTier: response.user.riskTier,
          accountStatus: response.user.accountStatus,
          onboardingStatus: response.user.onboardingStatus,
          onboardingRequired: response.user.onboardingRequired,
        }
      : response.userId
        ? {
            id: String(response.userId),
            email: response.email,
            name: response.name,
            roles: response.roles,
            onboardingRequired: response.onboarding_required,
            onboardingStatus:
              response.onboarding_required === false ? 'COMPLETED' : undefined,
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
    // already set the HttpOnly `refresh_token` cookie on the verify-OTP
    // response (auth.controller.setRefreshCookie). Keeping it out of JS
    // closes the XSS path that ate refresh sessions in v1.
  };

  const logout = () => {
    // Tell the backend so it can clear both HttpOnly cookies + revoke the
    // refresh-token row. Best-effort: we still clear local state even if
    // the request fails (e.g. offline) — proxy.ts will reject the next nav.
    void fetch(`${API_URL}/api/v2/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
    setToken(null);
    setUser(null);
    clearTokenState();
    clearAuthMarkers();
    // Hard navigation guarantees the cookie clear has settled before the
    // next request — router.push raced with cookie clearing in production
    // and proxy.ts kept routing the user back to /dashboard.
    window.location.href = '/sign-in';
  };

  const markOnboardingComplete = () => {
    setUser((prev) =>
      prev
        ? { ...prev, onboardingStatus: 'COMPLETED', onboardingRequired: false }
        : prev,
    );
  };

  const updateUser = (fields: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...fields } : prev));
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
        markOnboardingComplete,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
