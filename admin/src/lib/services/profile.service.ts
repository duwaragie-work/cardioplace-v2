// Admin "my account" profile service. Wraps the shared auth profile
// endpoints (the same ones the patient app uses — they're user-scoped,
// not patient-specific).
//
// Backend controller: backend/src/auth/auth.controller.ts
//   GET   /api/v2/auth/profile   — fetch the signed-in user's full profile
//   PATCH /api/v2/auth/profile   — edit profile fields (ProfileDto)
//
// All calls go through `fetchWithAuth` so the admin JWT bearer header +
// HttpOnly refresh cookie are attached (and a 401 transparently refreshes).

import type { UserRole } from '@/lib/roleGates'
import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

// ─── Types ──────────────────────────────────────────────────────────────────

/** Full profile as returned by GET /auth/profile. The clinical fields
 *  (dateOfBirth, communicationPreference, enrollmentStatus) are patient-only
 *  and stay null/ignored for admin users — kept here for shape parity. */
export interface MyProfile {
  id: string
  email: string | null
  name: string | null
  roles: UserRole[]
  emailVerified: boolean
  accountStatus: string
  createdAt: string
  preferredLanguage: string | null
  timezone: string | null
  /** Whether the user has an active TOTP credential enrolled. */
  mfaEnabled: boolean
  /** Whether the user's role is under the enforced-MFA policy. */
  mfaRequired: boolean
  activePractice: { id: string; name: string } | null
  availablePractices: Array<{ id: string; name: string }>
}

/** Editable subset of ProfileDto relevant to admin/care-team users.
 *  (dateOfBirth + communicationPreference are patient-clinical and omitted.) */
export interface ProfileEditPayload {
  name?: string
  preferredLanguage?: string
  timezone?: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────

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

// ─── Fetch ──────────────────────────────────────────────────────────────────

export async function getMyProfile(): Promise<MyProfile> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/profile`, {
    cache: 'no-store',
  })
  const data = await jsonOrThrow<Record<string, unknown>>(
    res,
    'Could not load your profile',
  )
  return {
    id: String(data.id),
    email: (data.email as string | null) ?? null,
    name: (data.name as string | null) ?? null,
    roles: Array.isArray(data.roles) ? (data.roles as UserRole[]) : [],
    emailVerified: Boolean(data.emailVerified),
    accountStatus: String(data.accountStatus ?? 'active'),
    createdAt: String(data.createdAt ?? ''),
    preferredLanguage: (data.preferredLanguage as string | null) ?? null,
    timezone: (data.timezone as string | null) ?? null,
    mfaEnabled: Boolean(data.mfaEnabled),
    mfaRequired: Boolean(data.mfaRequired),
    activePractice:
      (data.activePractice as { id: string; name: string } | null) ?? null,
    availablePractices: Array.isArray(data.availablePractices)
      ? (data.availablePractices as Array<{ id: string; name: string }>)
      : [],
  }
}

// ─── Update ──────────────────────────────────────────────────────────────────

export async function updateMyProfile(
  payload: ProfileEditPayload,
): Promise<void> {
  const res = await fetchWithAuth(`${API}/api/v2/auth/profile`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  })
  await jsonOrThrow<unknown>(res, 'Could not save your profile')
}
