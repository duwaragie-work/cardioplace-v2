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
  // Manisha 5/24 Q5C — aortic stenosis (interim HCM-style thresholds: low <100,
  // high ≥160; provider-overridable, mandatory provider thresholds).
  AORTIC_STENOSIS_LOW: 'RULE_AORTIC_STENOSIS_LOW',
  AORTIC_STENOSIS_HIGH: 'RULE_AORTIC_STENOSIS_HIGH',

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
  // Manisha 5/24 Q2 — narrow pulse pressure on the session average (<25 mmHg),
  // condition-specific physician note. Distinct from the per-reading <15
  // artifact flag (JournalEntry.narrowPpArtifact, set at entry).
  PULSE_PRESSURE_NARROW: 'RULE_PULSE_PRESSURE_NARROW',
  LOOP_DIURETIC_HYPOTENSION: 'RULE_LOOP_DIURETIC_HYPOTENSION',

  // Medication adherence (Tier 2 discrepancy, dismissable) — fires on a
  // rolling 2-of-3-day pattern with a single-miss carve-out for beta-blockers
  // in HFrEF/HCM/AFib patients (Cluster 6, Manisha 5/10/26).
  MEDICATION_MISSED: 'RULE_MEDICATION_MISSED',

  // Cluster 6 — symptomatic bradycardia + adjacent rules driven by the new
  // dizziness / syncope / palpitations / legSwelling buttons.
  BRADY_ABSOLUTE: 'RULE_BRADY_ABSOLUTE',
  HF_DECOMPENSATION: 'RULE_HF_DECOMPENSATION',
  DHP_CCB_LEG_SWELLING: 'RULE_DHP_CCB_LEG_SWELLING',
  BETA_BLOCKER_DIZZINESS: 'RULE_BETA_BLOCKER_DIZZINESS',
  ORTHOSTATIC_HYPOTENSION: 'RULE_ORTHOSTATIC_HYPOTENSION',
  AFIB_PALPITATIONS: 'RULE_AFIB_PALPITATIONS',
  TACHY_WITH_PALPITATIONS: 'RULE_TACHY_WITH_PALPITATIONS',
  PALPITATIONS_GENERAL: 'RULE_PALPITATIONS_GENERAL',
  SYNCOPE_GENERAL: 'RULE_SYNCOPE_GENERAL',

  // Cluster 7 (Manisha 5/11/26) — Appendix A side-effect + interaction rules.
  // All Tier 3 (informational, patient-facing) unless noted.
  BETA_BLOCKER_FATIGUE: 'RULE_BETA_BLOCKER_FATIGUE',
  BETA_BLOCKER_SOB_HF: 'RULE_BETA_BLOCKER_SOB_HF',         // Tier 2 — escalates
  BETA_BLOCKER_SOB_NON_HF: 'RULE_BETA_BLOCKER_SOB_NON_HF',
  NSAID_ANTIHTN_INTERACTION: 'RULE_NSAID_ANTIHTN_INTERACTION',
  ACE_COUGH: 'RULE_ACE_COUGH',
  HF_CAREGIVER_EDEMA: 'RULE_HF_CAREGIVER_EDEMA',

  // Cluster 8 (Manisha 5/18/26, P0 pilot blocker) — ACE-angioedema airway
  // emergency. Fires on faceSwelling || throatTightness for ALL patients.
  // ACE_ANGIOEDEMA = ACE inhibitor OR ARB on med list (physician message
  // branches ACE vs ARB); GENERIC_ANGIOEDEMA = neither / unverified list.
  // Both tier TIER_1_ANGIOEDEMA, non-dismissable, compressed ladder.
  ACE_ANGIOEDEMA: 'RULE_ACE_ANGIOEDEMA',
  GENERIC_ANGIOEDEMA: 'RULE_GENERIC_ANGIOEDEMA',

  // Cluster 8 Q1 (Manisha 5/18/26) — asymptomatic bradycardia surveillance.
  // HR 40–49, no brady symptoms, on a rate-control med or hasBradycardia.
  // Tier 3 physician-only chart event; auto-escalates to Tier 2 when the
  // mean HR has been ≤45 across 3+ consecutive sessions.
  BRADY_SURVEILLANCE: 'RULE_BRADY_SURVEILLANCE',

  // Cluster 8 Q3 (Manisha 5/18/26) — one-time first-month educational
  // adherence nudge. Tier 3, patient-only, fires once ever within 30 days
  // of enrollment after the first reported missed dose. The 2-of-3 default
  // window is unchanged — this is purely additive.
  FIRST_MONTH_ADHERENCE_NUDGE: 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',

  // Cluster 8 Q2 (Manisha 5/18/26 implementation block) — CAD DBP-high.
  // Second independent BP-Level-1-High trigger at DBP ≥80 for CAD patients
  // (no prior DBP-high rule existed); co-fires with RULE_CAD_HIGH.
  CAD_DBP_HIGH: 'RULE_CAD_DBP_HIGH',

  // Option D — retake-to-confirm for BP-only emergencies (Manisha 2026-06-12
  // Edit-Window + Session Policy sign-off, Q2). Two outcomes of the
  // confirmatory-measurement flow when a BP ≥180/120 reading has NO
  // co-occurring symptoms (symptom-override emergencies still fire immediately
  // via RULE_ABSOLUTE_EMERGENCY / the symptom-override rules — Option A):
  //   • UNCONFIRMED_EMERGENCY — patient declined / closed the app / the 5-min
  //     window expired before a second reading. Tier 1 PROVIDER-ONLY (the
  //     reading is unconfirmed and may be artifactual — Implementation Note 5
  //     classes it Tier 1, NOT a Tier 2 emergency). Standard Tier 1 ladder.
  //   • EMERGENCY_RANGE_CONFIRMED_NORMAL — second reading came back below the
  //     emergency threshold. Tier 3 informational; no emergency alert fires,
  //     no ladder. Physician sees a "review at next encounter" note.
  // The engine wiring that FIRES these (the Option D state machine) is Step 3
  // of the build; this registers the IDs + three-tier messages so the registry
  // contract + escalation routing are in place first.
  UNCONFIRMED_EMERGENCY: 'RULE_UNCONFIRMED_EMERGENCY',
  EMERGENCY_RANGE_CONFIRMED_NORMAL: 'RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL',
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
  // Cluster 8 — angioedema. Tier-1 class (non-dismissable) but routed to a
  // compressed escalation ladder instead of the standard Tier 1 ladder.
  | 'TIER_1_ANGIOEDEMA'

