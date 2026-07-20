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
 * N-3 (Duwaragie 2026-07-14 triage) — UNATTRIBUTED_ACCESS_LOG.
 *
 * Sibling to UnattributedSystemDisclosureDetector (which scans
 * EmailDisclosureLog). Fires on `AccessLog` rows produced by a query
 * that fired outside any CLS scope — the shape is
 *   actorType = SYSTEM_ACTOR
 *   AND actorId IS NULL
 *   AND systemActorLabel IS NULL
 *
 * Pre-N-3, `JwtStrategy.validate()` did a User.findUnique on every
 * authenticated request while the CLS actor was still unset (the CLS
 * interceptor ran AFTER guards), so every authenticated request wrote
 * one AccessLog row matching the above shape — burying genuine human
 * PHI access under the noise. Fix landed in
 * `common/cls/cls.module.ts` (middleware mount) + `jwt.strategy.ts:94`
 * (stamp actor from payload before findUnique). This detector guards
 * against a future regression: if the CLS wiring drifts, the next
 * exception-report cron surfaces it immediately.
 *
 * MEDIUM severity — a hygiene/attribution problem, not a security
 * incident. Fires ≥1 row in the window; one candidate per (modelName,
 * action) surface so a single regressed handler stays a single
 * exception no matter the traffic volume.
 */
export class UnattributedAccessLogDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.UNATTRIBUTED_ACCESS_LOG
  readonly defaultSeverity = AuditExceptionSeverity.MEDIUM

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    const rows = await ctx.prisma.accessLog.findMany({
      where: {
        actorType: 'SYSTEM_ACTOR',
        actorId: null,
        systemActorLabel: null,
        createdAt: { gte: ctx.windowStart, lt: ctx.windowEnd },
      },
      select: {
        id: true,
        modelName: true,
        action: true,
        recordId: true,
        ip: true,
        userAgent: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    // Group by (modelName, action) so a single mis-wired surface becomes one
    // exception, not N. e.g. every authenticated request pre-fix would have
    // produced `User:READ` — grouping keeps that as ONE finding to triage.
    const bySurface = new Map<string, typeof rows>()
    for (const r of rows) {
      const key = `${r.modelName}:${r.action}`
      const bucket = bySurface.get(key) ?? []
      bucket.push(r)
      bySurface.set(key, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [surface, group] of bySurface) {
      // Sample the first few for evidence; a large regression could be
      // thousands of rows — the reviewer pulls the full set with a
      // follow-up query using the sample as a starting point.
      const sample = group.slice(0, 5).map((r) => ({
        id: r.id,
        recordId: r.recordId,
        ip: r.ip,
        userAgent: r.userAgent,
        createdAt: r.createdAt.toISOString(),
      }))
      const [modelName, action] = surface.split(':') as [string, string]
      out.push({
        subjectKey: `surface:${surface}`,
        summary: `${group.length} unattributed AccessLog row(s) at ${surface} — a code path is querying outside any CLS scope`,
        evidence: {
          modelName,
          action,
          totalCount: group.length,
          sample,
          firstCreatedAt: group[0].createdAt.toISOString(),
          lastCreatedAt: group[group.length - 1].createdAt.toISOString(),
        },
        practiceContext: null,
      })
    }
    return out
  }
}
