import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
} from '../../../generated/prisma/enums.js'
import type {
  DetectorContext,
  ExceptionCandidate,
  ExceptionDetector,
} from '../detector.types.js'
import {
  aggregateFailedAuth,
  failedAuthWhere,
  FAILED_AUTH_SELECT,
} from './repeated-failed-auth.shared.js'

/**
 * N7 detector — REPEATED_FAILED_AUTH.
 *
 * Fires when the same `identifier` accumulates ≥5 failed AuthLog rows in the
 * window. The threshold aligns with the OTP module's own 5-attempt lockout
 * (docs/AUTH_MODULE.md:417). Severity: HIGH by default, CRITICAL past 50.
 *
 * READ-ONLY against AuthLog — OTP send/verify code paths are off-limits per the
 * standing rule. The threshold, dev-OTP exclusion, query shape, and candidate
 * building all live in repeated-failed-auth.shared.ts, shared verbatim with the
 * real-time evaluator (realtime-failed-auth.service.ts) so the daily batch and
 * the near-real-time path can never drift apart.
 */
export class RepeatedFailedAuthDetector implements ExceptionDetector {
  readonly id = AuditExceptionDetectorId.REPEATED_FAILED_AUTH
  readonly defaultSeverity = AuditExceptionSeverity.HIGH

  async scan(ctx: DetectorContext): Promise<ExceptionCandidate[]> {
    // Prisma doesn't support groupBy on a nullable column with count, so we
    // hydrate the rows once and aggregate in TS. The window is 24h and the
    // failure surface is small in practice.
    const rows = await ctx.prisma.authLog.findMany({
      where: failedAuthWhere(ctx.windowStart, ctx.windowEnd),
      select: FAILED_AUTH_SELECT,
      orderBy: { createdAt: 'asc' },
    })
    return aggregateFailedAuth(rows)
  }
}
