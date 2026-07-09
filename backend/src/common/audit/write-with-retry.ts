import { SpanStatusCode } from '@opentelemetry/api'
import { auditTracer } from './audit-tracer.js'

/**
 * N7 (2026-07-11) — producer-side tally sink for the DROPPED_AUDIT_WRITES
 * exception detector. Registered ONCE at boot (see AuditModule) so this file
 * stays a plain module — no DI coupling to Prisma. When null (test contexts,
 * pre-boot ordering), the tally write is silently skipped — the OTEL span +
 * console.error still fire, so the failure signal is not lost.
 *
 * Contract: the callback MUST NOT throw. writeAuditWithRetry's reportFailure
 * is already wrapped in a swallow-all catch (belt-and-suspenders), but the
 * callback should still be defensive — a broken tally writer must never
 * cascade into a second dropped audit row.
 */
export type AuditFailureTallySink = (input: {
  kind: string
  errorMessage: string
}) => void
let tallySink: AuditFailureTallySink | null = null
export function setAuditFailureTallySink(sink: AuditFailureTallySink | null): void {
  tallySink = sink
}

/**
 * Bounded-retry wrapper for audit writes (HIPAA §164.312(b) — N1).
 *
 * The AccessLog Prisma extension and AuthLog writer (auth.service.ts) both
 * had swallowed-failure paths before this — a dropped audit row was silent,
 * so the audit system couldn't detect its own failure. Duwaragie called this
 * out in the 2026-07-06 sprint brief:
 *
 *   > "surface + retry, don't silently drop. Bounded retry (e.g. 3×) on the
 *    audit write; on final failure emit a LOUD signal — an OTEL span +
 *    structured error — rather than a bare console log."
 *
 * Guarantees:
 *   • Runs `op` up to `MAX_ATTEMPTS` times with exponential backoff.
 *   • Never throws to the caller — the request path stays resilient (an audit
 *     lag must NOT 500 the user).
 *   • On final failure opens an OTEL span (`audit.write.failed`) with ERROR
 *     status + structured attributes, and emits a JSON console.error line
 *     ({ audit_write_failed: true, ...ctx }) so log-grep + alerting work
 *     without OTEL wired up.
 */

const MAX_ATTEMPTS = 3
const BACKOFF_MS = [100, 500, 2000] as const // one entry per attempt

export type AuditWriteContext =
  | { kind: 'access-log'; modelName?: string; action?: string; recordId?: string | null }
  | { kind: 'auth-log'; event: string; userId?: string | null; identifier?: string | null }
  | {
      kind: 'email-disclosure-log'
      template: string
      templateVersion: string
      patientUserId?: string | null
      recipientEmail?: string
      // N6 extension — registry-derived classification. Included in the OTEL
      // failure span so operators can filter dropped disclosures by purpose
      // or recipient bucket without re-resolving the template.
      purpose?: string
      recipientCategory?: string
    }

/**
 * Runs the audit write with bounded retry + OTEL failure reporting.
 * Fire-and-forget from the caller's perspective — always resolves, never rejects.
 *
 * @param op Callback that performs the actual write (Prisma `.create({...})`).
 *           Must return a Promise; the return value is discarded.
 * @param ctx Structured context describing what was being written, folded into
 *            the OTEL span attributes + the structured error line so an operator
 *            can locate the affected surface without reading source.
 */
export async function writeAuditWithRetry(
  op: () => Promise<unknown>,
  ctx: AuditWriteContext,
): Promise<void> {
  let lastError: unknown = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await op()
      return // success — no further work
    } catch (err) {
      lastError = err
      if (attempt < MAX_ATTEMPTS) {
        // Loop bound (attempt < MAX_ATTEMPTS) guarantees index is in range.
        await sleep(BACKOFF_MS[attempt - 1] ?? 100)
      }
    }
  }

  // All attempts exhausted — open a LOUD signal. Never rethrow, even if the
  // reporter itself blows up (belt-and-suspenders — tracer misconfig at boot
  // must never break the request path either).
  try {
    reportFailure(ctx, lastError)
  } catch {
    // Deliberately swallow — the DB write already failed AND the reporter
    // failed. Nothing more we can do without risking the request.
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function reportFailure(ctx: AuditWriteContext, err: unknown): void {
  const errorMessage = err instanceof Error ? err.message : String(err)
  const errorName = err instanceof Error ? err.name : 'UnknownError'

  // 1. OTEL span — audit-pipeline observability path.
  const span = auditTracer.startSpan('audit.write.failed', {
    attributes: {
      'audit.kind': ctx.kind,
      'audit.error.name': errorName,
      'audit.error.message': errorMessage,
      ...spanAttributesForCtx(ctx),
    },
  })
  span.setStatus({ code: SpanStatusCode.ERROR, message: errorMessage })
  if (err instanceof Error) span.recordException(err)
  span.end()

  // 2. Structured JSON console.error — greppable + alertable even when
  //    OTEL isn't wired. Log aggregators (CloudWatch, Loki) index on the
  //    top-level `audit_write_failed` key.
  // eslint-disable-next-line no-console
  console.error(
    JSON.stringify({
      audit_write_failed: true,
      kind: ctx.kind,
      error_name: errorName,
      error_message: errorMessage,
      ...spanAttributesForCtx(ctx),
      timestamp: new Date().toISOString(),
    }),
  )

  // 3. N7 — increment the per-(kind, hour) tally so the DROPPED_AUDIT_WRITES
  //    detector can find dropped rows without reading OTEL. Sink is null in
  //    tests / pre-boot; skip silently. Wrapped in its own catch so a broken
  //    tally writer can't cascade back into reportFailure's outer swallow.
  if (tallySink) {
    try {
      tallySink({ kind: ctx.kind, errorMessage })
    } catch {
      // Deliberately swallow — see contract on setAuditFailureTallySink.
    }
  }
}

function spanAttributesForCtx(ctx: AuditWriteContext): Record<string, string> {
  if (ctx.kind === 'access-log') {
    return {
      ...(ctx.modelName ? { 'audit.model': ctx.modelName } : {}),
      ...(ctx.action ? { 'audit.action': ctx.action } : {}),
      ...(ctx.recordId ? { 'audit.recordId': ctx.recordId } : {}),
    }
  }
  if (ctx.kind === 'email-disclosure-log') {
    return {
      'audit.template': ctx.template,
      'audit.templateVersion': ctx.templateVersion,
      ...(ctx.patientUserId ? { 'audit.patientUserId': ctx.patientUserId } : {}),
      ...(ctx.recipientEmail ? { 'audit.recipientEmail': ctx.recipientEmail } : {}),
      ...(ctx.purpose ? { 'audit.purpose': ctx.purpose } : {}),
      ...(ctx.recipientCategory ? { 'audit.recipientCategory': ctx.recipientCategory } : {}),
    }
  }
  return {
    'audit.event': ctx.event,
    ...(ctx.userId ? { 'audit.userId': ctx.userId } : {}),
    ...(ctx.identifier ? { 'audit.identifier': ctx.identifier } : {}),
  }
}