export type AlertModeValue = 'STANDARD' | 'PERSONALIZED'

/** Tier 1 + BP Level 2 are non-dismissable per CLINICAL_SPEC V2-C + V2-D.
 *  Cluster 8 — TIER_1_ANGIOEDEMA is a Tier-1 airway emergency, also
 *  non-dismissable (resolution requires a documented rationale + the
 *  15-field Joint Commission audit trail). */
export function isNonDismissable(tier: AlertTierValue): boolean {
  return (
    tier === 'TIER_1_CONTRAINDICATION' ||
    tier === 'TIER_1_ANGIOEDEMA' ||
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  )
}

// ─── Triggering-value axis (Phase 1 polish — Finding 10) ─────────────────────
//
// The audit footer's "TRIGGERING VALUE" (formerly the ambiguous "ACTUAL
// VALUE 165") needs an axis + unit so a reviewer knows whether 165 is
// systolic, diastolic, or heart rate without cross-referencing the rule ID.
//
// Every value in RULE_IDS is mapped. Classification:
//   • 'hr'        — heart-rate threshold rules (bpm)
//   • 'diastolic' — rules that compare against the diastolic target (mmHg)
//   • 'systolic'  — BP rules; systolic is the primary axis even when the
//                   rule can also fire on diastolic (single-axis is fine for
//                   pilot — dual-axis is future-spec per the plan §H note)
//   • 'profile'   — contraindication / medication / symptom-driven rules
//                   whose actualValue is null (no measured trigger value)
//
// ⚠ Clinical-review flags (best-effort, pilot-safe defaults):
//   - RULE_PULSE_PRESSURE_WIDE: labelled systolic-derived (PP = SBP−DBP);
//     a dedicated "pulse pressure" axis could be added if Dr. Singal wants.
//   - RULE_ORTHOSTATIC_HYPOTENSION: classed 'profile' (postural/symptom-
//     driven) though it involves a positional BP delta.
//   - RULE_SYMPTOM_OVERRIDE_*: value-derived but symptom-triggered; kept
//     'systolic' per the plan's mapping.
export type RuleAxis = 'systolic' | 'diastolic' | 'hr' | 'profile'

