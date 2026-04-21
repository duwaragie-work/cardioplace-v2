'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  type ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { ADMIN_COOKIE_NAME, ADMIN_TOKEN_KEY, REFRESH_TOKEN_KEY } from '@/lib/services/token';

const REFRESH_ENDPOINT = '/api/v2/auth/refresh';
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

function setAuthCookie(token: string) {
  document.cookie = `${ADMIN_COOKIE_NAME}=${token}; path=/; max-age=604800; SameSite=Lax`;
}

function clearAuthCookie() {
  document.cookie = `${ADMIN_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<AdminUser | null>(null);
  const [isLoading, setIsLoading] = useState(() => {
    if (typeof window === 'undefined') return true;
    return !!(localStorage.getItem(ADMIN_TOKEN_KEY) || localStorage.getItem(REFRESH_TOKEN_KEY));
  });

  useEffect(() => {
    const stored = localStorage.getItem(ADMIN_TOKEN_KEY);
    const storedRefresh = localStorage.getItem(REFRESH_TOKEN_KEY);

    if (!stored && !storedRefresh) {
      return;
    }

    async function rehydrate() {
      const accessToken = stored;

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
            });
            return;
          }
        } catch {
          // fall through to refresh
        }
      }

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
              localStorage.setItem(ADMIN_TOKEN_KEY, newAccess);
              setAuthCookie(newAccess);
              if (data.refreshToken) {
                localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
              }

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
                });
                return;
              }
            }
          }
        } catch {
          // refresh failed
        }
      }

      localStorage.removeItem(ADMIN_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      clearAuthCookie();
      setToken(null);
      setUser(null);
    }

    rehydrate().finally(() => {
      setIsLoading(false);
    });
  }, []);

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
      localStorage.setItem(ADMIN_TOKEN_KEY, newToken);
      setAuthCookie(newToken);
    }

    if (response.refreshToken) {
      localStorage.setItem(REFRESH_TOKEN_KEY, response.refreshToken);
    }
  };

  const logout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    clearAuthCookie();
    router.push('/sign-in');
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
