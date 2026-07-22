import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common'
import pino, { type Logger as PinoLogger, transport as pinoTransport } from 'pino'
import type { AccessLogData } from '../prisma-extensions/access-log.extension.js'
import { NullRedactor, PHI_REDACTOR, type PhiRedactor } from './phi-redactor.js'

/**
 * V-17 (Ruhaim 2026-07-16 addendum) — Pino access-log writer with rotated
 * file transport + config seam for a future S3 destination.
 *
 * SHADOW MODE: the DB write at
 *   backend/src/common/prisma-extensions/access-log.extension.ts:413
 * is untouched; the extension makes a *shadow* call to logAccess() alongside
 * it. The DB write is only retired once the S3 destination lands with the AWS
 * migration — until then the rotated file runs beside it, not instead of it.
 *
 * Redactor unblocked 2026-07-17: the binding is now StrictMetadataRedactor
 * (was NullRedactor, which dropped everything pending V-05). AccessLogData is
 * a closed metadata-only struct, so the V-05 dependency was a comment rather
 * than a real one — see phi-redactor.ts. Writes still only happen when an
 * operator opts in via LOG_SINK; prod's default ('off') is unchanged.
 *
 * Config seam mirrors `backend/src/observability/tracing.ts` — read env,
 * guard on presence, no-op when unset. Env vars:
 *   • LOG_SINK              = 'off' (default) | 'file' | 's3'
 *   • ACCESS_LOG_FILE_DIR   = './logs/access' (default)
 *   • ACCESS_LOG_ROTATION_SIZE = pino-roll size threshold, e.g. '50m'
 *     (default). Rotation is size-based per addendum's ~100k-lines guidance
 *     (~50MB at typical JSON line size). Accepts 'k' / 'm' / 'g' suffixes.
 *   • ACCESS_LOG_S3_BUCKET  = placeholder — read but not wired (AWS pending)
 *   • ACCESS_LOG_S3_PREFIX  = placeholder — read but not wired
 *
 * Filename convention (pino-roll v4 Extension Last Format):
 *   ./logs/access/access_log.YYYY-MM-DD.N.log
 * where N is the size-rotation counter within a day.
 */
@Injectable()
export class AccessLogWriter implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AccessLogWriter.name)
  private logger: PinoLogger | null = null
  private mode: 'off' | 'file' | 's3' = 'off'

  constructor(
    @Inject(PHI_REDACTOR) private readonly redactor: PhiRedactor,
  ) {}

  /**
   * Current sink state. 'off' means dormant — either never configured, or the
   * transport failed and we fell back. Exposed because the transport can go
   * dormant ASYNCHRONOUSLY (see the 'error' handler in onModuleInit), so this
   * is the only way to assert the fail-safe actually held.
   */
  get sinkMode(): 'off' | 'file' | 's3' {
    return this.mode
  }

  onModuleInit(): void {
    const sink = (process.env.LOG_SINK ?? 'off').trim().toLowerCase()

    if (sink !== 'file' && sink !== 's3') {
      // Dormant — no logger built, no writes ever land. Matches the OTEL
      // tracing.ts pattern (silent no-op when the endpoint env is unset).
      return
    }

    this.mode = sink

    if (sink === 's3') {
      // Placeholder — the addendum says explicitly: "Do NOT provision or
      // wire the S3 bucket yet." We accept the env value so the follow-up
      // flip is a config change, not a code change; today the writer stays
      // dormant regardless.
      this.log.warn(
        'LOG_SINK=s3 is a placeholder — no S3 transport is wired yet ' +
          '(AWS migration pending). AccessLogWriter stays dormant. Set ' +
          "LOG_SINK=file for local rotation testing, or unset for prod's " +
          'current DB-write path.',
      )
      return
    }

    // sink === 'file'
    const dir = (process.env.ACCESS_LOG_FILE_DIR ?? './logs/access').trim()
    const size = (process.env.ACCESS_LOG_ROTATION_SIZE ?? '50m').trim()

    try {
      const transport = pinoTransport({
        target: 'pino-roll',
        options: {
          // pino-roll v4 Extension Last Format: given `file: 'x/access_log'`
          // + frequency='daily' + dateFormat, rotated files land as
          // access_log.YYYY-MM-DD.N.log — the addendum's example filename
          // `access_log_2026_03_03` used underscores; dots are pino-roll's
          // convention and equally date-stamped. Non-blocking naming
          // difference; flip PR can wrap with a custom `file` function if
          // strict dashes-to-underscores are needed.
          file: `${dir}/access_log`,
          frequency: 'daily',
          dateFormat: 'yyyy-MM-dd',
          size,
          mkdir: true,
        },
      })

      // pino-roll validates the filename INSIDE the worker thread, so a bad
      // ACCESS_LOG_FILE_DIR surfaces as an async 'error' on the ThreadStream
      // — never as a throw from pinoTransport() above. Without this handler
      // the event is unhandled and Node takes the whole process down, which
      // is precisely the failure the catch below claims to prevent. Same
      // dormancy semantics as the sync path: log loudly, no partial state.
      transport.on('error', (err: unknown) => {
        this.log.error(
          `AccessLogWriter transport failed for LOG_SINK=file at ${dir} — ` +
            'writer is now dormant. Prod DB access-log path unaffected.',
          err instanceof Error ? err.stack : String(err),
        )
        this.mode = 'off'
        this.logger = null
      })

      this.logger = pino({}, transport)
    } catch (err) {
      // Never let a bad LOG_SINK config crash the app — the DB write path is
      // still active. Log LOUDLY so an operator notices the misconfigured
      // sink and the writer stays dormant (no partial state).
      this.log.error(
        `AccessLogWriter init failed for LOG_SINK=file at ${dir} — writer ` +
          'stays dormant. Prod DB access-log path unaffected.',
        err instanceof Error ? err.stack : String(err),
      )
      this.mode = 'off'
      this.logger = null
      return
    }

    if (this.redactor instanceof NullRedactor) {
      // No longer the default (StrictMetadataRedactor is, since 2026-07-17), so
      // reaching this means someone deliberately rebound it. Keep the warning:
      // an operator who set LOG_SINK=file deserves to know the file will stay
      // empty rather than assume the sink is broken.
      this.log.warn(
        'LOG_SINK=file is active but PHI_REDACTOR is bound to NullRedactor — ' +
          'every logAccess() call will be silently dropped. Rebind to ' +
          'StrictMetadataRedactor to activate writes.',
      )
    } else {
      this.log.log(
        `AccessLogWriter active — LOG_SINK=file, dir=${dir}, size=${size}`,
      )
    }
  }

  /**
   * Emit one access-log record. Dormant path (LOG_SINK unset/off/s3) returns
   * immediately with no side effects. Live path passes the payload through
   * the bound PhiRedactor; a null return drops the record.
   *
   * Fire-and-forget by design — Pino's file transport runs in a worker
   * thread with async flush, so this call itself never throws or awaits.
   */
  logAccess(payload: AccessLogData): void {
    if (!this.logger || this.mode !== 'file') return
    const redacted = this.redactor.redact(payload)
    if (redacted === null) return
    this.logger.info(redacted)
  }

  onModuleDestroy(): void {
    // Give the async worker thread a chance to flush before Nest tears down.
    // pino-roll's SonicBoom backend flushes on stream end; explicit flush()
    // is a belt-and-braces call. Errors are swallowed (nothing to do on
    // shutdown).
    try {
      this.logger?.flush()
    } catch {
      /* swallow — shutdown path */
    }
  }
}
