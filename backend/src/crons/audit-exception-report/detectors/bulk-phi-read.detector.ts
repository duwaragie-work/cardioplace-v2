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
 * N7 detector — BULK_PHI_READ.
 *
 * Fires when a single USER actor accumulates >100 PHI READ AccessLog rows in
 * any 60-min sliding window inside the scan window. PHI models come from the
 * canonical inventory (`CANONICAL_PHI_MODELS`) — same set N3's conformance
 * test keeps in sync with `docs/EPHI_INVENTORY.md`, so a model added to the
 * schema without an inventory update fails CI before it can silently escape
 * this detector.
 *
 * Excludes SYSTEM_ACTOR — crons legitimately batch-read at scale (see
 * escalation-ladder scan, monthly-report cron).
 *
 * Severity: HIGH by default, CRITICAL at ≥10× threshold (an actor pulling
 * 1000+ records in an hour is not "busy clinician" — it's exfiltration).
 */
const HOUR_MS = 60 * 60 * 1000
const HOURLY_THRESHOLD = 100
const CRITICAL_ESCALATION_MULTIPLIER = 10

export class BulkPhiReadDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.BULK_PHI_READ
  readonly defaultSeverity = AuditExceptionSeverity.HIGH

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
        recordId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    // Group by actorId first; per-actor we compute the maximum count across
    // any 60-min sliding window. Also track distinct patient records + a
    // model breakdown for evidence.
    const byActor = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!r.actorId) continue
      const bucket = byActor.get(r.actorId) ?? []
      bucket.push(r)
      byActor.set(r.actorId, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [actorId, group] of byActor) {
      const peak = peakHourlyCount(group.map((r) => r.createdAt.getTime()))
      if (peak.count <= HOURLY_THRESHOLD) continue

      const distinctRecords = new Set<string>()
      const topModels: Record<string, number> = {}
      for (const r of group) {
        if (r.recordId) distinctRecords.add(`${r.modelName}:${r.recordId}`)
        topModels[r.modelName] = (topModels[r.modelName] ?? 0) + 1
      }

      out.push({
        subjectKey: `actor:${actorId}`,
        summary: `${peak.count} PHI reads in a 60-min window by actor ${actorId} (peak hour ${new Date(peak.windowStart).toISOString()})`,
        evidence: {
          actorId,
          totalReadCount: group.length,
          peakHourlyCount: peak.count,
          peakHourStart: new Date(peak.windowStart).toISOString(),
          distinctRecordCount: distinctRecords.size,
          topModels,
          firstReadAt: group[0].createdAt.toISOString(),
          lastReadAt: group[group.length - 1].createdAt.toISOString(),
        },
        // Bulk-PHI reads are actor-driven; practice attribution is delayed
        // to the reviewer joining actor→practice, since the actor's active
        // practice may differ from the records' patient practices.
        practiceContext: null,
        severityOverride:
          peak.count >= HOURLY_THRESHOLD * CRITICAL_ESCALATION_MULTIPLIER
            ? AuditExceptionSeverity.CRITICAL
            : undefined,
      })
    }
    return out
  }
}

/**
 * Given a sorted-ascending list of timestamps, return the 60-minute window
 * containing the most events plus the count. Two-pointer sweep — O(n).
 */
function peakHourlyCount(
  timestampsMs: number[],
): { windowStart: number; count: number } {
  if (timestampsMs.length === 0) return { windowStart: 0, count: 0 }
  let peak = { windowStart: timestampsMs[0], count: 1 }
  let left = 0
  for (let right = 0; right < timestampsMs.length; right++) {
    while (timestampsMs[right] - timestampsMs[left] > HOUR_MS) left++
    const count = right - left + 1
    if (count > peak.count) {
      peak = { windowStart: timestampsMs[left], count }
    }
  }
  return peak
}
