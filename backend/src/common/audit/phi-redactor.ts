import { Injectable } from '@nestjs/common'
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
