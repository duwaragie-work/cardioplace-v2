import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

/**
 * Patient's BP / HR target range, set by their care team.
 * Mirrors the PatientThreshold Prisma model — all numeric targets are
 * optional because providers may set only the BP bounds, only the HR
 * bounds, or any subset relevant to the patient's condition.
 */
export interface PatientThresholdDto {
  id: string
  userId: string
  sbpUpperTarget: number | null
  sbpLowerTarget: number | null
  dbpUpperTarget: number | null
  dbpLowerTarget: number | null
  hrUpperTarget: number | null
  hrLowerTarget: number | null
  setByProviderId: string
  setAt: string
  replacedAt: string | null
  notes: string | null
}

/**
 * Returns the patient's own threshold or `null` when none has been set.
 * Used by the dashboard to decide whether to render the "Your goal" card.
 */
export async function getMyThreshold(): Promise<PatientThresholdDto | null> {
  const res = await fetchWithAuth(`${API}/api/me/threshold`)
  if (!res.ok) {
    if (res.status === 404) return null
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? null) as PatientThresholdDto | null
}
