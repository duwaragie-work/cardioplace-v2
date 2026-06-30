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
import { useIdleTimeout } from '@/lib/hooks/useIdleTimeout';

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
  /** Phase/practice-identity — null for SUPER_ADMIN / HEALPLACE_OPS or when
   *  the user has zero memberships (defensive — backend blocks this case). */
  activePracticeId?: string | null;
  /** PR #90 Bug A — the resolved active practice WITH its name, so the chip
   *  renders "Acting as: <name>" on the fresh sign-in/select window without
   *  waiting for /auth/profile. */
  activePractice?: { id: string; name: string } | null;
  /** PR #90 Bug A — switchable memberships, mirrors /auth/profile. */
  availablePractices?: Array<{ id: string; name: string }>;
  /** MFA — true when enforcement is on and this user hasn't enrolled TOTP. The
   *  sign-in page redirects to /sign-in/mfa-enroll instead of the dashboard. */
  mfaEnrollmentRequired?: boolean;
  /** Practice-select handoff for a first-time-enrolling MULTI-practice provider.
   *  Tokens are issued (enrollment needs a session) with activePracticeId null;
   *  the FE stashes the challenge and routes enroll → /sign-in/select-practice
   *  so a null-practice session never lands on the dashboard. */
  practiceSelectRequired?: boolean;
  practiceSelectChallengeToken?: string;
  practices?: Array<{ id: string; name: string }>;
};

/** Phase/practice-identity — discriminated response shape returned by
 *  /otp/verify and /magic-link/verify when a multi-practice provider must
 *  pick a practice before the real tokens are issued. */
export type AdminPracticeSelectResponse = {
  status: 'PRACTICE_SELECT_REQUIRED';
  challengeToken: string;
  practices: Array<{ id: string; name: string }>;
};

type AdminUser = {
  id: string;
  email?: string | null;
  name?: string | null;
  roles?: string[];
};

type ActivePractice = { id: string; name: string } | null;

