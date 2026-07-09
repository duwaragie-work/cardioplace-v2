import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
} from '../../../generated/prisma/enums.js'
import type {
  DetectorContext,
  ExceptionCandidate,
  ExceptionDetector,
} from '../detector.types.js'

/**
 * N7 detector — DROPPED_AUDIT_WRITES.
 *
 * Reads the producer-side `AuditWriteFailureTally` (populated by
 * `writeAuditWithRetry.reportFailure` via `AuditFailureTallyService`) for any
 * (kind, hourBucket) with count > 0 inside the window. One candidate per
 * `kind` — a single audit outage that drops 5000 access-log rows across the
 * night becomes one exception grouped by kind, not one per hour.
 *
 * CRITICAL severity always — a dropped audit row is exactly the failure
 * mode HIPAA §164.312(b) is asking us to detect. Practice context is null:
 * these rows had no observability so no practice attribution is possible.
 */
export class DroppedAuditWritesDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.DROPPED_AUDIT_WRITES
  readonly defaultSeverity = AuditExceptionSeverity.CRITICAL

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    const rows = await ctx.prisma.auditWriteFailureTally.findMany({
      where: {
        hourBucket: { gte: ctx.windowStart, lt: ctx.windowEnd },
        count: { gt: 0 },
      },
      orderBy: { hourBucket: 'asc' },
    })
    if (rows.length === 0) return []

    const byKind = new Map<string, typeof rows>()
    for (const r of rows) {
      const bucket = byKind.get(r.kind) ?? []
      bucket.push(r)
      byKind.set(r.kind, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [kind, buckets] of byKind) {
      const totalCount = buckets.reduce((sum, r) => sum + r.count, 0)
      const hourlyBreakdown = buckets.map((r) => ({
        hour: r.hourBucket.toISOString(),
        count: r.count,
        lastError: r.lastError,
      }))
      out.push({
        subjectKey: `kind:${kind}`,
        summary: `${totalCount} dropped ${kind} audit write(s) across ${buckets.length} hour bucket(s)`,
        evidence: {
          kind,
          totalCount,
          bucketCount: buckets.length,
          hourlyBreakdown,
          firstBucket: buckets[0].hourBucket.toISOString(),
          lastBucket: buckets[buckets.length - 1].hourBucket.toISOString(),
        },
        practiceContext: null,
      })
    }
    return out
  }
}
