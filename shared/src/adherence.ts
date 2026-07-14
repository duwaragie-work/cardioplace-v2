// Phase/25 — 90-day Medication Adherence Report payload + rules.
//
// Backend `AdherenceService.compute` returns the `AdherenceReport` shape;
// the admin adherence panel consumes it directly — single source of truth
// for the wire format. Computed on the fly per request (no snapshot table,
// no migration).
//
// ⚠️ The adherence *definition* below is PROVISIONAL. The thresholds and
// the "what counts as a due dose" rules are placeholders derived from the
// CMS PDC (Proportion of Days Covered) quality standard. They must be
// confirmed by Dr. Singal before the numbers are treated as clinical truth.
// Keep this the only knob — backend + frontend both read from here, exactly
// like `TIER_SLA_MINUTES` in report-sla.ts.

/** Adherence scoring rules. Single source of truth. PROVISIONAL — pending
 *  Dr. Singal sign-off (see docs/CLINICAL_SPEC.md). */
export const ADHERENCE_RULES = {
  /** Rolling look-back window, in days. */
  windowDays: 90,
  /** A patient whose adherence is strictly below this percentage is flagged
   *  "Below target". 80% is the CMS PDC quality cutoff. */
  targetPct: 80,
  /** When a patient marked their dose "not due yet"
   *  (`JournalEntry.medicationScheduledLater`), that check-in is treated as
   *  neutral and excluded from the denominator rather than counted as a
   *  miss. Flip to `true` to count those check-ins as due. */
  scheduledLaterCountsAsDue: false,
} as const;

export type AdherenceStatus = 'ON_TRACK' | 'BELOW_TARGET' | 'NO_DATA';

export interface AdherencePatientRow {
  patientId: string;
  /** Display name resolved server-side; falls back to email then "(unknown)". */
  name: string;
  /** Journal entries the patient logged in the window (any kind). */
  checkInsLogged: number;
  /** Entries where a medication decision was actually required
   *  (a med was due — excludes "not due yet" per ADHERENCE_RULES). */
  dueCheckIns: number;
  /** Of `dueCheckIns`, those where the patient reported taking their meds. */
  takenCheckIns: number;
  /** `takenCheckIns / dueCheckIns × 100`, two decimals. null when the
   *  patient had no due check-ins in the window. */
  adherencePct: number | null;
  /** Sum of self-reported missed doses across the window. */
  missedDosesTotal: number;
  status: AdherenceStatus;
}

export interface AdherenceOverall {
  /** Patients on the practice roster with ≥1 active (non-discontinued)
   *  medication on file — the denominator population for adherence. */
  patientsWithMeds: number;
  /** Of those, patients with at least one due check-in in the window. */
  patientsReporting: number;
  /** Pooled `takenCheckIns ÷ dueCheckIns` across all reporting patients,
   *  two decimals. null when there were no due check-ins at all. */
  practiceAdherencePct: number | null;
  /** Patients flagged BELOW_TARGET (excludes NO_DATA patients). */
  patientsBelowTarget: number;
  /** Patients with meds but zero due check-ins in the window. */
  patientsNoData: number;
  totalDueCheckIns: number;
  totalTakenCheckIns: number;
  totalMissedDoses: number;
}

export interface AdherenceReport {
  practiceId: string;
  practiceName: string;
  practiceTimezone: string;
  /** Rolling window [windowStart, windowEnd) as ISO 8601 strings. */
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  /** Adherence-target % the rows were graded against (mirror of
   *  ADHERENCE_RULES.targetPct at compute time). */
  targetPct: number;
  /** ISO 8601 timestamp the report was computed. Always fresh — no cache. */
  generatedAt: string;
  /** True while the adherence definition is provisional / pending clinical
   *  sign-off. Drives the disclaimer banner in the UI + PDF. */
  provisional: boolean;
  overall: AdherenceOverall;
  byPatient: AdherencePatientRow[];
}
