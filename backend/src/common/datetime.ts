/**
 * Bug 18 — Convert a wall-clock date+time interpreted in IANA timezone `tz`
 * into an ISO-8601 UTC instant. Used by every dispatcher that takes a
 * patient-spoken HH:MM and persists `JournalEntry.measuredAt`.
 *
 * Without this, dispatchers were writing wallclock-as-UTC (e.g.
 * `new Date(\`${date}T${time}:00.000Z\`)`) so a patient in IST saying
 * "3:32 PM" got stored as 2026-06-05T15:32:00Z. On read, the frontend
 * converts that UTC instant to client-local → 15:32 + 5h30 = 21:02 IST
 * → "9:02 PM" in My Readings while the chat card's verbal echo still
 * said "3:32 PM". Voice already used the correct helper; text chat
 * didn't, and both surfaces now share this single implementation.
 *
 * Algorithm: guess wallclock as UTC, ask Intl.DateTimeFormat what local
 * time that guess corresponds to in `tz`, subtract the offset. Matches
 * Python `zoneinfo` incl. DST transitions.
 */
export function isoFromTzWallclock(dateStr: string, timeStr: string, tz: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  const t = /^(\d{1,2}):(\d{2})$/.exec(timeStr)
  if (!m || !t) {
    return new Date().toISOString()
  }
  const y = parseInt(m[1], 10)
  const mo = parseInt(m[2], 10)
  const d = parseInt(m[3], 10)
  const h = parseInt(t[1], 10)
  const mi = parseInt(t[2], 10)

  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0)
  const offsetMs = tzOffsetMs(utcGuess, tz)
  return new Date(utcGuess - offsetMs).toISOString()
}

export function tzOffsetMs(utcMs: number, tz: string): number {
  const date = new Date(utcMs)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10)
  const localMs = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour'), get('minute'), get('second'),
  )
  return localMs - utcMs
}

/**
 * Bug 26 — inverse of `isoFromTzWallclock`. Given a UTC instant (Date or ISO
 * string) and the patient's IANA timezone, return the patient's local
 * wallclock as `{ date: 'YYYY-MM-DD', time: 'HH:mm' }`.
 *
 * Used by `get_recent_readings` (chat + voice) when projecting stored
 * `measuredAt` (UTC) into the JSON the LLM sees. Pre-fix the chat
 * dispatcher used `d.toISOString().slice(0, 10)` and `.slice(11, 16)`,
 * which gives UTC date/time strings — so a New York patient who saved at
 * 04:04 EDT (08:04 UTC) saw their reading echoed back as "08:04" by the
 * chatbot's "how am I doing?" summary, even though My Readings displayed
 * "04:04" correctly. Symmetric with the write-side helper above so chat
 * + voice agree end-to-end with the rest of the UI.
 */
export function tzWallclockFromIso(
  iso: string | Date,
  tz: string,
): { date: string; time: string } {
  const date = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(date.getTime())) return { date: '', time: '' }
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  // Intl returns "24" for midnight on some platforms — normalise to "00".
  const hh = get('hour') === '24' ? '00' : get('hour')
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${hh}:${get('minute')}`,
  }
}
