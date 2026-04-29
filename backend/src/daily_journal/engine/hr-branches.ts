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
import type { ResolvedContext } from '@cardioplace/shared'
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

// ─── HR context annotation ──────────────────────────────────────────────────
// Phase/26 Reading 5b fix — surfaces an HR concern when a terminal-stage rule
// (symptom override or absolute emergency) preempts Stage C and the HR rule
// that would have fired never gets a chance. Mirrors the exact threshold +
// flag guards as the rules above so the annotation only fires when the
// patient's clinical profile explicitly flags HR as a monitored signal.
//
// Open clinical question (raise with Manisha): should the HR finding instead
// produce a separate DeviationAlert row + ladder? Annotation is the interim
// reversible answer. If she signs off on co-firing, promote later.
export function getHrContextAnnotation(
  session: SessionAverage,
  ctx: ResolvedContext,
  priorElevated: boolean,
): string | null {
  const pulse = session.pulse
  if (pulse == null) return null

  // AFib HR — only when the patient is flagged hasAFib.
  if (ctx.profile.hasAFib) {
    if (pulse > AFIB_HR_HIGH) {
      return `HR ${pulse} + AFib — rate-uncontrolled AFib (>${AFIB_HR_HIGH}); review rate-control regimen.`
    }
    if (pulse < AFIB_HR_LOW) {
      return `HR ${pulse} + AFib — bradycardia (<${AFIB_HR_LOW}); review rate-control regimen.`
    }
  }

  // Bradycardia — only when the patient is flagged hasBradycardia.
  if (ctx.profile.hasBradycardia) {
    if (pulse < BRADY_ASYMPTOMATIC) {
      return `HR ${pulse} — asymptomatic bradycardia (<${BRADY_ASYMPTOMATIC}); ECG and pacemaker eval regardless of symptoms.`
    }
    if (pulse < BRADY_SYMPTOMATIC) {
      const symptomatic =
        session.symptoms.alteredMentalStatus ||
        session.symptoms.chestPainOrDyspnea ||
        session.symptoms.focalNeuroDeficit
      if (symptomatic) {
        return `HR ${pulse} + brady-relevant symptoms — symptomatic bradycardia (heart-block / Stokes-Adams suspicion); ECG and pacemaker eval, consider holding beta-blocker.`
      }
    }
  }

  // Tachycardia — only when flagged AND prior reading also elevated.
  if (ctx.profile.hasTachycardia && pulse > TACHY_HR && priorElevated) {
    return `HR ${pulse} — sustained tachycardia (≥2 consecutive readings >${TACHY_HR}); rule out causes.`
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
