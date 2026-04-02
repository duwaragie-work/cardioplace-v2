import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export interface ToolResult {
  tool: string
  result: {
    saved?: boolean
    updated?: boolean
    deleted?: boolean
    message?: string
    data?: {
      id?: string
      entryDate?: string
      systolicBP?: number
      diastolicBP?: number
      weight?: number
      medicationTaken?: boolean
      symptoms?: string[]
    }
    readings?: Array<{
      id: string
      date: string
      systolic: number
      diastolic: number
      weight?: number
      medication_taken?: boolean
      symptoms?: string[]
    }>
  }
}

export async function sendMessage(
  prompt: string,
  sessionId?: string,
): Promise<{
  sessionId: string
  data: string
  isEmergency: boolean
  emergencySituation: string | null
  toolResults?: ToolResult[]
}> {
  const res = await fetchWithAuth(`${API}/api/chat/structured`, {
    method: 'POST',
    body: JSON.stringify({ prompt, sessionId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

export async function getChatSessions(): Promise<
  Array<{
    id: string
    title: string
    createdAt: string
    updatedAt: string
  }>
> {
  const res = await fetchWithAuth(`${API}/api/chat/sessions`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

export async function getSessionHistory(
  sessionId: string,
): Promise<
  Array<{
    id: string
    userMessage: string
    aiSummary: string
    source: string
    timestamp: string
  }>
> {
  const res = await fetchWithAuth(`${API}/api/chat/sessions/${sessionId}/history`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  return res.json()
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetchWithAuth(`${API}/api/chat/sessions/${sessionId}`, {
    method: 'DELETE',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
}
