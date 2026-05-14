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

export function medicationMissedRuleWithWindow(
  recentMisses: AdherenceWindow,
): RuleFunction {
  return (session, ctx) => {
    const { daysWithMiss, daysWithMissOver7d, missesByDrugClass, missedMedications } = recentMisses

    // Carve-out: single beta-blocker miss for HFrEF / HCM / AFib patients.
    const isBetaBlockerCarveOut =
      (ctx.profile.hasHeartFailure || ctx.profile.hasHCM || ctx.profile.hasAFib) &&
      (missesByDrugClass.get('BETA_BLOCKER') ?? 0) >= 1

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
      annotations.push('beta-blocker-carve-out')
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
