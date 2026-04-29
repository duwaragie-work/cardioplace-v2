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
