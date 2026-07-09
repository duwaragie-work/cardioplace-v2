import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
} from '../../../generated/prisma/enums.js'
import { CANONICAL_PHI_MODELS } from '../../../common/prisma-extensions/phi-inventory.js'
import type {
  DetectorContext,
  ExceptionCandidate,
  ExceptionDetector,
} from '../detector.types.js'

/**
 * N7 detector — OFF_HOURS_PHI_ACCESS.
 *
 * Fires when a USER actor logs >5 PHI reads inside the off-hours band —
 * pre-06:00 or post-22:00 ET on a weekday, or ANY time on the weekend —
 * during the scan window. Excludes SYSTEM_ACTOR (crons legitimately run
 * overnight).
 *
 * MEDIUM severity — a clinician working late is a plausible explanation;
 * the row surfaces the pattern for the reviewer to sanity-check against the
 * roster, not to auto-flag misuse.
 *
 * Timezone note: America/New_York (Ward 7 & 8 DC pilot) is the operating
 * timezone. Uses `Intl.DateTimeFormat` (built in — no luxon dep) to convert
 * each UTC timestamp into an ET calendar date/hour/weekday so DST shifts
 * are handled correctly.
 */
const OFF_HOURS_THRESHOLD = 5
const BUSINESS_HOURS_TIMEZONE = 'America/New_York'

export class OffHoursPhiAccessDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.OFF_HOURS_PHI_ACCESS
  readonly defaultSeverity = AuditExceptionSeverity.MEDIUM

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    const rows = await ctx.prisma.accessLog.findMany({
      where: {
        action: 'READ',
        actorType: 'USER',
        actorId: { not: null },
        modelName: { in: [...CANONICAL_PHI_MODELS] },
        createdAt: { gte: ctx.windowStart, lt: ctx.windowEnd },
      },
      select: {
        actorId: true,
        modelName: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    // Filter to off-hours-in-ET first, then group by actor. Small windows
    // over a small table — the reads are cheap.
    const offHoursByActor = new Map<string, Array<{ modelName: string; at: Date }>>()
    for (const r of rows) {
      if (!isOffHours(r.createdAt)) continue
      if (!r.actorId) continue
      const bucket = offHoursByActor.get(r.actorId) ?? []
      bucket.push({ modelName: r.modelName, at: r.createdAt })
      offHoursByActor.set(r.actorId, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [actorId, group] of offHoursByActor) {
      if (group.length <= OFF_HOURS_THRESHOLD) continue

      const modelBreakdown: Record<string, number> = {}
      const samples: string[] = []
      for (const g of group) {
        modelBreakdown[g.modelName] = (modelBreakdown[g.modelName] ?? 0) + 1
        if (samples.length < 5) samples.push(g.at.toISOString())
      }

      out.push({
        subjectKey: `actor:${actorId}`,
        summary: `${group.length} off-hours PHI read(s) by actor ${actorId} in ${BUSINESS_HOURS_TIMEZONE}`,
        evidence: {
          actorId,
          offHoursReadCount: group.length,
          businessHoursTimezone: BUSINESS_HOURS_TIMEZONE,
          modelBreakdown,
          sampleTimestamps: samples,
        },
        // Practice attribution is not available on AccessLog directly; the
        // reviewer will join actor→practice in the UI. Kept null so we
        // don't over-attribute to whichever practice the actor happened
        // to touch first.
        practiceContext: null,
      })
    }
    return out
  }
}

/**
 * True if `at` (a UTC Date) falls outside 06:00–22:00 on a weekday in ET,
 * or on a Saturday/Sunday in ET (any hour). Uses `Intl.DateTimeFormat` so
 * DST is respected — a 22:00 UTC read is 18:00 ET in November (in-hours)
 * but 17:00 ET in July (still in-hours) — both fine.
 *
 * Exported for the detector's unit spec to smoke.
 */
export function isOffHours(at: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_HOURS_TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? ''
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '00'
  // en-US with hour12:false emits "24" for midnight; normalize to 0.
  const hour = Number(hourStr) % 24

  const isWeekend = weekday === 'Sat' || weekday === 'Sun'
  if (isWeekend) return true
  return hour < 6 || hour >= 22
}
