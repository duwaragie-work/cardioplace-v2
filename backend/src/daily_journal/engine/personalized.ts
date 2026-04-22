// Phase/5 personalized-mode rule — ±20 mmHg from provider-set target.
// Source: CLINICAL_SPEC §4.1 (Diagnosed Hypertension, Personalised Mode).

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const PERSONALIZED_BAND_MMHG = 20

export const personalizedHighRule: RuleFunction = (session, ctx) => {
  if (!ctx.personalizedEligible) return null
  const upper = ctx.threshold?.sbpUpperTarget
  if (upper == null || session.systolicBP == null) return null

  const trigger = upper + PERSONALIZED_BAND_MMHG
  if (session.systolicBP < trigger) return null

  return {
    ruleId: RULE_IDS.PERSONALIZED_HIGH,
    tier: 'BP_LEVEL_1_HIGH',
    mode: 'PERSONALIZED',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `SBP ${session.systolicBP} ≥ target ${upper} + ${PERSONALIZED_BAND_MMHG}.`,
    metadata: { thresholdValue: trigger },
  }
}

export const personalizedLowRule: RuleFunction = (session, ctx) => {
  if (!ctx.personalizedEligible) return null
  const lower = ctx.threshold?.sbpLowerTarget
  if (lower == null || session.systolicBP == null) return null
  if (session.systolicBP >= lower) return null

  return {
    ruleId: RULE_IDS.PERSONALIZED_LOW,
    tier: 'BP_LEVEL_1_LOW',
    mode: 'PERSONALIZED',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `SBP ${session.systolicBP} < provider lower target ${lower}.`,
    metadata: { thresholdValue: lower },
  }
}
