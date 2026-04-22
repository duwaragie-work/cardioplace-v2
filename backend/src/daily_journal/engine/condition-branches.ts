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

export const cadRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasCAD) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session

  // CRITICAL: DBP <70 regardless of SBP (CLINICAL_SPEC §4.3).
  if (dbp != null && dbp < CAD_DBP_CRITICAL) {
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

  // Upper bound — standard ≥160.
  const upper = ctx.threshold?.sbpUpperTarget ?? CAD_DEFAULT_UPPER
  if (sbp != null && sbp >= upper) {
    return highAlert(session, ctx, RULE_IDS.CAD_HIGH, 'CAD', upper)
  }
  return null
}

// ─── HCM ────────────────────────────────────────────────────────────────────

export const hcmRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasHCM) return null
  const { systolicBP: sbp } = session

  // HCM vasodilator / nitrate / high-dose loop diuretic safety flag (Tier 3).
  const risky = ctx.contextMeds.find((m) =>
    m.drugClass === 'VASODILATOR_NITRATE' ||
    m.drugClass === 'DHP_CCB' ||
    m.drugClass === 'LOOP_DIURETIC',
  )
  if (risky) {
    return {
      ruleId: RULE_IDS.HCM_VASODILATOR,
      tier: 'TIER_3_INFO',
      mode: 'STANDARD',
      pulsePressure: getPulsePressure(sbp, session.diastolicBP),
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: sbp,
      reason: `HCM + ${risky.drugClass} (${risky.drugName}) — may worsen LVOT obstruction.`,
      metadata: {
        conditionLabel: 'HCM',
        drugName: risky.drugName,
        drugClass: risky.drugClass,
      },
    }
  }

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
