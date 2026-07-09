import type {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
} from '../../generated/prisma/enums.js'
import type { PrismaService } from '../../prisma/prisma.service.js'

/**
 * N7 — shared types for the audit-exception detector plugin surface
 * (HIPAA §164.308(a)(1)(ii)(D)).
 *
 * Every detector is a class implementing `ExceptionDetector`. The cron loops
 * through `ALL_DETECTORS`, calls `scan(ctx)` on each, and feeds the returned
 * candidates to `AuditExceptionWriter.upsert`. Detectors do NOT write rows
 * themselves — that split keeps idempotency logic in one place.
 */

/**
 * Everything a detector needs to run one scan. Passed by the cron.
 */
export interface DetectorContext {
  prisma: PrismaService
  /** "Now" at cron-fire time. */
  now: Date
  /** Start of the scan window (typically `now - 24h`). */
  windowStart: Date
  /** End of the scan window (typically `now`). */
  windowEnd: Date
}

/**
 * One suspicious pattern found. The writer converts a candidate into an
 * `AuditException` row (or updates an existing one with the same idempotency
 * key). Detectors never touch `AuditException` directly.
 */
export interface ExceptionCandidate {
  /**
   * Stable subject the exception is ABOUT — an `actorId`, an `identifier`,
   * or a synthetic key like `hourly-tally`. Combined with `detectorId` +
   * `windowStart` to build the idempotency key so a re-run of the cron in
   * the same window UPDATES the row, never inserts a duplicate.
   *
   * Two candidates from the same detector with the same subjectKey in the
   * same window are a bug in the detector — MUST NOT happen.
   */
  subjectKey: string
  /**
   * Human-readable summary (≤200 chars). Renders in Lakshitha's L3 worklist
   * row before the reviewer opens the evidence blob. Structured, no PHI.
   */
  summary: string
  /**
   * Detector-specific structured payload. Numeric aggregates, record IDs,
   * principal labels only — NEVER patient names / DOBs / narrative.
   */
  evidence: Record<string, unknown>
  /**
   * Practice context so per-practice ops routing works. Null when the
   * detector is system-wide (DROPPED_AUDIT_WRITES) or the target's practice
   * cannot be resolved.
   */
  practiceContext: string | null
  /**
   * Overrides the detector's `defaultSeverity` when the candidate warrants
   * escalation — e.g. BULK_PHI_READ bumps to CRITICAL at >10× threshold.
   */
  severityOverride?: AuditExceptionSeverity
}

/**
 * The plugin contract every detector implements. Kept intentionally small:
 *   • `id` — the enum value written to `AuditException.detectorId`. A
 *     static-drift guard test asserts every `ExceptionDetector.id` in
 *     `ALL_DETECTORS` matches an `AuditExceptionDetectorId` enum value.
 *   • `defaultSeverity` — used when a candidate doesn't set an override.
 *   • `scan(ctx)` — returns 0+ candidates. Failure semantics: the cron
 *     wraps every scan in a try/catch and logs the error, so a single
 *     detector's crash does NOT abort the whole scan. Detectors should
 *     still defend at their own boundaries where reasonable.
 */
export interface ExceptionDetector {
  readonly id: AuditExceptionDetectorId
  readonly defaultSeverity: AuditExceptionSeverity
  scan(ctx: DetectorContext): Promise<ExceptionCandidate[]>
}
