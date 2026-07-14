// Item C / Bug 24 (2026-06-18) — effective BP-alert threshold for the patient
// dashboard. The engine applies pregnancy / HFrEF / CAD overrides on top of any
// provider-set custom PatientThreshold, so the raw custom values the dashboard
// used to show (e.g. "alerts begin at 196") can be wrong for a pregnant patient
// the engine actually alerts at 140. The backend computes this so the FE only
// renders.

export type ThresholdRuleSource =
  | 'pregnancy'
  | 'hfref'
  | 'cad'
  | 'personalized'
  | 'standard'

export interface EffectiveThreshold {
  /** Lowest high-alert thresholds across every applicable rule (where an alert
   *  first fires). */
  sbpHighAlertThreshold: number
  dbpHighAlertThreshold: number

  /** What the patient should aim BELOW. For an override (pregnancy/HFrEF/CAD)
   *  this equals the alert threshold (no tolerance band); for standard /
   *  personalized it's the goal and alerts begin at goal + tolerance. */
  sbpGoal: number
  dbpGoal: number

  /** SBP tolerance band added to the goal to get the alert point: 0 when an
   *  override applies, else the standard band (20). */
  toleranceMmHg: number

  /** Every rule that applied, for transparency. */
  basedOn: ThresholdRuleSource[]

  /** The highest-priority override that drove the values (pregnancy > HFrEF >
   *  CAD), or null for standard / personalized. Drives the dashboard caption. */
  overrideReason: 'pregnancy' | 'hfref' | 'cad' | null
}
