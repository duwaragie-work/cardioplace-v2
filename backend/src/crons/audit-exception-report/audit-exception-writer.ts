import { Injectable } from '@nestjs/common'
import type { Prisma } from '../../generated/prisma/client.js'
import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
  AuditExceptionStatus,
} from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import type { ExceptionCandidate } from './detector.types.js'

export interface WriteExceptionInput {
  detectorId: AuditExceptionDetectorId
  defaultSeverity: AuditExceptionSeverity
  candidate: ExceptionCandidate
  windowStart: Date
  windowEnd: Date
}

export type UpsertResult =
  | { outcome: 'created'; id: string }
  | { outcome: 'updated'; id: string }
  | { outcome: 'sticky-skipped'; id: string; status: AuditExceptionStatus }

/**
 * N7 exception writer — the single write path for AuditException rows. Owns
 * idempotency, sticky-resolved semantics, and evidence-blob shape.
 *
 * Idempotency key: `${detectorId}:${subjectKey}:${windowStart.toISOString()}`.
 * A re-run of the cron in the same window UPDATES the row (evidence +
 * updatedAt + summary + severity) instead of inserting a duplicate.
 *
 * Sticky-resolved semantics: rows in `RESOLVED` or `FALSE_POSITIVE` status
 * are treated as regulator-dispositioned. A re-fire with the same
 * idempotency key is a no-op — the writer returns `sticky-skipped` and
 * does NOT re-open the row. This lets the reviewer's decision persist
 * even when the underlying pattern keeps recurring.
 *
 * Detectors do NOT invoke this — the cron does. Splitting the plugin
 * (scan → candidates) from the persistence (writer → rows) keeps
 * idempotency logic in one place, so a new detector only worries about
 * pattern detection.
 */
@Injectable()
export class AuditExceptionWriter {
  constructor(private readonly prisma: PrismaService) {}

  buildIdempotencyKey(
    detectorId: AuditExceptionDetectorId,
    subjectKey: string,
    windowStart: Date,
  ): string {
    return `${detectorId}:${subjectKey}:${windowStart.toISOString()}`
  }

  async upsert(input: WriteExceptionInput): Promise<UpsertResult> {
    const { detectorId, defaultSeverity, candidate, windowStart, windowEnd } = input
    const idempotencyKey = this.buildIdempotencyKey(
      detectorId,
      candidate.subjectKey,
      windowStart,
    )
    const severity = candidate.severityOverride ?? defaultSeverity

    // Sticky-resolved guard — do not touch rows the reviewer has finalised.
    const existing = await this.prisma.auditException.findUnique({
      where: { idempotencyKey },
      select: { id: true, status: true },
    })
    if (
      existing &&
      (existing.status === AuditExceptionStatus.RESOLVED ||
        existing.status === AuditExceptionStatus.FALSE_POSITIVE)
    ) {
      return { outcome: 'sticky-skipped', id: existing.id, status: existing.status }
    }

    // Evidence blob — Prisma accepts a plain object here; the schema column
    // is JSONB. Cast to Prisma.InputJsonValue rather than JSON.stringify so
    // nested objects keep their structure in Postgres.
    const evidence = candidate.evidence as unknown as Prisma.InputJsonValue

    if (existing) {
      // Update path — OPEN or ACKNOWLEDGED row for the same window; refresh
      // the evidence + summary + severity. Status is preserved (reviewer
      // may have already acknowledged).
      const updated = await this.prisma.auditException.update({
        where: { id: existing.id },
        data: {
          severity,
          summary: candidate.summary.slice(0, 200),
          evidence,
          practiceContext: candidate.practiceContext,
          windowEnd,
        },
        select: { id: true },
      })
      return { outcome: 'updated', id: updated.id }
    }

    const created = await this.prisma.auditException.create({
      data: {
        detectorId,
        severity,
        // status defaults to OPEN via Prisma default.
        windowStart,
        windowEnd,
        summary: candidate.summary.slice(0, 200),
        evidence,
        practiceContext: candidate.practiceContext,
        idempotencyKey,
      },
      select: { id: true },
    })
    return { outcome: 'created', id: created.id }
  }
}
