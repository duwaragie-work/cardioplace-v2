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
  /**
   * All drug names matched by the rule. Populated by rules that can fire
   * on multiple meds at once (e.g. pregnancy + ACE/ARB when the patient is
   * on Prinivil and Zestoretic). Falls back to `[drugName]` when the rule
   * only carries a single match. Always non-empty when `drugName` is set.
   */
  drugNames: string[]
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

  /** Cluster 6 — adherence template inputs. Cleaner than threading them
   *  through `physicianAnnotations`. Only populated for RULE_MEDICATION_MISSED. */
  adherenceDaysWithMiss?: number
  adherenceDaysWithMissOver7d?: number
  adherenceBetaBlockerCarveOut?: boolean

  /** Cluster 6 — patient first name (when available). Used by caregiver
   *  message templates for the new HF / adherence rules. */
  patientName?: string | null

  /** Cluster 6 Q2 (Manisha 5/9/26) — true when the alert fired against a
   *  single-reading session that was finalized by the 5-min timeout
   *  (i.e. the patient didn't log a second reading to confirm). Drives a
   *  "— confirm with next reading" annotation on the physician message. */
  singleReadingSession?: boolean

  /** Cluster 8 — which angioedema symptom(s) the patient reported. Drives
   *  whether the message leads with face-swelling or throat-tightness
   *  phrasing. Populated only for the angioedema rules. */
  angioedemaFace?: boolean
  angioedemaThroat?: boolean

  /** Cluster 8 Q1 — consecutive ≤45 bpm sessions, rendered in the
   *  brady-surveillance physician message. */
  bradySustainedSessions?: number
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
  const parts: string[] = []
  if (ctx.physicianAnnotations.length) parts.push(...ctx.physicianAnnotations)
  // Cluster 6 Q2 (Manisha 5/9/26) — single-reading-session caveat.
  if (ctx.singleReadingSession) {
    parts.push('Single-reading session — confirm with next reading')
  }
  return parts.length ? ` | ${parts.join(' | ')}` : ''
}

function preDaySuffix(ctx: AlertContext): string {
  return ctx.preDay3 ? PRE_DAY_3_DISCLAIMER : ''
}

function suboptimalSuffix(ctx: AlertContext): string {
  return ctx.suboptimalMeasurement ? SUBOPTIMAL_SUFFIX : ''
}

/**
 * Plain-English join of drug names: "" / "X" / "X and Y" / "X, Y, and Z".
 * Used by patient + caregiver messages so a multi-drug Tier 1 reads as
 * natural prose instead of a comma-joined CSV.
 */
function formatDrugList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
}

// ─── registry ────────────────────────────────────────────────────────────────

