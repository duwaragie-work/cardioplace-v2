/**
 * Single source of truth for this app's non-token marker cookie names.
 *
 * The patient app (localhost:3000) and admin app (localhost:3001) share the
 * `localhost` cookie host — browsers don't scope cookies by port — so the
 * two apps' marker cookies MUST have distinct names or signing into one
 * contaminates the other's session on the same browser (you'd otherwise
 * need incognito / a second browser to run a patient + admin flow side by
 * side). The `cp_patient_*` prefix pairs with the backend's app-scoped
 * HttpOnly token cookies (backend/src/auth/cookie-scope.ts).
 *
 * In production the apps are on separate subdomains so the cookies were
 * already isolated — the prefixed names are belt-and-suspenders there.
 */

export const AUTH_MARKER_COOKIE = 'cp_patient_auth_marker'
export const AUTH_ROLE_COOKIE = 'cp_patient_auth_role'

/**
 * Onboarding gate marker — "1" onboarded, "0" not. Carries no PII: it is a
 * single bit derived from `onboardingStatus === 'COMPLETED'` OR this device's
 * skip flag. proxy.ts cannot read `onboardingStatus` (server-side, cookies
 * only) or localStorage, so this cookie is how the device-local skip decision
 * reaches the route guard.
 *
 * Tri-state on purpose: ABSENT means "unknown", not "un-onboarded", so the
 * guard fails open. A session that predates this cookie would otherwise be
 * bounced to /onboarding on its first navigation. AuthProvider writes the bit
 * on login and on every rehydrate, so any live session converges to a real
 * value on its first mount; the onboarding page's own client-side redirect
 * remains the backstop in the meantime.
 */
export const ONBOARDED_MARKER_COOKIE = 'cp_patient_onboarded'

// Pre-fix unscoped names. Cleared on logout so sessions created before this
// change wipe cleanly instead of orphaning a stale "logged in" marker.
export const LEGACY_MARKER_COOKIES = ['auth_marker', 'auth_role'] as const
