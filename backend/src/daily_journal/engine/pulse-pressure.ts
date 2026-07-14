// Phase/5 pulse-pressure wide flag — physician-only Tier 3 annotation.
// Source: CLINICAL_SPEC "Pulse Pressure derived alert" appendix.
//
// Does NOT create a standalone alert row when another rule also fires — the
// orchestrator annotates the primary rule's physician message via
// RuleResult.metadata.physicianAnnotations. Use this rule only as a last-step
// fallback when no other rule fired but PP > 60.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { ResolvedContext } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const WIDE_PP_THRESHOLD = 60
// Manisha 5/24 Q2 — hemodynamic-significance threshold on the SESSION average
// (distinct from the per-reading <15 artifact flag handled at entry).
const NARROW_PP_THRESHOLD = 25

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

/**
 * Condition group for the narrow-PP physician note (Manisha 5/24 Q2). DCM is
 * managed as HFrEF (same wording); aortic stenosis shares the HCM fixed-outflow
 * framing. Returns null for the generic message.
 */
function narrowPpConditionLabel(
  profile: ResolvedContext['profile'],
): 'HFrEF' | 'HFpEF' | 'HCM' | 'aortic stenosis' | undefined {
  if (profile.resolvedHFType === 'HFREF' || profile.hasDCM) return 'HFrEF'
  if (profile.resolvedHFType === 'HFPEF') return 'HFpEF'
  if (profile.hasHCM) return 'HCM'
  if (profile.hasAorticStenosis) return 'aortic stenosis'
  return undefined
}

/**
 * Manisha 5/24 Q2 — narrow pulse pressure on the session average (< 25 mmHg).
 * Physician-only Tier 3, condition-specific. Like the wide-PP rule it fires as
 * a standalone row only when nothing else fired; otherwise it rides as an
 * annotation (getNarrowPulsePressureAnnotation). Session-averaged only — the
 * single-reading gate already suppresses Stage C / D for lone readings.
 */
export const pulsePressureNarrowRule: RuleFunction = (session, ctx) => {
  const pp = getPulsePressure(session.systolicBP, session.diastolicBP)
  if (pp == null) return null
  if (pp >= NARROW_PP_THRESHOLD) return null

  return {
    ruleId: RULE_IDS.PULSE_PRESSURE_NARROW,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: pp,
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: pp,
    reason: `Pulse pressure ${pp} < ${NARROW_PP_THRESHOLD} (physician-only).`,
    metadata: {
      conditionLabel: narrowPpConditionLabel(ctx.profile),
      thresholdValue: NARROW_PP_THRESHOLD,
    },
  }
}

/** Annotation form — appended to another rule's physicianMessage when narrow PP
 *  co-occurs with a higher-tier finding. F23: carry the condition-specific
 *  clinical-correlation wording (HFrEF / HFpEF / HCM / AS) that the standalone
 *  RULE_PULSE_PRESSURE_NARROW message builder already produces, so a co-firing
 *  L1 alert on an HFrEF patient surfaces the same Manisha 5/24 Q2 language. */
export function getNarrowPulsePressureAnnotation(
  sbp: number | null,
  dbp: number | null,
  profile?: ResolvedContext['profile'],
): string | null {
  const pp = getPulsePressure(sbp, dbp)
  if (pp == null || pp >= NARROW_PP_THRESHOLD) return null
  const base = `Narrow pulse pressure: ${pp} mmHg (<${NARROW_PP_THRESHOLD}).`
  const label = profile ? narrowPpConditionLabel(profile) : undefined
  if (label === 'HFrEF') {
    return `${base} In HFrEF, narrow PP may indicate reduced stroke volume. Consider clinical correlation — echocardiography if new finding or worsening trend.`
  }
  if (label === 'HFpEF') {
    return `${base} In HFpEF, narrow PP is less prognostically significant than in HFrEF. Clinical correlation recommended.`
  }
  if (label === 'HCM' || label === 'aortic stenosis') {
    return `${base} In the context of ${label}, narrow PP may reflect fixed outflow obstruction. Clinical correlation recommended.`
  }
  return base
}
