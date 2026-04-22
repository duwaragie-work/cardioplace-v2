// Phase/5 pulse-pressure wide flag — physician-only Tier 3 annotation.
// Source: CLINICAL_SPEC "Pulse Pressure derived alert" appendix.
//
// Does NOT create a standalone alert row when another rule also fires — the
// orchestrator annotates the primary rule's physician message via
// RuleResult.metadata.physicianAnnotations. Use this rule only as a last-step
// fallback when no other rule fired but PP > 60.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const WIDE_PP_THRESHOLD = 60

export const pulsePressureWideRule: RuleFunction = (session) => {
  const pp = getPulsePressure(session.systolicBP, session.diastolicBP)
  if (pp == null) return null
  if (pp <= WIDE_PP_THRESHOLD) return null

  return {
    ruleId: RULE_IDS.PULSE_PRESSURE_WIDE,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: pp,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: pp,
    reason: `Pulse pressure ${pp} > ${WIDE_PP_THRESHOLD} (physician-only).`,
    metadata: { thresholdValue: WIDE_PP_THRESHOLD },
  }
}

/** Used by the orchestrator to annotate another rule's physicianMessage. */
export function getWidePulsePressureAnnotation(
  sbp: number | null,
  dbp: number | null,
): string | null {
  const pp = getPulsePressure(sbp, dbp)
  if (pp == null || pp <= WIDE_PP_THRESHOLD) return null
  return `Wide pulse pressure: ${pp} mmHg (>${WIDE_PP_THRESHOLD}).`
}
