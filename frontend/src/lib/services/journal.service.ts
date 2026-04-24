// Patient daily-journal API client. Fields mirror the backend
// CreateJournalEntryDto: `measuredAt` (single UTC timestamp) replaced the v1
// `entryDate` + `measurementTime` pair in phase/2; structured Level-2 symptom
// booleans were added in phase/15 alongside Flow B.

import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export type MissedMedicationReason =
  | 'FORGOT'
  | 'SIDE_EFFECTS'
  | 'RAN_OUT'
  | 'COST'
  | 'INTENTIONAL'
  | 'OTHER'

export interface MissedMedicationPayload {
  medicationId: string
  drugName: string
  drugClass: string
  reason: MissedMedicationReason
  missedDoses: number
}

export interface JournalEntryPayload {
  /** ISO 8601 UTC timestamp. Required by the backend. */
  measuredAt: string
  systolicBP?: number
  diastolicBP?: number
  pulse?: number
  weight?: number
  position?: 'SITTING' | 'STANDING' | 'LYING'
  /** UUID grouping multiple readings taken within ~30 min (rule engine averages them). */
  sessionId?: string
  /** Pre-measurement 8-item checklist captured as a JSON object. */
  measurementConditions?: Record<string, unknown>
  medicationTaken?: boolean
  missedDoses?: number
  /** Per-medication miss detail. Submitted when the patient taps "Missed"
   * and checks off specific drugs in CheckIn.tsx. */
  missedMedications?: MissedMedicationPayload[]
  // Structured V2 Level-2 symptom triggers
  severeHeadache?: boolean
  visualChanges?: boolean
  alteredMentalStatus?: boolean
  chestPainOrDyspnea?: boolean
  focalNeuroDeficit?: boolean
  severeEpigastricPain?: boolean
  // Pregnancy-specific (only if PatientProfile.isPregnant)
  newOnsetHeadache?: boolean
  ruqPain?: boolean
  edema?: boolean
  /** Patient's "anything else" freeform notes — stored as String[]. */
  otherSymptoms?: string[]
  notes?: string
  source?: 'manual' | 'healthkit'
}

export interface JournalEntryDto extends JournalEntryPayload {
  id: string
  userId: string
  createdAt: string
  updatedAt: string
}

/**
 * Thrown when POST /daily-journal returns 403 `clinical-intake-required` —
 * Layer A journaling gate. Callers should route the patient to
 * `/clinical-intake` rather than surfacing the raw error. See
 * docs/TESTING_FLOW_GUIDE.md §6.1.
 */
export class ClinicalIntakeRequiredError extends Error {
  readonly code = 'clinical-intake-required' as const
  constructor(reason?: string) {
    super(reason || 'Complete your clinical intake before logging readings.')
    this.name = 'ClinicalIntakeRequiredError'
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    if (res.status === 403 && err?.message === 'clinical-intake-required') {
      throw new ClinicalIntakeRequiredError(err.reason)
    }
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

export async function createJournalEntry(data: JournalEntryPayload): Promise<JournalEntryDto> {
  const res = await fetchWithAuth(`${API}/api/daily-journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return unwrap<JournalEntryDto>(res)
}

export async function updateJournalEntry(
  id: string,
  data: Partial<JournalEntryPayload>,
): Promise<JournalEntryDto> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return unwrap<JournalEntryDto>(res)
}

export async function deleteJournalEntry(id: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'DELETE',
  })
  return unwrap<unknown>(res)
}

export async function getJournalEntries(params?: {
  startDate?: string
  endDate?: string
  limit?: number
}): Promise<JournalEntryDto[]> {
  const qs = new URLSearchParams()
  if (params?.startDate) qs.append('startDate', params.startDate)
  if (params?.endDate) qs.append('endDate', params.endDate)
  if (params?.limit) qs.append('limit', String(params.limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal${query ? `?${query}` : ''}`)
  return unwrap<JournalEntryDto[]>(res)
}

export async function getJournalHistory(page?: number, limit?: number) {
  const qs = new URLSearchParams()
  if (page) qs.append('page', String(page))
  if (limit) qs.append('limit', String(limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal/history${query ? `?${query}` : ''}`)
  return unwrap<unknown>(res)
}

export async function getJournalEntry(id: string): Promise<JournalEntryDto> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`)
  return unwrap<JournalEntryDto>(res)
}

export async function getLatestBaseline() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/baseline/latest`)
  return unwrap<unknown>(res)
}

// V2 alert tier — mirrors AlertTier enum on the backend.
export type AlertTier =
  | 'TIER_1_CONTRAINDICATION'
  | 'TIER_2_DISCREPANCY'
  | 'TIER_3_INFO'
  | 'BP_LEVEL_1_HIGH'
  | 'BP_LEVEL_1_LOW'
  | 'BP_LEVEL_2'
  | 'BP_LEVEL_2_SYMPTOM_OVERRIDE'

export interface DeviationAlertDto {
  id: string
  userId: string
  journalEntryId: string
  // V1 legacy
  type?: string | null
  severity?: string | null
  magnitude?: number | null
  baselineValue?: number | null
  actualValue?: number | null
  // V2
  tier?: AlertTier | null
  ruleId?: string | null
  mode?: 'STANDARD' | 'PERSONALIZED' | null
  pulsePressure?: number | null
  suboptimalMeasurement?: boolean
  patientMessage?: string | null
  caregiverMessage?: string | null
  physicianMessage?: string | null
  dismissible?: boolean
  resolutionAction?: string | null
  resolutionRationale?: string | null
  resolvedBy?: string | null
  escalated?: boolean
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  createdAt: string
  acknowledgedAt?: string | null
  // Joined journalEntry snapshot
  journalEntry?: {
    id: string
    measuredAt: string
    systolicBP?: number | null
    diastolicBP?: number | null
    pulse?: number | null
    weight?: number | null
  } | null
}

export async function getAlerts(): Promise<DeviationAlertDto[]> {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts`)
  return unwrap<DeviationAlertDto[]>(res)
}

export async function acknowledgeAlert(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
  })
  return unwrap<unknown>(res)
}

export async function getJournalStats() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/stats`)
  return unwrap<{ totalEntries?: number; currentStreak?: number } | null>(res)
}

export async function getEscalations() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/escalations`)
  return unwrap<unknown>(res)
}

export async function getNotifications(status?: 'all' | 'read' | 'unread') {
  const qs = status ? `?status=${status}` : ''
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications${qs}`)
  return unwrap<unknown>(res)
}

export async function markNotificationRead(id: string, watched: boolean) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ watched }),
  })
  return unwrap<unknown>(res)
}
