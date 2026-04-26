// Phase/6 three-tier message registry — Dr. Singal's sign-off target.
//
// Single source of truth for every alert rule's patient / caregiver /
// physician wording. Each ruleId from rule-ids.ts has a matching entry;
// OutputGeneratorService enforces registry completeness at module init.
//
// Writing guidelines (CLINICAL_SPEC §V2-C + §V2-E):
//  - patient: plain language, warm tone, action-oriented. No clinical jargon.
//    Tier 1 patient messages avoid medication names by default — direct
//    patients to discuss with their provider. BP Level 2 patient messages
//    include an explicit 911 CTA.
//  - caregiver: context + caregiver action. Populated when the patient is
//    non-verbal / elderly / has caregiver assigned. MVP: same or similar to
//    patient-facing but second-person plural tone. Physician-only rules
//    return empty string.
//  - physician: clinical shorthand. Includes drug name, threshold, and any
//    Tier 3 physician annotations (wide PP, loop-diuretic sensitivity).

import type { RuleId } from './rule-ids.js'

// ─── public types ────────────────────────────────────────────────────────────

/**
 * Context passed to every MessageBuilder. Supplied by OutputGenerator from
 * the AlertEngine's RuleResult + session + ResolvedContext. All numeric
 * fields are session-averaged (not per-reading).
 */
export interface AlertContext {
  /** Session vitals (session-averaged, integer). */
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null

  /** Snapshot pulse pressure cached on DeviationAlert at fire-time. */
  pulsePressure: number | null

  /** Drug name (single) that triggered a medication-linked rule. */
  drugName: string | null
  /** Drug class, used for physician-facing messages. */
  drugClass: string | null

  /** Human-readable condition ("HFrEF", "CAD", "Pregnancy", "AFib"). */
  conditionLabel: string | null
  /** Numeric threshold that was compared against (e.g. 160, 70, 20). */
  thresholdValue: number | null

  /** Rule-level extras the orchestrator wants surfaced to the physician. */
  physicianAnnotations: string[]

  /** True when <7 readings — appended disclaimer on standard-mode alerts. */
  preDay3: boolean
  /** Pre-measurement-checklist flagged at least one item false. */
  suboptimalMeasurement: boolean

  /**
   * Per-medication miss detail supplied by the patient at check-in. Populated
   * only for RULE_MEDICATION_MISSED. Order matches the user's selection order.
   * Empty/undefined when the patient answered "missed" generically without
   * specifying which medications — the messages fall back to a non-specific
   * warm reminder in that case.
   */
  missedMedications?: Array<{
    drugName: string
    drugClass: string
    reason: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER'
    missedDoses: number
  }>
}

export type MessageBuilder = (ctx: AlertContext) => string

export interface RuleMessages {
  patientMessage: MessageBuilder
  caregiverMessage: MessageBuilder
  physicianMessage: MessageBuilder
}

// ─── fragments + helpers ─────────────────────────────────────────────────────

const EMERGENCY_CTA =
  ' If you have chest pain, severe headache, trouble breathing, weakness, or vision changes, call 911 now.'

const PRE_DAY_3_DISCLAIMER =
  ' (Standard threshold — personalization begins after Day 3.)'

const SUBOPTIMAL_SUFFIX =
  ' Please retake the reading following the measurement checklist.'

function bp(ctx: AlertContext): string {
  const sbp = ctx.systolicBP ?? '?'
  const dbp = ctx.diastolicBP ?? '?'
  return `${sbp}/${dbp} mmHg`
}

function hr(ctx: AlertContext): string {
  return `HR ${ctx.pulse ?? '?'} bpm`
}

function physSuffix(ctx: AlertContext): string {
  if (!ctx.physicianAnnotations.length) return ''
  return ' | ' + ctx.physicianAnnotations.join(' | ')
}

function preDaySuffix(ctx: AlertContext): string {
  return ctx.preDay3 ? PRE_DAY_3_DISCLAIMER : ''
}

function suboptimalSuffix(ctx: AlertContext): string {
  return ctx.suboptimalMeasurement ? SUBOPTIMAL_SUFFIX : ''
}

