// Cluster 8 Q1 (Manisha 5/18/26) — sustained-bradycardia window aggregator.
// Mirrors adherence-window.ts: one Prisma pass over recent JournalEntry
// rows, bucketed by calendar day in the patient timezone (one "session" per
// day), to count the trailing run of consecutive sessions whose mean resting
// HR is ≤ 45 bpm. When that run reaches 3+, the surveillance rule escalates
// from Tier 3 (info-only chart event) to Tier 2 (physician review).

import type { PrismaService } from '../../prisma/prisma.service.js'

// 14 days is comfortably more than the 3-session escalation threshold even
// with the occasional skipped check-in day. Bounded by ~1-3 entries/day and
// the existing (userId, measuredAt desc) index.
const WINDOW_DAYS = 14
// Per Manisha Q1 — the escalation sub-threshold within the 40–49 band.
const SUSTAINED_HR_CEILING = 45

export interface BradyPatternWindow {
  /** Length of the trailing run of consecutive check-in sessions (calendar
   *  days, patient timezone) whose mean resting HR is ≤ 45 bpm, ending at
   *  the anchor (current) session. 0 when the most recent session is > 45. */
  consecutiveSessionsLe45: number
}

export const EMPTY_BRADY_WINDOW: BradyPatternWindow = {
  consecutiveSessionsLe45: 0,
}

export async function loadBradyPatternWindow(
  prisma: PrismaService,
  userId: string,
  anchorDate: Date,
  timezone: string,
): Promise<BradyPatternWindow> {
  const windowStart = new Date(
    anchorDate.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000,
  )

  const entries = await prisma.journalEntry.findMany({
    where: {
      userId,
      measuredAt: { gte: windowStart, lte: anchorDate },
      pulse: { not: null },
    },
    select: { measuredAt: true, pulse: true },
    orderBy: { measuredAt: 'desc' },
  })

  // Bucket by calendar day → mean pulse for that day's session(s).
  const sums = new Map<string, { total: number; n: number }>()
  for (const e of entries) {
    if (e.pulse == null) continue
    const day = calendarDayKey(e.measuredAt, timezone)
    const acc = sums.get(day) ?? { total: 0, n: 0 }
    acc.total += e.pulse
    acc.n += 1
    sums.set(day, acc)
  }

  // Most-recent day first. A day with no readings is simply not a session —
  // it does NOT break the consecutive-session run (clinical "consecutive
  // sessions", not "consecutive calendar days").
  const daysDesc = [...sums.keys()].sort().reverse()

  let run = 0
  for (const day of daysDesc) {
    const acc = sums.get(day)
    if (!acc || acc.n === 0) break
    const mean = Math.round(acc.total / acc.n)
    if (mean <= SUSTAINED_HR_CEILING) run += 1
    else break
  }

  return { consecutiveSessionsLe45: run }
}

function calendarDayKey(d: Date, timezone: string): string {
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
