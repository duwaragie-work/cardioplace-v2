// Task 4 — Per-Condition Cohort Report payload.
//
// The same outcome metrics (BP-control rate, alert volume) sliced by clinical
// cohort so groups can be compared side by side. Cohorts OVERLAP — a patient
// with both CAD and HFrEF is counted in both — plus an "All patients" baseline
// row. Computed on the fly per request (no snapshot table, no migration).
//
// Cohort membership comes from PatientProfile flags. The BP-control definition
// is reused from QUARTERLY_RULES, so it carries the same provisional default
// (140/90) — this report adds no new clinical decision of its own.

/** Stable cohort identifiers. "ALL" is the whole-practice baseline. */
export const COHORT_KEYS = ['ALL', 'HFREF', 'CAD', 'PREGNANCY'] as const;
export type CohortKey = (typeof COHORT_KEYS)[number];

export const COHORT_LABELS: Record<CohortKey, string> = {
  ALL: 'All patients',
  HFREF: 'HFrEF',
  CAD: 'CAD',
  PREGNANCY: 'Pregnancy',
};

export interface CohortRow {
  cohort: CohortKey;
  label: string;
  /** Patients on the roster who belong to this cohort. */
  patientCount: number;
  /** Of those, patients with ≥1 BP reading in the window (control-rate
   *  denominator). */
  patientsWithReadings: number;
  /** Patients whose window-average BP is at/below target. */
  controlled: number;
  /** controlled ÷ patientsWithReadings × 100, two decimals. null when none
   *  had a reading. */
  controlRatePct: number | null;
  /** Alerts raised for this cohort's patients in the window. */
  alertCount: number;
  /** Patients in this cohort whose profile is not yet VERIFIED — the cohort
   *  flag may be self-reported and unconfirmed. */
  unverifiedProfiles: number;
}

export interface CohortReport {
  practiceId: string;
  practiceName: string;
  practiceTimezone: string;
  /** Month identifier (YYYY-MM) in the practice timezone. */
  monthYear: string;
  windowStart: string;
  windowEnd: string;
  generatedAt: string;
  /** True while the BP-control definition is provisional / pending sign-off. */
  provisional: boolean;
  /** The default "controlled" upper limits used (per-patient provider targets
   *  still override per patient inside the calculation). */
  defaultSbpUpper: number;
  defaultDbpUpper: number;
  /** Total roster patients (the "ALL" cohort size). */
  totalPatients: number;
  /** ALL first, then condition cohorts. Cohort sizes can sum to more than
   *  totalPatients because cohorts overlap. */
  rows: CohortRow[];
}