interface AuthContextType {
  token: string | null;
  user: AdminUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (response: AdminAuthResponse) => void;
  logout: () => void;
  /** Phase/practice-identity — the practice the active session is acting as.
   *  Drives the AdminTopBar chip + audit attribution on backend writes. */
  activePractice: ActivePractice;
  /** Memberships available for switching. Populated after sign-in if the
   *  user has 2+ practices (fetched from /auth/profile or the selector
   *  challenge response). */
  availablePractices: Array<{ id: string; name: string }>;
  /** Switch the active practice mid-session. Calls POST /auth/switch-practice
   *  and replaces the in-memory access token. */
  switchPractice: (practiceId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  token: null,
  user: null,
  isAuthenticated: false,
  isLoading: true,
  login: () => {},
  logout: () => {},
  activePractice: null,
  availablePractices: [],
  switchPractice: async () => {},
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

// Phase/practice-identity rehydrate fix (smoke 2026-06-18) — /auth/profile
// now returns activePracticeId + activePractice + availablePractices so the
// admin app can restore practice context after a browser refresh. Pre-fix
// rehydrate() only restored user, leaving activePractice null, which
// dropped every PROVIDER/MED_DIR/COORDINATOR into the ZeroPracticeModal on
// every F5.
type ProfileResponse = {
  id: string;
  email: string | null;
  name: string | null;
  roles: string[];
  activePracticeId?: string | null;
  activePractice?: { id: string; name: string } | null;
  availablePractices?: Array<{ id: string; name: string }>;
};

async function fetchProfile(accessToken: string): Promise<ProfileResponse | null> {
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
  const [user, setUser] = useState<AdminUser | null>(null);
  // Always start in loading state — we have to attempt a cookie-based
  // rehydrate before we can know whether the session is live.
  const [isLoading, setIsLoading] = useState(true);
  // Phase/practice-identity — populated on sign-in (from the verify-OTP
  // response), after switch, and on rehydrate (from /auth/profile, which
  // returns the current AuthSession's activePracticeId + the matching
  // practice + the user's full membership list). Pre-rehydrate-fix this
  // was only set during sign-in/switch, so every F5 dropped providers
  // into the ZeroPracticeModal.
  const [activePractice, setActivePractice] = useState<ActivePractice>(null);
  const [availablePractices, setAvailablePractices] = useState<
    Array<{ id: string; name: string }>
  >([]);

  // On mount: try a silent refresh against the HttpOnly refresh_token cookie.
  useEffect(() => {
    // Skip rehydrate when we're handling a fresh magic-link sign-in.
    // MagicLinkHandler is about to call login() with the tokens from the
    // URL params; running /refresh here would consume the just-issued
    // refresh token and race with the destination page's own mount-time
    // rehydrate. Refresh-token rotation is single-use, so whichever fetch
    // reaches the backend second gets a 401 — and the loser's rehydrate
    // clears user state, which bounces the destination page to /sign-in.
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname;
      const isFreshMagicLink =
        pathname === '/auth/magic-link' &&
        new URLSearchParams(window.location.search).has('accessToken');
      // Phase/practice-identity pre-session bounce fix —
      // /sign-in/select-practice has only a short-lived challenge token
      // in sessionStorage, no refresh-token cookie yet. Running rehydrate
      // here gets a 401, clears auth markers, and bounces the user back
      // to /sign-in before they can pick a practice.
      const isSelectPractice = pathname.startsWith('/sign-in/select-practice');
      if (isFreshMagicLink || isSelectPractice) {
        setIsLoading(false);
        return;
      }
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
        setUser({
          id: profile.id,
          email: profile.email,
          name: profile.name,
          roles: profile.roles,
        });
        writeAuthMarkers(profile.roles ?? []);
        // Phase/practice-identity rehydrate fix — restore the active
        // practice + membership list from the profile response. Without
        // these two setters, ZeroPracticeModal fires after every F5
        // because its trigger condition is `!activePractice &&
        // isPracticeBound && !isOrgWide` — and isPracticeBound is true
        // for PROVIDER / MED_DIR / COORDINATOR.
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
    // Phase/practice-identity — surface the active practice so AdminTopBar
    // can render "Acting as: <name>". PR #90 Bug A: /select-practice now
    // returns activePractice {id,name} + availablePractices, so the chip
    // shows the real name immediately. Older payloads carry only
    // activePracticeId (name unknown until /auth/profile) — keep that as a
    // fallback so a stale response doesn't crash, but the chip renders
    // nothing for an empty name rather than the "Acting as practice" lie.
    if (response.activePractice) {
      setActivePractice(response.activePractice);
    } else if (response.activePracticeId) {
      setActivePractice({ id: response.activePracticeId, name: '' });
    } else {
      setActivePractice(null);
    }
    if (response.availablePractices) {
      setAvailablePractices(response.availablePractices);
    } else {
      // Every auth-issuing response now carries the bundle, so an absent list
      // means "no memberships" — reset rather than keep a stale array.
      setAvailablePractices([]);
    }
    // Refresh token deliberately NOT persisted client-side — the backend
    // already set the HttpOnly refresh_token cookie on the verify-OTP
    // response. Keeping it out of JS closes the XSS path.
  };

  /**
   * Phase/practice-identity — mid-session active-practice swap.
   * POSTs /auth/switch-practice; backend updates AuthSession + mints a
   * fresh access token carrying the new activePracticeId JWT claim.
   * Refresh-token cookie stays the same.
   */
  const switchPractice = async (practiceId: string) => {
    const res = await fetch(`${API_URL}/api/v2/auth/switch-practice`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ practiceId }),
    });
    if (!res.ok) {
      throw new Error(`Switch failed: ${res.status}`);
    }
    const data = (await res.json()) as {
      activePracticeId: string;
      accessToken: string;
      activePractice?: { id: string; name: string } | null;
      availablePractices?: Array<{ id: string; name: string }>;
    };
    setToken(data.accessToken);
    setAccessToken(data.accessToken);
    // PR #90 Bug A — the switch response now carries the resolved practice
    // {id,name}; prefer it so the chip updates to the real name. Fall back
    // to the local membership list, then to an id-only stub (which the chip
    // renders as nothing rather than the "Acting as practice" placeholder).
    if (data.availablePractices) {
      setAvailablePractices(data.availablePractices);
    }
    const target =
      data.activePractice ??
      availablePractices.find((p) => p.id === data.activePracticeId) ??
      data.availablePractices?.find((p) => p.id === data.activePracticeId);
    setActivePractice(target ?? { id: data.activePracticeId, name: '' });
    // PR #90 Bug C — data-fetching components (patient list, alerts, stats)
    // keep their own client-side fetch cache and don't auto-bust on an
    // auth-context state change, so the chip flips to the new practice while
    // the visible data stays scoped to the OLD activePracticeId until a hard
    // reload re-queries. router.refresh() only re-runs Server Components (most
    // of admin fetches client-side), and per-hook cache invalidation would
    // mean wiring every hook to activePractice — a full reload is the standard
    // multi-tenant "switch context → invalidate everything" pattern.
    //
    // Deferred one tick so the caller's success toast (fired in
    // PracticeContextChip AFTER this promise resolves) paints before the
    // navigation tears the page down. ~half-second of toast, then reload.
    if (typeof window !== 'undefined') {
      setTimeout(() => window.location.reload(), 600);
    }
  };

  // Manisha 2026-06-12 Doc 3 Q7 — idle session timeout. 15 min web,
  // 5 min mobile. Arm only when signed in. Warning fires a custom
  // event so layout chrome can render a banner; timeout sign-outs
  // re-use the existing logout pattern + bounces to /sign-in.
  useIdleTimeout({
    enabled: !!token,
    onWarn: () => {
      if (typeof window === 'undefined') return;
      window.dispatchEvent(new CustomEvent('auth:idle-warning'));
    },
    onTimeout: () => {
      if (typeof window === 'undefined') return;
      fetch(`${API_URL}/api/v2/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      }).catch(() => {});
      setToken(null);
      setUser(null);
      clearTokenState();
      clearAuthMarkers();
      window.location.href = '/sign-in?session_expired=1';
    },
  });

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
        activePractice,
        availablePractices,
        switchPractice,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
