import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

/**
 * Minimal view of a PatientMedication for the patient-side forms. Full detail
 * (verification status, discontinuedAt, etc.) is not needed when rendering
 * the checkbox list in the CheckIn MEDICATION step — but we keep the fields
 * the backend returns so a future UI can surface them without another call.
 */
export interface PatientMedication {
  id: string
  drugName: string
  drugClass: string
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED'
  source: string
  isCombination?: boolean
  frequency?: string | null
  reportedAt: string
  verifiedAt: string | null
  discontinuedAt: string | null
}

/**
 * List the authenticated patient's active medications. Defaults to excluding
 * discontinued rows — we only want "what am I supposed to be taking right now"
 * in the check-in flow.
 */
export async function listMyMedications(): Promise<PatientMedication[]> {
  const res = await fetchWithAuth(`${API}/api/me/medications`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data?: PatientMedication[] }
  return body.data ?? []
}
