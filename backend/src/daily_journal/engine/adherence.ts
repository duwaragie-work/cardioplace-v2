// Phase/post-merge — Tier 2 medication adherence rule.
// Fires on any self-reported missed dose: either the generic
// `medicationTaken=false` toggle from the legacy form, OR the richer
// per-medication miss detail captured by the updated CheckIn.tsx flow.
//
// Runs in an independent pipeline pass alongside the BP/HR rules so a single
// journal entry can produce up to two DeviationAlert rows (e.g. BP L1 High
// AND medication missed). See AlertEngineService.evaluate() for the two-pass
// orchestration.
//
// TODO(Dr. Singal): confirm single-miss trigger (vs 2/3 consecutive) and
// review the three-tier wording in shared/src/alert-messages.ts.

import { RULE_IDS } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

export const medicationMissedRule: RuleFunction = (session) => {
  const explicitNo = session.medicationTaken === false
  const perMedList = session.missedMedications
  const hasPerMed = perMedList.length > 0

  if (!explicitNo && !hasPerMed) return null

  return {
    ruleId: RULE_IDS.MEDICATION_MISSED,
    tier: 'TIER_2_DISCREPANCY',
    mode: 'STANDARD',
    pulsePressure: null,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: hasPerMed ? perMedList.length : 1,
    reason: hasPerMed
      ? `Patient self-reported missing ${perMedList.length} medication(s).`
      : 'Patient self-reported missing a medication dose.',
    metadata: {
      conditionLabel: 'Medication adherence',
      missedMedications: hasPerMed ? perMedList : undefined,
    },
  }
}
