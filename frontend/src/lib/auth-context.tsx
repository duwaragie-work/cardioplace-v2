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
import {
  AUTH_MARKER_COOKIE,
  AUTH_ROLE_COOKIE,
  LEGACY_MARKER_COOKIES,
} from '@/lib/cookie-names';
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout';
import { unsubscribePush } from '@/lib/services/push.service';
import {
  purgeClinicalDrafts,
  sweepStaleClinicalDrafts,
} from '@/lib/clinical-drafts';
import {
  clearOnboardedMarker,
  isOnboardingSkippedOnDevice,
  writeOnboardedMarker,
} from '@/lib/onboarding';

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
  // #88 — the clinical dispatch gate (orthogonal to onboardingStatus). The
  // backend /me already returns this (F27); the patient app reads it so
  // post-submit + alert surfaces tell the truth ("enrollment pending")
  // instead of "your care team has been notified" for un-enrolled patients.
  enrollmentStatus?: string;
  // Cluster 8 Gap 1 — surfaced so LanguageProvider can default the locale
  // to the patient's account language (es/am pilot cohort).
  preferredLanguage?: string | null;
};

// Phase/practice-identity rehydrate-fix consistency mirror (handoff
// 2026-06-18). Patient app has no ZeroPracticeModal today (patients aren't
// practice-bound), so this state has no current consumer — but we mirror
// the admin shape so future patient-facing copy that needs to display the
// patient's primary practice (caregiver-facing UI, multi-clinic transitions,
// etc.) can read it without another schema/auth-context refactor. Without
// this mirror, the admin + patient auth contexts would have a structural
// drift that's a tax on every future shared-pattern change.
type ActivePractice = { id: string; name: string } | null;

interface AuthContextType {
  token: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (response: OtpVerifyResponse) => void;
  logout: () => void;
  markOnboardingComplete: () => void;
  updateUser: (fields: Partial<AuthUser>) => void;
  /** Mirror of the admin field. Always null for PATIENT-role accounts
   *  today; reserved for forward-compat. */
  activePractice: ActivePractice;
  /** Mirror of the admin field. Always [] for PATIENT-role accounts today. */
  availablePractices: Array<{ id: string; name: string }>;
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
  activePractice: null,
  availablePractices: [],
});

