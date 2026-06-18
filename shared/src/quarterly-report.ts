// Task 2 — Quarterly Outcomes Report payload + rules.
//
// Two views over one calendar quarter (3 months) for a single practice:
//   1. Alert-volume trend — total alerts per month, side by side.
//   2. BP-control rate — % of patients whose quarter-average BP is at/below
//      their "controlled" upper limit.
//
// Computed on the fly per request (no snapshot table, no migration).
//
// ⚠️ The BP-control *definition* is PROVISIONAL. Rather than invent a new
// clinical cutoff, the default below reuses the alert engine's already
// signed-off upper bound (SBP 140 / DBP 90) — "controlled" = "not in alert
// territory". Per-patient provider targets (PatientThreshold) override it.
// Keep this the single knob, exactly like ADHERENCE_RULES / TIER_SLA_MINUTES.

/** BP-control scoring rules. Single source of truth. PROVISIONAL default —
 *  pending confirmation of the official definition (see docs/CLINICAL_SPEC.md). */
export const QUARTERLY_RULES = {
  /** Fallback "controlled" upper limits, used when a patient has no
   *  provider-set PatientThreshold. Mirrors the alert engine's signed-off
   *  upper bound so no unseen number is introduced. */
  defaultSbpUpper: 140,
  defaultDbpUpper: 90,
  /** Control is judged on the patient's quarter-AVERAGE BP (more stable than
   *  a single most-recent reading for a small population). The alternative
   *  (HEDIS uses most-recent) is a one-line change if preferred. */
  basis: 'quarter-average',
} as const;

export interface MonthVolumeRow {
  /** YYYY-MM. */
  monthYear: string;
  /** "Apr 2026" — display label. */
  label: string;
  totalAlerts: number;
}

export type ControlStatus = 'CONTROLLED' | 'NOT_CONTROLLED';

export interface ControlPatientRow {
  patientId: string;
  name: string;
  /** BP readings the patient logged in the quarter. */
  readings: number;
  /** Quarter-average systolic / diastolic, rounded. */
  meanSystolic: number;
  meanDiastolic: number;
  /** "Controlled" upper limits applied to this patient (provider target when
   *  set, otherwise the QUARTERLY_RULES default). */
  sbpUpper: number;
  dbpUpper: number;
  /** True when this patient's limits came from a provider-set
   *  PatientThreshold rather than the default. */
  usedCustomTarget: boolean;
  status: ControlStatus;
}

export interface QuarterlyControlOverall {
  /** Patients on the roster with ≥1 BP reading in the quarter (the rate
   *  denominator). */
  patientsWithReadings: number;
  controlled: number;
  notControlled: number;
  /** controlled ÷ patientsWithReadings × 100, two decimals. null when no
   *  patient had a reading. */
  controlRatePct: number | null;
}

export interface QuarterlyReport {
  practiceId: string;
  practiceName: string;
  practiceTimezone: string;
  /** "2026-Q2". */
  quarter: string;
  /** ISO 8601 half-open window covering the 3 months of the quarter. */
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  /** True while the BP-control definition is provisional / pending sign-off. */
  provisional: boolean;
  /** One row per month in the quarter (always 3). */
  alertVolume: MonthVolumeRow[];
  totalAlertsInQuarter: number;
  control: QuarterlyControlOverall;
  byPatient: ControlPatientRow[];
}
