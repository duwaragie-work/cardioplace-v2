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

/**
 * Callbacks consumed by streamChatMessage as SSE events arrive from
 * POST /api/chat/streaming. `onChunk` is required — everything else is
 * optional and maps to a specific event in the server's generator.
 */
export interface StreamHandlers {
  /** First event; fires once per session, before any text chunks. */
  onSession?: (sessionId: string) => void
  /** Fires if the emergency tool tripped server-side. May arrive before, during, or instead of text. */
  onEmergency?: (situation: string) => void
  /** Fires once per word/fragment. Append to the message's text verbatim. */
  onChunk: (textFragment: string) => void
  /**
   * Fires once per successful journal tool call (submit_checkin / update_checkin /
   * delete_checkin). `result` is the parsed tool payload; shape depends on tool.
   * Blocked or failed tool calls are NOT emitted.
   */
  onToolResult?: (tool: string, result: Record<string, unknown>) => void
  /**
   * Fires once, just before [DONE], when the server has generated an LLM title
   * for a brand-new session. Use this to update the sidebar in place — no refetch.
   */
  onSessionTitle?: (sessionId: string, title: string) => void
  /** Server-emitted error (controller catch path). `onError` does NOT fire for fetch failures — those throw. */
  onError?: (message: string) => void
  /** Fires once after the [DONE] sentinel (or when the reader naturally closes). */
  onDone?: () => void
}

/**
 * Consume POST /api/chat/streaming. Resolves when the server emits [DONE]
 * (or the response body closes). Throws on HTTP / network failures —
 * callers should wrap in try/catch for UX fallback.
 *
 * Wire format (data: <payload>\n\n frames):
 *   - {"sessionId":"..."}                                        → onSession
 *   - {"type":"emergency","emergencySituation":"..."}            → onEmergency
 *   - {"type":"toolResult","tool":"...","result":{...}}          → onToolResult
 *   - {"type":"sessionTitle","sessionId":"...","title":"..."}    → onSessionTitle
 *   - "...some text..." (JSON-encoded string)                    → onChunk
 *   - {"error":"..."}                                            → onError
 *   - [DONE] (not JSON)                                          → loop exits
 */
export async function streamChatMessage(
  prompt: string,
  sessionId: string | undefined,
  handlers: StreamHandlers,
): Promise<void> {
  const res = await fetchWithAuth(`${API}/api/chat/streaming`, {
    method: 'POST',
    body: JSON.stringify({ prompt, sessionId }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Request failed: ${res.status}`)
  }
  if (!res.body) {
    throw new Error('Streaming response has no body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let doneCalled = false
  const fireDone = () => {
    if (doneCalled) return
    doneCalled = true
    handlers.onDone?.()
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // Extract complete SSE events (`data: <payload>\n\n`). Partial events
      // at the buffer tail stay in `buffer` until the next read.
      let sep = buffer.indexOf('\n\n')
      while (sep !== -1) {
        const rawEvent = buffer.slice(0, sep)
        buffer = buffer.slice(sep + 2)
        sep = buffer.indexOf('\n\n')

        // SSE lines start with `data: `. Skip any comments or empty lines.
        const line = rawEvent.split('\n').find((l) => l.startsWith('data: '))
        if (!line) continue
        const payload = line.slice(6).trim()

        if (payload === '[DONE]') {
          fireDone()
          return
        }
        if (payload.startsWith('{')) {
          // Object event — sessionId / emergency / toolResult / sessionTitle / error.
          // Order matters: typed frames (`type` field) MUST be matched before the
          // bare `sessionId` shape — sessionTitle also carries a sessionId.
          try {
            const obj = JSON.parse(payload) as Record<string, unknown>
            if (obj.type === 'emergency' && typeof obj.emergencySituation === 'string') {
              handlers.onEmergency?.(obj.emergencySituation)
            } else if (obj.type === 'toolResult' && typeof obj.tool === 'string') {
              handlers.onToolResult?.(obj.tool, (obj.result ?? {}) as Record<string, unknown>)
            } else if (
              obj.type === 'sessionTitle' &&
              typeof obj.sessionId === 'string' &&
              typeof obj.title === 'string'
            ) {
              handlers.onSessionTitle?.(obj.sessionId, obj.title)
            } else if (typeof obj.sessionId === 'string') {
              handlers.onSession?.(obj.sessionId)
            } else if (typeof obj.error === 'string') {
              handlers.onError?.(obj.error)
            }
          } catch {
            // Malformed frame — skip quietly; stream continues.
          }
        } else if (payload.startsWith('"')) {
          // JSON-encoded string — the text chunk.
          try {
            const text = JSON.parse(payload) as string
            handlers.onChunk(text)
          } catch {
            // Ignore malformed text frame.
          }
        }
      }
    }
  } finally {
    // Ensure the reader is released; flush any final buffered text.
    try {
      reader.releaseLock()
    } catch {
      // Already released.
    }
    fireDone()
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

export async function getSession(sessionId: string): Promise<{
  id: string
  title: string
  summary: string | null
  createdAt: string
  updatedAt: string
}> {
  const res = await fetchWithAuth(`${API}/api/chat/sessions/${sessionId}`)
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

/**
 * Patient dictates into the chat input — browser MediaRecorder captures
 * audio, this client converts the Blob to base64 and POSTs to the backend
 * where Gemini handles the transcription. Returns the transcript text so
 * the caller can append it to the textarea for review-then-Send.
 *
 * Use this in place of the browser Web Speech API for consistent results
 * across Firefox / iOS Safari / Chrome and consistent quality on medical
 * terminology (same model the voice chat + OCR use).
 *
 * The languageHint is a BCP-47 tag (`en-US`, `es-ES`, etc.) derived from
 * the patient's preferredLanguage. Optional but recommended.
 */
export async function transcribeAudio(
  blob: Blob,
  languageHint?: string,
): Promise<string> {
  const audioBase64 = await blobToBase64(blob)
  const res = await fetchWithAuth(`${API}/api/chat/transcribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64,
      mimeType: blob.type || 'audio/webm',
      languageHint,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.message || `Transcription failed: ${res.status}`)
  }
  const json = (await res.json()) as { transcript: string }
  return json.transcript ?? ''
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer()
  // Encode in chunks to avoid the Maximum call stack exceeded error
  // String.fromCharCode hits at ~125k args. 32k is a safe chunk size.
  const bytes = new Uint8Array(buf)
  let binary = ''
  const CHUNK = 32_768
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK)) as unknown as number[],
    )
  }
  return btoa(binary)
}
