import { fetchWithAuth } from './token'
import type {
  CaregiverDto,
  CreateCaregiverPayload,
  UpdateCaregiverPayload,
} from '@cardioplace/shared'

const API = process.env.NEXT_PUBLIC_API_URL

async function jsonOrThrow<T>(res: Response, fallbackMsg = 'Request failed'): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `${fallbackMsg}: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

export async function listCaregivers(patientUserId: string): Promise<CaregiverDto[]> {
  const res = await fetchWithAuth(
    `${API}/api/admin/patients/${patientUserId}/caregivers`,
  )
  return jsonOrThrow<CaregiverDto[]>(res, 'Could not load caregivers')
}

export async function createCaregiver(
  patientUserId: string,
  payload: CreateCaregiverPayload,
): Promise<CaregiverDto> {
  const res = await fetchWithAuth(
    `${API}/api/admin/patients/${patientUserId}/caregivers`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return jsonOrThrow<CaregiverDto>(res, 'Could not add caregiver')
}

export async function updateCaregiver(
  patientUserId: string,
  id: string,
  payload: UpdateCaregiverPayload,
): Promise<CaregiverDto> {
  const res = await fetchWithAuth(
    `${API}/api/admin/patients/${patientUserId}/caregivers/${id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  return jsonOrThrow<CaregiverDto>(res, 'Could not update caregiver')
}

export async function disableCaregiver(
  patientUserId: string,
  id: string,
): Promise<void> {
  const res = await fetchWithAuth(
    `${API}/api/admin/patients/${patientUserId}/caregivers/${id}`,
    { method: 'DELETE' },
  )
  await jsonOrThrow<unknown>(res, 'Could not remove caregiver')
}
