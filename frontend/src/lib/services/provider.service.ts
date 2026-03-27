import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export async function getProviderStats() {
  const res = await fetchWithAuth(`${API}/api/provider/stats`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatients(filters?: {
  riskTier?: string
  hasActiveAlerts?: boolean
}) {
  const qs = new URLSearchParams()
  if (filters?.riskTier) qs.append('riskTier', filters.riskTier)
  if (filters?.hasActiveAlerts !== undefined)
    qs.append('hasActiveAlerts', String(filters.hasActiveAlerts))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/provider/patients${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatientSummary(userId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/patients/${userId}/summary`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getPatientJournal(userId: string, page?: number, limit?: number) {
  const qs = new URLSearchParams()
  if (page) qs.append('page', String(page))
  if (limit) qs.append('limit', String(limit))
  const query = qs.toString()
  const res = await fetchWithAuth(
    `${API}/api/provider/patients/${userId}/journal${query ? `?${query}` : ''}`,
  )
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getProviderAlerts(filters?: {
  severity?: string
  escalated?: boolean
}) {
  const qs = new URLSearchParams()
  if (filters?.severity) qs.append('severity', filters.severity)
  if (filters?.escalated !== undefined) qs.append('escalated', String(filters.escalated))
  const query = qs.toString()
  const res = await fetchWithAuth(`${API}/api/provider/alerts${query ? `?${query}` : ''}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function getAlertDetail(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/alerts/${alertId}/detail`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}

export async function scheduleCall(body: {
  patientUserId: string
  alertId?: string
  callDate: string
  callTime: string
  callType: string
  notes?: string
}) {
  const res = await fetchWithAuth(`${API}/api/provider/schedule-call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json
}

export async function acknowledgeProviderAlert(alertId: string) {
  const res = await fetchWithAuth(`${API}/api/provider/alerts/${alertId}/acknowledge`, {
    method: 'PATCH',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  const json = await res.json()
  return json.data ?? json
}
