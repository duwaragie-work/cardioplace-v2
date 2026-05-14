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
}
