// Coordinator front-desk surface. Restricted, no-clinical patient roster +
// care-team assignment, scoped server-side to the coordinator's own practice.
//
// Backend:
//   GET   /api/admin/coordinator/patients
//   GET   /api/admin/coordinator/clinicians
//   POST  /api/admin/patients/:userId/assignment      (create care team)
//   PATCH /api/admin/patients/:userId/assignment      (update care team)

import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export interface ClinicianRef {
  id: string
  name: string | null
}

export interface CoordinatorPatient {
  id: string
  name: string | null
  email: string | null
  displayId: string | null
  onboardingStatus: string
  enrollmentStatus: string
  careTeam: {
    primaryProvider: ClinicianRef | null
    backupProvider: ClinicianRef | null
    medicalDirector: ClinicianRef | null
  } | null
}

export interface Clinician {
  id: string
  name: string | null
  email: string | null
  roles: string[]
}

export interface CareTeamDto {
  practiceId: string
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
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

interface Wrapped<T> {
  data: T
  practiceId?: string
}

export async function getCoordinatorPatients(): Promise<{
  patients: CoordinatorPatient[]
  practiceId: string | null
}> {
  const res = await fetchWithAuth(`${API}/api/admin/coordinator/patients`, {
    cache: 'no-store',
  })
  const json = await jsonOrThrow<Wrapped<CoordinatorPatient[]>>(
    res,
    'Could not load patients',
  )
  return { patients: json.data ?? [], practiceId: json.practiceId ?? null }
}

export async function getCoordinatorClinicians(): Promise<Clinician[]> {
  const res = await fetchWithAuth(`${API}/api/admin/coordinator/clinicians`, {
    cache: 'no-store',
  })
  const json = await jsonOrThrow<Wrapped<Clinician[]>>(
    res,
    'Could not load clinicians',
  )
  return json.data ?? []
}

/** Create (first assignment) or update (already has a care team). */
export async function saveCareTeam(
  userId: string,
  dto: CareTeamDto,
  hasExisting: boolean,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/admin/patients/${userId}/assignment`,
    {
      method: hasExisting ? 'PATCH' : 'POST',
      body: JSON.stringify(dto),
    },
  )
  await jsonOrThrow<unknown>(res, 'Could not save care team')
}