export const alertMessageRegistry: Record<RuleId, RuleMessages> = {
  // ── Tier 1 contraindications ──────────────────────────────────────────
  RULE_PREGNANCY_ACE_ARB: {
    patientMessage: (ctx) => {
      // Name every offending drug — patient may be on Prinivil + Zestoretic,
      // and discontinuing only the named one is unsafe. Plain language only;
      // patient hears the brand/generic names they recognize from their
      // pillbox, no drug-class jargon.
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const lead = drugList
        ? `Your care team needs to review ${drugList} because you are pregnant.`
        : 'Your care team needs to review your blood pressure medicine because you are pregnant.'
      return `${lead} Please call your provider today before taking your next dose.`
    },
    caregiverMessage: (ctx) => {
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const lead = drugList
        ? `The patient is pregnant and is taking ${drugList}, which need urgent provider review.`
        : 'The patient is pregnant and has a blood pressure medicine that needs urgent provider review.'
      return `${lead} Please help them contact their care team today.`
    },
    physicianMessage: (ctx) => {
      const names =
        ctx.drugNames.length > 0
          ? ctx.drugNames.join(', ')
          : (ctx.drugName ?? 'unknown')
      return `Tier 1 — ACE/ARB (${names}, ${ctx.drugClass ?? 'unknown'}) in pregnant patient. Teratogenic; discontinue and switch to CHAP-protocol alternative (labetalol or long-acting nifedipine).${physSuffix(ctx)}`
    },
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
    // Cluster 6 Q6 (Manisha 5/9/26): current patient-facing wording approved
    // — keep "preeclampsia" since pregnant patients routinely encounter the
    // term in prenatal care. Caregiver + physician wording stays as-is.
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
    // Cluster 8 Q2 (Manisha 5/18/26) — default alert threshold lowered to
    // SBP ≥140 (Stage 2 HTN floor). Always surface the AHA/ACC 130/80
    // treatment target + the DBP coronary-perfusion caution so the provider
    // can customise the threshold per patient.
    physicianMessage: (ctx) =>
      `BP Level 1 High — CAD SBP ≥ ${ctx.thresholdValue ?? 140}: ${bp(ctx)} (session average). AHA/ACC treatment target 130/80. Consider medication adjustment. NOTE: monitor DBP — coronary perfusion (J-curve) risk if DBP < 70. Customise the alert threshold in patient settings.${physSuffix(ctx)}`,
  },
  // Cluster 8 Q2 (Manisha 5/18/26) — CAD DBP-high, the "second independent
  // alert trigger" (145/95 fires this alongside RULE_CAD_HIGH).
  RULE_CAD_DBP_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than your goal. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's lower BP number is elevated at ${bp(ctx)} (CAD).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — CAD DBP ≥ ${ctx.thresholdValue ?? 80}: ${bp(ctx)} (session average). AHA/ACC treatment target 130/80. Consider medication adjustment. NOTE: coronary perfusion (J-curve) risk if DBP < 70 — reassess antihypertensive class rather than over-titrating. Customise the alert threshold in patient settings.${physSuffix(ctx)}`,
  },

  // ── HCM ───────────────────────────────────────────────────────────────
  // Cluster 7 A.5 (Manisha 5/11/26, Appendix B1.4): HCM patients are
  // preload-dependent — low BP can reduce perfusion. Patient-facing wording
  // names the symptoms to watch for so they know when to act.
  RULE_HCM_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is too low for you. With your heart condition, low blood pressure can reduce blood flow to your body — watch for dizziness, lightheadedness, or feeling faint. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (HCM). Watch for dizziness, lightheadedness, or fainting and help them contact their care team.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — HCM SBP < ${ctx.thresholdValue ?? 100}: ${bp(ctx)}. Preload-dependent — under-perfusion + dynamic LVOT obstruction risk.${physSuffix(ctx)}`,
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

  // ── Aortic stenosis (Manisha 5/24 Q5C) ────────────────────────────────
  // Interim HCM-style thresholds (low <100, high ≥160). Fixed valvular outflow
  // obstruction → preload/afterload sensitive; low BP is the bigger concern.
  RULE_AORTIC_STENOSIS_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is too low for you. With your heart valve condition, low blood pressure can reduce blood flow to your body — watch for dizziness, lightheadedness, chest pain, or feeling faint. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is low at ${bp(ctx)} (aortic stenosis). Watch for dizziness, lightheadedness, chest pain, or fainting and help them contact their care team.`,
    physicianMessage: (ctx) =>
      `BP Level 1 Low — aortic stenosis SBP < ${ctx.thresholdValue ?? 100}: ${bp(ctx)}. Fixed outflow obstruction — afterload/preload sensitive; hypotension risks syncope + coronary under-perfusion. Interim HCM-style thresholds pending provider-set targets.${physSuffix(ctx)}`,
  },
  RULE_AORTIC_STENOSIS_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure reading is ${bp(ctx)}, which is higher than the goal for you. Please contact your care team today.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `The patient's BP is elevated at ${bp(ctx)} (aortic stenosis).`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — aortic stenosis SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}. Interim HCM-style thresholds pending provider-set targets.${physSuffix(ctx)}`,
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
  // Manisha 5/24 Q2 — narrow pulse pressure on the session average (<25 mmHg).
  // Physician-only; condition-specific wording keyed on conditionLabel set by
  // the rule ('HFrEF' [also DCM], 'HFpEF', 'HCM'/'aortic stenosis', else null).
  RULE_PULSE_PRESSURE_NARROW: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) => {
      const pp = `${bp(ctx)} (PP = ${ctx.pulsePressure ?? '?'} mmHg)`
      const label = ctx.conditionLabel
      if (label === 'HFrEF') {
        return `Tier 3 — Narrow pulse pressure: ${pp}. In HFrEF, narrow PP may indicate reduced stroke volume. Consider clinical correlation — echocardiography if new finding or worsening trend.${physSuffix(ctx)}`
      }
      if (label === 'HFpEF') {
        return `Tier 3 — Narrow pulse pressure: ${pp}. Note: In HFpEF, narrow PP is less prognostically significant than in HFrEF. Clinical correlation recommended.${physSuffix(ctx)}`
      }
      if (label === 'HCM' || label === 'aortic stenosis') {
        return `Tier 3 — Narrow pulse pressure: ${pp}. In the context of ${label}, narrow PP may reflect fixed outflow obstruction. Clinical correlation recommended.${physSuffix(ctx)}`
      }
      return `Tier 3 — Narrow pulse pressure: ${pp}. If confirmed on repeat measurement, consider evaluation for reduced cardiac output.${physSuffix(ctx)}`
    },
  },
  RULE_LOOP_DIURETIC_HYPOTENSION: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Loop diuretic + SBP ${ctx.systolicBP ?? '?'} — increased hypotension sensitivity.${physSuffix(ctx)}`,
  },

  // ── Tier 2 medication adherence (Cluster 6 — Manisha 5/10/26 wording) ─
  RULE_MEDICATION_MISSED: {
    patientMessage: (ctx) => {
      const meds = ctx.missedMedications ?? []
      const list = meds.length > 0 ? formatDrugList(meds.map((m) => m.drugName)) : ''
      if (ctx.adherenceBetaBlockerCarveOut && list) {
        return (
          `It looks like you may have missed ${list} today. This medicine is important for your heart. ` +
          'Please try to take your next dose on time, and let your care team know if anything is making it hard to stay on schedule.'
        )
      }
      if (list) {
        return (
          `It looks like you may have missed ${list} a couple of times recently. These medicines help protect your heart and keep your blood pressure steady. ` +
          'If anything is making it hard to take them, your care team can help.'
        )
      }
      return (
        'It looks like you may have missed your medicine a couple of times recently. Taking your medicine regularly helps keep your blood pressure steady. ' +
        'If something is making it hard to stay on schedule, your care team can help.'
      )
    },
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      const days = ctx.adherenceDaysWithMiss ?? 0
      const meds = ctx.missedMedications ?? []
      const list = meds.length > 0 ? formatDrugList(meds.map((m) => m.drugName)) : ''
      if (list) {
        return (
          `${name} has reported missing ${list} on ${days} of the last 3 days. ` +
          'A gentle check-in may help — common reasons include side effects, cost, or forgetting.'
        )
      }
      return (
        `${name} has reported missing medication doses on ${days} of the last 3 days. ` +
        'A gentle check-in may help identify any barriers.'
      )
    },
    physicianMessage: (ctx) => {
      const days = ctx.adherenceDaysWithMiss ?? 0
      const meds = ctx.missedMedications ?? []
      if (meds.length === 0) {
        return (
          `Tier 2 — Non-adherence pattern: patient self-reported missed doses on ${days}/3 days (no medication specified). ` +
          `Consider barrier assessment and reconciliation.${physSuffix(ctx)}`
        )
      }
      const detail = meds
        .map(
          (m) =>
            `${m.drugName} (${m.drugClass}) — missed ${m.missedDoses}/3 days — reason: ${m.reason}`,
        )
        .join('; ')
      return (
        `Tier 2 — Non-adherence pattern: ${detail}. ` +
        `Consider barrier assessment; if persistent, evaluate regimen simplification or longer-acting agent.${physSuffix(ctx)}`
      )
    },
  },

  // ── Cluster 6 — bradycardia + symptom-driven rules ─────────────────────

  RULE_BRADY_ABSOLUTE: {
    patientMessage: () =>
      'Your heart rate is very low and your care team has been notified. Please contact your care team or call 911 right away if you feel dizzy, faint, short of breath, or have chest pain.',
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name}'s heart rate is below 40 bpm. This needs urgent attention — please help them contact their care team or 911 if they have any symptoms.`
    },
    physicianMessage: (ctx) =>
      `Tier 1 — Absolute bradycardia ${hr(ctx)}. ECG + pacemaker evaluation; hold rate-controlling agents pending review.${physSuffix(ctx)}`,
  },

  RULE_HF_DECOMPENSATION: {
    patientMessage: () =>
      'You reported swelling in your ankles or legs (or a quick weight gain). Because of your heart condition, your care team needs to know about this right away. ' +
      'Please also let them know if you have gained weight, feel more short of breath, or are having trouble lying flat.',
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported leg swelling or rapid weight gain. With their heart condition this can indicate fluid overload — please contact their care team today.`
    },
    physicianMessage: (ctx) =>
      `Tier 2 — Possible HF decompensation. Patient reported leg swelling and/or >2 lb weight gain in 24h. Review volume status, diuretic regimen, and consider in-person visit.${physSuffix(ctx)}`,
  },

  RULE_DHP_CCB_LEG_SWELLING: {
    patientMessage: () =>
      'You reported swelling in your ankles or legs. This can sometimes happen with your blood-pressure medicine. It is usually not dangerous, but your care team should know — they may want to adjust your medicine.',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Possible DHP-CCB peripheral edema. Patient on dihydropyridine CCB reports leg swelling without HF flag. Consider dose reduction or non-DHP alternative.${physSuffix(ctx)}`,
  },

  RULE_BETA_BLOCKER_DIZZINESS: {
    patientMessage: () =>
      "You reported feeling dizzy, and your blood pressure looks lower than usual. Please sit or lie down until it passes, and let your care team know — they may want to review your medicine.",
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Possible β-blocker-induced hypotension. ${bp(ctx)} with dizziness reported. Consider dose review or timing change.${physSuffix(ctx)}`,
  },

  RULE_ORTHOSTATIC_HYPOTENSION: {
    patientMessage: () =>
      "You reported feeling dizzy, and your blood pressure dropped compared to your last reading. Try standing up slowly and drinking water. If it happens again, please let your care team know.",
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported dizziness with a drop in blood pressure from the prior reading. Watch for unsteadiness when they stand up and let their care team know if it continues.`
    },
    physicianMessage: (ctx) =>
      `Tier 2 — Orthostatic hypotension pattern: SBP drop ≥15 mmHg from prior session with dizziness. Review antihypertensive regimen + hydration status.${physSuffix(ctx)}`,
  },

  RULE_AFIB_PALPITATIONS: {
    patientMessage: () =>
      "You reported your heart feeling like it's racing or fluttering. With your AFib history, your care team should know about this. Please contact them today.",
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported palpitations. With their AFib history, please help them contact their care team today.`
    },
    physicianMessage: (ctx) =>
      `Tier 2 — AFib patient reports palpitations. Consider paroxysmal AFib recurrence. Review rate control.${physSuffix(ctx)}`,
  },

  RULE_TACHY_WITH_PALPITATIONS: {
    patientMessage: () =>
      "You reported your heart racing, and your pulse is higher than usual. Please rest, drink water, and let your care team know if it doesn't settle in the next hour.",
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 2 — Symptomatic tachycardia: ${hr(ctx)} with palpitations reported. Rule out causes; consider Holter / event monitor.${physSuffix(ctx)}`,
  },

  RULE_PALPITATIONS_GENERAL: {
    patientMessage: () =>
      "You reported your heart feeling like it's racing or fluttering. Your pulse looks normal right now, but please mention this at your next visit — your care team may want to take a closer look.",
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Patient reports palpitations with normal resting HR. Consider Holter/event monitor at next visit.${physSuffix(ctx)}`,
  },

  RULE_SYNCOPE_GENERAL: {
    patientMessage: () =>
      'You reported feeling faint or passing out recently. This always needs a doctor to look at. Please contact your care team today — and call 911 if you feel faint again with chest pain, weakness, or trouble breathing.',
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported a recent fainting or near-fainting episode. Please help them contact their care team today.`
    },
    physicianMessage: (ctx) =>
      `Tier 2 — Syncope/near-syncope reported. Consider cardiac vs. vasovagal etiology. ECG recommended.${physSuffix(ctx)}`,
  },

  // ─── Cluster 7 (Manisha 5/11/26) — Appendix A side-effect/interaction ───
  // Patient-facing copy pulled from MANISHA_MASTER_GUIDE_V3 Appendix A.2 /
  // A.3 / A.5 / A.6 / B1.3 / B1.4 / B1.5. Tier 3 entries are informational —
  // patient inbox surface, no escalation. Tier 2 BETA_BLOCKER_SOB_HF
  // escalates via the standard Tier 2 ladder.

  RULE_BETA_BLOCKER_FATIGUE: {
    patientMessage: () =>
      "You reported feeling more tired than usual. This can happen with your blood-pressure medicine, especially when you first start it or after a dose change. It usually gets better over a few weeks. If it's making your day harder, let your care team know — they may adjust the timing or dose.",
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Patient on β-blocker reports fatigue. Common dose-dependent side effect; consider dose review, evening dosing, or β1-selective alternative if persistent or limiting.${physSuffix(ctx)}`,
  },

  RULE_BETA_BLOCKER_SOB_HF: {
    patientMessage: () =>
      "You reported shortness of breath. Because of your heart condition, this is something your care team needs to know about today. Please contact them — and call 911 if you can't catch your breath at rest or it's getting worse quickly.",
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported new shortness of breath and is on a β-blocker for heart failure. Please help them contact their care team today; watch for worsening breathing at rest or sudden weight gain.`
    },
    physicianMessage: (ctx) =>
      `Tier 2 — HF patient on β-blocker reports new shortness of breath. Decompensation risk — assess volume status, BNP/NT-proBNP, and consider in-person visit. Do NOT abruptly stop β-blocker.${physSuffix(ctx)}`,
  },

  RULE_BETA_BLOCKER_SOB_NON_HF: {
    patientMessage: () =>
      'You reported shortness of breath. This can sometimes happen with your blood-pressure medicine. Let your care team know at your next visit so they can check whether the medicine needs adjusting.',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — Patient on β-blocker (non-HF) reports shortness of breath. Possible bronchospasm or exercise intolerance; consider β1-selective switch and pulmonary review.${physSuffix(ctx)}`,
  },

  RULE_NSAID_ANTIHTN_INTERACTION: {
    patientMessage: () =>
      "You told us you've taken a pain reliever like ibuprofen, Advil, Aleve, or naproxen. These can raise your blood pressure and make your blood-pressure medicine work less well, especially if you take them often. If your pain needs a few days of relief, acetaminophen (Tylenol) is usually a safer choice — please check with your care team.",
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — NSAID use reported alongside antihypertensive therapy. Blunts ACE/ARB/diuretic efficacy + drives sodium retention. Counsel patient on acetaminophen alternative; reassess BP trend.${physSuffix(ctx)}`,
  },

  RULE_ACE_COUGH: {
    patientMessage: () =>
      'You reported a dry, tickly cough. This is a common side effect of one of your blood-pressure medicines — it usually starts within the first few weeks of starting it. It is not dangerous, but if the cough is bothering you, please let your care team know. There is a related medicine that often does not cause this cough that they can switch you to.',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `Tier 3 — ACE inhibitor cough reported. Bradykinin-mediated; consider ARB switch if persistent or limiting.${physSuffix(ctx)}`,
  },

  RULE_HF_CAREGIVER_EDEMA: {
    patientMessage: () => '',
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported new swelling in their ankles or legs. With heart failure, this can be an early sign of fluid build-up. Please weigh them today and tomorrow morning — if they gain more than 2 pounds, or if breathing gets harder, contact their care team. Keep an eye on swelling, breathing, and weight over the next few days.`
    },
    physicianMessage: (ctx) =>
      `Tier 3 — HF patient + new ankle edema, routed to caregiver for monitoring. Sibling row of HF_DECOMPENSATION (Tier 2 physician escalation).${physSuffix(ctx)}`,
  },

  // ── Cluster 8 — ACE-angioedema (P0 pilot blocker, Manisha 5/18/26) ──────
  // Patient + caregiver wording is the approved revised 1.7 / B1.6 verbatim.
  // ACE_ANGIOEDEMA tells the patient to STOP the medicine (ACE/ARB is the
  // likely cause); GENERIC_ANGIOEDEMA omits that line (cause unknown).
  RULE_ACE_ANGIOEDEMA: {
    patientMessage: (ctx) => `${angioedemaPatientLead(ctx)} Do not take any more of your blood pressure medicine until your doctor tells you it is safe.`,
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported swelling of their face, lips, or tongue. This can be a dangerous reaction to one of their blood pressure medicines. If they have trouble breathing or throat tightness, call 911 now. If not, take them to the nearest emergency room now. Do not let them take another dose of that medicine.`
    },
    physicianMessage: (ctx) => {
      const drug = ctx.drugName ?? 'unknown'
      const airway = ctx.angioedemaThroat
        ? ' Throat tightness reported — potential airway compromise.'
        : ''
      if (ctx.drugClass === 'ARB') {
        return `Tier 1 — RULE_ACE_ANGIOEDEMA: Patient on ${drug} (ARB) self-reported facial/lip/tongue swelling.${airway} ARB-associated angioedema is less common than ACE-inhibitor angioedema but uses the same emergency pathway. Discontinue ARB. Evaluate for alternative etiology.${physSuffix(ctx)}`
      }
      return `Tier 1 — RULE_ACE_ANGIOEDEMA: Patient on ${drug} (ACE_INHIBITOR) self-reported facial/lip/tongue swelling.${airway} ACE-inhibitor angioedema — airway obstruction risk ~10%. Standard antihistamines/corticosteroids/epinephrine are NOT reliably effective (bradykinin-mediated). Discontinue ACE inhibitor immediately. Do not rechallenge with any ACE inhibitor (class effect). Consider ARB with caution (cross-reactivity reported but uncommon).${physSuffix(ctx)}`
    },
  },

  RULE_GENERIC_ANGIOEDEMA: {
    // No "stop your medicine" line — cause may not be a medication (doc p.5).
    patientMessage: (ctx) => angioedemaPatientLead(ctx),
    caregiverMessage: (ctx) => {
      const name = ctx.patientName?.trim() || 'The patient'
      return `${name} reported swelling of their face, lips, or tongue. This can be dangerous and needs urgent medical attention. If they have trouble breathing or throat tightness, call 911 now. If not, take them to the nearest emergency room now.`
    },
    physicianMessage: (ctx) => {
      const airway = ctx.angioedemaThroat
        ? ' Throat tightness reported — potential airway compromise.'
        : ''
      return `Tier 1 — RULE_GENERIC_ANGIOEDEMA: Patient self-reported facial/lip/tongue swelling.${airway} No ACE inhibitor or ARB on verified med list. Differential: allergic angioedema, hereditary angioedema, idiopathic, or unverified ACE/ARB exposure. Standard anaphylaxis protocol appropriate if allergic etiology suspected.${physSuffix(ctx)}`
    },
  },

  // ── Cluster 8 Q1 — asymptomatic bradycardia surveillance ───────────────
  // Physician-only: no patient/caregiver message (patient is asymptomatic —
  // no reason to alarm them). Tier 3 = chart event + yellow dot, no push.
  // The escalated (Tier 2) variant swaps in the sustained-pattern wording.
  RULE_BRADY_SURVEILLANCE: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) => {
      const hr = ctx.pulse ?? '?'
      const med = ctx.drugName ?? 'a rate-controlling medication'
      const cls = ctx.drugClass ?? 'rate-control'
      const sessions = ctx.bradySustainedSessions ?? 0
      if (sessions >= 3) {
        return `Tier 2 — Sustained asymptomatic bradycardia: mean resting HR ≤45 bpm on ${sessions} consecutive sessions (current ${hr} bpm). Patient is on ${med} (${cls}). ECG and medication-dose review recommended.${physSuffix(ctx)}`
      }
      return `Tier 3 — Surveillance: resting HR ${hr} bpm (asymptomatic). Patient is on ${med} (${cls}). Consider: is this the therapeutic target? Trend review recommended. If HR persists ≤45 on multiple sessions, consider ECG and medication-dose review.${physSuffix(ctx)}`
    },
  },

  // ── Cluster 8 Q3 — first-month educational adherence nudge ─────────────
  // Patient-only, Tier 3, one-time. Verbatim from the sign-off (doc p.7).
  // No provider/caregiver message — educational, not clinical.
  RULE_FIRST_MONTH_ADHERENCE_NUDGE: {
    patientMessage: () =>
      'Starting a new medicine can take some getting used to. If you missed a dose, try to take your next one on time. Taking your medicine every day helps keep your blood pressure steady. Your care team is here to help if anything makes it hard to stay on schedule.',
    caregiverMessage: () => '',
    physicianMessage: () => '',
  },
}

