// Phase/5 absolute emergency rule — SBP ≥180 or DBP ≥120 fires BP Level 2.
// Source: CLINICAL_SPEC Part 1.2 + §V2-D BP Level 2 ladder.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

export const absoluteEmergencyRule: RuleFunction = (session) => {
  const sbp = session.systolicBP
  const dbp = session.diastolicBP
  if (sbp == null && dbp == null) return null

  const sbpTrigger = sbp != null && sbp >= 180
  const dbpTrigger = dbp != null && dbp >= 120
  if (!sbpTrigger && !dbpTrigger) return null

  const pp = getPulsePressure(sbp, dbp)

  return {
    ruleId: RULE_IDS.ABSOLUTE_EMERGENCY,
    tier: 'BP_LEVEL_2',
    mode: 'STANDARD',
    pulsePressure: pp,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbpTrigger ? sbp : dbp,
    reason: `Absolute emergency BP: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: { thresholdValue: sbpTrigger ? 180 : 120 },
  }
}
