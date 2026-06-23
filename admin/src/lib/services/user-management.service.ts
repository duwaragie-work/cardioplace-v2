// Phase/23 — User management service. Wraps the admin user-invite
// endpoints. All calls go through `fetchWithAuth` so the admin JWT
// cookie + bearer header are attached automatically.
//
// Backend controller: backend/src/users/users.controller.ts
//   Mounted at  /admin/users  (global prefix `/api` → /api/admin/users)
//
//   POST   /api/admin/users/invite
//   POST   /api/admin/users/invite/bulk
//   GET    /api/admin/users
//   POST   /api/admin/users/:id/deactivate
//   POST   /api/admin/users/:id/reactivate
//   POST   /api/admin/users/invite/:id/resend
//   POST   /api/admin/users/invite/:id/revoke

import type { UserRole } from '@/lib/roleGates'
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

// ─── Types ──────────────────────────────────────────────────────────────────

export type AccountStatus =
  | 'ACTIVE'
  | 'BLOCKED'
  | 'SUSPENDED'
  | 'DEACTIVATED'

/** Synthetic value the list endpoint uses for the open-invite bucket. */
export const INVITE_PENDING = 'INVITE_PENDING' as const

export type UserListStatus = AccountStatus | typeof INVITE_PENDING

export interface UserRow {
  id: string
  email: string | null
  name: string | null
  roles: UserRole[]
  accountStatus: AccountStatus
  createdAt: string
  /** Derived server-side from the user's role-appropriate practice
   *  membership (PatientProviderAssignment for patients, PracticeCoordinator
   *  for coordinators, first PracticeProvider/PracticeMedicalDirector
   *  membership for clinical staff). `null` for OPS / SUPER_ADMIN. */
  practiceId: string | null
  /** True when the user has an enrolled TOTP authenticator. Drives the
   *  "Reset MFA" action — only enrolled users can be reset. */
  mfaEnrolled?: boolean
  /** True when the patient has a registered biometric passkey. Drives the
   *  "Reset biometric" support action. */
  biometricEnrolled?: boolean
}

/** Coordinator-scoped patient row — backend strips every field but these. */
export interface CoordinatorPatientRow {
  id: string
  name: string | null
  email: string | null
  status: 'Active' | 'Deactivated' | 'Blocked'
}

export interface UserInviteRow {
  id: string
  email: string
  name: string
  role: UserRole
  practiceId: string | null
  invitedById: string
  invitedAt: string
  expiresAt: string
  acceptedAt: string | null
  revokedAt: string | null
  createdUserId: string | null
}

export interface InvitePayload {
  name: string
  email: string
  role: UserRole
  practiceId?: string | null
}

export interface BulkInviteRowError {
  index: number
  email: string
  reason: string
}

export interface BulkInviteResult {
  statusCode: number
  message: string
  data: UserInviteRow[] | null
  errors?: BulkInviteRowError[]
}

export interface UserListQuery {
  role?: UserRole
  practiceId?: string
  status?: UserListStatus
  search?: string
  page?: number
  limit?: number
}

export interface UserListResponse {
  statusCode: number
  message: string
  data: UserRow[] | CoordinatorPatientRow[]
  invites: UserInviteRow[]
  total: number
  page: number
  limit: number
  /** Only sent for COORDINATOR callers — their own practice (id + name).
   *  Surfaced in the header so the coordinator can see which practice
   *  they're managing without needing access to the practices list
   *  endpoint (which is OPS/SUPER-only). */
  scopePractice?: { id: string; name: string } | null
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function unwrap<T>(json: unknown): T {
  if (json && typeof json === 'object' && 'data' in (json as Record<string, unknown>)) {
    return (json as { data: T }).data
  }
  return json as T
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err && typeof err === 'object' && 'message' in err && err.message) ||
        `${fallback}: ${res.status}`,
    )
  }
  return (await res.json()) as T
}

// ─── Single invite ──────────────────────────────────────────────────────────