/**
 * Cluster 8 — shared patient lead for both angioedema rules. Leads with the
 * throat-tightness phrasing when that is the only symptom reported (doc p.6,
 * throat tightness fires for ALL patients as an airway emergency); otherwise
 * uses the approved revised-1.7 face/lip/tongue wording. Caller appends the
 * "do not take your medicine" line for the ACE/ARB variant only.
 */
function angioedemaPatientLead(ctx: AlertContext): string {
  if (ctx.angioedemaThroat && !ctx.angioedemaFace) {
    return 'You reported that your throat feels tight or that it is hard to swallow. This can be a breathing emergency. Call 911 now.'
  }
  return 'You reported swelling of your face, lips, or tongue. This needs urgent medical attention. If you also have trouble breathing or feel tightness in your throat, call 911 now. If not, go to the nearest emergency room now.'
}

/**
 * Cluster 7 A.7 + Manisha 5/24 Med §3 — system message dispatched to the
 * patient's inbox when a provider places a medication on HOLD. TWO PATHS
 * (patient-safety critical): a provider-directed hold is a clinical "pause it"
 * instruction; an administrative hold (awaiting records / unclear name or dose /
 * other) must NOT tell the patient to stop a medication they're correctly
 * taking — abrupt β-blocker discontinuation for a paperwork delay can cause
 * rebound harm. The administrative message does not name the medication.
 */
