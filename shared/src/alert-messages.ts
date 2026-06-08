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

import { RULE_AXIS } from './rule-ids.js'
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

  /** #83 — the firing rule's id, used to scope the single-reading caveat to
   *  BP/HR threshold rules only (see physSuffix). Optional so direct test
   *  callers can omit it; OutputGenerator always populates it in production. */
  ruleId?: RuleId

  /**
   * Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional
   * exception) — gestational age in weeks. Threaded through to the
   * pregnancy-rule physician messages because teratogenic ACE/ARB risk
   * differs by trimester (first-trimester carries a lower but still
   * elevated risk; second/third trimester causes classic fetopathy:
   * renal dysgenesis, oligohydramnios, pulmonary hypoplasia). Populated
   * by OutputGenerator from PatientProfile when the rule fires against a
   * pregnant patient; null when unknown or non-pregnancy alerts. The
   * other Decision-4 placeholders ([age], [medication list]) remain
   * backlogged.
   */
  gestationalAgeWeeks?: number | null
}

export type MessageBuilder = (ctx: AlertContext) => string

export interface RuleMessages {
  patientMessage: MessageBuilder
  caregiverMessage: MessageBuilder
  physicianMessage: MessageBuilder
}

// ─── fragments + helpers ─────────────────────────────────────────────────────

// Handoff 4 / Doc 2 — three reusable, Manisha-verbatim fragments. Exported so
// the same canonical strings back the patient/caregiver alert bodies, the
// email templates, and any future surface. Each carries a leading space so it
// composes onto a preceding sentence.
//
// MVP US-only: emergency number hardcoded to 911. See CROSS_HANDOFF_ADDENDUM_2026_06_03.md.
// Post-MVP: replace with {{emergencyNumber}} resolved by locale.
export const EMERGENCY_CTA =
  ' If you are having chest pain, trouble breathing, or feel like you might faint, call 911 right away.'

// Doc 2 Fragment 2 — care-team notification. Manisha's patient/caregiver bodies
// close on this passive assurance ("we told them") rather than an active
// "please contact" instruction, except where the rule needs the patient to act.
export const CARE_TEAM_NOTIFIED = 'Your care team has been notified.'

// Doc 2 Fragment 3 — safety-critical. Patients who receive an alarming alert may
// self-discontinue a medication, which can cause rebound harm. Never let an alert
// imply "stop your medicine" unless a provider directed it.
export const DO_NOT_STOP_MED =
  'Please do not stop taking any medication on your own without talking to your care team.'

// Manisha 5/24 Q3 — pre-personalization fires Level 1 WITH this disclaimer
// (option a), and personalization is anchored on a reading count, not a calendar
// day. Wording updated "after Day 3" → "after 7 readings" to match the actual
// gate (PRE_DAY_3_MIN_READINGS = 7).
const PRE_DAY_3_DISCLAIMER =
  ' (Standard threshold — personalization begins after 7 readings.)'

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
  // #83 (2026-06-03) — "confirm with next reading" is BP-averaging language:
  // a second reading could change a threshold-band call. It is clinically
  // irrelevant on the medication / contraindication / symptom-driven rules
  // (RULE_AXIS 'profile' — adherence, angioedema, ACE cough, palpitations,
  // etc.), where the finding doesn't depend on a repeat BP/HR measurement.
  // Gate the caveat to non-'profile' (systolic / diastolic / hr) rules. When
  // ruleId is absent (direct test callers) we keep the legacy behavior.
  const suffixApplies =
    ctx.ruleId == null || RULE_AXIS[ctx.ruleId] !== 'profile'
  if (ctx.singleReadingSession && suffixApplies) {
    parts.push('Single-reading session — confirm with next reading')
  }
  return parts.length ? ` | ${parts.join(' | ')}` : ''
}

function preDaySuffix(ctx: AlertContext): string {
  return ctx.preDay3 ? PRE_DAY_3_DISCLAIMER : ''
}

/**
 * Manisha Q5 (2026-06-02) — severe-Stage-2 band label for RULE_STANDARD_L1_HIGH,
 * naming the axis that crossed so the physician message can't self-contradict:
 *   • SBP ≥160, DBP <100  → "severe Stage 2 SBP (SBP ≥160)"
 *   • DBP ≥100, SBP <160  → "severe Stage 2 DBP (DBP ≥100)"
 *   • both                → "severe Stage 2 (≥160/100)"
 * The rule fires when EITHER axis crosses, so these three cases are exhaustive;
 * a missing-value edge falls through to the combined label.
 */
