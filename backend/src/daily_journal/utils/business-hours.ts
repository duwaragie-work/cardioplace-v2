// Phase/7 business-hours math — used by EscalationService for after-hours
// queueing. Practice stores business hours as HH:MM strings + an IANA timezone
// (BUILD_PLAN §2.5). Luxon handles DST correctly; naive Date math cannot.
//
// Contract:
//  - isWithinBusinessHours(now, practice) — true when `now` (a UTC instant)
//    falls within the practice's local Mon–Fri business window.
//  - nextBusinessHoursStart(now, practice) — returns the next UTC instant at
//    which the practice's business window opens. If `now` is already inside
//    the window this returns `now`. Handles weekends (Sat/Sun skip to Mon).
//
// Only Mon–Fri is considered "business hours". CLINICAL_SPEC §V2-D sets this
// implicitly — after-hours protocol covers evenings + weekends — and phase/13
// locks practice config to a single window pair (no per-day overrides).

import { DateTime } from 'luxon'

export interface BusinessHoursConfig {
  businessHoursStart: string // "HH:MM", 24h local
  businessHoursEnd: string // "HH:MM", 24h local
  businessHoursTimezone: string // IANA tz, e.g. "America/New_York"
}

/** Mon–Fri inside [start, end) in the practice's local tz. */
export function isWithinBusinessHours(
  now: Date,
  practice: BusinessHoursConfig,
): boolean {
  const local = DateTime.fromJSDate(now, { zone: practice.businessHoursTimezone })
  if (!local.isValid) return false

  // Luxon weekday: 1=Mon ... 7=Sun. Only 1..5 are business days.
  if (local.weekday > 5) return false

  const [startMin, endMin] = parseWindow(practice)
  if (startMin == null || endMin == null) return false

  const nowMin = local.hour * 60 + local.minute
  return nowMin >= startMin && nowMin < endMin
}

/**
 * Next UTC instant at which `practice` is open. If already open, returns
 * `now` as a JS Date truncated to the same instant (no-op).
 *
 * Examples (tz America/New_York, 08:00-18:00):
 *  - Mon 07:00 local → Mon 08:00 local (same day open)
 *  - Mon 19:00 local → Tue 08:00 local
 *  - Fri 19:00 local → Mon 08:00 local (skip weekend)
 *  - Sat 10:00 local → Mon 08:00 local
 *  - Sun 23:59 local → Mon 08:00 local
 */
export function nextBusinessHoursStart(
  now: Date,
  practice: BusinessHoursConfig,
): Date {
  const zone = practice.businessHoursTimezone
  const [startMin, endMin] = parseWindow(practice)
  if (startMin == null || endMin == null) {
    // Malformed config — don't queue indefinitely; act as if always open.
    return now
  }

  let local = DateTime.fromJSDate(now, { zone })
  if (!local.isValid) return now

  const startHour = Math.floor(startMin / 60)
  const startMinute = startMin % 60

  for (let i = 0; i < 8; i++) {
    const candidate = local.set({
      hour: startHour,
      minute: startMinute,
      second: 0,
      millisecond: 0,
    })
    const nowMin = local.hour * 60 + local.minute
    const alreadyOpen =
      local.weekday <= 5 && nowMin >= startMin && nowMin < endMin

    if (alreadyOpen) {
      // Already inside the window — return `now` (rounded to the minute) as UTC.
      return local.set({ second: 0, millisecond: 0 }).toJSDate()
    }

    const isBusinessDay = candidate.weekday <= 5
    const beforeOpen = isBusinessDay && nowMin < startMin
    if (beforeOpen) {
      return candidate.toJSDate()
    }

    // Roll to next day at 00:00 local and try again.
    local = local.plus({ days: 1 }).set({
      hour: 0,
      minute: 0,
      second: 0,
      millisecond: 0,
    })
  }

  // Defensive fallback: treat as open if we can't find a slot in 8 days.
  return now
}

// ─── internals ────────────────────────────────────────────────────────────────

function parseWindow(
  practice: BusinessHoursConfig,
): [number | null, number | null] {
  const start = toMinutes(practice.businessHoursStart)
  const end = toMinutes(practice.businessHoursEnd)
  if (start == null || end == null) return [null, null]
  if (end <= start) return [null, null] // invalid / overnight window not supported for MVP
  return [start, end]
}

function toMinutes(hhmm: string): number | null {
  if (!hhmm || typeof hhmm !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (h < 0 || h > 23 || m < 0 || m > 59) return null
  return h * 60 + m
}
