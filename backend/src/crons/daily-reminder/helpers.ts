// N2 helpers (2026-07-13) — reusable primitives for the daily-reminder cron
// AND for Lakshitha's SMS worker (L5). Kept as stateless module functions (not
// a Nest service) so the SMS path can import them without pulling in the whole
// cron module.
//
// Timezone semantics: every helper resolves patient-local wall-clock via
// Intl.DateTimeFormat, matching the existing convention at
// backend/src/daily_journal/engine/adherence-window.ts:181-198
// (calendarDayKey). No luxon / date-fns-tz dependency.
//
// ─── Signature note for Lakshitha (L5) ────────────────────────────────────────
// The 2026-07-07 spec proposed simpler shapes:
//   hasLoggedReadingToday(userId): Promise<boolean>
//   isWithinQuietHours(user, at: Date): boolean
// The `isWithinQuietHours` export already matches. `hasLoggedReadingToday`
// needs `(prisma, userId, tz, now?)` because this is a shared module in the
// backend and Nest's dependency injection is not reachable from a module-level
// export — the caller must pass `prisma` explicitly. If you want the
// spec-shape ergonomics (userId only) for the per-patient SMS loop, use
// `hasLoggedReadingTodayForUser(prisma, userId)` below — it resolves the
// timezone from the User row on your behalf at the cost of one extra query
// per call. The cron itself uses the tz-explicit form to avoid that query.
import type { PrismaService } from '../../prisma/prisma.service.js'

/** IANA fallback for the Ward 7 & 8 DC pilot. Every downstream call uses this
 *  when the patient's stored `timezone` is null (never persisted through
 *  onboarding, legacy row, etc). */
export const REMINDER_TZ_FALLBACK = 'America/New_York'

/**
 * "YYYY-MM-DD" in the given IANA timezone. Copies the existing
 * calendarDayKey helper in adherence-window.ts so the two agree on
 * midnight-boundary semantics.
 */
export function localCalendarDayKey(d: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(d)
    const y = parts.find((p) => p.type === 'year')?.value
    const m = parts.find((p) => p.type === 'month')?.value
    const dd = parts.find((p) => p.type === 'day')?.value
    return `${y}-${m}-${dd}`
  } catch {
    return d.toISOString().slice(0, 10)
  }
}

/**
 * "HH:mm" (24h) in the given IANA timezone. Returned string is directly
 * comparable to User.reminderTime / quietHoursStart / quietHoursEnd —
 * they use the same 24h zero-padded format.
 */
export function localHourMinute(d: Date, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(d)
    let h = parts.find((p) => p.type === 'hour')?.value ?? '00'
    const m = parts.find((p) => p.type === 'minute')?.value ?? '00'
    // Some engines emit '24' for local midnight when hour12:false is combined
    // with en-US. Normalise so string comparison against '00:00' works.
    if (h === '24') h = '00'
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  } catch {
    return '00:00'
  }
}

/** True iff the patient has at least one non-deleted JournalEntry whose
 *  patient-local calendar day matches `now`'s local day.
 *
 *  Fetches only the single most-recent entry, then compares day keys —
 *  fine for a per-user daily scan; do not call in a hot loop without a
 *  batched precompute.
 */
export async function hasLoggedReadingToday(
  prisma: PrismaService,
  userId: string,
  tz: string,
  now: Date = new Date(),
): Promise<boolean> {
  const last = await prisma.journalEntry.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { measuredAt: 'desc' },
    select: { measuredAt: true },
  })
  if (!last) return false
  return localCalendarDayKey(last.measuredAt, tz) === localCalendarDayKey(now, tz)
}

/**
 * Gap 2 fix (2026-07-13) — convenience wrapper matching the spec's shorter
 * shape `hasLoggedReadingToday(userId): Promise<boolean>`. Resolves the
 * patient's timezone from the User row (falls back to America/New_York)
 * before delegating to the tz-explicit form above.
 *
 * Costs one extra User read per call — fine for Lakshitha's per-patient
 * SMS loop; the daily-reminder cron keeps the tz-explicit form to avoid
 * the extra query when it has already loaded the user row.
 *
 * Missing user → returns `false` (a patient that doesn't exist has by
 * definition not logged today — safe default that never suppresses
 * a subsequent nudge on stale data).
 */
export async function hasLoggedReadingTodayForUser(
  prisma: PrismaService,
  userId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  })
  if (!user) return false
  const tz = user.timezone ?? REMINDER_TZ_FALLBACK
  return hasLoggedReadingToday(prisma, userId, tz, now)
}

