import { Injectable, Logger, type OnModuleInit } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import { setAuditFailureTallySink } from './write-with-retry.js'

/**
 * N7 (2026-07-11) — producer-side counter for the DROPPED_AUDIT_WRITES
 * exception detector (HIPAA §164.308(a)(1)(ii)(D)).
 *
 * When `writeAuditWithRetry` exhausts its retries, N1 emits an OTEL span +
 * structured console.error. That's observable but ephemeral — an exception
 * detector needs a queryable footprint. This service is that footprint:
 * onModuleInit it registers a sink on the shared `write-with-retry` module,
 * which the reporter calls after the OTEL + console.error side-effects.
 * Every call upserts a per-(kind, hour) row on `AuditWriteFailureTally` and
 * increments `count`.
 *
 * Hourly-bucket (not per-drop) is a deliberate compromise:
 *   • bounded write pressure — one audit outage doesn't spike thousands of
 *     rows,
 *   • the detector still gets "how bad, how long" resolution.
 *
 * Producer failure mode: if the underlying DB is unhealthy (the reason the
 * original audit write failed), this upsert can fail too. Acceptable — OTEL
 * + console.error still fire; we lose one signal, not all three.
 */
@Injectable()
export class AuditFailureTallyService implements OnModuleInit {
  private readonly logger = new Logger(AuditFailureTallyService.name)

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit(): void {
    setAuditFailureTallySink(({ kind, errorMessage }) => {
      // Fire-and-forget — do NOT await. The writer must not block the
      // reportFailure path (which is itself already off the request path).
      // Any exception here is swallowed by the sink caller's outer catch.
      void this.record(kind, errorMessage)
    })
    this.logger.log('AuditFailureTallySink registered')
  }

  /**
   * Idempotently increment the (kind, hour) bucket. Rounds `now` DOWN to
   * the start of the hour in UTC so all failures in the same clock hour
   * land on the same row.
   *
   * Exposed (not private) so tests can drive the write path without going
   * through the sink indirection.
   */
  async record(kind: string, errorMessage: string, now: Date = new Date()): Promise<void> {
    const hourBucket = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        now.getUTCHours(),
        0,
        0,
        0,
      ),
    )
    // Trim to keep the payload bounded (per schema comment ≤500 chars).
    const trimmed =
      errorMessage.length > 500 ? `${errorMessage.slice(0, 499)}…` : errorMessage

    try {
      await this.prisma.auditWriteFailureTally.upsert({
        where: { kind_hourBucket: { kind, hourBucket } },
        create: { kind, hourBucket, count: 1, lastError: trimmed },
        update: { count: { increment: 1 }, lastError: trimmed },
      })
    } catch (err) {
      // Swallow — the DB was already unhealthy on the caller's write path.
      // Emit a structured console line so operators still see it, but do
      // not throw; the reporter's outer try/catch would swallow anyway.
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          audit_tally_write_failed: true,
          kind,
          error_message: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        }),
      )
    }
  }
}
