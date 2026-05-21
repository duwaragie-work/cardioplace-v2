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
 * READ (audit + queue list): all four admin roles. HEALPLACE_OPS receives
 * the T+24h / T+48h escalation notification — they see the alert row
 * read-only for operational follow-up but cannot close it.
 *   backend/src/daily_journal/controllers/alert-resolution.controller.ts @Get
 */
export function canViewAlerts(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER', 'HEALPLACE_OPS'])
}

/**
 * WRITE (acknowledge / resolve): clinical disposition — HEALPLACE_OPS
 * removed in the May 2026 access-scope decision (they reassign care team
 * or phone the patient instead).
 *   @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER)  // HEALPLACE_OPS excluded
 *   backend/src/daily_journal/controllers/alert-resolution.controller.ts
 *     POST :id/acknowledge + POST :id/resolve
 */
export function canResolveAlerts(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER'])
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
 * Practice CRUD is an operational/admin function (May 2026 access-scope
 * decision). MED_DIR removed — their clinical authority is per-patient
 * inside their practice, not over practice metadata.
 *   @Roles(SUPER_ADMIN, HEALPLACE_OPS)  // MED_DIR + PROVIDER excluded
 *   backend/src/practice/practice.controller.ts
 */
export function canManagePractices(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'HEALPLACE_OPS'])
}

// ─── Care team assignment ───────────────────────────────────────────────────
/**
 * @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, HEALPLACE_OPS)   // PROVIDER excluded
 * backend/src/practice/assignment.controller.ts
 *
 * MED_DIR is further runtime-scoped by PatientAccessService to practices
 * they head — the frontend can show the button but a MED_DIR trying to
 * edit assignments outside their practice gets a 403 from the backend.
 */
export function canAssignCareTeam(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'HEALPLACE_OPS'])
}

// ─── Enrollment gate (Complete Onboarding) ─────────────────────────────────
/**
 * Clinical readiness call — May 2026 access-scope decision moved this to
 * the clinician group. PROVIDER added; HEALPLACE_OPS removed (they handle
 * practice↔patient assignment, not clinical readiness).
 *   @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER)  // HEALPLACE_OPS excluded
 *   backend/src/practice/enrollment.controller.ts
 */
export function canCompleteEnrollment(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER'])
}

// ─── Thresholds (clinical directive) ────────────────────────────────────────
/**
 * PROVIDER added in May 2026 access-scope decision — they can author
 * thresholds for their assigned patients. HEALPLACE_OPS still read-only.
 *   @Roles(SUPER_ADMIN, MEDICAL_DIRECTOR, PROVIDER)
 *   backend/src/practice/threshold.controller.ts
 */
export function canEditThresholds(input: RoleInput | UserInput): boolean {
  return has(input, ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER'])
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

// ─── HEALPLACE_OPS scope helper ─────────────────────────────────────────────
/**
 * True when the caller is OPS without an overlapping clinical role. Used to
 * keep clinical surfaces (alerts/readings/timeline/escalation audit) in
 * read-only state and hide acknowledge / resolve / complete-onboarding /
 * verify buttons. OPS is the T+24h / T+48h escalation target so the data
 * stays visible — only the action buttons disappear. See ADMIN_ROLE_ACCESS
 * §5 for the per-tab matrix.
 */
export function isHealplaceOpsOnly(input: RoleInput | UserInput): boolean {
  const roles = rolesOf(input)
  if (!roles.includes('HEALPLACE_OPS')) return false
  const broader = ['SUPER_ADMIN', 'MEDICAL_DIRECTOR', 'PROVIDER']
  return !roles.some((r) => broader.includes(r))
}

// ─── MEDICAL_DIRECTOR scope helper ──────────────────────────────────────────
/**
 * True when the caller is MED_DIR without an OPS/SUPER overlap. Used by the
 * frontend to decide whether to hide /practices nav (MED_DIR doesn't manage
 * practice metadata in v2 — that's OPS/SUPER). They can still co-hold
 * PROVIDER and act through their assigned panel.
 */
export function isMedicalDirectorOnly(input: RoleInput | UserInput): boolean {
  const roles = rolesOf(input)
  if (!roles.includes('MEDICAL_DIRECTOR')) return false
  const broader = ['SUPER_ADMIN', 'HEALPLACE_OPS']
  return !roles.some((r) => broader.includes(r))
}
