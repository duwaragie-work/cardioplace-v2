// measuredAt construction + display helpers (Chunk C "nowish" gate + Bug 15).

const NOWISH_WINDOW_MS = 10 * 60 * 1000

/**
 * Treat a chosen measured datetime within ~10 min of now as "just now" (the
 * real-time 95% case). A backdated time reads as not-now. `now` is injectable
 * for tests.
 */
export function isNowish(
  measuredDate: string,
  measuredTime: string,
  nowMs: number = Date.now(),
): boolean {
  const ms = new Date(`${measuredDate}T${measuredTime}`).getTime()
  if (Number.isNaN(ms)) return false
  return Math.abs(nowMs - ms) < NOWISH_WINDOW_MS
}

/**
 * Bug 15 — `<input type="time">` only yields HH:MM, so building measuredAt from
 * the form truncates to the minute. Two submissions in the same wall-clock
 * minute then collide on the DB `@@unique([userId, measuredAt])` → 409. For a
 * "just now" submission (the common case) use real now() with full millisecond
 * precision so rapid resubmits can never collide. A genuinely backdated time
 * (not nowish) keeps the minute-precision value the patient explicitly picked —
 * if that collides, the backend's friendly ConflictException is meaningful.
 */
export function resolveMeasuredAtIso(
  measuredDate: string,
  measuredTime: string,
  now: Date = new Date(),
): string {
  return isNowish(measuredDate, measuredTime, now.getTime())
    ? now.toISOString()
    : new Date(`${measuredDate}T${measuredTime}`).toISOString()
}
