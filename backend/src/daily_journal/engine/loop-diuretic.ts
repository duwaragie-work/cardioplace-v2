// Loop-diuretic hypotension sensitivity — Tier 3 physician note.
//
// Cluster 6 Q1 (Manisha 5/9/26): STRICT cutoff at SBP < 90. The prior
// 90-92 "trending-low" band is dropped — pharmacologically it is not a
// distinct clinical state. HF patients (HFrEF / HFpEF / DCM) are excluded
// because their condition-specific rules already fire on the appropriate
// SBP thresholds; loop-diuretic surface would be redundant.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { ContextMedication } from '@cardioplace/shared'
import type { ResolvedContext } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const LOOP_SENSITIVITY_SBP = 90 // strict cutoff per Manisha 5/9 Q1

export const loopDiureticHypotensionRule: RuleFunction = (session, ctx) => {
  if (!hasLoopDiuretic(ctx.contextMeds)) return null
  if (session.systolicBP == null) return null
  if (session.systolicBP >= LOOP_SENSITIVITY_SBP) return null
  // HF takes precedence — HFrEF/HFpEF/DCM rules subsume the warning at
  // their own thresholds. Avoid duplicate provider noise.
  if (isHeartFailurePatient(ctx)) return null

  return {
    ruleId: RULE_IDS.LOOP_DIURETIC_HYPOTENSION,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `Loop diuretic + SBP ${session.systolicBP} <${LOOP_SENSITIVITY_SBP} — hypotension sensitivity.`,
    metadata: { drugClass: 'LOOP_DIURETIC', thresholdValue: LOOP_SENSITIVITY_SBP },
  }
}

export function getLoopDiureticAnnotation(
  meds: ContextMedication[],
  sbp: number | null,
): string | null {
  if (sbp == null) return null
  if (sbp >= LOOP_SENSITIVITY_SBP) return null
  if (!hasLoopDiuretic(meds)) return null
  return 'Patient on loop diuretic — increased hypotension sensitivity.'
}

function hasLoopDiuretic(meds: ContextMedication[]): boolean {
  return meds.some((m) => m.drugClass === 'LOOP_DIURETIC')
}

function isHeartFailurePatient(ctx: ResolvedContext): boolean {
  return (
    ctx.profile.hasHeartFailure ||
    ctx.profile.hasDCM ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  )
}