export async function inviteUser(payload: InvitePayload): Promise<UserInviteRow> {
  const body: Record<string, unknown> = {
    name: payload.name,
    email: payload.email,
    role: payload.role,
  }
  if (payload.practiceId) body.practiceId = payload.practiceId
  const res = await fetchWithAuth(`${API}/api/admin/users/invite`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
  const json = await jsonOrThrow<unknown>(res, 'Could not send invite')
  return unwrap<UserInviteRow>(json)
}

// ─── Bulk invite ────────────────────────────────────────────────────────────

/**
 * Returns the full payload (incl. statusCode + errors). The backend uses
 * a 200 HTTP response with `statusCode: 422` in the body for the
 * "validate-all-then-create-all" reject case, so callers must inspect
 * `result.statusCode === 422` instead of relying on the HTTP status.
 */
export async function bulkInviteUsers(
  entries: InvitePayload[],
): Promise<BulkInviteResult> {
  const cleaned = entries.map((e) => {
    const row: Record<string, unknown> = {
      name: e.name,
      email: e.email,
      role: e.role,
    }
    if (e.practiceId) row.practiceId = e.practiceId
    return row
  })
  const res = await fetchWithAuth(`${API}/api/admin/users/invite/bulk`, {
    method: 'POST',
    body: JSON.stringify({ entries: cleaned }),
  })
  // The backend wraps the success path in `data`. The reject path returns
  // a plain object `{ statusCode, message, errors, data: null }`.
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(
      (err && typeof err === 'object' && 'message' in err && err.message) ||
        `Could not send bulk invites: ${res.status}`,
    )
  }
  const json = (await res.json()) as Record<string, unknown>
  // Detect the 422-shape reject — has `errors` array, no usable invite list.
  if (Array.isArray(json.errors) && (json.errors as unknown[]).length > 0) {
    return {
      statusCode: 422,
      message: String(json.message ?? 'Bulk invite rejected'),
      data: null,
      errors: json.errors as BulkInviteRowError[],
    }
  }
  // Success — pull the created invites out of `data`.
  const created = unwrap<UserInviteRow[]>(json)
  return {
    statusCode: 200,
    message: String(json.message ?? 'Bulk invites sent'),
    data: created,
  }
}

// ─── List ───────────────────────────────────────────────────────────────────

export async function listUsers(query: UserListQuery = {}): Promise<UserListResponse> {
  const qs = new URLSearchParams()
  if (query.role) qs.set('role', query.role)
  if (query.practiceId) qs.set('practiceId', query.practiceId)
  if (query.status) qs.set('status', query.status)
  if (query.search) qs.set('search', query.search)
  if (query.page) qs.set('page', String(query.page))
  if (query.limit) qs.set('limit', String(query.limit))
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  // `no-store` defeats browser / intermediary caches so mutations (revoke,
  // deactivate, etc.) reflect immediately on the next list fetch.
  const res = await fetchWithAuth(`${API}/api/admin/users${suffix}`, {
    cache: 'no-store',
  })
  return jsonOrThrow<UserListResponse>(res, 'Could not load users')
}

// ─── Deactivate / Reactivate ───────────────────────────────────────────────

export async function deactivateUser(
  id: string,
  reason?: string,
): Promise<UserRow> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${id}/deactivate`, {
    method: 'POST',
    body: JSON.stringify(reason ? { reason } : {}),
  })
  const json = await jsonOrThrow<unknown>(res, 'Could not deactivate user')
  return unwrap<UserRow>(json)
}

export async function reactivateUser(id: string): Promise<UserRow> {
  const res = await fetchWithAuth(`${API}/api/admin/users/${id}/reactivate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
  const json = await jsonOrThrow<unknown>(res, 'Could not reactivate user')
  return unwrap<UserRow>(json)
}

// ─── Invite admin (resend / revoke) ────────────────────────────────────────

export async function resendInvite(inviteId: string): Promise<UserInviteRow> {
  const res = await fetchWithAuth(
    `${API}/api/admin/users/invite/${inviteId}/resend`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  const json = await jsonOrThrow<unknown>(res, 'Could not resend invite')
  return unwrap<UserInviteRow>(json)
}

export async function revokeInvite(inviteId: string): Promise<UserInviteRow> {
  const res = await fetchWithAuth(
    `${API}/api/admin/users/invite/${inviteId}/revoke`,
    { method: 'POST', body: JSON.stringify({}) },
  )
  const json = await jsonOrThrow<unknown>(res, 'Could not revoke invite')
  return unwrap<UserInviteRow>(json)
}

// ─── Email validation regex — shared with the form components. ─────────────
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
