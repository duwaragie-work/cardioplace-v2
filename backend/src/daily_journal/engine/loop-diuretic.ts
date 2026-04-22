// Phase/5 loop-diuretic hypotension sensitivity — Tier 3 physician note.
// Source: CLINICAL_SPEC Part 7 Priority 3 (loop diuretic + SBP <90).
//
// When the reading is already low enough to fire a primary alert (e.g.
// standard L1 low at <90), the orchestrator rides this hint as a physician
// annotation instead of firing a second alert row.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { ContextMedication } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const LOOP_SENSITIVITY_SBP = 92 // patient trending low but not yet <90

export const loopDiureticHypotensionRule: RuleFunction = (session, ctx) => {
  if (!hasLoopDiuretic(ctx.contextMeds)) return null
  if (session.systolicBP == null) return null
  if (session.systolicBP > LOOP_SENSITIVITY_SBP) return null
  if (session.systolicBP < 90) return null // let standard L1 Low handle that case

  return {
    ruleId: RULE_IDS.LOOP_DIURETIC_HYPOTENSION,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `Loop diuretic + SBP ${session.systolicBP} — hypotension sensitivity.`,
    metadata: { drugClass: 'LOOP_DIURETIC', thresholdValue: LOOP_SENSITIVITY_SBP },
  }
}

export function getLoopDiureticAnnotation(
  meds: ContextMedication[],
  sbp: number | null,
): string | null {
  if (sbp == null) return null
  if (sbp > LOOP_SENSITIVITY_SBP) return null
  if (!hasLoopDiuretic(meds)) return null
  return 'Patient on loop diuretic — increased hypotension sensitivity.'
}

function hasLoopDiuretic(meds: ContextMedication[]): boolean {
  return meds.some((m) => m.drugClass === 'LOOP_DIURETIC')
}
