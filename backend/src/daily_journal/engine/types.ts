// Phase/5 engine types — shared by the rule functions and the AlertEngine
// orchestrator. Kept in the backend (not `/shared`) because these types are
// evaluation-time internals; downstream consumers read only the persisted
// DeviationAlert rows.

import type {
  AlertModeValue,
  AlertTierValue,
  ResolvedContext,
  RuleId,
} from '@cardioplace/shared'

/**
 * Session-averaged reading that feeds the rule pipeline. Computed by
 * SessionAverager from one or more JournalEntry rows grouped by sessionId or
 * a 30-min proximity window (CLINICAL_SPEC Part 5).
 */
export interface SessionAverage {
  /** Primary entry id (used for DeviationAlert.journalEntryId). */
  entryId: string
  userId: string
  /** UTC timestamp of the latest reading in the session. */
  measuredAt: Date

  /** Mean SBP across all readings in the session. Integer (rounded). */
  systolicBP: number | null
  /** Mean DBP across all readings in the session. Integer (rounded). */
  diastolicBP: number | null
  /** Mean pulse across all readings in the session. Integer. */
  pulse: number | null
  /** Mean weight (lbs) across the session, or null when unrecorded. Used by
   *  the HF-decompensation rule to compute 24h delta. */
  weight: number | null

  /** Count of readings averaged. AFib requires ≥3. */
  readingCount: number

  /** Cluster 6 — most-recent prior reading's weight + when it was logged.
   *  Populated by AlertEngineService before rule evaluation when the patient
   *  has any HF-related condition. Drives the >2-lbs-in-24h HF-decompensation
   *  predicate. Both null when no prior reading. */
  priorWeight?: number | null
  priorWeightAt?: Date | null
  /** Cluster 6 — most-recent prior SBP, for orthostatic-hypotension predicate
   *  (SBP drop ≥15 from prior session + dizziness). */
  priorSystolicBP?: number | null

  /** Cluster 6 Q2 (Manisha 5/9/26) — true when the anchor entry's
   *  `singleReadingFinalized` column is true (flipped by the 5-min
   *  finalize endpoint). Bypasses the non-emergency single-reading gate
   *  in `runPipeline` so the alert fires on the lone reading with a
   *  "confirm with next reading" annotation. */
  singleReadingFinalized: boolean

  /** Structured symptom flags — OR-reduced across the session's entries. */
  symptoms: SessionSymptoms

  /** True if any reading in the session had a suboptimal checklist. */
  suboptimalMeasurement: boolean

  /** Shared `sessionId` if the entries were explicitly grouped. */
  sessionId: string | null

  /**
   * Adherence signal: did the patient take their medications for this entry?
   * true = yes, false = self-reported miss, null = not asked / skipped.
   * OR-reduced across session entries: any `false` wins.
   */
  medicationTaken: boolean | null

  /**
   * Per-medication miss detail supplied by the patient. Empty array when the
   * patient either answered "yes" or answered "missed" generically without
   * specifying which medications. OR-unioned across session entries (dedup
   * by medicationId — latest entry's reason/missedDoses wins).
   */
  missedMedications: SessionMissedMedication[]
}

export interface SessionMissedMedication {
  medicationId: string
  drugName: string
  drugClass: string
  reason: 'FORGOT' | 'SIDE_EFFECTS' | 'RAN_OUT' | 'COST' | 'INTENTIONAL' | 'OTHER'
  missedDoses: number
}

export interface SessionSymptoms {
  severeHeadache: boolean
  visualChanges: boolean
  alteredMentalStatus: boolean
  chestPainOrDyspnea: boolean
  focalNeuroDeficit: boolean
  severeEpigastricPain: boolean
  newOnsetHeadache: boolean
  ruqPain: boolean
  edema: boolean
  /** Cluster 6 — new patient-driven signals. dizziness/syncope feed the
   *  brady-symptomatic predicate; palpitations route to AFib/tachy/general
   *  palpitation rules; legSwelling routes to HF decompensation and DHP-CCB
   *  side-effect. `edema` is preserved as a preeclampsia-only trigger. */
  dizziness: boolean
  syncope: boolean
  palpitations: boolean
  legSwelling: boolean
  /** Cluster 7 (Appendix A) — side-effect + interaction inputs. fatigue +
   *  shortnessOfBreath feed β-blocker rules; dryCough feeds the ACE
   *  side-effect; nsaidUse feeds the NSAID + antihypertensive interaction. */
  fatigue: boolean
  shortnessOfBreath: boolean
  dryCough: boolean
  nsaidUse: boolean
  /** Freeform symptoms retained for context but not used in override logic. */
  otherSymptoms: string[]
}

/**
 * A rule function's return value. One rule per short-circuit match; the
 * engine writes exactly one DeviationAlert row per call of `evaluate()`.
 */
export interface RuleResult {
  ruleId: RuleId
  tier: AlertTierValue
  mode: AlertModeValue
  /** Pulse pressure snapshot at fire-time. Rule functions fill this from the session. */
  pulsePressure: number | null
  /** Session-level suboptimal flag (propagated by the engine, but rule may override). */
  suboptimalMeasurement: boolean
  /** Which reading drove the value — used for DeviationAlert.actualValue. */
  actualValue: number | null
  /** Human-readable one-liner for logs / dashboards; NOT patient-facing. */
  reason: string
  /** Extras surfaced in three-tier messages (drug name, condition, etc.). */
  metadata: RuleResultMetadata
}

export interface RuleResultMetadata {
  drugName?: string
  drugClass?: string
  /**
   * Full set of drug names for rules that match more than one med (e.g. a
   * pregnant patient on multiple ACE/ARBs). `drugName` keeps the first
   * match for back-compat; `drugNames` is the joined list rendered in
   * physician messages.
   */
  drugNames?: string[]
  conditionLabel?: string
  thresholdValue?: number
  /** Used for physician-only pulse-pressure annotations riding on another rule. */
  physicianAnnotations?: string[]
  /**
   * Per-medication miss detail — populated only by RULE_MEDICATION_MISSED.
   * Flows through OutputGenerator → AlertContext.missedMedications so the
   * three-tier message builders can render drug names + reasons.
   */
  missedMedications?: SessionMissedMedication[]
  /** Cluster 6 — drives "X of 3 days" wording in adherence three-tier messages. */
  adherenceDaysWithMiss?: number
  /** Cluster 6 — escalation flag for ≥3-of-7 push notification. */
  adherenceDaysWithMissOver7d?: number
  /** Cluster 6 — true when the alert fired because of the beta-blocker carve-out. */
  adherenceBetaBlockerCarveOut?: boolean
}

/**
 * Signature every rule function implements. Returns null when the rule does
 * not fire for the given session + context. The orchestrator short-circuits
 * on the first non-null result in evaluation order.
 */
export type RuleFunction = (
  session: SessionAverage,
  ctx: ResolvedContext,
) => RuleResult | null
