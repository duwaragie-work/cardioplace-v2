// Phase/5 condition-specific threshold rules — HFrEF, HFpEF, CAD, HCM, DCM.
// Each branch respects provider-set PatientThreshold when present; otherwise
// applies spec defaults. Source: CLINICAL_SPEC §4.2–§4.9.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction, RuleResult } from './types.js'

const HFREF_DEFAULT_LOWER = 85
const HFREF_DEFAULT_UPPER = 160
const HFPEF_DEFAULT_LOWER = 110
const HFPEF_DEFAULT_UPPER = 160
const HCM_DEFAULT_LOWER = 100
const HCM_DEFAULT_UPPER = 160
const DCM_DEFAULT_LOWER = 85
const DCM_DEFAULT_UPPER = 160
const CAD_DBP_CRITICAL = 70
const CAD_DEFAULT_UPPER = 160

// ─── HFrEF ──────────────────────────────────────────────────────────────────

export const hfrefRule: RuleFunction = (session, ctx) => {
  if (ctx.profile.resolvedHFType !== 'HFREF') return null
  const { systolicBP: sbp } = session
  if (sbp == null) return null

  const lower = ctx.threshold?.sbpLowerTarget ?? HFREF_DEFAULT_LOWER
  const upper = ctx.threshold?.sbpUpperTarget ?? HFREF_DEFAULT_UPPER

  if (sbp < lower) {
    return lowAlert(session, ctx, RULE_IDS.HFREF_LOW, 'HFrEF', lower)
  }
  if (sbp >= upper) {
    return highAlert(session, ctx, RULE_IDS.HFREF_HIGH, 'HFrEF', upper)
  }
  return null
}

// ─── HFpEF ──────────────────────────────────────────────────────────────────

export const hfpefRule: RuleFunction = (session, ctx) => {
  if (ctx.profile.resolvedHFType !== 'HFPEF') return null
  const { systolicBP: sbp } = session
  if (sbp == null) return null

  const lower = ctx.threshold?.sbpLowerTarget ?? HFPEF_DEFAULT_LOWER
  const upper = ctx.threshold?.sbpUpperTarget ?? HFPEF_DEFAULT_UPPER

  if (sbp < lower) {
    return lowAlert(session, ctx, RULE_IDS.HFPEF_LOW, 'HFpEF', lower)
  }
  if (sbp >= upper) {
    return highAlert(session, ctx, RULE_IDS.HFPEF_HIGH, 'HFpEF', upper)
  }
  return null
}

// ─── CAD ────────────────────────────────────────────────────────────────────
// Split into two single-axis rules so the multi-axis orchestrator can fire
// both for SBP 165 + DBP 65. Each rule is on its own clinical axis:
//   • cadDbpRule  → dbp-low axis (J-curve / coronary perfusion, §4.3)
//   • cadHighRule → bp-high axis (standard ≥160 upper bound, §4.3)

export const cadDbpRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasCAD) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (dbp == null || dbp >= CAD_DBP_CRITICAL) return null

  return {
    ruleId: RULE_IDS.CAD_DBP_CRITICAL,
    tier: 'BP_LEVEL_1_LOW',
    mode: ctx.personalizedEligible ? 'PERSONALIZED' : 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: dbp,
    reason: `CAD DBP <${CAD_DBP_CRITICAL}: ${dbp}.`,
    metadata: { conditionLabel: 'CAD', thresholdValue: CAD_DBP_CRITICAL },
  }
}

export const cadHighRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasCAD) return null
  const { systolicBP: sbp } = session
  const upper = ctx.threshold?.sbpUpperTarget ?? CAD_DEFAULT_UPPER
  if (sbp == null || sbp < upper) return null
  return highAlert(session, ctx, RULE_IDS.CAD_HIGH, 'CAD', upper)
}

