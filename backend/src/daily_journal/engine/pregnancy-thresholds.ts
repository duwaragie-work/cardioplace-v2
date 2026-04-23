// Phase/5 pregnancy-threshold rules — applies to all pregnant patients
// (incl. safety-net: unverified profile still activates). Source:
// CLINICAL_SPEC Part 3 (ACOG / CHAP). Step 3 emergency fires first (handled
// separately); these rules handle Level 1 (≥140/90) and Level 2 (≥160/110).

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const PREGNANCY_L2_SBP = 160
const PREGNANCY_L2_DBP = 110
const PREGNANCY_L1_SBP = 140
const PREGNANCY_L1_DBP = 90

export const pregnancyL2Rule: RuleFunction = (session, ctx) => {
  if (!ctx.pregnancyThresholdsActive) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (sbp == null && dbp == null) return null

  const hit =
    (sbp != null && sbp >= PREGNANCY_L2_SBP) ||
    (dbp != null && dbp >= PREGNANCY_L2_DBP)
  if (!hit) return null

  return {
    ruleId: RULE_IDS.PREGNANCY_L2,
    tier: 'BP_LEVEL_2',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbp ?? dbp,
    reason: `Pregnancy BP ≥${PREGNANCY_L2_SBP}/${PREGNANCY_L2_DBP}: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: { conditionLabel: 'Pregnancy' },
  }
}

export const pregnancyL1HighRule: RuleFunction = (session, ctx) => {
  if (!ctx.pregnancyThresholdsActive) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (sbp == null && dbp == null) return null

  const hit =
    (sbp != null && sbp >= PREGNANCY_L1_SBP) ||
    (dbp != null && dbp >= PREGNANCY_L1_DBP)
  if (!hit) return null

  return {
    ruleId: RULE_IDS.PREGNANCY_L1_HIGH,
    tier: 'BP_LEVEL_1_HIGH',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbp ?? dbp,
    reason: `Pregnancy BP ≥${PREGNANCY_L1_SBP}/${PREGNANCY_L1_DBP}: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: { conditionLabel: 'Pregnancy' },
  }
}
