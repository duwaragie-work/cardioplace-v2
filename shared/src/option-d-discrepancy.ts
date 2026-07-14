// Item B (2026-06-18) — Option D large-discrepancy detection.
//
// Option D (retake-to-confirm): an emergency-range reading (AWAITING) is held
// and the patient takes a confirmatory second reading. When the two BPs differ
// a lot, the first reading may have been a measurement error or a transient
// spike rather than a true episode — the system can't tell, so a provider-side
// "Large discrepancy" badge surfaces the pair for clinical judgement. Patient
// UX is unchanged.
//
// Threshold (Duwaragie 2026-06-18): SBP delta ≥ 40 OR DBP delta ≥ 20. These are
// the clinical-judgement boundary; tune here (Duwaragie + Manisha review) rather
// than scattering magic numbers across the admin UI.

export const OPTION_D_DISCREPANCY_SBP_DELTA = 40
export const OPTION_D_DISCREPANCY_DBP_DELTA = 20

interface DiscrepancyReading {
  systolicBP: number
  diastolicBP: number
}

/**
 * True when the AWAITING first-of-pair and its CONFIRMATORY second reading
 * differ by ≥ 40 mmHg systolic OR ≥ 20 mmHg diastolic (absolute, either
 * direction). Pure + side-effect-free so the admin UI and tests share one rule.
 */
export function hasLargeDiscrepancy(
  awaiting: DiscrepancyReading,
  confirmatory: DiscrepancyReading,
): boolean {
  const sbpDelta = Math.abs(awaiting.systolicBP - confirmatory.systolicBP)
  const dbpDelta = Math.abs(awaiting.diastolicBP - confirmatory.diastolicBP)
  return (
    sbpDelta >= OPTION_D_DISCREPANCY_SBP_DELTA ||
    dbpDelta >= OPTION_D_DISCREPANCY_DBP_DELTA
  )
}