/**
 * Whole-day-count diff between the patient's most recent reading and `now`,
 * both in local calendar terms. Returns Number.POSITIVE_INFINITY when the
 * patient has never logged — callers treat that identically to a long gap
 * for reminder-tier selection.
 *
 * Day-count is derived, not stored — Duwaragie's spec explicitly bans a
 * counter table. Any reading resets the count on the next cron pass.
 */
export async function daysSinceLastReadingLocal(
  prisma: PrismaService,
  userId: string,
  tz: string,
  now: Date = new Date(),
): Promise<number> {
  const last = await prisma.journalEntry.findFirst({
    where: { userId, deletedAt: null },
    orderBy: { measuredAt: 'desc' },
    select: { measuredAt: true },
  })
  if (!last) return Number.POSITIVE_INFINITY
  const lastKey = localCalendarDayKey(last.measuredAt, tz)
  const todayKey = localCalendarDayKey(now, tz)
  // Parse each YYYY-MM-DD at UTC-midnight — the diff is stable regardless of
  // the machine's local zone because both sides are compared in the same
  // fictional UTC anchor.
  const lastMs = Date.parse(`${lastKey}T00:00:00Z`)
  const todayMs = Date.parse(`${todayKey}T00:00:00Z`)
  if (Number.isNaN(lastMs) || Number.isNaN(todayMs)) return Number.POSITIVE_INFINITY
  return Math.max(0, Math.floor((todayMs - lastMs) / 86_400_000))
}

/**
 * True iff `now` (evaluated in the user's timezone) falls inside the
 * patient's quiet-hours window. Handles the overnight-wrap case: when
 * `quietHoursStart > quietHoursEnd` (e.g. default 22:00 → 07:00), the window
 * spans midnight and matches [start, 24:00) ∪ [00:00, end).
 *
 * Missing fields are treated as no-quiet-hours (returns false) — a patient
 * who never set preferences must not accidentally have every reminder
 * suppressed.
 */
export function isWithinQuietHours(
  user: {
    quietHoursStart: string | null
    quietHoursEnd: string | null
    timezone: string | null
  },
  now: Date = new Date(),
): boolean {
  const start = user.quietHoursStart
  const end = user.quietHoursEnd
  if (!start || !end) return false
  const tz = user.timezone ?? REMINDER_TZ_FALLBACK
  const current = localHourMinute(now, tz)
  return isHhmmWithinQuietHours(current, start, end)
}

/**
 * Pure "HH:mm" membership check. Extracted so the shift-rule computation
 * in DailyReminderService can reuse it without threading a timezone.
 */
export function isHhmmWithinQuietHours(
  hhmm: string,
  start: string,
  end: string,
): boolean {
  if (start === end) return false // degenerate — treat as "always awake"
  if (start > end) {
    // Wraps midnight: 22:00 → 07:00 catches 22:00..23:59 and 00:00..06:59
    return hhmm >= start || hhmm < end
  }
  // Non-wrap: 12:00 → 14:00 (e.g. lunch quiet-hour) catches 12:00..13:59
  return hhmm >= start && hhmm < end
}

/**
 * N6 shift rule (spec §N6): if a patient's configured `reminderTime`
 * falls INSIDE their quiet-hours window, the effective delivery time is
 * shifted to `quietHoursEnd` (the first slot after quiet hours end).
 * Otherwise the effective time is the raw reminderTime.
 *
 * Returns null when the patient has no configured reminderTime — the
 * cron then skips them entirely.
 */
export function effectiveReminderSlot(user: {
  reminderTime: string | null
  quietHoursStart: string | null
  quietHoursEnd: string | null
}): string | null {
  const rt = user.reminderTime
  if (!rt) return null
  const qs = user.quietHoursStart
  const qe = user.quietHoursEnd
  if (!qs || !qe) return rt
  if (isHhmmWithinQuietHours(rt, qs, qe)) {
    // Shift to the end-of-quiet-hours edge. Round to the nearest 30-min
    // slot boundary in case a legacy user has a non-slot quietHoursEnd.
    return normaliseToHalfHour(qe)
  }
  return rt
}

function normaliseToHalfHour(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(':')
  const h = Number(hStr)
  const m = Number(mStr)
  if (!Number.isFinite(h) || !Number.isFinite(m)) return hhmm
  const rounded = m < 30 ? 0 : 30
  return `${String(h).padStart(2, '0')}:${String(rounded).padStart(2, '0')}`
}

/**
 * The hour (0–23) of `now` in the given IANA timezone. Used for
 * N2's time-of-day greeting bucket (morning / midday / evening).
 */
export function localHour(now: Date, tz: string): number {
  const hhmm = localHourMinute(now, tz)
  const h = Number(hhmm.slice(0, 2))
  return Number.isFinite(h) ? h : 0
}
