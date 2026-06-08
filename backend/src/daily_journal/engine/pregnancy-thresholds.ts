// Phase/5 pregnancy-threshold rules — applies to all pregnant patients
// (incl. safety-net: unverified profile still activates). Source:
// CLINICAL_SPEC Part 3 (ACOG / CHAP). Step 3 emergency fires first (handled
// separately); these rules handle Level 1 (≥140/90) and Level 2 (≥160/110).

import { RULE_IDS, getPulsePressure } from '@cardioplace/shared'
import type { RuleFunction } from './types.js'

const PREGNANCY_L2_SBP = 160
const PREGNANCY_L2_DBP = 110
const PREGNANCY_L1_SBP = 140
const PREGNANCY_L1_DBP = 90

// Standard term-pregnancy length used to derive gestational age from EDD.
const PREGNANCY_TERM_WEEKS = 40
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/**
 * Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional
 * exception) — derive gestational age in completed weeks from the patient
 * profile's `pregnancyDueDate` (EDD). Formula: `40 - weeks-until-EDD`.
 * Caller passes `now` so the value is deterministic in tests.
 *
 * Returns `null` when:
 *   - profile lacks `pregnancyDueDate` (patient hasn't entered EDD)
 *   - derived weeks fall outside the plausible range (0…45)
 *
 * Clamping the upper bound at 45 catches stale/incorrect EDDs without
 * crashing the rule. Lower-bound 0 catches future-EDD-misread cases.
 *
 * Export so the pregnancy ACE/ARB contraindication rule shares one
 * computation path; if the formula evolves (LMP-based, ultrasound override),
 * one place to fix.
 */
export function gestationalAgeWeeksFromProfile(
  pregnancyDueDate: Date | null | undefined,
  now: Date,
): number | null {
  if (!pregnancyDueDate) return null
  const msUntilEdd = pregnancyDueDate.getTime() - now.getTime()
  const weeksUntilEdd = msUntilEdd / MS_PER_WEEK
  const ga = Math.round(PREGNANCY_TERM_WEEKS - weeksUntilEdd)
  if (!Number.isFinite(ga) || ga < 0 || ga > 45) return null
  return ga
}

export const pregnancyL2Rule: RuleFunction = (session, ctx) => {
  if (!ctx.pregnancyThresholdsActive) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (sbp == null && dbp == null) return null

  const hit =
    (sbp != null && sbp >= PREGNANCY_L2_SBP) ||
    (dbp != null && dbp >= PREGNANCY_L2_DBP)
  if (!hit) return null

  return {
    ruleId: RULE_IDS.PREGNANCY_L2,
    tier: 'BP_LEVEL_2',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbp ?? dbp,
    reason: `Pregnancy BP ≥${PREGNANCY_L2_SBP}/${PREGNANCY_L2_DBP}: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: {
      conditionLabel: 'Pregnancy',
      gestationalAgeWeeks: gestationalAgeWeeksFromProfile(
        ctx.profile.pregnancyDueDate,
        session.measuredAt,
      ),
    },
  }
}

export const pregnancyL1HighRule: RuleFunction = (session, ctx) => {
  if (!ctx.pregnancyThresholdsActive) return null
  const { systolicBP: sbp, diastolicBP: dbp } = session
  if (sbp == null && dbp == null) return null

  const hit =
    (sbp != null && sbp >= PREGNANCY_L1_SBP) ||
    (dbp != null && dbp >= PREGNANCY_L1_DBP)
  if (!hit) return null

  return {
    ruleId: RULE_IDS.PREGNANCY_L1_HIGH,
    tier: 'BP_LEVEL_1_HIGH',
    mode: 'STANDARD',
    pulsePressure: getPulsePressure(sbp, dbp),
    suboptimalMeasurement: session.suboptimalMeasurement,
    actualValue: sbp ?? dbp,
    reason: `Pregnancy BP ≥${PREGNANCY_L1_SBP}/${PREGNANCY_L1_DBP}: ${sbp ?? '?'}/${dbp ?? '?'}.`,
    metadata: {
      conditionLabel: 'Pregnancy',
      gestationalAgeWeeks: gestationalAgeWeeksFromProfile(
        ctx.profile.pregnancyDueDate,
        session.measuredAt,
      ),
    },
  }
}