// Phase/26 round-3 fix — bidirectional BP context annotation. When a CAD
// patient's reading triggers RULE_CAD_DBP_CRITICAL (J-curve / DBP-low) AND
// SBP is in the (140, 160) "above-goal-but-below-alert-threshold" range,
// surface the SBP framing alongside the J-curve framing so the physician
// sees both concerns. Without this annotation, the dominant alert reads as
// "drop the dose" — risking SBP rebound when the patient actually needs a
// class switch (per §4.3 treatment target 130/80).
//
// Floor 140: AHA Stage 2 boundary — natural breakpoint for "uncontrolled".
// Ceiling 160: at ≥160 the cadHighRule fires its own bp-high row, so the
// annotation would duplicate.
const CAD_HTN_UNCONTROLLED_FLOOR = 140
const CAD_HTN_UNCONTROLLED_CEILING = 160

export function getCadHtnUncontrolledAnnotation(
  sbp: number | null,
  hasCAD: boolean,
): string | null {
  if (!hasCAD || sbp == null) return null
  if (sbp <= CAD_HTN_UNCONTROLLED_FLOOR) return null
  if (sbp >= CAD_HTN_UNCONTROLLED_CEILING) return null
  return `SBP ${sbp} also above CAD goal of 130/80 — consider switching antihypertensive class rather than dose reduction.`
}

// ─── HCM ────────────────────────────────────────────────────────────────────
// Split into two single-axis rules so the multi-axis orchestrator can fire
// the vasodilator safety flag (Tier 3 info) AND a BP-axis alert on the same
// reading. Pre-split, the vasodilator branch returned early and dropped
// HCM_LOW even when SBP <100. Per CLINICAL_SPEC §4.6 the patient's clinical
// hypotension is a real concern independent of the medication safety flag.

export const hcmVasodilatorRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasHCM) return null
  const risky = ctx.contextMeds.find((m) =>
    m.drugClass === 'VASODILATOR_NITRATE' ||
    m.drugClass === 'DHP_CCB' ||
    m.drugClass === 'LOOP_DIURETIC',
  )
  if (!risky) return null

  return {
    ruleId: RULE_IDS.HCM_VASODILATOR,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `HCM + ${risky.drugClass} (${risky.drugName}) — may worsen LVOT obstruction.`,
    metadata: {
      conditionLabel: 'HCM',
      drugName: risky.drugName,
      drugClass: risky.drugClass,
    },
  }
}

export const hcmRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasHCM) return null
  const { systolicBP: sbp } = session
  if (sbp == null) return null

  const lower = ctx.threshold?.sbpLowerTarget ?? HCM_DEFAULT_LOWER
  const upper = ctx.threshold?.sbpUpperTarget ?? HCM_DEFAULT_UPPER

  if (sbp < lower) {
    return lowAlert(session, ctx, RULE_IDS.HCM_LOW, 'HCM', lower)
  }
  if (sbp >= upper) {
    return highAlert(session, ctx, RULE_IDS.HCM_HIGH, 'HCM', upper)
  }
  return null
}

// ─── DCM ────────────────────────────────────────────────────────────────────

export const dcmRule: RuleFunction = (session, ctx) => {
  // DCM is managed as HFrEF (§4.8), but only fire this rule if the patient
  // doesn't also carry a HeartFailure flag — otherwise the HFrEF branch
  // handles them. (resolvedHFType is HFREF in both cases.)
  if (!ctx.profile.hasDCM) return null
  if (ctx.profile.hasHeartFailure) return null
  const { systolicBP: sbp } = session
  if (sbp == null) return null

  const lower = ctx.threshold?.sbpLowerTarget ?? DCM_DEFAULT_LOWER
  const upper = ctx.threshold?.sbpUpperTarget ?? DCM_DEFAULT_UPPER

  if (sbp < lower) {
    return lowAlert(session, ctx, RULE_IDS.DCM_LOW, 'DCM', lower)
  }
  if (sbp >= upper) {
    return highAlert(session, ctx, RULE_IDS.DCM_HIGH, 'DCM', upper)
  }
  return null
}

// ─── Cluster 6 — HF decompensation + DHP-CCB side-effect ─────────────────────

const HF_WEIGHT_DELTA_LBS = 2
const HF_WEIGHT_DELTA_MS = 24 * 60 * 60 * 1000

/**
 * Fires when an HF patient reports leg swelling OR shows >2 lbs weight gain
 * in 24h. The HF-ARC 2024 panel calls these out as primary decompensation
 * indicators. Tier 2 alert on its own dedicated axis so it co-exists with
 * any HFREF / HFPEF / DCM SBP rule that also fires.
 */
