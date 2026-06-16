// Patient /readings session bucketing (Bug 43 + Bug 14).
//
// Groups a date's readings into session buckets for the readings list. Two
// consecutive readings land in the same bucket ONLY when:
//   (a) they share the SAME non-null sessionId, or
//   (b) BOTH have a null sessionId and fall within the 5-min clinical window.
//
// Case (b) is the legacy fallback the proximity rule was added for (Bug 43):
// null-id rows from pre-#91 entries and chat tool calls that didn't thread a
// session_id. Per CLINICAL_SPEC §5.2 the 5-min clock is the canonical
// session-grouping rule, but `sessionId` is the storage shortcut and a NON-null
// id is authoritative.
//
// Bug 14 — proximity must NEVER bridge two DIFFERENT non-null sessionIds, nor a
// null and a non-null id. Those are distinct clinical episodes: e.g. a declined
// Option D emergency (its own UNCONFIRMED session) and a fresh reading minutes
// later must render as two separate cards, never averaged into one. This
// mirrors the admin ReadingsTab strictness (Bug 5) so the two apps agree.

export type SessionGroupable = {
  sessionId?: string | null
  measuredAt: string
}

export type TimedReading = {
  id: string
  measuredAt: string
}

// Bug 15 — the set of entry ids that share their local HH:MM with at least one
// OTHER entry in the same list. Those entries render with seconds (HH:MM:SS) so
// two readings submitted moments apart don't both display "15:11" and read like
// an accidental duplicate. Adaptive: only the colliding entries get seconds;
// everything else stays minute-only. Same rule on patient /readings and the
// admin Readings tab (cross-app parity).
export function sameMinuteCollisionIds(
  items: ReadonlyArray<TimedReading>,
): Set<string> {
  const byMinute = new Map<string, string[]>()
  for (const e of items) {
    const d = new Date(e.measuredAt)
    if (Number.isNaN(d.getTime())) continue
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours()}-${d.getMinutes()}`
    const arr = byMinute.get(key)
    if (arr) arr.push(e.id)
    else byMinute.set(key, [e.id])
  }
  const colliding = new Set<string>()
  for (const arr of byMinute.values()) {
    if (arr.length >= 2) for (const id of arr) colliding.add(id)
  }
  return colliding
}

export type ReadingBucket<T extends SessionGroupable> = {
  sessionId: string | null
  items: T[]
  lastMs: number
}

const FIVE_MIN_MS = 5 * 60 * 1000

export function bucketReadingsBySession<T extends SessionGroupable>(
  items: T[],
): ReadingBucket<T>[] {
  const buckets: ReadingBucket<T>[] = []
  for (const e of items) {
    const sid = e.sessionId ?? null
    const eMs = new Date(e.measuredAt).getTime()
    const last = buckets[buckets.length - 1]
    // (a) same non-null sessionId — authoritative, always groups.
    const sameNonNullSession = sid !== null && !!last && last.sessionId === sid
    // (b) both null + within the 5-min window — legacy null-id fallback only.
    const bothNullWithinWindow =
      !!last &&
      sid === null &&
      last.sessionId === null &&
      Number.isFinite(eMs) &&
      Number.isFinite(last.lastMs) &&
      Math.abs(eMs - last.lastMs) <= FIVE_MIN_MS
    if (last && (sameNonNullSession || bothNullWithinWindow)) {
      last.items.push(e)
      last.lastMs = eMs
    } else {
      buckets.push({ sessionId: sid, items: [e], lastMs: eMs })
    }
  }
  return buckets
}
