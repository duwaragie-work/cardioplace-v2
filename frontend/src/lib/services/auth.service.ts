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