export const hfDecompensationRule: RuleFunction = (session, ctx) => {
  const isHF =
    ctx.profile.hasHeartFailure ||
    ctx.profile.hasDCM ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  if (!isHF) return null

  const reasons: string[] = []
  if (session.symptoms.legSwelling) reasons.push('leg-swelling')

  const weightDeltaPounds = computeWeightDelta(session, ctx)
  if (weightDeltaPounds != null && weightDeltaPounds > HF_WEIGHT_DELTA_LBS) {
    reasons.push(`weight-+${weightDeltaPounds.toFixed(1)}lbs/24h`)
  }
  if (reasons.length === 0) return null

  return {
    ruleId: RULE_IDS.HF_DECOMPENSATION,
    tier: 'BP_LEVEL_1_LOW',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `HF decompensation signal: ${reasons.join(', ')}.`,
    metadata: { conditionLabel: 'HF decompensation' },
  }
}

/**
 * DHP-CCB peripheral edema is a known and usually benign side effect, but
 * the prescriber wants to know about it (dose adjustment / class switch).
 * Tier 3 — physician-facing only. Suppressed for HF patients because the HF
 * decompensation rule above already fires the patient-visible alert.
 */
export const dhpCcbLegSwellingRule: RuleFunction = (session, ctx) => {
  if (!session.symptoms.legSwelling) return null
  const isHF =
    ctx.profile.hasHeartFailure ||
    ctx.profile.hasDCM ||
    ctx.profile.resolvedHFType === 'HFREF' ||
    ctx.profile.resolvedHFType === 'HFPEF'
  if (isHF) return null
  const onDhpCcb = ctx.contextMeds.some((m) => m.drugClass === 'DHP_CCB')
  if (!onDhpCcb) return null

  return {
    ruleId: RULE_IDS.DHP_CCB_LEG_SWELLING,
    tier: 'TIER_3_INFO',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: null,
    reason: 'Leg swelling reported on DHP-CCB — peripheral edema side-effect.',
    metadata: { conditionLabel: 'DHP-CCB peripheral edema' },
  }
}

/**
 * Returns the pound difference between the current session's weight and the
 * most-recent prior weight within 24h, or null if either side is missing.
 * Reads from optional `priorWeight` / `priorWeightAt` fields populated by
 * the orchestrator via a one-shot Prisma lookup (added in Step 4).
 */
function computeWeightDelta(
  session: Parameters<RuleFunction>[0],
  _ctx: Parameters<RuleFunction>[1],
): number | null {
  const currentWeight = session.weight
  const priorWeight = session.priorWeight ?? null
  const priorWeightAt = session.priorWeightAt ?? null
  if (currentWeight == null || priorWeight == null || priorWeightAt == null) return null
  if (session.measuredAt.getTime() - priorWeightAt.getTime() > HF_WEIGHT_DELTA_MS) return null
  return currentWeight - priorWeight
}

// ─── helpers ────────────────────────────────────────────────────────────────

function lowAlert(
  session: Parameters<RuleFunction>[0],
  ctx: Parameters<RuleFunction>[1],
  ruleId: RuleResult['ruleId'],
  conditionLabel: string,
  threshold: number,
): RuleResult {
  return {
    ruleId,
    tier: 'BP_LEVEL_1_LOW',
    mode: ctx.personalizedEligible ? 'PERSONALIZED' : 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `${conditionLabel} SBP <${threshold}: ${session.systolicBP}.`,
    metadata: { conditionLabel, thresholdValue: threshold },
  }
}

function highAlert(
  session: Parameters<RuleFunction>[0],
  ctx: Parameters<RuleFunction>[1],
  ruleId: RuleResult['ruleId'],
  conditionLabel: string,
  threshold: number,
): RuleResult {
  return {
    ruleId,
    tier: 'BP_LEVEL_1_HIGH',
    mode: ctx.personalizedEligible ? 'PERSONALIZED' : 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.systolicBP,
    reason: `${conditionLabel} SBP ≥${threshold}: ${session.systolicBP}.`,
    metadata: { conditionLabel, thresholdValue: threshold },
  }
}
