import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export async function createJournalEntry(data: {
  entryDate: string
  measurementTime?: string
  systolicBP?: number
  diastolicBP?: number
  weight?: number
  medicationTaken?: boolean
  missedDoses?: number
  symptoms?: string[]
  teachBackAnswer?: string
  notes?: string
}) {
  const res = await fetchWithAuth(`${API}/api/daily-journal`, {
    method: 'POST',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function updateJournalEntry(
  id: string,
  data: Partial<{
    entryDate: string
    measurementTime: string
    systolicBP: number
    diastolicBP: number
    weight: number
    medicationTaken: boolean
    missedDoses: number
    symptoms: string[]
    teachBackAnswer: string
    notes: string
  }>,
) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function deleteJournalEntry(id: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getJournalEntries(params?: {
  startDate?: string
  endDate?: string
  limit?: number
}) {
  const qs = new URLSearchParams()
  if (params?.startDate) qs.append('startDate', params.startDate)
  if (params?.endDate) qs.append('endDate', params.endDate)
  if (params?.limit) qs.append('limit', String(params.limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getJournalHistory(page?: number, limit?: number) {
  const qs = new URLSearchParams()
  if (page) qs.append('page', String(page))
  if (limit) qs.append('limit', String(limit))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/daily-journal/history${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getJournalEntry(id: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/${id}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getLatestBaseline() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/baseline/latest`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getAlerts() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function acknowledgeAlert(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getJournalStats() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/stats`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getEscalations() {
  const res = await fetchWithAuth(`${API}/api/daily-journal/escalations`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getNotifications(status?: 'all' | 'read' | 'unread') {
  const qs = status ? `?status=${status}` : ''
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications${qs}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function markNotificationRead(id: string, watched: boolean) {
  const res = await fetchWithAuth(`${API}/api/daily-journal/notifications/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ watched }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}