export const RULE_AXIS: Record<RuleId, RuleAxis> = {
  // Heart-rate rules
  [RULE_IDS.AFIB_HR_HIGH]: 'hr',
  [RULE_IDS.AFIB_HR_LOW]: 'hr',
  [RULE_IDS.TACHY_HR]: 'hr',
  [RULE_IDS.BRADY_ABSOLUTE]: 'hr',
  [RULE_IDS.BRADY_HR_SYMPTOMATIC]: 'hr',
  [RULE_IDS.BRADY_HR_ASYMPTOMATIC]: 'hr',
  [RULE_IDS.BRADY_SURVEILLANCE]: 'hr',

  // Diastolic-axis rule
  [RULE_IDS.CAD_DBP_CRITICAL]: 'diastolic',
  [RULE_IDS.CAD_DBP_HIGH]: 'diastolic',

  // Systolic-axis BP rules (primary axis = systolic)
  [RULE_IDS.STANDARD_L1_HIGH]: 'systolic',
  [RULE_IDS.STANDARD_L1_LOW]: 'systolic',
  [RULE_IDS.ABSOLUTE_EMERGENCY]: 'systolic',
  [RULE_IDS.PERSONALIZED_HIGH]: 'systolic',
  [RULE_IDS.PERSONALIZED_LOW]: 'systolic',
  [RULE_IDS.HFREF_LOW]: 'systolic',
  [RULE_IDS.HFREF_HIGH]: 'systolic',
  [RULE_IDS.HFPEF_LOW]: 'systolic',
  [RULE_IDS.HFPEF_HIGH]: 'systolic',
  [RULE_IDS.CAD_HIGH]: 'systolic',
  [RULE_IDS.HCM_LOW]: 'systolic',
  [RULE_IDS.HCM_HIGH]: 'systolic',
  [RULE_IDS.DCM_LOW]: 'systolic',
  [RULE_IDS.DCM_HIGH]: 'systolic',
  [RULE_IDS.AORTIC_STENOSIS_LOW]: 'systolic',
  [RULE_IDS.AORTIC_STENOSIS_HIGH]: 'systolic',
  [RULE_IDS.AGE_65_LOW]: 'systolic',
  [RULE_IDS.PREGNANCY_L1_HIGH]: 'systolic',
  [RULE_IDS.PREGNANCY_L2]: 'systolic',
  [RULE_IDS.SYMPTOM_OVERRIDE_GENERAL]: 'systolic',
  [RULE_IDS.SYMPTOM_OVERRIDE_PREGNANCY]: 'systolic',
  [RULE_IDS.LOOP_DIURETIC_HYPOTENSION]: 'systolic',
  [RULE_IDS.PULSE_PRESSURE_WIDE]: 'systolic',
  [RULE_IDS.PULSE_PRESSURE_NARROW]: 'systolic',
  // Option D (Manisha 2026-06-12 Q2) — both are BP-reading rules; the
  // triggering value axis is systolic. UNCONFIRMED_EMERGENCY's actualValue is
  // the unconfirmed SBP; CONFIRMED_NORMAL carries the confirmatory SBP (both
  // readings are spelled out in the physician message regardless).
  [RULE_IDS.UNCONFIRMED_EMERGENCY]: 'systolic',
  [RULE_IDS.EMERGENCY_RANGE_CONFIRMED_NORMAL]: 'systolic',

  // Profile / medication / symptom-driven rules (actualValue is null)
  [RULE_IDS.NDHP_HFREF]: 'profile',
  [RULE_IDS.PREGNANCY_ACE_ARB]: 'profile',
  [RULE_IDS.HCM_VASODILATOR]: 'profile',
  [RULE_IDS.ACE_COUGH]: 'profile',
  [RULE_IDS.BETA_BLOCKER_FATIGUE]: 'profile',
  [RULE_IDS.BETA_BLOCKER_SOB_HF]: 'profile',
  [RULE_IDS.BETA_BLOCKER_SOB_NON_HF]: 'profile',
  [RULE_IDS.BETA_BLOCKER_DIZZINESS]: 'profile',
  [RULE_IDS.NSAID_ANTIHTN_INTERACTION]: 'profile',
  [RULE_IDS.HF_CAREGIVER_EDEMA]: 'profile',
  [RULE_IDS.HF_DECOMPENSATION]: 'profile',
  [RULE_IDS.MEDICATION_MISSED]: 'profile',
  [RULE_IDS.DHP_CCB_LEG_SWELLING]: 'profile',
  [RULE_IDS.ORTHOSTATIC_HYPOTENSION]: 'profile',
  [RULE_IDS.AFIB_PALPITATIONS]: 'profile',
  [RULE_IDS.TACHY_WITH_PALPITATIONS]: 'profile',
  [RULE_IDS.PALPITATIONS_GENERAL]: 'profile',
  [RULE_IDS.SYNCOPE_GENERAL]: 'profile',
  // Cluster 8 — angioedema is symptom-driven; actualValue carries SBP for
  // context only, not the trigger. 'profile' suppresses a misleading
  // "TRIGGERING VALUE" axis label in the audit footer.
  [RULE_IDS.ACE_ANGIOEDEMA]: 'profile',
  [RULE_IDS.GENERIC_ANGIOEDEMA]: 'profile',
  [RULE_IDS.FIRST_MONTH_ADHERENCE_NUDGE]: 'profile',
}

