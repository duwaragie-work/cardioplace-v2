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
  verificationStatus: 'UNVERIFIED' | 'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER' | 'HOLD'
  source: string
  isCombination?: boolean
  frequency?: string | null
  reportedAt: string
  verifiedAt: string | null
  discontinuedAt: string | null
}

/**
 * List the authenticated patient's medications for the check-in flow — i.e.
 * "what am I supposed to be taking right now". We keep VERIFIED, UNVERIFIED,
 * and AWAITING_PROVIDER (the patient is taking these / they're pending review),
 * but exclude:
 *   • HOLD     — the care team told the patient NOT to take it, so asking
 *               "did you take it today?" is wrong (also excluded from the
 *               adherence miss count, CLINICAL_SPEC §14.2).
 *   • REJECTED — not the patient's medication.
 *   • discontinued — no longer current.
 */
export async function listMyMedications(): Promise<PatientMedication[]> {
  const res = await fetchWithAuth(`${API}/api/me/medications`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const body = (await res.json()) as { data?: PatientMedication[] }
  return (body.data ?? []).filter(
    (m) =>
      !m.discontinuedAt &&
      m.verificationStatus !== 'HOLD' &&
      m.verificationStatus !== 'REJECTED',
  )
}
