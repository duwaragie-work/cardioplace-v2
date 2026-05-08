/**
 * Business-hours / after-hours helpers. The seed practice (Cedar Hill) runs
 * Mon–Fri 08:00–18:00 America/New_York — most specs anchor times against
 * those hours.
 *
 * These do NOT call any backend; they're pure date math. The backend is the
 * source of truth for what's after-hours during dispatch — these helpers
 * only let specs construct deterministic `now` values for runScan calls.
 */

export const SEED_PRACTICE_TZ = 'America/New_York'
export const SEED_PRACTICE_START_HOUR = 8
export const SEED_PRACTICE_END_HOUR = 18

/** Build an ISO timestamp for "next Monday 9am ET". */
export function nextBusinessDay9am(): Date {
  const now = new Date()
  const d = new Date(now)
  // Move to next Monday — clears any weekend or after-hours wraparound.
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1)
  // 13:00 UTC ≈ 09:00 ET (DST agnostic — close enough for cron triggers).
  d.setUTCHours(13, 0, 0, 0)
  return d
}

/** Add deltaMs to a Date and return a new Date. */
export function plusMs(d: Date, deltaMs: number): Date {
  return new Date(d.getTime() + deltaMs)
}

export const HOURS = (n: number) => n * 60 * 60 * 1000
export const MINUTES = (n: number) => n * 60 * 1000
export const DAYS = (n: number) => n * 24 * 60 * 60 * 1000

/**
 * Construct a fake "now" inside business hours of the seed practice — useful
 * for deterministic Tier 1 ladder tests that don't want after-hours queueing.
 */
export function fakeNowBusinessHours(deltaHoursFrom9am = 0): Date {
  const d = nextBusinessDay9am()
  return plusMs(d, HOURS(deltaHoursFrom9am))
}

/** Construct a fake "now" outside business hours (Tuesday 02:00 ET). */
export function fakeNowAfterHours(): Date {
  const d = nextBusinessDay9am()
  // Tuesday 02:00 ET = +24h from Monday 09:00 ET, then -7h to land on 02:00.
  return plusMs(d, HOURS(24) - HOURS(7))
}