const AXIS_LABEL: Record<RuleAxis, string> = {
  systolic: 'systolic',
  diastolic: 'diastolic',
  hr: 'heart rate',
  profile: '',
}

const AXIS_UNIT: Record<RuleAxis, string> = {
  systolic: 'mmHg',
  diastolic: 'mmHg',
  hr: 'bpm',
  profile: '',
}

/**
 * Format the audit footer's TRIGGERING VALUE with axis + unit context:
 *   "165 mmHg (systolic)" · "45 bpm (heart rate)" ·
 *   "Not applicable — profile-based rule" (profile rules / null) ·
 *   "—" (value-based rule with a genuinely missing value)
 * Unmapped rule ids fall back to 'systolic' (safe for any future BP rule
 * before its RULE_AXIS entry lands). Display-only — does not touch the
 * `actualValue` data model.
 */
export function formatTriggeringValue(
  ruleId: string | null | undefined,
  actualValue: number | null | undefined,
): string {
  const axis: RuleAxis =
    (ruleId ? RULE_AXIS[ruleId as RuleId] : undefined) ?? 'systolic'
  if (axis === 'profile') return 'Not applicable — profile-based rule'
  if (actualValue === null || actualValue === undefined) return '—'
  return `${actualValue} ${AXIS_UNIT[axis]} (${AXIS_LABEL[axis]})`
}
