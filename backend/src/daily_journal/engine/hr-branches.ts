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
// Cluster 6 Q5 (Manisha 5/9/26) — single-reading Tier 2 exception: HR > 130
// fires immediately, no need for a second reading to confirm.
const TACHY_SEVERE_HR = 130
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
 * Severe tachycardia (HR > 130) — Cluster 6 Q5 single-reading Tier 2
 * exception: fires immediately on ONE reading, no consecutive-reading wait.
 * Split out of `buildTachyRule` so it can run in the engine's pre-gate
 * emergency set (Stage B) and bypass the single-reading non-emergency gate,
 * exactly like the BP ≥180 absolute-emergency rule. Claims the `hr` axis
 * (same as the consecutive-reading tachy path), so the two never double-fire.
 */
export const tachySevereRule: RuleFunction = (session, ctx) => {
  if (!ctx.profile.hasTachycardia) return null
  if (session.pulse == null) return null
  if (session.pulse <= TACHY_SEVERE_HR) return null

  return {
    ruleId: RULE_IDS.TACHY_HR,
    tier: 'BP_LEVEL_1_HIGH',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.pulse,
    reason: `Severe tachycardia HR ${session.pulse} > ${TACHY_SEVERE_HR} (single-reading Tier 2 exception).`,
    metadata: {
      conditionLabel: 'Tachycardia',
      thresholdValue: TACHY_SEVERE_HR,
    },
  }
}

/**
 * Tachycardia consecutive-reading branch — HR > 100 AND `priorElevated` (a
 * reading within the prior 8h was also > 100). The 8h window is enforced by
 * `wasPriorReadingPulseElevated`; this rule only consumes the boolean. The
 * HR > 130 single-reading exception is owned by `tachySevereRule` above (which
 * runs in the pre-gate emergency set); this branch stays in Stage C since it
 * inherently needs ≥2 readings. Both share `RULE_TACHY_HR` / the `hr` axis.
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
      reason: `Tachycardia HR ${session.pulse} > ${TACHY_HR} (≥2 consecutive within 8h).`,
      metadata: {
        conditionLabel: 'Tachycardia',
        thresholdValue: TACHY_HR,
      },
    }
  }
}

/**
 * Cluster 6 (Manisha 5/10/26) — HR<40 is Tier 1 regardless of symptoms per
 * v1.0 spec §5.6. Renamed from `RULE_BRADY_HR_ASYMPTOMATIC` (was Tier 2) to
 * `RULE_BRADY_ABSOLUTE` (Tier 1). The escalation ladder picks up the new
 * tier automatically; admin dashboard treats it as non-dismissable. Gate:
 * patient must have hasBradycardia OR be on a beta-blocker — we don't fire
 * Tier 1 brady for a random reading on a healthy patient.
 */
export const bradyAbsoluteRule: RuleFunction = (session, ctx) => {
  if (session.pulse == null) return null
  if (session.pulse >= BRADY_ASYMPTOMATIC) return null
  const gated = ctx.profile.hasBradycardia || onBetaBlocker(ctx)
  if (!gated) return null

  return {
    ruleId: RULE_IDS.BRADY_ABSOLUTE,
    tier: 'TIER_1_CONTRAINDICATION',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: session.pulse,
    reason: `HR ${session.pulse} < ${BRADY_ASYMPTOMATIC} — absolute bradycardia.`,
    metadata: {
      conditionLabel: 'Absolute bradycardia',
      thresholdValue: BRADY_ASYMPTOMATIC,
    },
  }
}

/**
 * Symptomatic bradycardia HR<50 with at least one cerebral-hypoperfusion
 * symptom. Cluster 6 widened the predicate to include the new dizziness +
 * syncope buttons (2018 ACC/AHA/HRS Guideline §5 names lightheadedness +
 * pre-syncope as canonical low-cardiac-output presentations).
 *
 * Gate also widened: in addition to `hasBradycardia`, fires when patient is
 * on a beta-blocker — even a healthy patient on a β-blocker can develop
 * symptomatic brady from dose / interaction / illness.
 */
export const bradySymptomaticRule: RuleFunction = (session, ctx) => {
  if (session.pulse == null) return null
  // HR<40 path is owned by bradyAbsoluteRule (Tier 1). This rule covers the
  // [40, 50) range only — keeps the two non-overlapping, both can co-fire on
  // the same reading via different axes (contraindication vs hr).
  if (session.pulse < BRADY_ASYMPTOMATIC || session.pulse >= BRADY_SYMPTOMATIC) {
    return null
  }
  const gated = ctx.profile.hasBradycardia || onBetaBlocker(ctx)
  if (!gated) return null

  const s = session.symptoms
  const isSymptomatic =
    s.alteredMentalStatus ||
    s.chestPainOrDyspnea ||
    s.focalNeuroDeficit ||
    s.dizziness ||
    s.syncope
  if (!isSymptomatic) return null

  return bradyResult(
    session,
    RULE_IDS.BRADY_HR_SYMPTOMATIC,
    BRADY_SYMPTOMATIC,
    'symptomatic',
  )
}

function onBetaBlocker(ctx: ResolvedContext): boolean {
  return ctx.contextMeds.some((m) => m.drugClass === 'BETA_BLOCKER')
}

