'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';

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
  const [isLoading, setIsLoading] = useState(true);

  // On mount: rehydrate from localStorage token via GET /me
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setIsLoading(false);
      return;
    }

    fetch(`${API_URL}/api/v2/auth/me`, {
      headers: { Authorization: `Bearer ${stored}` },
    })
      .then((res) => {
        if (!res.ok) throw new Error('Unauthorized');
        return res.json();
      })
      .then(
        (data: { id: string; email?: string | null; name?: string | null; roles?: string[] }) => {
          setToken(stored);
          setAuthCookie(stored);
          setUser({
            id: data.id,
            email: data.email,
            name: data.name,
            roles: data.roles,
          });
        },
      )
      .catch(() => {
        localStorage.removeItem(TOKEN_KEY);
        clearAuthCookie();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
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

    if (newToken) {
      localStorage.setItem(TOKEN_KEY, newToken);
      setAuthCookie(newToken);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(TOKEN_KEY);
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