function stage2Band(ctx: AlertContext): string {
  const sbpHigh = ctx.systolicBP != null && ctx.systolicBP >= 160
  const dbpHigh = ctx.diastolicBP != null && ctx.diastolicBP >= 100
  if (sbpHigh && !dbpHigh) return 'severe Stage 2 SBP (SBP ≥160)'
  if (dbpHigh && !sbpHigh) return 'severe Stage 2 DBP (DBP ≥100)'
  return 'severe Stage 2 (≥160/100)'
}

function suboptimalSuffix(ctx: AlertContext): string {
  return ctx.suboptimalMeasurement ? SUBOPTIMAL_SUFFIX : ''
}

/**
 * Caregiver-tier name lead. Manisha's Doc 2 caregiver wording opens with
 * "[Patient name]'s blood pressure is…"; fall back to "The patient" when the
 * name is unavailable so the possessive still reads naturally.
 */
function patientNameOr(ctx: AlertContext): string {
  return ctx.patientName?.trim() || 'The patient'
}

/**
 * Manisha Open-Decisions sign-off 2026-06-06 (Decision 4, conditional
 * exception) — render gestational age as a clinician-readable suffix that
 * inlines naturally after the BP value or drug-list. Returns empty string
 * when GA is unknown (non-pregnancy alert, missing profile field, or
 * pre-pilot data). Format follows obstetrics convention "Xw" (weeks).
 *
 * Examples:
 *   gestationalAgePhrase({...gestationalAgeWeeks: 28}) → " (28w)"
 *   gestationalAgePhrase({...gestationalAgeWeeks: null}) → ""
 *
 * Kept generic (no rule-id check) — every pregnancy rule that wants it
 * just inlines the call.
 */