export type MedicationHoldMessageReason =
  | 'AWAITING_RECORDS'
  | 'UNCLEAR_NAME'
  | 'UNCLEAR_DOSE'
  | 'PROVIDER_DIRECTED_HOLD'
  | 'OTHER'

export function systemMsgMedicationHold(
  drugName: string,
  reason: MedicationHoldMessageReason,
): string {
  if (reason === 'PROVIDER_DIRECTED_HOLD') {
    return `Your care team has asked you to pause ${drugName} until they can review it with you. Do not take it until your care team tells you it is okay.`
  }
  // Administrative holds — keep taking everything as usual; do not name the med.
  return `Your care team is reviewing your medicine list to make sure everything is up to date. Keep taking your medicines as usual unless your care team tells you otherwise.`
}

/** True for the clinical "stop taking it" hold path. */
export function isProviderDirectedHold(
  reason: MedicationHoldMessageReason,
): boolean {
  return reason === 'PROVIDER_DIRECTED_HOLD'
}

/**
 * Patient inbox message when a provider rejects a self-reported profile field
 * during verification. Names the field so the patient knows exactly what to
 * re-check — the value isn't erased, they confirm or update it.
 * NEEDS CLINICAL SIGN-OFF (Dr. Singal) — wording is provisional.
 */
export function systemMsgProfileFieldRejected(fieldLabel: string): string {
  return `Your care team needs you to re-check your ${fieldLabel}. Please open your profile to confirm or update it. If you have questions, contact your care team.`
}

/**
 * Patient inbox message when a provider sets or changes the patient's
 * personalized BP monitoring targets (THR-034 — transparency). Not required by
 * the clinical doc; NEEDS CLINICAL SIGN-OFF (Dr. Singal) — wording provisional.
 */
export function systemMsgThresholdUpdated(): string {
  return `Your care team updated your blood-pressure monitoring targets. Your future check-ins will use the new targets. If you have questions, contact your care team.`
}
