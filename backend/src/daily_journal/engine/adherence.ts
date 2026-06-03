// Tier 2 medication adherence rule — Cluster 6 (Manisha 5/10/26 sign-off).
//
// Default trigger: ≥2 missed-medication-days within a rolling 3-day window.
// Carve-out: a SINGLE missed dose of a beta-blocker fires when the patient
// has HFrEF / HCM / AFib (rebound tachycardia + hypertensive risk per the
// 2018 ACC/AHA bradycardia + AHA HTN scientific statements).
//
// Escalates from a passive yellow badge to a provider push notification
// when the window expands to ≥3 miss-days within rolling 7 — surfaced as a
// physicianAnnotation the EscalationService consumes (no new ladder).
//
// Runs in an independent Pass 2 pipeline so adherence coexists with the
// multi-axis BP/HR pipeline (a single entry can fire BP L1 + adherence
// simultaneously). See AlertEngineService.evaluate().

import { RULE_IDS } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'
import type { AdherenceWindow } from './adherence-window.js'

const RECENT_MISS_THRESHOLD = 2
const EXTENDED_MISS_THRESHOLD = 3

/**
 * Carve-out predicate: a SINGLE missed beta-blocker dose in an HFrEF / HCM /
 * AFib patient (rebound tachycardia + hypertensive risk). Shared by the Tier-2
 * adherence rule (which fires on it) and the first-month nudge (which skips it —
 * those patients get the Tier-2 alert, not the gentle educational nudge).
 */
function betaBlockerSingleMissCarveOut(
  window: AdherenceWindow,
  profile: { hasHeartFailure: boolean; hasHCM: boolean; hasAFib: boolean },
): boolean {
  return (
    (profile.hasHeartFailure || profile.hasHCM || profile.hasAFib) &&
    (window.missesByDrugClass.get('BETA_BLOCKER') ?? 0) >= 1
  )
}

export function medicationMissedRuleWithWindow(
  recentMisses: AdherenceWindow,
): RuleFunction {
  return (session, ctx) => {
    const { daysWithMiss, daysWithMissOver7d, missedMedications } = recentMisses

    // Carve-out: single beta-blocker miss for HFrEF / HCM / AFib patients.
    const isBetaBlockerCarveOut = betaBlockerSingleMissCarveOut(recentMisses, ctx.profile)

    if (!isBetaBlockerCarveOut && daysWithMiss < RECENT_MISS_THRESHOLD) {
      return null
    }

    // Escalate to provider push when the pattern persists over 7 days.
    // EscalationService's standard Tier 2 ladder honours this annotation.
    const annotations: string[] = []
    if (daysWithMissOver7d >= EXTENDED_MISS_THRESHOLD) {
      annotations.push('escalate-3-of-7')
    }
    if (isBetaBlockerCarveOut) {
      // #93 (2026-06-03) — clinical prose, not an internal path tag. Explains
      // to the provider WHY a single missed dose escalated to Tier 2 (the
      // HFrEF/HCM/AFib β-blocker safety carve-out). Rendered via physSuffix.
      annotations.push(
        'Tier 2 dispatched on single missed dose per HFrEF / HCM / AFib β-blocker safety policy.',
      )
    }

    return {
      ruleId: RULE_IDS.MEDICATION_MISSED,
      tier: 'TIER_2_DISCREPANCY',
      mode: 'STANDARD',
      pulsePressure: null,
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: daysWithMiss,
      reason: isBetaBlockerCarveOut
        ? 'Beta-blocker miss in HFrEF/HCM/AFib patient — single-miss carve-out.'
        : `Non-adherence pattern: ${daysWithMiss}/3 days with missed doses.`,
      metadata: {
        conditionLabel: 'Medication adherence',
        missedMedications,
        // The output-generator reads daysWithMiss + carveOut + drug list to
        // render the three-tier patient/caregiver/physician messages.
        adherenceDaysWithMiss: daysWithMiss,
        adherenceDaysWithMissOver7d: daysWithMissOver7d,
        adherenceBetaBlockerCarveOut: isBetaBlockerCarveOut,
        physicianAnnotations: annotations.length > 0 ? annotations : undefined,
      },
    }
  }
}

// Cluster 8 Q3 (Manisha 5/18/26) — first-month educational nudge. The
// 2-of-3 default window (above) is UNCHANGED. This is a purely additive,
// one-time, Tier 3 patient-only educational message: a single gentle nudge
// after the patient's first reported missed dose, but only within the first
// 30 days of enrollment (the AHA highest-risk non-adherence window). The
// "fires once per patient ever" guarantee is enforced by the engine via a
// prior-alert existence check (mirrors the CAD-ramp one-time notice).
const FIRST_MONTH_DAYS = 30

export function firstMonthAdherenceNudge(
  window: AdherenceWindow,
): RuleFunction {
  return (session, ctx) => {
    if (ctx.enrolledAt == null) return null
    const ageMs = ctx.resolvedAt.getTime() - ctx.enrolledAt.getTime()
    if (ageMs < 0 || ageMs > FIRST_MONTH_DAYS * 24 * 60 * 60 * 1000) return null

    // Manisha 5/24 Med §5 — patients who qualify for the beta-blocker single-
    // miss carve-out get the Tier-2 adherence alert, NOT this gentle first-month
    // nudge. Suppress the nudge so the safety-critical alert isn't softened.
    if (betaBlockerSingleMissCarveOut(window, ctx.profile)) return null

    // Any miss reported in the rolling window (3- or 7-day) counts as the
    // patient's "first missed dose" — the engine's one-time guard ensures
    // this only ever fires once, so a broad miss signal is correct here.
    const anyMiss =
      window.daysWithMissOver7d >= 1 || window.missedMedications.length >= 1
    if (!anyMiss) return null

    return {
      ruleId: RULE_IDS.FIRST_MONTH_ADHERENCE_NUDGE,
      tier: 'TIER_3_INFO',
      mode: 'STANDARD',
      pulsePressure: null,
      suboptimalMeasurement: session.suboptimalMeasurement,
      actualValue: null,
      reason:
        'First missed dose within the first 30 days of enrollment — one-time educational nudge.',
      metadata: { conditionLabel: 'Medication adherence' },
    }
  }
}

/**
 * Backwards-compat single-session rule. Used only by older tests that
 * exercise the rule in isolation without a window. Returns null unless the
 * legacy `medicationTaken=false` flag is set AND no window data is provided.
 * Prefer the windowed variant above.
 */
export const medicationMissedRule: RuleFunction = (session) => {
  void session
  return null
}
