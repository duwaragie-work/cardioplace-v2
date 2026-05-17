/**
 * Single source of truth for this app's non-token marker cookie names.
 *
 * The admin app (localhost:3001) and patient app (localhost:3000) share the
 * `localhost` cookie host — browsers don't scope cookies by port — so the
 * two apps' marker cookies MUST have distinct names or signing into one
 * contaminates the other's session on the same browser. The `cp_admin_*`
 * prefix pairs with the backend's app-scoped HttpOnly token cookies
 * (backend/src/auth/cookie-scope.ts).
 *
 * In production the apps are on separate subdomains so the cookies were
 * already isolated — the prefixed names are belt-and-suspenders there.
 */

export const AUTH_MARKER_COOKIE = 'cp_admin_auth_marker'
export const AUTH_ROLE_COOKIE = 'cp_admin_auth_role'

// Pre-fix unscoped names. Cleared on logout so sessions created before this
// change wipe cleanly instead of orphaning a stale "logged in" marker.
export const LEGACY_MARKER_COOKIES = ['admin_auth_marker', 'admin_auth_role'] as const
