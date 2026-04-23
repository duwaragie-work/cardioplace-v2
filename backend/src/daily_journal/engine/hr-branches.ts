// Phase/5 heart-rate rules — AFib, Tachy, Brady.
// Source: CLINICAL_SPEC §4.4–§4.6.
//
// Tachycardia's "≥2 consecutive readings" rule requires visibility into more
// than the current session; the orchestrator passes an explicit
// `tachycardiaConsecutiveCount` to handle this cross-session state.
//
// Beta-blocker suppression window (50–60 bpm) from CLINICAL_SPEC Part 7 is a
// spec-level non-event for this engine: the only HR-alerting thresholds in
// this file are <50 and >100/>110, so a patient in the 50–60 window simply
// doesn't trigger any HR rule. No explicit suppression check is required.

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction, RuleResult, SessionAverage } from './types.js'

const AFIB_HR_HIGH = 110
const AFIB_HR_LOW = 50
const TACHY_HR = 100
const BRADY_SYMPTOMATIC = 50
const BRADY_ASYMPTOMATIC = 40

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
    // Beta-blocker suppression (50–60 bpm) is mutually exclusive with this
    // branch (<50), so no suppression check is needed here. Kept this comment
    // so reviewers don't add one back.
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
  // Beta-blocker suppression (50–60 bpm) is mutually exclusive with this
  // branch (<50), so no suppression check is needed here. The unit test
  // "beta-blocker + HR=55 → suppressed" passes because the rule already
  // returns null for pulse in [50, 60) — no branch fires.
  if (session.pulse < BRADY_SYMPTOMATIC) {
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
