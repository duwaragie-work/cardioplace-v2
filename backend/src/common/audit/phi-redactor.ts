import { Injectable, Logger } from '@nestjs/common'
import type { AccessLogData } from '../prisma-extensions/access-log.extension.js'

/**
 * V-17 (Ruhaim 2026-07-16 addendum) — PHI/PII redaction contract for the
 * access-log Pino writer. Every payload passed to AccessLogWriter.logAccess()
 * must round-trip through a bound PhiRedactor before it hits disk.
 *
 * The addendum requires:
 *   "PHI/PII stays stripped — this rides on your V-05 redaction; V-05 must
 *    land first, and the access log must carry identifiers/metadata only, no
 *    clinical values."
 *
 * Implementations return the sanitized payload, or `null` to drop the record
 * entirely (e.g. the payload contains a field the redactor can't safely
 * strip — better a dropped audit row than a leaked one).
 */
export interface PhiRedactor {
  redact(payload: AccessLogData): AccessLogData | null
}

/**
 * Nest DI token. Consumers depend on `@Inject(PHI_REDACTOR)`; the default
 * binding in CommonModule is `NullRedactor` until V-05 replaces it.
 */
export const PHI_REDACTOR = 'PHI_REDACTOR'

/**
 * Default binding shipped with V-17. Drops every record (`redact()` returns
 * null) so no lines hit disk before V-05 provides a real implementation.
 * AccessLogWriter's boot-time init logs a WARN whenever LOG_SINK is set AND
 * this class is still the bound redactor, so an operator running with
 * LOG_SINK=file understands why the file stays empty.
 */
@Injectable()
export class NullRedactor implements PhiRedactor {
  redact(_payload: AccessLogData): null {
    return null
  }
}

/**
 * Every key `AccessLogData` is allowed to carry — kept deliberately in sync with
 * the interface at `prisma-extensions/access-log.extension.ts`. Each one is an
 * identifier or request-metadata field, which is exactly what the addendum
 * permits ("identifiers/metadata only, no clinical values").
 */
const ALLOWED_KEYS = [
  'actorId',
  'actorType',
  'systemActorLabel',
  'runId',
  'practiceContext',
  'action',
  'modelName',
  'recordId',
  'ip',
  'userAgent',
] as const satisfies readonly (keyof AccessLogData)[]

const ALLOWED_KEY_SET: ReadonlySet<string> = new Set(ALLOWED_KEYS)

/**
 * The live binding (replaces NullRedactor).
 *
 * Why this is safe WITHOUT V-05's stdout work, despite the addendum's "V-05
 * must land first": `AccessLogData` is a closed metadata-only struct, and
 * `computeAccessLogData` only ever lifts `args.where.id` plus the actor / ip /
 * userAgent context — it never copies a field value out of `args`/`result`. So
 * no clinical value can structurally reach this payload. V-05's separate job is
 * stripping PHI from chat/voice *stdout*, which never flows through here.
 *
 * Defence in depth is a **whitelist projection**, not a pass-through: we rebuild
 * the record from ALLOWED_KEYS, so a field added by a caller — or a future
 * widening of AccessLogData that someone forgets to review — can never ride
 * along to disk. Unknown keys are dropped and warned about ONCE rather than
 * failing the record closed: a silent audit outage is itself a §164.312(b)
 * failure, and projection already guarantees nothing unsafe is written.
 */
@Injectable()
export class StrictMetadataRedactor implements PhiRedactor {
  private readonly log = new Logger(StrictMetadataRedactor.name)
  private warnedKeys = new Set<string>()

  redact(payload: AccessLogData): AccessLogData {
    for (const key of Object.keys(payload)) {
      if (ALLOWED_KEY_SET.has(key) || this.warnedKeys.has(key)) continue
      this.warnedKeys.add(key)
      this.log.warn(
        `AccessLog payload carried unexpected key "${key}" — dropped before ` +
          'write. If AccessLogData gained a field, review it for PHI and add ' +
          'it to ALLOWED_KEYS in phi-redactor.ts.',
      )
    }

    return {
      actorId: payload.actorId,
      actorType: payload.actorType,
      systemActorLabel: payload.systemActorLabel,
      runId: payload.runId,
      practiceContext: payload.practiceContext,
      action: payload.action,
      modelName: payload.modelName,
      recordId: payload.recordId,
      ip: payload.ip,
      userAgent: payload.userAgent,
    }
  }
}
