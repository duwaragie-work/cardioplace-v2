// Phase/4 derivation helpers — single source of truth for values that are
// computed from primary data rather than stored (BUILD_PLAN §2.10).
//
// Pure functions only. No framework, no Prisma. Imported by the rule engine
// (phase/5), admin / patient dashboards, and chat system-prompt injection
// (phase/16).

export type AgeGroup = '18-39' | '40-64' | '65+'

export type ReadingContext = 'MORNING' | 'AFTERNOON' | 'EVENING' | 'NOCTURNAL'

export interface TrailingBaseline {
  baselineSystolic: number
  baselineDiastolic: number
  /** Number of complete readings (SBP + DBP non-null) inside the window. */
  readingCount: number
}

export interface BaselineEntry {
  measuredAt: Date | string
  systolicBP: number | null
  diastolicBP: number | null
}

/**
 * Trailing N-day mean SBP/DBP computed on-the-fly from JournalEntry rows.
 * v2 replaces the v1 rolling BaselineSnapshot table — baseline is *derived*,
 * never stored. Both the chat system prompt and the voice system prompt
 * inject this so the agent can reference the patient's recent average.
 *
 * Returns null when no complete readings fall inside the window. Entries
 * with either BP value null are skipped (partial readings don't contribute).
 *
 * @param entries JournalEntry-shaped rows (anything with measuredAt + BP)
 * @param windowDays default 7 per CLINICAL_SPEC Part 5 averaged-reading
 * @param now default Date.now(); injectable for tests
 */
export function getTrailing7DayBaseline(
  entries: readonly BaselineEntry[],
  windowDays = 7,
  now: number = Date.now(),
): TrailingBaseline | null {
  const windowStart = now - windowDays * 24 * 60 * 60 * 1000
  const inside = entries.filter(
    (e) =>
      e.systolicBP != null &&
      e.diastolicBP != null &&
      new Date(e.measuredAt).getTime() >= windowStart,
  )
  if (inside.length === 0) return null
  const baselineSystolic = Math.round(
    inside.reduce((a, e) => a + (e.systolicBP as number), 0) / inside.length,
  )
  const baselineDiastolic = Math.round(
    inside.reduce((a, e) => a + (e.diastolicBP as number), 0) / inside.length,
  )
  return { baselineSystolic, baselineDiastolic, readingCount: inside.length }
}

/**
 * Pulse pressure = SBP − DBP. Returns null if either input is null/undefined
 * or if the result is non-physiological (SBP < DBP implies sensor error).
 * Threshold comparisons (>60 flag) are the caller's responsibility — this
 * helper is pure arithmetic.
 */
export function getPulsePressure(
  sbp: number | null | undefined,
  dbp: number | null | undefined,
): number | null {
  if (sbp == null || dbp == null) return null
  const pp = sbp - dbp
  if (pp <= 0) return null
  return pp
}

/**
 * BMI = weight(kg) / (height(m))². Returns null when either value is missing.
 * Accepts Prisma's Decimal-like values by calling toString() and parsing —
 * avoids importing @prisma/client into the shared package.
 */
export function getBMI(
  heightCm: number | null | undefined,
  weightKg: number | null | undefined | { toString(): string },
): number | null {
  if (heightCm == null || weightKg == null) return null
  const weightNum =
    typeof weightKg === 'number' ? weightKg : Number(weightKg.toString())
  if (!Number.isFinite(weightNum) || weightNum <= 0) return null
  if (heightCm <= 0) return null
  const heightM = heightCm / 100
  return weightNum / (heightM * heightM)
}

/**
 * Age group from date of birth, per CLINICAL_SPEC Part 1.1:
 * - 18-39  — lower baseline CVD risk
 * - 40-64  — standard
 * - 65+    — raised lower bound (SBP <100 instead of <90)
 *
 * Returns null for null DOB, future DOB, or ages <18. Callers that want a
 * default (e.g. treat null as 40-64) apply that policy themselves.
 */
export function getAgeGroup(
  dob: Date | string | null | undefined,
  now: Date = new Date(),
): AgeGroup | null {
  if (dob == null) return null
  const dobDate = dob instanceof Date ? dob : new Date(dob)
  if (Number.isNaN(dobDate.getTime())) return null
  if (dobDate.getTime() > now.getTime()) return null

  const age = yearsBetween(dobDate, now)
  if (age < 18) return null
  if (age < 40) return '18-39'
  if (age < 65) return '40-64'
  return '65+'
}

/**
 * Reading context buckets for dashboard display and nocturnal-dip rules
 * (CLINICAL_SPEC Part 5). Computed from measuredAt in the user's IANA
 * timezone:
 * - 04:00–11:59  MORNING
 * - 12:00–17:59  AFTERNOON
 * - 18:00–21:59  EVENING
 * - 22:00–03:59  NOCTURNAL
 *
 * Null/invalid timezone falls back to UTC.
 */
export function getReadingContext(
  measuredAt: Date | string,
  timezone?: string | null,
): ReadingContext {
  const date = measuredAt instanceof Date ? measuredAt : new Date(measuredAt)
  const hour = getLocalHour(date, timezone)

  if (hour >= 4 && hour < 12) return 'MORNING'
  if (hour >= 12 && hour < 18) return 'AFTERNOON'
  if (hour >= 18 && hour < 22) return 'EVENING'
  return 'NOCTURNAL'
}

// ─── internals ────────────────────────────────────────────────────────────────

function yearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear()
  const monthDiff = to.getUTCMonth() - from.getUTCMonth()
  const dayDiff = to.getUTCDate() - from.getUTCDate()
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) years--
  return years
}

function getLocalHour(date: Date, timezone?: string | null): number {
  if (!timezone) return date.getUTCHours()
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).formatToParts(date)
    const hourPart = parts.find((p) => p.type === 'hour')?.value
    if (!hourPart) return date.getUTCHours()
    // Intl returns "24" instead of "0" for midnight in some locales; normalise.
    const hour = Number(hourPart) % 24
    return Number.isNaN(hour) ? date.getUTCHours() : hour
  } catch {
    return date.getUTCHours()
  }
}
