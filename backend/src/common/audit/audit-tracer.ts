import { trace } from '@opentelemetry/api'

/**
 * OTEL tracer for the audit subsystem — mirrors the voice.service.ts pattern
 * (backend/src/voice/voice.service.ts:9 uses `trace.getTracer('cardioplace.voice')`).
 *
 * Emits `audit.write.failed` spans with `SpanStatusCode.ERROR` when the
 * retry loop in `write-with-retry.ts` exhausts its attempts. Failures are
 * surfaced through the existing OTEL pipeline (observability/tracing.ts) —
 * LangSmith / LangSmith-OTLP endpoints, or any OTLP/HTTP collector — so a
 * silent audit-write outage becomes observable without a net-new MeterProvider.
 *
 * Duwaragie decision (2026-07-06 sprint brief): metrics/MeterProvider are net
 * new and out of MVP scope. Spans + structured console.error are sufficient
 * for the "audit pipeline is failing" signal. If we ever need a coverage% or
 * write-success-rate dashboard, that's a separate task (Humaira Best-Practice
 * b4).
 */
export const auditTracer = trace.getTracer('cardioplace.audit')
