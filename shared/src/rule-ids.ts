// Phase/5 rule identifiers — the closed set of rules the engine can fire.
// Each value becomes a row on DeviationAlert.ruleId and indexes the phase/6
// message registry in alert-messages.ts. Adding a rule here requires a
// matching registry entry — OutputGenerator enforces that contract at
// module init (phase/6).

export const RULE_IDS = {
  // Contraindications (Tier 1, non-dismissable)
  PREGNANCY_ACE_ARB: 'RULE_PREGNANCY_ACE_ARB',
  NDHP_HFREF: 'RULE_NDHP_HFREF',

  // Symptom overrides (BP Level 2 at any BP)
  SYMPTOM_OVERRIDE_GENERAL: 'RULE_SYMPTOM_OVERRIDE_GENERAL',
  SYMPTOM_OVERRIDE_PREGNANCY: 'RULE_SYMPTOM_OVERRIDE_PREGNANCY',

  // Absolute emergency
  ABSOLUTE_EMERGENCY: 'RULE_ABSOLUTE_EMERGENCY',

  // Pregnancy thresholds
  PREGNANCY_L1_HIGH: 'RULE_PREGNANCY_L1_HIGH',
  PREGNANCY_L2: 'RULE_PREGNANCY_L2',

  // Condition branches
  HFREF_LOW: 'RULE_HFREF_LOW',
  HFREF_HIGH: 'RULE_HFREF_HIGH',
  HFPEF_LOW: 'RULE_HFPEF_LOW',
  HFPEF_HIGH: 'RULE_HFPEF_HIGH',
  CAD_DBP_CRITICAL: 'RULE_CAD_DBP_CRITICAL',
  CAD_HIGH: 'RULE_CAD_HIGH',
  HCM_LOW: 'RULE_HCM_LOW',
  HCM_HIGH: 'RULE_HCM_HIGH',
  HCM_VASODILATOR: 'RULE_HCM_VASODILATOR',
  DCM_LOW: 'RULE_DCM_LOW',
  DCM_HIGH: 'RULE_DCM_HIGH',

  // Personalized (threshold + ≥7 readings)
  PERSONALIZED_HIGH: 'RULE_PERSONALIZED_HIGH',
  PERSONALIZED_LOW: 'RULE_PERSONALIZED_LOW',

  // Standard mode (AHA 2025)
  STANDARD_L1_HIGH: 'RULE_STANDARD_L1_HIGH',
  STANDARD_L1_LOW: 'RULE_STANDARD_L1_LOW',

  // Age-based override
  AGE_65_LOW: 'RULE_AGE_65_LOW',

  // Heart rate branches
  AFIB_HR_HIGH: 'RULE_AFIB_HR_HIGH',
  AFIB_HR_LOW: 'RULE_AFIB_HR_LOW',
  TACHY_HR: 'RULE_TACHY_HR',
  BRADY_HR_SYMPTOMATIC: 'RULE_BRADY_HR_SYMPTOMATIC',
  BRADY_HR_ASYMPTOMATIC: 'RULE_BRADY_HR_ASYMPTOMATIC',

  // Physician-only
  PULSE_PRESSURE_WIDE: 'RULE_PULSE_PRESSURE_WIDE',
  LOOP_DIURETIC_HYPOTENSION: 'RULE_LOOP_DIURETIC_HYPOTENSION',
} as const

export type RuleId = (typeof RULE_IDS)[keyof typeof RULE_IDS]

export const ALL_RULE_IDS: RuleId[] = Object.values(RULE_IDS) as RuleId[]

// ─── Tier mapping ────────────────────────────────────────────────────────────
// Mirrors the AlertTier enum in prisma/schema/diviation_alert.prisma.

export type AlertTierValue =
  | 'TIER_1_CONTRAINDICATION'
  | 'TIER_2_DISCREPANCY'
  | 'TIER_3_INFO'
  | 'BP_LEVEL_1_HIGH'
  | 'BP_LEVEL_1_LOW'
  | 'BP_LEVEL_2'
  | 'BP_LEVEL_2_SYMPTOM_OVERRIDE'

export type AlertModeValue = 'STANDARD' | 'PERSONALIZED'

/** Tier 1 + BP Level 2 are non-dismissable per CLINICAL_SPEC V2-C + V2-D. */
export function isNonDismissable(tier: AlertTierValue): boolean {
  return (
    tier === 'TIER_1_CONTRAINDICATION' ||
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  )
}
