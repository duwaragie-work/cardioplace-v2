import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export async function getProfile() {
  const res = await fetchWithAuth(`${API}/api/v2/auth/profile`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function updateProfile(data: {
  name?: string
  dateOfBirth?: string | null
  primaryCondition?: string
  communicationPreference?: 'TEXT_FIRST' | 'AUDIO_FIRST'
  preferredLanguage?: string
  timezone?: string
  diagnosisDate?: string | null
}) {
  const res = await fetchWithAuth(`${API}/api/v2/auth/profile`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function logoutUser() {
  const res = await fetchWithAuth(`${API}/api/v2/auth/logout`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

export async function refreshAccessToken() {
  const res = await fetchWithAuth(`${API}/api/v2/auth/refresh`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

// ─── Account lifecycle — patient self-service (phase/28) ──────────────────────

/** Deactivate your own account (reversible). Ends every session immediately. */
export async function selfDeactivateAccount() {
  const res = await fetchWithAuth(`${API}/api/v2/auth/account/deactivate`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

/** Request permanent closure — emails a 1-hour confirmation link. */
export async function requestSelfClose() {
  const res = await fetchWithAuth(
    `${API}/api/v2/auth/account/permanent-close/request`,
    { method: 'POST' },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

/** Confirm permanent closure with the emailed token (irreversible). */
export async function confirmSelfClose(confirmationToken: string) {
  const res = await fetchWithAuth(
    `${API}/api/v2/auth/account/permanent-close/confirm`,
    { method: 'POST', body: JSON.stringify({ confirmationToken }) },
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}