// Non-token marker cookies for proxy.ts to gate page navigation. They carry
// no credential — only "logged in or not" + the role list. The actual auth
// happens via the HttpOnly access_token cookie + Bearer header on API calls.
// Tampering with these only affects which page shell renders; the backend
// rejects unauthenticated API calls regardless.
function writeAuthMarkers(roles: string[]) {
  if (typeof document === 'undefined') return;
  // 3.2 — add `Secure` so these client cookies never travel over plain HTTP,
  // but ONLY on an HTTPS page: an unconditional `Secure` would be silently
  // dropped by the browser on http:// (non-localhost) dev/staging, leaving
  // proxy.ts with no marker → a redirect loop to /sign-in. HTTPS-gated is safe.
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${AUTH_MARKER_COOKIE}=1; path=/; max-age=2592000; SameSite=Lax${secure}`;
  document.cookie = `${AUTH_ROLE_COOKIE}=${encodeURIComponent(roles.join(','))}; path=/; max-age=2592000; SameSite=Lax${secure}`;
}

// The onboarding gate bit proxy.ts reads. Onboarded means either the server
// says identity is captured, or this device chose to skip it — the guard must
// honour both or a patient who skipped would be stuck in a redirect loop.
function writeOnboardedMarkerFor(user: {
  id: string;
  onboardingStatus?: string;
} | null) {
  if (!user) return;
  writeOnboardedMarker(
    user.onboardingStatus === 'COMPLETED' || isOnboardingSkippedOnDevice(user.id),
  );
}

function clearAuthMarkers() {
  if (typeof document === 'undefined') return;
  document.cookie = `${AUTH_MARKER_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  document.cookie = `${AUTH_ROLE_COOKIE}=; path=/; max-age=0; SameSite=Lax`;
  clearOnboardedMarker();
  // Clear pre-fix unscoped names too so a local session created before the
  // app-scoped rename doesn't leave a stale "logged in" marker behind.
  for (const name of LEGACY_MARKER_COOKIES) {
    document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax`;
  }
}

// Phase/practice-identity rehydrate-fix consistency mirror (handoff
// 2026-06-18). Surface the same activePracticeId / activePractice /
// availablePractices triple admin's fetchProfile returns. For PATIENT-role
// accounts the backend returns null + [], so this is a structural mirror,
// not a behavioural change.
type PatientProfileResponse = AuthUser & {
  activePracticeId?: string | null;
  activePractice?: { id: string; name: string } | null;
  availablePractices?: Array<{ id: string; name: string }>;
};

async function fetchProfile(accessToken: string): Promise<PatientProfileResponse | null> {
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
      enrollmentStatus: data.enrollmentStatus,
      preferredLanguage: data.preferredLanguage ?? null,
      activePracticeId: data.activePracticeId ?? null,
      activePractice: data.activePractice ?? null,
      availablePractices: Array.isArray(data.availablePractices)
        ? data.availablePractices
        : [],
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
  // Phase/practice-identity rehydrate-fix consistency mirror — see the
  // type definitions above. Null/[] for every PATIENT-role account today;
  // populated only if the backend ever surfaces a practice for them.
  const [activePractice, setActivePractice] = useState<ActivePractice>(null);
  const [availablePractices, setAvailablePractices] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // On mount: try a silent refresh against the HttpOnly refresh_token
  // cookie. If it succeeds we hydrate state with a fresh access token +
  // user profile; if it fails we treat the user as logged-out.
  useEffect(() => {
    // V-10 — age out clinical drafts left behind when sign-out never ran (tab
    // closed, crash, battery died), so abandoned ePHI can't linger on a shared
    // device indefinitely. Runs before the auth branch below because it must
    // happen whether or not this visitor turns out to be signed in.
    sweepStaleClinicalDrafts();

    // F4 — the old "skip rehydrate on /auth/magic-link?accessToken=" guard was
    // removed: the backend no longer emits tokens in the magic-link redirect
    // (A1/V-11), so that param never exists. The magic-link page now waits for
    // this cookie rehydrate instead of racing it, so there's nothing to skip.

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
        setUser({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          roles: profile.roles,
          isVerified: profile.isVerified,
          riskTier: profile.riskTier,
          accountStatus: profile.accountStatus,
          onboardingStatus: profile.onboardingStatus,
          enrollmentStatus: profile.enrollmentStatus,
          preferredLanguage: profile.preferredLanguage ?? null,
        });
        writeAuthMarkers(profile.roles ?? []);
        writeOnboardedMarkerFor({
          id: profile.id,
          onboardingStatus: profile.onboardingStatus,
        });
        // Mirror of admin's rehydrate wiring — no consumer on the patient
        // app today, but the shape stays aligned so future patient-facing
        // practice copy can rely on it.
        setActivePractice(profile.activePractice ?? null);
        setAvailablePractices(profile.availablePractices ?? []);
      } else {
        clearTokenState();
        clearAuthMarkers();
        setToken(null);
        setUser(null);
        setActivePractice(null);
        setAvailablePractices([]);
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
      setActivePractice(null);
      setAvailablePractices([]);
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
    writeOnboardedMarkerFor(newUser);
    // Refresh token deliberately NOT persisted client-side — the backend
    // already set the HttpOnly `refresh_token` cookie on the verify-OTP
    // response (auth.controller.setRefreshCookie). Keeping it out of JS
    // closes the XSS path that ate refresh sessions in v1.
  };

  // Manisha 2026-06-12 Doc 3 Q7 — idle session timeout. 15 min web, 5 min
  // mobile. We arm only while the user is signed in (token present). The
  // warning fires a custom event so the app-level chrome can render a
  // banner / toast; the actual sign-out re-uses the existing logout flow.
  useIdleTimeout({
    enabled: !!token,
    onWarn: () => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent('auth:idle-warning'));
    },
    onTimeout: () => {
      if (typeof window === 'undefined') return;
      // Best-effort backend logout + hard nav to sign-in. We don't await
      // because the backend may already 401 on the refresh chain — the UX
      // contract is just "user gets bounced back to sign-in promptly".
      fetch(`${API_URL}/api/v2/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
      setToken(null);
      setUser(null);
      setActivePractice(null);
      setAvailablePractices([]);
      clearTokenState();
      clearAuthMarkers();
      // V-10 — an idle timeout is the walked-away-from-a-shared-device case,
      // so the clinical drafts must go here too, not just on explicit sign-out.
      purgeClinicalDrafts();
      window.location.href = '/sign-in?session_expired=1';
    },
  });

  const logout = async () => {
    // Drop this browser's push subscription FIRST, while the session is still
    // valid (the unsubscribe call is authenticated). Best-effort — never blocks
    // logout. Matters for shared devices: a signed-out patient must not keep
    // receiving pushes on this browser.
    await unsubscribePush().catch(() => {});
    // Tell the backend so it can clear both HttpOnly cookies + revoke the
    // refresh-token row. AWAIT the response so the server's Set-Cookie
    // (max-age=0 on access_token + refresh_token) is fully processed by
    // the browser BEFORE we redirect — fire-and-forget races the next
    // request and proxy.ts can keep seeing the old cookies. Best-effort:
    // we still clear local state if the network call fails (offline,
    // expired session, etc.) — proxy.ts will reject the next nav anyway.
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
    setActivePractice(null);
    setAvailablePractices([]);
    clearTokenState();
    clearAuthMarkers();
    // V-10 — wipe in-progress clinical drafts (BP, symptoms, medications) from
    // this device. Runs even if the backend logout call above failed: the local
    // ePHI must not survive a sign-out just because the network did not.
    purgeClinicalDrafts();
    // Hard navigation guarantees the cookie clear has settled before the
    // next request — router.push raced with cookie clearing in production
    // and proxy.ts kept routing the user back to /dashboard.
    window.location.href = '/sign-in';
  };

  const markOnboardingComplete = () => {
    // Open the route guard in the same tick the patient finishes onboarding —
    // the redirect to /dashboard hits proxy.ts before any rehydrate could
    // refresh the cookie.
    writeOnboardedMarker(true);
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
        activePractice,
        availablePractices,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
