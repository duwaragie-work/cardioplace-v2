// Flow J — practice + assignment + clinician service.
// Wraps:
//   • GET    /admin/practices          (list with patient + staff counts)
//   • POST   /admin/practices          (create)
//   • GET    /admin/practices/:id      (detail)
//   • PATCH  /admin/practices/:id      (update name / hours / tz / protocol)
//   • GET    /admin/practices/:id/staff
//   • GET    /admin/clinicians         (global pool, used by J3 dropdowns)
//   • GET    /admin/patients/:id/assignment
//   • POST   /admin/patients/:id/assignment
//   • PATCH  /admin/patients/:id/assignment

import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Practice {
  id: string
  name: string
  businessHoursStart: string
  businessHoursEnd: string
  businessHoursTimezone: string
  afterHoursProtocol: string | null
  createdAt: string
  updatedAt: string
  patientCount?: number
  staffCount?: number
}

export type StaffSlot = 'PRIMARY' | 'BACKUP' | 'MEDICAL_DIRECTOR'

export interface PracticeStaff {
  id: string
  name: string | null
  email: string
  roles: string[]
  /** Which slots this user fills across this practice's assignments. */
  slots: StaffSlot[]
}

export interface Clinician {
  id: string
  name: string | null
  email: string
  roles: string[]
}

export interface PatientAssignment {
  id: string
  userId: string
  practiceId: string
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
  assignedAt: string
  // Some endpoints hydrate names — keep them optional.
  practice?: { id: string; name: string } | null
  primaryProvider?: { id: string; name: string | null; email: string } | null
  backupProvider?: { id: string; name: string | null; email: string } | null
  medicalDirector?: { id: string; name: string | null; email: string } | null
}

export interface UpsertPracticePayload {
  name: string
  businessHoursStart?: string
  businessHoursEnd?: string
  businessHoursTimezone?: string
  afterHoursProtocol?: string | null
}

export interface UpsertAssignmentPayload {
  practiceId: string
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
}

// ─── Helper ─────────────────────────────────────────────────────────────────

async function jsonOrThrow<T>(res: Response, fallbackMsg = 'Request failed'): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `${fallbackMsg}: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

// ─── Practice CRUD (J1 + J2) ────────────────────────────────────────────────

export async function listPractices(): Promise<Practice[]> {
  const res = await fetchWithAuth(`${API}/api/admin/practices`)
  return jsonOrThrow<Practice[]>(res, 'Could not load practices')
}

export async function getPractice(id: string): Promise<Practice> {
  const res = await fetchWithAuth(`${API}/api/admin/practices/${id}`)
  return jsonOrThrow<Practice>(res, 'Could not load practice')
}

export async function createPractice(body: UpsertPracticePayload): Promise<Practice> {
  const res = await fetchWithAuth(`${API}/api/admin/practices`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<Practice>(res, 'Could not create practice')
}

export async function updatePractice(id: string, body: Partial<UpsertPracticePayload>): Promise<Practice> {
  const res = await fetchWithAuth(`${API}/api/admin/practices/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<Practice>(res, 'Could not update practice')
}

// ─── Practice staff (J2 list + J3 dropdown source) ──────────────────────────

export async function listPracticeStaff(id: string): Promise<PracticeStaff[]> {
  const res = await fetchWithAuth(`${API}/api/admin/practices/${id}/staff`)
  return jsonOrThrow<PracticeStaff[]>(res, 'Could not load practice staff')
}

export async function listClinicians(role?: 'PROVIDER' | 'MEDICAL_DIRECTOR'): Promise<Clinician[]> {
  const qs = role ? `?role=${role}` : ''
  const res = await fetchWithAuth(`${API}/api/admin/clinicians${qs}`)
  return jsonOrThrow<Clinician[]>(res, 'Could not load clinicians')
}

// ─── Patient assignment (J3) ────────────────────────────────────────────────

export async function getPatientAssignment(patientUserId: string): Promise<PatientAssignment | null> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${patientUserId}/assignment`)
  if (res.status === 404) return null
  return jsonOrThrow<PatientAssignment>(res, 'Could not load assignment')
}

export async function createPatientAssignment(
  patientUserId: string,
  body: UpsertAssignmentPayload,
): Promise<PatientAssignment> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${patientUserId}/assignment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<PatientAssignment>(res, 'Could not create assignment')
}

export async function updatePatientAssignment(
  patientUserId: string,
  body: Partial<UpsertAssignmentPayload>,
): Promise<PatientAssignment> {
  const res = await fetchWithAuth(`${API}/api/admin/patients/${patientUserId}/assignment`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return jsonOrThrow<PatientAssignment>(res, 'Could not update assignment')
}

// ─── Constants for the J2 timezone picker ───────────────────────────────────

/** Common IANA timezones for the US healthcare market. The full IANA list is
 *  thousands long; this short list covers the v2 Cardioplace footprint plus a
 *  few extras for future expansion. The textbox accepts any IANA string the
 *  backend's Intl validator approves, so this is just a quick-pick set. */
export const COMMON_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'America/Honolulu',
  'America/Puerto_Rico',
] as const
