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

  /** Count of readings averaged. AFib requires ≥3. */
  readingCount: number

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
