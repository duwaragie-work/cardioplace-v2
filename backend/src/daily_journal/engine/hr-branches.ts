// Phase/5 heart-rate rules — AFib, Tachy, Brady + beta-blocker suppression.
// Source: CLINICAL_SPEC §4.4–§4.6 + Part 7 (beta-blocker linkage).
//
// Tachycardia's "≥2 consecutive readings" rule requires visibility into more
// than the current session; the orchestrator passes an explicit
// `tachycardiaConsecutiveCount` to handle this cross-session state.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { ContextMedication } from '@cardioplace/shared'
import type { RuleFunction, RuleResult, SessionAverage } from './types.js'

const AFIB_HR_HIGH = 110
const AFIB_HR_LOW = 50
const TACHY_HR = 100
const BRADY_SYMPTOMATIC = 50
const BRADY_ASYMPTOMATIC = 40
const BB_SUPPRESS_LOWER = 50 // beta-blocker HR suppression window [50..60]
const BB_SUPPRESS_UPPER = 60

export const afibHrRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasAFib) return null
  if (session.pulse == null) return null

  if (session.pulse > AFIB_HR_HIGH) {
    return {
      ruleId: RULE_IDS.AFIB_HR_HIGH,
      tier: 'BP_LEVEL_1_HIGH',
      mode: 'STANDARD',
      pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: session.pulse,
      reason: `AFib + HR ${session.pulse} > ${AFIB_HR_HIGH}.`,
      metadata: { conditionLabel: 'AFib', thresholdValue: AFIB_HR_HIGH },
    }
  }

  if (session.pulse < AFIB_HR_LOW) {
    if (hasBetaBlocker(ctx.contextMeds) && isInSuppressionWindow(session.pulse)) {
      return null
    }
    return {
      ruleId: RULE_IDS.AFIB_HR_LOW,
      tier: 'BP_LEVEL_1_LOW',
      mode: 'STANDARD',
      pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: session.pulse,
      reason: `AFib + HR ${session.pulse} < ${AFIB_HR_LOW}.`,
      metadata: { conditionLabel: 'AFib', thresholdValue: AFIB_HR_LOW },
    }
  }

  return null
}

/**
 * Tachycardia — fires only when the patient is flagged hasTachycardia AND
 * the current session's pulse >100 AND prior consecutive sessions also ≥100.
 * The "two consecutive readings" requirement is enforced by the orchestrator
 * via `ctx.tachycardiaConsecutiveCount` analog — for the rule function itself
 * we require the flag + pulse + a `priorElevated` hint passed in the session.
 */
export function buildTachyRule(priorElevated: boolean): RuleFunction {
  return (session, ctx) => {
    if (!ctx.profile.hasTachycardia) return null
    if (session.pulse == null) return null
    if (session.pulse <= TACHY_HR) return null
    if (!priorElevated) return null

    return {
      ruleId: RULE_IDS.TACHY_HR,
      tier: 'BP_LEVEL_1_HIGH',
      mode: 'STANDARD',
      pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: session.pulse,
      reason: `Tachycardia HR ${session.pulse} > ${TACHY_HR} (≥2 consecutive).`,
      metadata: { conditionLabel: 'Tachycardia', thresholdValue: TACHY_HR },
    }
  }
}

export const bradyRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasBradycardia) return null
  if (session.pulse == null) return null

  // Asymptomatic HR <40 fires regardless of beta-blocker.
  if (session.pulse < BRADY_ASYMPTOMATIC) {
    return bradyResult(
      session,
      RULE_IDS.BRADY_HR_ASYMPTOMATIC,
      BRADY_ASYMPTOMATIC,
      'asymptomatic',
    )
  }

  // Symptomatic HR <50 — check structured symptoms for brady-relevant ones.
  if (session.pulse < BRADY_SYMPTOMATIC) {
    if (hasBetaBlocker(ctx.contextMeds) && isInSuppressionWindow(session.pulse)) {
      return null
    }
    const isSymptomatic =
      session.symptoms.alteredMentalStatus ||
      session.symptoms.chestPainOrDyspnea ||
      session.symptoms.focalNeuroDeficit
    if (isSymptomatic) {
      return bradyResult(
        session,
        RULE_IDS.BRADY_HR_SYMPTOMATIC,
        BRADY_SYMPTOMATIC,
        'symptomatic',
      )
    }
  }

  return null
}

// ─── helpers ────────────────────────────────────────────────────────────────

function hasBetaBlocker(meds: ContextMedication[]): boolean {
  return meds.some((m) => m.drugClass === 'BETA_BLOCKER')
}

function isInSuppressionWindow(pulse: number): boolean {
  return pulse >= BB_SUPPRESS_LOWER && pulse <= BB_SUPPRESS_UPPER
}

function bradyResult(
  session: SessionAverage,
  ruleId: RuleResult['ruleId'],
  threshold: number,
  flavor: 'asymptomatic' | 'symptomatic',
): RuleResult {
  return {
    ruleId,
    tier: 'BP_LEVEL_1_LOW',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.pulse,
    reason: `Bradycardia ${flavor} HR ${session.pulse} < ${threshold}.`,
    metadata: { conditionLabel: 'Bradycardia', thresholdValue: threshold },
  }
}
