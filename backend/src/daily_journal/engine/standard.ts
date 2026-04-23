// Phase/5 standard-mode thresholds — AHA 2025 table + age-65 override.
// Source: CLINICAL_SPEC Part 1.1 (age groups) + Part 1.2 (thresholds).

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const STANDARD_SEVERE_STAGE2_SBP = 160
const STANDARD_SEVERE_STAGE2_DBP = 100
const STANDARD_LOW_SBP = 90
const AGE_65_LOW_SBP = 100

/** Level 1 HIGH — SBP ≥160 or DBP ≥100 (Severe Stage 2). */
export const standardL1HighRule: RuleFunction = (session, ctx) => {
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (sbp == null && dbp == null) return null

  const sbpHit = sbp != null && sbp >= STANDARD_SEVERE_STAGE2_SBP
  const dbpHit = dbp != null && dbp >= STANDARD_SEVERE_STAGE2_DBP
  if (!sbpHit && !dbpHit) return null

  return {
    ruleId: RULE_IDS.STANDARD_L1_HIGH,
    tier: 'BP_LEVEL_1_HIGH',
    mode: ctx.preDay3Mode ? 'STANDARD' : ctx.personalizedEligible ? 'PERSONALIZED' : 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbpHit ? sbp : dbp,
    reason: `Standard L1 High: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: {
      thresholdValue: sbpHit
        ? STANDARD_SEVERE_STAGE2_SBP
        : STANDARD_SEVERE_STAGE2_DBP,
    },
  }
}

/**
 * Level 1 LOW — standard SBP <90, or SBP <100 for 65+ patients.
 * The 65+ override uses ctx.ageGroup (derived from dateOfBirth).
 */
export const standardL1LowRule: RuleFunction = (session, ctx) => {
  const { systolicBP: sbp } = session
  if (sbp == null) return null

  const isElderly = ctx.ageGroup === '65+'
  const lowerBound = isElderly ? AGE_65_LOW_SBP : STANDARD_LOW_SBP

  if (sbp >= lowerBound) return null

  return {
    ruleId: isElderly ? RULE_IDS.AGE_65_LOW : RULE_IDS.STANDARD_L1_LOW,
    tier: 'BP_LEVEL_1_LOW',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(sbp, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbp,
    reason: isElderly
      ? `Age 65+ SBP <${AGE_65_LOW_SBP}: ${sbp}.`
      : `Standard L1 Low: ${sbp}.`,
    metadata: { thresholdValue: lowerBound },
  }
}
