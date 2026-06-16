// FE buffer for non-emergency check-in readings (CTO Ruhim 2026-06-09 + Manisha
// Q1, docs/clinical-signoffs/MANISHA_2026_06_12_EDIT_WINDOW_AND_SESSION_POLICY_SIGNOFF.md).
//
// A non-emergency reading does NOT hit the backend on submit. It buffers here —
// in sessionStorage + component state — for the 5-minute review window. The
// backend only sees it when the patient taps "I'm good" or the window expires.
// The buffer holds the WHOLE sitting (Q3: 1–3 readings), committed together with
// one shared sessionId so the engine groups + averages them as it does today.
//
// Emergencies (Option D AWAITING, symptom-override) BYPASS this buffer and go
// straight to the backend — that branching happens in CheckIn before the buffer.

import type { JournalEntryPayload } from '@/lib/services/journal.service'

// 5-minute review window (Manisha Q4 — confirmed 5 min; CLINICAL_SPEC §5.2).
export const BUFFER_WINDOW_MS = 5 * 60 * 1000

export interface BufferedReading {
  /** Client-side id so the review screen can edit/delete this specific reading. */
  localId: string
  /** The fully-composed payload as it will be POSTed. `sessionId` is (re)applied
   *  from the draft at commit time so every reading shares one sitting. */
  payload: JournalEntryPayload
  /** Opaque wizard form snapshot (FormData) so "Edit" can re-open the wizard
   *  pre-filled without reverse-mapping the payload. The lib never inspects it;
   *  only the commit `payload` matters. Optional — survives sessionStorage. */
  form?: unknown
}

export interface JournalDraft {
  /** One shared session id for every reading committed from this draft. */
  sessionId: string
  /** ms epoch the FIRST reading entered the buffer. The countdown anchors here
   *  and does NOT reset when a 2nd/3rd reading is added (locked design). */
  createdAt: number
  readings: BufferedReading[]
}

// ─── Pure reducers (no I/O — unit-testable) ─────────────────────────────────

export function createDraft(
  sessionId: string,
  createdAt: number,
  first: BufferedReading,
): JournalDraft {
  return { sessionId, createdAt, readings: [first] }
}

export function addReading(draft: JournalDraft, reading: BufferedReading): JournalDraft {
  return { ...draft, readings: [...draft.readings, reading] }
}

export function updateReading(
  draft: JournalDraft,
  localId: string,
  payload: JournalEntryPayload,
): JournalDraft {
  return {
    ...draft,
    readings: draft.readings.map((r) =>
      r.localId === localId ? { ...r, payload } : r,
    ),
  }
}

export function removeReading(draft: JournalDraft, localId: string): JournalDraft {
  return { ...draft, readings: draft.readings.filter((r) => r.localId !== localId) }
}

/** ms left in the review window (clamped at 0). `now` injectable for tests. */
export function remainingMs(draft: JournalDraft, now: number = Date.now()): number {
  return Math.max(0, draft.createdAt + BUFFER_WINDOW_MS - now)
}

export function isExpired(draft: JournalDraft, now: number = Date.now()): boolean {
  return now >= draft.createdAt + BUFFER_WINDOW_MS
}

/** Payloads to POST on commit — every reading carries the draft's shared
 *  session so the backend treats them as one sitting. */
export function commitPayloads(draft: JournalDraft): JournalEntryPayload[] {
  return draft.readings.map((r) => ({ ...r.payload, sessionId: draft.sessionId }))
}

// ─── sessionStorage I/O ─────────────────────────────────────────────────────
// sessionStorage (NOT localStorage) so a tab refresh restores the draft but
// CLOSING the tab discards it — the CTO's "the front end sits as the buffer"
// intent: a closed tab is equivalent to discarding the non-emergency draft.

const KEY_PREFIX = 'cardioplace_buffer_draft:'
const keyFor = (userId: string) => `${KEY_PREFIX}${userId}`

export function loadDraft(userId: string): JournalDraft | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.sessionStorage.getItem(keyFor(userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as JournalDraft
    if (
      !parsed ||
      typeof parsed.sessionId !== 'string' ||
      typeof parsed.createdAt !== 'number' ||
      !Array.isArray(parsed.readings) ||
      parsed.readings.length === 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function saveDraft(userId: string, draft: JournalDraft): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.setItem(keyFor(userId), JSON.stringify(draft))
  } catch {
    // storage full / unavailable — non-fatal; the in-memory draft still stands.
  }
}

export function clearDraft(userId: string): void {
  if (typeof window === 'undefined') return
  try {
    window.sessionStorage.removeItem(keyFor(userId))
  } catch {
    // ignore
  }
}
