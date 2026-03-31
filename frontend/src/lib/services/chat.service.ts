import { fetchWithAuth } from './token'

const API = process.env.NEXT_PUBLIC_API_URL

export async function sendMessage(
  prompt: string,
  sessionId?: string,
): Promise<{
  sessionId: string
  data: string
  isEmergency: boolean
  emergencySituation: string | null
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