function gestationalAgePhrase(ctx: AlertContext): string {
  const ga = ctx.gestationalAgeWeeks
  if (ga == null) return ''
  if (!Number.isFinite(ga) || ga < 1 || ga > 45) return ''
  return ` (${ga}w gestation)`
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
  // Doc 2 (Manisha 6/2) — patient must NOT be frightened into abruptly stopping
  // the medication (rebound hypertension risk). Name every offending drug — the
  // patient may be on Prinivil + Zestoretic — using the brand/generic names from
  // their pillbox, no drug-class jargon in the patient tier.
  RULE_PREGNANCY_ACE_ARB: {
    patientMessage: (ctx) => {
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const med = drugList ? ` (${drugList})` : ''
      return `One of your medications${med} is not recommended during pregnancy. Please do not stop taking it on your own — your care team has been notified and will contact you to discuss a safe alternative.`
    },
    caregiverMessage: (ctx) => {
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const med = drugList ? ` (${drugList})` : ''
      return `${patientNameOr(ctx)} is taking a medication${med} that is not recommended during pregnancy. Their care team has been notified and will follow up.`
    },
    physicianMessage: (ctx) => {
      const names =
        ctx.drugNames.length > 0
          ? ctx.drugNames.join(', ')
          : (ctx.drugName ?? 'unknown')
      const cls = ctx.drugClass ?? 'ACE inhibitor/ARB'
      // Decision 4 conditional — gestational age is most clinically
      // meaningful for the ACE/ARB rule: 2nd/3rd trimester carries the
      // classic fetopathy (renal dysgenesis, oligohydramnios, pulmonary
      // hypoplasia); 1st trimester carries lower but still elevated risk.
      return `CONTRAINDICATION — Pregnant patient on ${cls}: ${names}${gestationalAgePhrase(ctx)}. ACE/ARBs are contraindicated in pregnancy (FDA Category D/X). Recommend immediate substitution (CHAP-protocol alternative — labetalol or long-acting nifedipine). Patient has been advised not to self-discontinue.${physSuffix(ctx)}`
    },
  },

  // Doc 2 (Manisha 6/2) — same patient-safety guardrail as PREGNANCY_ACE_ARB:
  // do not let the patient self-discontinue. Tone is serious but not alarming.
  RULE_NDHP_HFREF: {
    patientMessage: (ctx) => {
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const med = drugList ? ` (${drugList})` : ''
      return `One of your medications${med} may need to be reviewed because of your heart condition. ${CARE_TEAM_NOTIFIED} Please do not stop taking it on your own.`
    },
    caregiverMessage: (ctx) => {
      const names = ctx.drugNames.length > 0 ? ctx.drugNames : ctx.drugName ? [ctx.drugName] : []
      const drugList = formatDrugList(names)
      const med = drugList ? ` (${drugList})` : ''
      return `${patientNameOr(ctx)} is taking a medication${med} that may need to be reviewed given their heart failure diagnosis. ${CARE_TEAM_NOTIFIED}`
    },
    physicianMessage: (ctx) =>
      `CONTRAINDICATION — HFrEF patient on non-dihydropyridine CCB: ${ctx.drugName ?? 'unknown'} (diltiazem/verapamil). NDHP-CCBs are potentially harmful in HFrEF (negative inotropy) per 2022 AHA/ACC/HFSA HF guideline. Recommend review and substitution.${physSuffix(ctx)}`,
  },

  // ── BP Level 2 symptom overrides ──────────────────────────────────────
  // Doc 2 (Manisha 6/2). Symptom list comes from ctx.conditionLabel; report
  // time is referenced in Manisha's clinician wording but isn't on AlertContext
  // (omitted). MVP US-only: 911 hardcoded per CROSS_HANDOFF_ADDENDUM_2026_06_03.md.
  RULE_SYMPTOM_OVERRIDE_GENERAL: {
    patientMessage: () =>
      'Based on what you reported, your care team needs to know right away. If you are having chest pain, trouble breathing, or feel like you might faint, call 911. Otherwise, your care team has been notified and will contact you.',
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)} reported symptoms that need attention: ${ctx.conditionLabel ?? '—'}. ${CARE_TEAM_NOTIFIED} If they are having chest pain, trouble breathing, or feel faint, please help them call 911.`,
    physicianMessage: (ctx) =>
      `SYMPTOM OVERRIDE — Patient reported: ${ctx.conditionLabel ?? '—'}. BP at time of report: ${bp(ctx)}, ${hr(ctx)}. Symptoms triggered override regardless of BP threshold. Recommend urgent clinical assessment.${physSuffix(ctx)}`,
  },

  // Doc 2 (Manisha 6/2) supersedes the Cluster 6 Q6 (5/9) "preeclampsia"
  // patient wording — newest sign-off wins. Gestational age omitted (not on
  // AlertContext). MVP US-only: 911 hardcoded per CROSS_HANDOFF_ADDENDUM.
  RULE_SYMPTOM_OVERRIDE_PREGNANCY: {
    patientMessage: () =>
      "Some of the symptoms you reported can be serious during pregnancy. Please call your doctor or go to the hospital right away. If you have trouble breathing or a very bad headache that won't go away, call 911.",
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)} reported pregnancy-related symptoms that may be serious: ${ctx.conditionLabel ?? '—'}. Please help them contact their doctor or go to the hospital. If they have trouble breathing, call 911.`,
    physicianMessage: (ctx) =>
      `PREGNANCY SYMPTOM OVERRIDE — Patient reported: ${ctx.conditionLabel ?? '—'}. BP: ${bp(ctx)}. Evaluate for preeclampsia with severe features. ACOG criteria: headache unresponsive to medication, visual disturbances, RUQ/epigastric pain, thrombocytopenia, elevated LFTs, renal insufficiency.${physSuffix(ctx)}`,
  },

  // ── Absolute emergency ────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2) — the most urgent alert in the system. Patient copy is
  // directive, not suggestive. No raw BP number in the patient tier (anxiety);
  // caregiver + clinician carry the reading.
  // MVP US-only: emergency number hardcoded to 911. See CROSS_HANDOFF_ADDENDUM_2026_06_03.md.
  // Post-MVP: replace with {{emergencyNumber}} resolved by locale.
  RULE_ABSOLUTE_EMERGENCY: {
    patientMessage: () =>
      'Your blood pressure is dangerously high and you are having symptoms that need emergency care. Call 911 or go to the nearest emergency room right now. Do not wait.',
    caregiverMessage: (ctx) =>
      `URGENT — ${patientNameOr(ctx)}'s blood pressure is dangerously high (${bp(ctx)}) and they are having symptoms. Please help them call 911 or get to the nearest emergency room immediately.`,
    physicianMessage: (ctx) =>
      `HYPERTENSIVE EMERGENCY — BP ${bp(ctx)} with symptoms: ${ctx.conditionLabel ?? '—'}. Meets criteria for hypertensive emergency (SBP ≥180 and/or DBP ≥120 with target organ damage). Patient advised to call 911. Immediate evaluation required.${physSuffix(ctx)}`,
  },

  // ── Pregnancy thresholds ──────────────────────────────────────────────
  // Doc 2 (Manisha 6/2). Gestational age threaded through to the physician
  // tier per Manisha Open-Decisions sign-off 2026-06-06 (Decision 4,
  // conditional exception): the pilot population includes pregnant patients
  // on ACE/ARB, so trimester-specific teratogenic risk context becomes
  // pilot-priority. Other Decision-4 placeholders ([age], [medication list])
  // remain backlogged. MVP US-only: 911 hardcoded per
  // CROSS_HANDOFF_ADDENDUM_2026_06_03.md.
  RULE_PREGNANCY_L2: {
    patientMessage: () =>
      "Your blood pressure is very high. During pregnancy, this needs urgent attention. Please call your doctor or go to the hospital right away. If you can't reach your doctor, call 911.",
    caregiverMessage: (ctx) =>
      `URGENT — ${patientNameOr(ctx)}'s blood pressure is very high (${bp(ctx)}) during pregnancy. Please help them contact their doctor or go to the hospital immediately.`,
    physicianMessage: (ctx) =>
      `PREGNANCY BP LEVEL 2 — BP ${bp(ctx)}${gestationalAgePhrase(ctx)}. Meets ACOG criteria for severe hypertension in pregnancy (SBP ≥160 or DBP ≥110). Initiate antihypertensive therapy within 30–60 min. Evaluate for preeclampsia with severe features.${physSuffix(ctx)}`,
  },

  RULE_PREGNANCY_L1_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than recommended during pregnancy. ${CARE_TEAM_NOTIFIED} They will follow up with you. If you develop a severe headache, vision changes, or upper belly pain, call your doctor right away.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is elevated (${bp(ctx)}) during pregnancy. ${CARE_TEAM_NOTIFIED} Watch for severe headache, vision changes, or upper belly pain — if these occur, help them contact their doctor immediately.`,
    physicianMessage: (ctx) =>
      `PREGNANCY BP LEVEL 1 HIGH — BP ${bp(ctx)}${gestationalAgePhrase(ctx)}. Above pregnancy HTN threshold (≥140/90). Monitor for progression to severe range or preeclampsia features.${physSuffix(ctx)}`,
  },

  // ── HFrEF ─────────────────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2). Patient tier carries no raw number; caregiver +
  // clinician do. Clinician threshold uses the engine value (ctx.thresholdValue)
  // rather than a hardcoded literal so wording can't drift from the rule.
  // "[medication list]" is referenced in Manisha's clinician wording but not on
  // AlertContext — omitted.
  RULE_HFREF_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. If you feel dizzy, lightheaded, or faint, please sit or lie down right away. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). If they feel dizzy or lightheaded, help them sit or lie down. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HFrEF LOW BP — SBP < ${ctx.thresholdValue ?? 85}: ${bp(ctx)}. Assess for symptomatic hypotension. Consider GDMT dose adjustment if symptomatic. Note: asymptomatic low SBP alone is not a contraindication to GDMT continuation per 2022 AHA/ACC/HFSA guideline.${physSuffix(ctx)}`,
  },
  RULE_HFREF_HIGH: {
    // Q2 (Handoff 1) keeps this rule firing on a single reading — that's engine
    // behavior; the single-reading caveat rides on physSuffix. Wording per Doc 2.
    patientMessage: (ctx) =>
      `Your blood pressure is a bit higher than your target. Your care team has been notified and may want to adjust your treatment.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HFrEF HIGH BP — SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}. Consider uptitration of GDMT or addition of antihypertensive therapy per 2025 AHA/ACC guideline.${physSuffix(ctx)}`,
  },

  // ── HFpEF ─────────────────────────────────────────────────────────────
  RULE_HFPEF_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. If you feel dizzy or lightheaded, please sit or lie down. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HFpEF LOW BP — SBP < ${ctx.thresholdValue ?? 110}: ${bp(ctx)}. Assess for symptomatic hypotension and volume status.${physSuffix(ctx)}`,
  },
  RULE_HFPEF_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than your target. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HFpEF HIGH BP — SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}. Consider antihypertensive optimization.${physSuffix(ctx)}`,
  },

  // ── CAD ───────────────────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2) patient + caregiver wording. Physician tier keeps the
  // threshold-accurate Cluster 8 Q2 (5/18) detail — the alert fires at the
  // engine's ctx.thresholdValue, so the message must not assert a different
  // number.
  //
  // Manisha sign-off 2026-06-06 (Open Decisions Doc, Decision 2): the engine's
  // Cluster 8 Q2 thresholds stand (SBP ≥140 alert, DBP <70 perfusion warning).
  // Doc 2's ≥130 was a treatment-initiation target, not an alert threshold.
  // Physician-tier wording here matches the engine; Doc 2 markdown will be
  // updated separately to cite ≥140.
  RULE_CAD_DBP_CRITICAL: {
    patientMessage: (ctx) =>
      `Your bottom blood pressure number is lower than expected. If you feel dizzy, have chest pain, or feel faint, please sit down and call your care team. If symptoms are severe, call 911.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s diastolic blood pressure is critically low (${ctx.diastolicBP ?? '?'} mmHg). If they have chest pain or feel faint, help them call 911.`,
    physicianMessage: (ctx) =>
      `CAD DBP CRITICAL — DBP < ${ctx.thresholdValue ?? 70}: ${bp(ctx)}. Low DBP may compromise coronary perfusion (J-curve). Assess for symptomatic hypotension. Consider dose reduction of antihypertensives, particularly vasodilators.${physSuffix(ctx)}`,
  },
  RULE_CAD_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than your target. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
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
      `Your blood pressure is higher than your target. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `BP Level 1 High — CAD DBP ≥ ${ctx.thresholdValue ?? 80}: ${bp(ctx)} (session average). AHA/ACC treatment target 130/80. Consider medication adjustment. NOTE: coronary perfusion (J-curve) risk if DBP < 70 — reassess antihypertensive class rather than over-titrating. Customise the alert threshold in patient settings.${physSuffix(ctx)}`,
  },

  // ── HCM ───────────────────────────────────────────────────────────────
  // Cluster 7 A.5 (Manisha 5/11/26, Appendix B1.4): HCM patients are
  // preload-dependent — low BP can reduce perfusion. Patient-facing wording
  // names the symptoms to watch for so they know when to act.
  // Doc 2 (Manisha 6/2) supersedes the Cluster 7 A.5 patient wording. HCM is
  // preload-dependent — Manisha's patient copy adds the hydration + slow-stand
  // guidance directly.
  RULE_HCM_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. Please drink some water and sit or lie down. Avoid standing up quickly. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). Help them sit or lie down and drink water. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HCM LOW BP — SBP < ${ctx.thresholdValue ?? 100}: ${bp(ctx)}. Hypotension may worsen dynamic LVOT obstruction. Assess hydration status. Review vasodilator use. Avoid volume depletion.${physSuffix(ctx)}`,
  },
  RULE_HCM_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than your target. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `HCM HIGH BP — SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}. Consider antihypertensive adjustment. Avoid pure vasodilators in obstructive HCM.${physSuffix(ctx)}`,
  },
  RULE_HCM_VASODILATOR: {
    patientMessage: () => '',
    caregiverMessage: () => '',
    physicianMessage: (ctx) =>
      `HCM VASODILATOR ALERT — Patient with HCM is on ${ctx.drugName ?? 'a vasodilator'} (${ctx.drugClass ?? 'vasodilator'} class). Vasodilators may worsen dynamic LVOT obstruction in obstructive HCM. Review indication and consider alternative.${physSuffix(ctx)}`,
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
  // Doc 2 (Manisha 6/2). DCM is managed as HFrEF clinically; keep that note.
  RULE_DCM_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. If you feel dizzy or lightheaded, please sit or lie down. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `DCM LOW BP — SBP < ${ctx.thresholdValue ?? 85}: ${bp(ctx)}. Managed as HFrEF. Assess for symptomatic hypotension. Consider GDMT dose adjustment if symptomatic.${physSuffix(ctx)}`,
  },
  RULE_DCM_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than your target. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is above their target (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `DCM HIGH BP — SBP ≥ ${ctx.thresholdValue ?? 160}: ${bp(ctx)}. Consider antihypertensive optimization.${physSuffix(ctx)}`,
  },

  // ── Personalized mode ─────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2). "the target your care team set for you" (not "provider").
  RULE_PERSONALIZED_HIGH: {
    patientMessage: (ctx) =>
      `Your blood pressure is higher than the target your care team set for you. They've been notified.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure (${bp(ctx)}) is above their personalized target. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `PERSONALIZED HIGH — BP ${bp(ctx)} exceeds patient-specific threshold of ${ctx.thresholdValue ?? '?'}. Review and adjust as indicated.${physSuffix(ctx)}`,
  },
  RULE_PERSONALIZED_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than the target your care team set for you. If you feel dizzy or lightheaded, please sit or lie down. They've been notified.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure (${bp(ctx)}) is below their personalized target. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `PERSONALIZED LOW — BP ${bp(ctx)} below patient-specific threshold of ${ctx.thresholdValue ?? '?'}. Assess for symptomatic hypotension.${physSuffix(ctx)}`,
  },

  // ── Standard mode ─────────────────────────────────────────────────────
  RULE_STANDARD_L1_HIGH: {
    // F26 — the pre-personalization disclaimer is admin-only. It used to be
    // appended to patientMessage (preDaySuffix) and leaked the
    // "(Standard threshold — personalization begins after 7 readings.)"
    // parenthetical into the patient alerts tab / banner / detail page. The
    // patient gets only the clinical instruction; the disclaimer now rides on
    // the physicianMessage (admin surface) instead.
    // Doc 2 (Manisha 6/2) patient + caregiver wording. Physician tier is the
    // Q5 axis-specific build (Handoff 2) — left untouched per H4 scope.
    patientMessage: (ctx) =>
      `Your blood pressure is quite high. Your care team has been notified and will follow up with you.${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is significantly elevated (${bp(ctx)}). ${CARE_TEAM_NOTIFIED}`,
    // Manisha Q5 (2026-06-02) — axis-specific severe-Stage-2 wording. The old
    // flat "≥160/100" label self-contradicted when only one axis crossed
    // (e.g. 119/109 read "≥160/100" though SBP 119 is well under 160). Name
    // the axis that actually triggered. Evaluated on the session-averaged
    // values (physicianCtx), which is the engine's evaluation truth.
    physicianMessage: (ctx) =>
      `BP Level 1 High — ${stage2Band(ctx)} at ${bp(ctx)}.${preDaySuffix(ctx)}${physSuffix(ctx)}`,
  },
  RULE_STANDARD_L1_LOW: {
    // F26 — disclaimer is admin-only, not patient. Wording per Doc 2 (Manisha 6/2).
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. If you feel dizzy or lightheaded, please sit or lie down. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). If they feel dizzy, help them sit or lie down. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `BP LEVEL 1 LOW — SBP < ${ctx.thresholdValue ?? 90}: ${bp(ctx)}. Assess for symptomatic hypotension. Review antihypertensive regimen.${preDaySuffix(ctx)}${physSuffix(ctx)}`,
  },

  // ── Age 65+ override ─────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2). Age is referenced in Manisha's clinician wording but
  // not on AlertContext — omitted.
  RULE_AGE_65_LOW: {
    patientMessage: (ctx) =>
      `Your blood pressure is lower than expected. Please be careful when standing up — move slowly. If you feel dizzy or unsteady, sit or lie down right away. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s blood pressure is low (${bp(ctx)}). Please watch for dizziness or unsteadiness, especially when standing. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `AGE 65+ LOW BP — SBP < ${ctx.thresholdValue ?? 100}: ${bp(ctx)}. Assess for orthostatic hypotension (sustained SBP drop ≥20 or DBP drop ≥10 within 3 min of standing). Review medications for OH-aggravating agents. Consider fall risk assessment.${physSuffix(ctx)}`,
  },

  // ── HR branches ───────────────────────────────────────────────────────
  // Doc 2 (Manisha 6/2). Caregiver uses bare "(N bpm)"; physician keeps the
  // "HR N bpm" helper. Threshold uses the engine value.
  RULE_AFIB_HR_HIGH: {
    patientMessage: (ctx) =>
      `Your heart rate is faster than expected. If you feel your heart racing, feel short of breath, or feel dizzy, please sit down and rest. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s heart rate is elevated (${ctx.pulse ?? '?'} bpm). If they feel their heart racing or are short of breath, help them sit down. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `AFib HR HIGH — ${hr(ctx)} (threshold >${ctx.thresholdValue ?? 110}). Assess for triggers (missed medication, dehydration, infection, caffeine). Consider rate control adjustment. If HF present, stricter target (80 bpm) may apply.${physSuffix(ctx)}`,
  },
  RULE_AFIB_HR_LOW: {
    patientMessage: (ctx) =>
      `Your heart rate is slower than expected. If you feel dizzy, lightheaded, or faint, please sit or lie down. ${CARE_TEAM_NOTIFIED}${suboptimalSuffix(ctx)}`,
    caregiverMessage: (ctx) =>
      `${patientNameOr(ctx)}'s heart rate is low (${ctx.pulse ?? '?'} bpm). If they feel dizzy or faint, help them sit or lie down. ${CARE_TEAM_NOTIFIED}`,
    physicianMessage: (ctx) =>
      `AFib HR LOW — ${hr(ctx)} (threshold <${ctx.thresholdValue ?? 50}). Assess for symptomatic bradycardia and rate-controlling agent burden.${physSuffix(ctx)}`,
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
      // #86 (2026-06-03) — RULE_MEDICATION_MISSED fires on a rolling 3-day
      // pattern (≥2 of last 3 days). Anchor the wording to "the last few days",
      // never to "today", so a patient who just logged a clean check-in isn't
      // told they missed today. i18n: backend-rendered patient string,
      // English-only for the US pilot per CROSS_HANDOFF_ADDENDUM (backend
      // alert-template i18n is a Phase-2 retrofit); flagged in
      // I18N_TRANSLATION_FLAGS.
      if (list) {
        // Today's session also reported missed meds — acknowledge "today".
        return (
          `It looks like some medication doses have been missed in the last few days, including ${list} today. ` +
          'Taking your medicine every day helps keep your blood pressure steady. ' +
          'Your care team is here to help if anything makes it hard to stay on schedule.'
        )
      }
      // No per-medication detail for this session — we can't tell whether
      // today was clean or missed-without-specifying. Use neutral, history-
      // anchored wording (handoff Option B) that's accurate either way and
      // still never claims "today".
      return (
        'In the last few days, some medication doses may have been missed. ' +
        'Taking your medicine every day helps keep your blood pressure steady. ' +
        'Your care team is here to help if anything makes it hard to stay on schedule.'
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
  // Patient-only, Tier 3, one-time. Hybrid of sign-off doc p.7 + educational
  // sentence (approved 2026-06-02 by Dr. Singal, Q1). The "that's okay — just"
  // softening clause is clinically load-bearing (AHA Medication Adherence
  // statement — non-judgmental tone); the third sentence is the evidence-based
  // educational reinforcement. No provider/caregiver message — educational.
  // i18n: patient-facing string rendered backend-side; English-only for the US
  // pilot per CROSS_HANDOFF_ADDENDUM_2026_06_03 (backend alert-template i18n is
  // a Phase-2 retrofit). Translation flag logged in I18N_TRANSLATION_FLAGS.
  RULE_FIRST_MONTH_ADHERENCE_NUDGE: {
    patientMessage: () =>
      "Starting a new medicine can take some getting used to. If you missed a dose, that's okay — just try to take your next one on time. Taking your medicine every day helps keep your blood pressure steady. Your care team is here to help if anything makes it hard to stay on schedule.",
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

/**
 * Handoff 4 A6 (Manisha Doc 1) — transparent disclosure when a provider
 * CORRECTS a self-reported profile field (changes its value), as opposed to
 * asking the patient to re-check it (systemMsgProfileFieldRejected). Manisha
 * verbatim. The emission path (a Notification row on admin-correct) is not yet
 * wired — backlog: emit this from the verification/correct flow so the patient
 * is always told what changed.
 */
export function systemMsgProfileFieldCorrected(
  fieldLabel: string,
  newValue: string,
): string {
  return `Your care team made a change to your profile. ${fieldLabel} was updated to ${newValue}. If you have questions, please contact your care team.`
}