// ─── registry ────────────────────────────────────────────────────────────────

export const alertMessageRegistry: Record<RuleId, RuleMessages> = {
  // ── Tier 1 contraindications ──────────────────────────────────────────
  RULE_PREGNANCY_ACE_ARB: {
    patientMessage: () =>
      'Your care team needs to review your blood pressure medicine because you are pregnant. Please call your provider today before taking your next dose.',
    caregiverMessage: () =>
      'The patient is pregnant and has a blood pressure medicine that needs urgent provider review. Please help them contact their care team today.',
    physicianMessage: (ctx) =>
      `Tier 1 — ACE/ARB (${ctx.drugName ?? 'unknown'}, ${ctx.drugClass ?? 'unknown'}) in pregnant patient. Teratogenic; discontinue and switch to CHAP-protocol alternative (labetalol or long-acting nifedipine).${physSuffix(ctx)}`,
  },

  RULE_NDHP_HFREF: {
    patientMessage: () =>
      'Your care team needs to review one of your heart medicines with you. Please call your provider today before taking your next dose.',
    caregiverMessage: () =>
      'The patient has a heart-failure diagnosis and is taking a medication that needs urgent provider review. Please help them contact their care team today.',
    physicianMessage: (ctx) =>
      `Tier 1 — Nondihydropyridine CCB (${ctx.drugName ?? 'unknown'}) in HFrEF. Negative inotropic; discontinue per 2025 AHA/ACC.${physSuffix(ctx)}`,
  },

  // ── BP Level 2 symptom overrides ──────────────────────────────────────
  RULE_SYMPTOM_OVERRIDE_GENERAL: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)} and you reported serious symptoms.${EMERGENCY_CTA}`,
    caregiverMessage: (ctx) =>
      `The patient reported symptoms consistent with hypertensive emergency at ${bp(ctx)}.${EMERGENCY_CTA}`,
    physicianMessage: (ctx) =>
      `BP Level 2 — symptom override at ${bp(ctx)}. Reported: ${ctx.conditionLabel ?? '—'}.${physSuffix(ctx)}`,
  },

  RULE_SYMPTOM_OVERRIDE_PREGNANCY: {
    // TODO(Dr. Singal): "preeclampsia" in the patient-facing line may be too
    // clinical for the silent-literacy audience per CLINICAL_SPEC §V2-E.
    // Suggested plain-language alternative pending her review:
    //   `You reported a symptom that needs urgent attention during pregnancy at ${bp(ctx)}.${EMERGENCY_CTA}`
    // Caregiver + physician wording keeps the clinical term intentionally.
    patientMessage: (ctx) =>
      `You reported a symptom that may signal preeclampsia at ${bp(ctx)}.${EMERGENCY_CTA}`,
    caregiverMessage: (ctx) =>
      `The pregnant patient reported symptoms consistent with preeclampsia at ${bp(ctx)}.${EMERGENCY_CTA}`,
    physicianMessage: (ctx) =>
      `BP Level 2 — pregnancy symptom override at ${bp(ctx)}. Reported: ${ctx.conditionLabel ?? '—'}. Assess for preeclampsia with severe features.${physSuffix(ctx)}`,
  },

  // ── Absolute emergency ────────────────────────────────────────────────
  RULE_ABSOLUTE_EMERGENCY: {
    patientMessage: (ctx) =>
      `Your blood pressure is very high: ${bp(ctx)}.${EMERGENCY_CTA}`,
    caregiverMessage: (ctx) =>
      `The patient's blood pressure is very high: ${bp(ctx)}.${EMERGENCY_CTA}`,
    physicianMessage: (ctx) =>
      `BP Level 2 — ${bp(ctx)} (SBP ≥180 or DBP ≥120). Prompt symptom assessment; treat per hypertensive-urgency protocol if confirmed target organ involvement.${physSuffix(ctx)}`,
  },

  // ── Pregnancy thresholds ──────────────────────────────────────────────
  RULE_PREGNANCY_L2: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is very high for pregnancy.${EMERGENCY_CTA}`,
    caregiverMessage: (ctx) =>
      `The pregnant patient's BP is severely elevated at ${bp(ctx)}.${EMERGENCY_CTA}`,
    physicianMessage: (ctx) =>
      `BP Level 2 — pregnancy ≥160/110 at ${bp(ctx)}. Severe-range hypertension; treat within 15 minutes per ACOG.${physSuffix(ctx)}`,
  },

  RULE_PREGNANCY_L1_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than the goal for pregnancy. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The pregnant patient's BP is elevated at ${bp(ctx)}; needs same-day provider review.`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — pregnancy ≥140/90 at ${bp(ctx)}. Assess for preeclampsia features.${physSuffix(ctx)}`,
  },

  // ── HFrEF ─────────────────────────────────────────────────────────────
  RULE_HFREF_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is lower than the goal set for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (HFrEF).`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — HFrEF SBP < ${ctx.thresholdValue ?? 85}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_HFREF_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than the goal for your heart. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (HFrEF).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — HFrEF SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── HFpEF ─────────────────────────────────────────────────────────────
  RULE_HFPEF_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is lower than the goal for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (HFpEF).`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — HFpEF SBP < ${ctx.thresholdValue ?? 110}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_HFPEF_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than the goal for your heart. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (HFpEF).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — HFpEF SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── CAD ───────────────────────────────────────────────────────────────
  RULE_CAD_DBP_CRITICAL: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}. The lower number is concerning for your heart. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's DBP is low at ${bp(ctx)} (CAD). Needs same-day provider review.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — CAD DBP < 70 at ${bp(ctx)}. J-curve risk per CLARIFY; reassess antihypertensive intensity.${physSuffix(ctx)}`,
  },
  RULE_CAD_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than your goal. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (CAD).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — CAD SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── HCM ───────────────────────────────────────────────────────────────
  RULE_HCM_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is lower than the goal for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (HCM).`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — HCM SBP < ${ctx.thresholdValue ?? 100}: ${bp(ctx)}. Dynamic LVOT obstruction risk.${physSuffix(ctx)}`,
  },
  RULE_HCM_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than the goal for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (HCM).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — HCM SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_HCM_VASODILATOR: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — HCM + ${ctx.drugClass ?? 'vasodilator/nitrate/loop'} (${ctx.drugName ?? 'unknown'}): may worsen LVOT obstruction. Review per 2024 AHA/ACC HCM guideline.${physSuffix(ctx)}`,
  },

  // ── DCM ───────────────────────────────────────────────────────────────
  RULE_DCM_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is lower than the goal for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (DCM).`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — DCM SBP < ${ctx.thresholdValue ?? 85}: ${bp(ctx)}. Managed as HFrEF.${physSuffix(ctx)}`,
  },
  RULE_DCM_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than your goal. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (DCM).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — DCM SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── Personalized mode ─────────────────────────────────────────────────
  RULE_PERSONALIZED_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is above the target your provider set for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is above provider-set target: ${bp(ctx)}.`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — personalized: SBP ≥ target + 20 = ${ctx.thresholdValue ?? '?'}. Current ${bp(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_PERSONALIZED_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is below the target your provider set for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is below provider-set lower target: ${bp(ctx)}.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — personalized: SBP < lower target ${ctx.thresholdValue ?? '?'}. Current ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── Standard mode ─────────────────────────────────────────────────────
  RULE_STANDARD_L1_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is high. Please contact your care team today.${preDaySuffix(ctx)}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)}.`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — severe Stage 2 (≥160/100) at ${bp(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_STANDARD_L1_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is low. Please contact your care team today.${preDaySuffix(ctx)}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)}.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — SBP <90 at ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── Age 65+ override ─────────────────────────────────────────────────
  RULE_AGE_65_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is low. Please contact your care team today and watch for dizziness or fall risk.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)}; assess for orthostatic symptoms and fall risk.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — age 65+ override: SBP <100 at ${bp(ctx)}.${physSuffix(ctx)}`,
  },

  // ── HR branches ───────────────────────────────────────────────────────
  RULE_AFIB_HR_HIGH: {
    patientMessage: (ctx) =>
      `Your heart rate is ${hr(ctx)}, which is higher than your goal. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's heart rate is elevated at ${hr(ctx)} (AFib).`,
    physicianMessage: (ctx) =>
      `HR Level 1 High — AFib HR >110: ${hr(ctx)}. Rate-uncontrolled AFib.${physSuffix(ctx)}`,
  },
  RULE_AFIB_HR_LOW: {
    patientMessage: (ctx) =>
      `Your heart rate is ${hr(ctx)}, which is lower than your goal. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's heart rate is low at ${hr(ctx)} (AFib).`,
    physicianMessage: (ctx) =>
      `HR Level 1 Low — AFib HR <50: ${hr(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_TACHY_HR: {
    patientMessage: (ctx) =>
      `Your heart rate is ${hr(ctx)}, which is high. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's heart rate is elevated at ${hr(ctx)} on repeat readings.`,
    physicianMessage: (ctx) =>
      `HR Level 1 High — tachycardia HR >100 on ≥2 consecutive readings: ${hr(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_BRADY_HR_SYMPTOMATIC: {
    patientMessage: (ctx) =>
      `Your heart rate is ${hr(ctx)} and you reported symptoms. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's heart rate is low at ${hr(ctx)} with symptoms.`,
    physicianMessage: (ctx) =>
      `HR Level 1 Low — symptomatic bradycardia <50: ${hr(ctx)}.${physSuffix(ctx)}`,
  },
  RULE_BRADY_HR_ASYMPTOMATIC: {
    patientMessage: (ctx) =>
      `Your heart rate is ${hr(ctx)}, which is low. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's heart rate is low at ${hr(ctx)}.`,
    physicianMessage: (ctx) =>
      `HR Level 1 Low — asymptomatic bradycardia <40: ${hr(ctx)}.${physSuffix(ctx)}`,
  },

  // ── Physician-only ───────────────────────────────────────────────────
  RULE_PULSE_PRESSURE_WIDE: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Wide pulse pressure: ${ctx.pulsePressure ?? '?'} mmHg (>60) at ${bp(ctx)}. Consider arterial stiffness / isolated systolic HTN workup.${physSuffix(ctx)}`,
  },
  RULE_LOOP_DIURETIC_HYPOTENSION: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Loop diuretic + SBP ${ctx.systolicBP ?? '?'} — increased hypotension sensitivity.${physSuffix(ctx)}`,
  },

  // ── Tier 2 medication adherence ───────────────────────────────────────
  // TODO(Dr. Singal): review all three tones + confirm that single-miss is
  // the right threshold. Wording is a first-pass placeholder.
  RULE_MEDICATION_MISSED: {
    patientMessage: (ctx) => {
      const meds = ctx.missedMedications ?? []
      if (meds.length === 0) {
        return "We noticed you didn't take your medication today. Try to take your next dose on time, and talk to your care team if you're having trouble staying on schedule."
      }
      const list = meds.map((m) => m.drugName).join(', ')
      return `We noticed you missed ${list} today. Try to take your next dose on time, and let your care team know if there's anything making it hard to stay on schedule.`
    },
    caregiverMessage: (ctx) => {
      const meds = (ctx.missedMedications ?? []).map((m) => m.drugName).join(', ')
      return meds
        ? `The patient reported missing ${meds} today. A gentle reminder may help them stay on track.`
        : 'The patient reported missing a medication dose today. A gentle reminder may help.'
    },
    physicianMessage: (ctx) => {
      const meds = ctx.missedMedications ?? []
      if (meds.length === 0) {
        return `Tier 2 — Patient self-reported missed dose (no medication specified). Consider reconciliation at next visit.${physSuffix(ctx)}`
      }
      const detail = meds
        .map((m) => `${m.drugName} (${m.drugClass}) — reason: ${m.reason}, doses missed: ${m.missedDoses}`)
        .join('; ')
      return `Tier 2 — Non-adherence self-reported: ${detail}.${physSuffix(ctx)}`
    },
  },
}
