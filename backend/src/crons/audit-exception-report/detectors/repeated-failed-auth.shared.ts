import type { Prisma } from '../../../generated/prisma/client.js'
import { AuditExceptionSeverity } from '../../../generated/prisma/enums.js'
import type { ExceptionCandidate } from '../detector.types.js'

/**
 * Shared repeated-failed-auth logic, consumed by BOTH the daily batch detector
 * (repeated-failed-auth.detector.ts) and the real-time evaluator
 * (realtime-failed-auth.service.ts). Extracted so the threshold, the dev-OTP
 * exclusion, the query shape, and the candidate-building are defined ONCE — two
 * copies are how the batch and real-time paths silently diverge.
 */

/**
 * ≥5 failed attempts for one identifier in the window. Aligned to the OTP
 * module's own 5-attempt lockout (docs/AUTH_MODULE.md:417).
 */
export const FAILURE_THRESHOLD = 5

/** Sustained credential-stuffing — bumps severity HIGH → CRITICAL. */
export const CRITICAL_ESCALATION_THRESHOLD = 50

/**
 * The dev perma-OTP identifier. Excluded from BOTH paths so dev traffic never
 * trips the detector — the standing rule keeps OTP send/verify code off-limits.
 */
export const DEV_OTP_IDENTIFIER = '666666'

/** Prisma `where` for failed AuthLog rows in a window, dev-OTP excluded. */
export function failedAuthWhere(
  windowStart: Date,
  windowEnd: Date,
): Prisma.AuthLogWhereInput {
  return {
    success: false,
    createdAt: { gte: windowStart, lt: windowEnd },
    identifier: { not: null },
    NOT: { identifier: DEV_OTP_IDENTIFIER },
  }
}

/** The column projection both paths hydrate. */
export const FAILED_AUTH_SELECT = {
  identifier: true,
  userId: true,
  ipAddress: true,
  event: true,
  errorCode: true,
  practiceContext: true,
  createdAt: true,
} as const

export interface FailedAuthRow {
  identifier: string | null
  userId: string | null
  ipAddress: string | null
  event: string
  errorCode: string | null
  practiceContext: string | null
  createdAt: Date
}

/**
 * Group failed-auth rows by identifier and emit one ExceptionCandidate per
 * identifier that has crossed FAILURE_THRESHOLD. Pure — no I/O — so it is
 * identical whether the rows came from a 24h batch scan or a single-identifier
 * real-time query. Behaviour is byte-for-byte the original detector's.
 */
export function aggregateFailedAuth(rows: FailedAuthRow[]): ExceptionCandidate[] {
  if (rows.length === 0) return []

  const byIdentifier = new Map<string, FailedAuthRow[]>()
  for (const r of rows) {
    if (!r.identifier) continue
    const bucket = byIdentifier.get(r.identifier) ?? []
    bucket.push(r)
    byIdentifier.set(r.identifier, bucket)
  }

  const out: ExceptionCandidate[] = []
  for (const [identifier, group] of byIdentifier) {
    if (group.length < FAILURE_THRESHOLD) continue

    // rows arrive ordered by createdAt asc; first/last are the window bounds.
    const ordered = [...group].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
    )

    const distinctIps = new Set<string>()
    const distinctUserIds = new Set<string>()
    const eventBreakdown: Record<string, number> = {}
    for (const r of ordered) {
      if (r.ipAddress) distinctIps.add(r.ipAddress)
      if (r.userId) distinctUserIds.add(r.userId)
      eventBreakdown[r.event] = (eventBreakdown[r.event] ?? 0) + 1
    }

    const practiceContext = mostCommon(
      ordered.map((r) => r.practiceContext).filter((x): x is string => !!x),
    )

    out.push({
      subjectKey: `identifier:${identifier}`,
      summary: `${ordered.length} failed auth attempt(s) for identifier ${identifier} across ${distinctIps.size} IP(s)`,
      evidence: {
        identifier,
        failedCount: ordered.length,
        distinctIpCount: distinctIps.size,
        distinctUserIds: [...distinctUserIds],
        eventBreakdown,
        firstFailAt: ordered[0].createdAt.toISOString(),
        lastFailAt: ordered[ordered.length - 1].createdAt.toISOString(),
      },
      practiceContext,
      severityOverride:
        ordered.length >= CRITICAL_ESCALATION_THRESHOLD
          ? AuditExceptionSeverity.CRITICAL
          : undefined,
    })
  }
  return out
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