// Cluster 8 Q1 — the MESA differential-mortality population: cardiac
// patients on HR-modifying drugs. Beta-blockers + non-DHP CCBs (diltiazem/
// verapamil) + antiarrhythmics (which include digoxin/amiodarone in this
// catalog's grouping) are the rate-controlling classes whose asymptomatic
// 40–49 bradycardia carries risk.
function onRateControlMed(ctx: ResolvedContext): boolean {
  return ctx.contextMeds.some(
    (m) =>
      m.drugClass === 'BETA_BLOCKER' ||
      m.drugClass === 'NDHP_CCB' ||
      m.drugClass === 'ANTIARRHYTHMIC',
  )
}

// ─── Cluster 8 Q1 — asymptomatic bradycardia surveillance ───────────────────
// Manisha 5/18/26: HR 40–49 with NO brady-relevant symptoms must NOT be
// silent for cardiac patients on rate-controlling meds (MESA). Fire a Tier 3
// surveillance chart event (physician-only, no patient/caregiver message, no
// escalation ladder, no push). If the mean HR has been ≤45 across 3+
// consecutive check-in sessions, auto-escalate to Tier 2 (physician review:
// ECG + medication-dose review).
//
// Interaction with the existing brady split (May 10 sign-off):
//   - HR < 40                  → bradyAbsoluteRule (Tier 1), unchanged
//   - HR 40–49 + symptom       → bradySymptomaticRule (Tier 2), unchanged
//   - HR 40–49 + NO symptom    → THIS rule (Tier 3, or Tier 2 if sustained)
//   - HR 50–60 (BB therapeutic)→ no alert, unchanged
const BRADY_SUSTAINED_SESSIONS = 3

export function bradySurveillanceRuleWithWindow(
  consecutiveSessionsLe45: number,
): RuleFunction {
  return (session, ctx) => {
    const pulse = session.pulse
    if (pulse == null) return null
    // [40, 50): <40 is owned by bradyAbsoluteRule (Tier 1).
    if (pulse < BRADY_ASYMPTOMATIC || pulse >= BRADY_SYMPTOMATIC) return null

    const s = session.symptoms
    const symptomatic =
      s.dizziness ||
      s.syncope ||
      s.alteredMentalStatus ||
      s.chestPainOrDyspnea
    // Symptomatic 40–49 is bradySymptomaticRule's (Tier 2) territory.
    if (symptomatic) return null

    // Gate: only the at-risk population — diagnosed bradycardia OR on a
    // rate-controlling medication (MESA differential-mortality cohort).
    //
    // SIGNED-OFF INTERPRETATION (user-confirmed 2026-05, gap audit): the
    // Q1 sign-off's literal WHEN clause is just HR 40–49 + no symptoms +
    // session-averaged, with no medication gate. We deliberately keep this
    // `hasBradycardia OR rate-control med` gate because (a) the doc's own
    // physician-message template reads "Patient is on [medname]
    // ([DRUGCLASS])" — meaningless without a med, (b) the entire MESA
    // rationale is specific to patients on HR-modifying drugs, and (c) it
    // matches the existing bradyAbsolute/bradySymptomatic gating, avoiding
    // surveillance noise for healthy athletic bradycardia. Confirmed as the
    // intended behavior, not an oversight.
    if (!ctx.profile.hasBradycardia && !onRateControlMed(ctx)) return null

    const sustained = consecutiveSessionsLe45 >= BRADY_SUSTAINED_SESSIONS

    return {
      ruleId: RULE_IDS.BRADY_SURVEILLANCE,
      tier: sustained ? 'TIER_2_DISCREPANCY' : 'TIER_3_INFO',
      mode: 'STANDARD',
      pulsePressure: getPulsePressure(session.systolicBP, session.diastolicBP),
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: pulse,
      reason: sustained
        ? `Sustained asymptomatic bradycardia HR ${pulse} ≤ 45 on ${consecutiveSessionsLe45} consecutive sessions.`
        : `Asymptomatic bradycardia surveillance — resting HR ${pulse} (40–49 band).`,
      metadata: {
        conditionLabel: 'Asymptomatic bradycardia',
        thresholdValue: BRADY_SYMPTOMATIC,
        // Surfaced in the physician message ("Patient is on [med] ([class])").
        drugName: ctx.contextMeds.find(
          (m) =>
            m.drugClass === 'BETA_BLOCKER' ||
            m.drugClass === 'NDHP_CCB' ||
            m.drugClass === 'ANTIARRHYTHMIC',
        )?.drugName,
        drugClass: ctx.contextMeds.find(
          (m) =>
            m.drugClass === 'BETA_BLOCKER' ||
            m.drugClass === 'NDHP_CCB' ||
            m.drugClass === 'ANTIARRHYTHMIC',
        )?.drugClass,
        bradySustainedSessions: consecutiveSessionsLe45,
      },
    }
  }
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
      return `HR ${pulse} — absolute bradycardia (<${BRADY_ASYMPTOMATIC}); Tier 1 — ECG + pacemaker eval, hold rate-controlling agents.`
    }
    if (pulse < BRADY_SYMPTOMATIC) {
      const symptomatic =
        session.symptoms.alteredMentalStatus ||
        session.symptoms.chestPainOrDyspnea ||
        session.symptoms.focalNeuroDeficit ||
        session.symptoms.dizziness ||
        session.symptoms.syncope
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
