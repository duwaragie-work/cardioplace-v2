// Admin app — role-based UI gates. Each predicate below mirrors a backend
// `@Roles()` decorator exactly. When adding a new role or changing backend
// authz, update the matching predicate here AND the comment reference so
// drift is obvious in code review.
//
// Rule: the frontend must never be LOOSER than the backend (would cause 403s
// visible to users) and never STRICTER either (would hide functionality the
// user is actually allowed to use).

export const ADMIN_ROLES = [
  'SUPER_ADMIN',
  'MEDICAL_DIRECTOR',
  'PROVIDER',
  'HEALPLACE_OPS',
] as const
export type AdminRole = (typeof ADMIN_ROLES)[number]

type RoleInput = string[] | null | undefined
type UserInput = { roles?: string[] | null } | null | undefined

function rolesOf(input: RoleInput | UserInput): string[] {
  if (!input) return []
  if (Array.isArray(input)) return input
  return input.roles ?? []
}

function has(input: RoleInput | UserInput, allowed: readonly string[]): boolean {
  const roles = rolesOf(input)
  return roles.some((r) => allowed.includes(r))
}

// ─── Coarse gate — "can access admin app at all" ────────────────────────────
/** Mirror of admin/src/proxy.ts + backend OTP admin-context gate. */
export function hasAdminRole(input: RoleInput | UserInput): boolean {
  return has(input, ADMIN_ROLES as readonly string[])
}

// ─── Alerts (read + resolve) ────────────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER, HEALPLACE_OPS)
 * backend/src/daily_journal/controllers/alert-resolution.controller.ts
 */
export function canResolveAlerts(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS'])
}

// ─── Profile + medication verification ─────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, PROVIDER, MEDICAL_DIRECTOR)    // HEALPLACE_OPS excluded
 * backend/src/intake/admin-intake.controller.ts
 */
export function canVerifyProfile(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'PROVIDER', 'MEDICAL_DIRECTOR'])
}

export function canVerifyMedications(input: RoleInput | UserInput): boolean {
  // Same backend controller.
  return canVerifyProfile(input)
}

// ─── Practice CRUD ──────────────────────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)    // PROVIDER excluded
 * backend/src/practice/practice.controller.ts
 */
export function canManagePractices(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS'])
}

// ─── Care team assignment ───────────────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)    // PROVIDER excluded
 * backend/src/practice/assignment.controller.ts
 */
export function canAssignCareTeam(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS'])
}

// ─── Enrollment gate (Complete Onboarding) ─────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)    // PROVIDER excluded
 * backend/src/practice/enrollment.controller.ts
 */
export function canCompleteOnboarding(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS'])
}

// ─── Thresholds (clinical directive) ────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR)    // MD-only clinical authority
 * backend/src/practice/threshold.controller.ts
 */
export function canEditThresholds(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR'])
}

// ─── Legacy v1 / scheduled calls ────────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN) — legacy v1 provider endpoints and scheduled-calls
 * UI live behind this gate.
 */
export function canAccessLegacyV1(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN'])
}

// ─── PROVIDER scope helper ──────────────────────────────────────────────────
/**
 * True when the caller's ONLY admin-tier role is PROVIDER (i.e. not also
 * a MD / OPS / SUPER_ADMIN). Used by the frontend to decide whether to
 * pass `?scope=assigned` when listing patients or alerts. The backend
 * force-scopes this anyway — the frontend just matches for UI clarity.
 */
export function isProviderOnly(input: RoleInput | UserInput): boolean {
  const roles = rolesOf(input)
  if (!roles.includes('PROVIDER')) return false
  const broader = ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS']
  return !roles.some((r) => broader.includes(r))
}
