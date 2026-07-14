import { fetchWithAuth } from './token'
import type {
  CaregiverDto,
  CreateCaregiverPayload,
  UpdateCaregiverPayload,
} from '@cardioplace/shared'

const API = process.env.NEXT_PUBLIC_API_URL

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return (json.data ?? json) as T
}

/** The patient's own caregiver contacts (active only). */
export async function getCaregivers(): Promise<CaregiverDto[]> {
  const res = await fetchWithAuth(`${API}/api/me/caregivers`)
  return unwrap<CaregiverDto[]>(res)
}

export async function addCaregiver(
  payload: CreateCaregiverPayload,
): Promise<CaregiverDto> {
  const res = await fetchWithAuth(`${API}/api/me/caregivers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return unwrap<CaregiverDto>(res)
}

export async function updateCaregiver(
  id: string,
  payload: UpdateCaregiverPayload,
): Promise<CaregiverDto> {
  const res = await fetchWithAuth(`${API}/api/me/caregivers/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return unwrap<CaregiverDto>(res)
}

/** Soft-disable (server sets active=false). */
export async function removeCaregiver(id: string): Promise<void> {
  const res = await fetchWithAuth(`${API}/api/me/caregivers/${id}`, {
    method: 'DELETE',
  })
  await unwrap<unknown>(res)
}
