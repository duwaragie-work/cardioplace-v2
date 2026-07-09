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
 * N7 detector — REPEATED_FAILED_AUTH.
 *
 * Fires when the same `identifier` accumulates ≥5 failed AuthLog rows in the
 * window. The threshold aligns with the OTP module's own 5-attempt lockout
 * (docs/AUTH_MODULE.md:417) — below 5 the auth path hasn't yet fired its
 * lockout; ≥5 means the boundary has been crossed at least once.
 *
 * Severity: HIGH by default, CRITICAL if the failed count crosses 50 in the
 * window (sustained credential-stuffing pattern).
 *
 * READ-ONLY against AuthLog — OTP send/verify code paths are off-limits
 * per the standing rule. Filters out the dev OTP `666666` at query time so
 * dev traffic never triggers the detector.
 */
const FAILURE_THRESHOLD = 5
const CRITICAL_ESCALATION_THRESHOLD = 50

export class RepeatedFailedAuthDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.REPEATED_FAILED_AUTH
  readonly defaultSeverity = AuditExceptionSeverity.HIGH

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    // Prisma doesn't support groupBy on a nullable column with count, so we
    // hydrate the rows once and aggregate in TS. The window is 24h and the
    // failure surface is small in practice; we sacrifice some SQL elegance
    // for portability + testability against the mocked Prisma factory.
    const rows = await ctx.prisma.authLog.findMany({
      where: {
        success: false,
        createdAt: { gte: ctx.windowStart, lt: ctx.windowEnd },
        identifier: { not: null },
        // Dev OTP is off-limits per standing rule — filter out at query time
        // so dev traffic never trips the detector. Both the value and the
        // '666666' identifier a caller might send are excluded.
        NOT: { identifier: '666666' },
      },
      select: {
        identifier: true,
        userId: true,
        ipAddress: true,
        event: true,
        errorCode: true,
        practiceContext: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    if (rows.length === 0) return []

    const byIdentifier = new Map<string, typeof rows>()
    for (const r of rows) {
      if (!r.identifier) continue
      const bucket = byIdentifier.get(r.identifier) ?? []
      bucket.push(r)
      byIdentifier.set(r.identifier, bucket)
    }

    const out: ExceptionCandidate[] = []
    for (const [identifier, group] of byIdentifier) {
      if (group.length < FAILURE_THRESHOLD) continue

      const distinctIps = new Set<string>()
      const distinctUserIds = new Set<string>()
      const eventBreakdown: Record<string, number> = {}
      for (const r of group) {
        if (r.ipAddress) distinctIps.add(r.ipAddress)
        if (r.userId) distinctUserIds.add(r.userId)
        eventBreakdown[r.event] = (eventBreakdown[r.event] ?? 0) + 1
      }

      // Most-frequent practiceContext among the failed rows — falls back to
      // null when nothing carried practice context (identifier we've never
      // seen before, no session yet).
      const practiceContext = mostCommon(
        group.map((r) => r.practiceContext).filter((x): x is string => !!x),
      )

      out.push({
        subjectKey: `identifier:${identifier}`,
        summary: `${group.length} failed auth attempt(s) for identifier ${identifier} across ${distinctIps.size} IP(s)`,
        evidence: {
          identifier,
          failedCount: group.length,
          distinctIpCount: distinctIps.size,
          distinctUserIds: [...distinctUserIds],
          eventBreakdown,
          firstFailAt: group[0].createdAt.toISOString(),
          lastFailAt: group[group.length - 1].createdAt.toISOString(),
        },
        practiceContext,
        severityOverride:
          group.length >= CRITICAL_ESCALATION_THRESHOLD
            ? AuditExceptionSeverity.CRITICAL
            : undefined,
      })
    }
    return out
  }
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  let best: string | null = null
  let bestCount = 0
  for (const [v, n] of counts) {
    if (n > bestCount) {
      best = v
      bestCount = n
    }
  }
  return best
}
