'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { REFRESH_TOKEN_KEY } from '@/lib/services/token';

const REFRESH_ENDPOINT = '/api/v2/auth/refresh';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
const TOKEN_KEY = 'healplace_token';

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
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
  markOnboardingComplete: () => {},
});

function setAuthCookie(token: string) {
  document.cookie = `access_token=${token}; path=/; max-age=604800; SameSite=Lax`;
}

function clearAuthCookie() {
  document.cookie = 'access_token=; path=/; max-age=0; SameSite=Lax';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  // Start as false when there's nothing to rehydrate; true only when we have a stored token/refresh token
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!(localStorage.getItem(TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY));
  });

  // On mount: rehydrate session — try access token first, then refresh token
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);

    if (!stored && !storedRefresh) {
      // isLoading already initialized to false when no tokens exist
      return;
    }

    async function rehydrate() {
      const accessToken = stored;

      // 1. Try /profile with the existing access token (returns full user incl. name)
      if (accessToken) {
        try {
          const res = await fetch(`${API_URL}/api/v2/auth/profile`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (res.ok) {
            const data = await res.json();
            setToken(accessToken);
            setAuthCookie(accessToken);
            setUser({
              id: data.id,
              email: data.email,
              name: data.name,
              roles: data.roles,
              isVerified: data.isVerified,
              riskTier: data.riskTier,
              accountStatus: data.accountStatus,
              onboardingStatus: data.onboardingStatus,
            });
            return;
          }
        } catch {
          // access token failed — fall through to refresh
        }
      }

      // 2. Access token expired or missing — try refresh
      if (storedRefresh) {
        try {
          const res = await fetch(`${API_URL}${REFRESH_ENDPOINT}`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: storedRefresh }),
          });

          if (res.ok) {
            const data: { accessToken?: string; refreshToken?: string } = await res.json();
            const newAccess = data.accessToken;

            if (newAccess) {
              localStorage.setItem(TOKEN_KEY, newAccess);
              setAuthCookie(newAccess);

              if (data.refreshToken) {
                localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
              }

              // Fetch full profile with the fresh token
              const profileRes = await fetch(`${API_URL}/api/v2/auth/profile`, {
                headers: { Authorization: `Bearer ${newAccess}` },
              });
              if (profileRes.ok) {
                const profileData = await profileRes.json();
                setToken(newAccess);
                setUser({
                  id: profileData.id,
                  email: profileData.email,
                  name: profileData.name,
                  roles: profileData.roles,
                  isVerified: profileData.isVerified,
                  riskTier: profileData.riskTier,
                  accountStatus: profileData.accountStatus,
                  onboardingStatus: profileData.onboardingStatus,
                });
                return;
              }
            }
          }
        } catch {
          // refresh failed — clear everything
        }
      }

      // 3. Both access and refresh failed — clear session
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      clearAuthCookie();
      setToken(null);
      setUser(null);
    }

    rehydrate().finally(() => {
      setIsLoading(false);
    });
  }, []);

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

    if (newUser?.email) {
      localStorage.setItem('healplace_user_email', newUser.email);
    }

    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
      setAuthCookie(newToken);
    }

    const newRefreshToken = response.refreshToken || null;
    if (newRefreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    clearAuthCookie();
    router.push('/');
  };

  const markOnboardingComplete = () => {
    setUser((prev) =>
      prev
        ? { ...prev, onboardingStatus: 'COMPLETED', onboardingRequired: false }
        : prev,
    );
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
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
