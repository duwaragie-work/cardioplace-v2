// Option D retake-to-confirm decision (Manisha 2026-06-12 Edit-Window +
// Session Policy sign-off, Q2). Pure + DB-free so it unit-tests in isolation.
//
// When a patient submits a BP-only emergency reading (≥180/120, no symptoms),
// the app asks for a confirmatory second reading. THIS function decides the
// outcome from the SECOND (confirmatory) reading's OWN value — NOT the session
// average. That distinction is load-bearing: a 195/120 → 178/118 pair averages
// to ~187/119 (still "emergency" by the average) yet the confirmatory reading
// itself is below threshold, so the spec says NO emergency fires. Deciding on
// the second reading's band is the only correct read of Q2.
//
// The emergency band mirrors absoluteEmergencyRule exactly (SBP ≥180 OR DBP
// ≥120) so the confirmed-emergency branch is identical to a fresh emergency.

export const EMERGENCY_SBP = 180
export const EMERGENCY_DBP = 120

export type OptionDOutcome = 'EMERGENCY' | 'CONFIRMED_NORMAL'

/**
 * @param sbp confirmatory reading systolic (the second-of-pair's OWN value)
 * @param dbp confirmatory reading diastolic
 */
export function decideOptionDOutcome(
  sbp: number | null | undefined,
  dbp: number | null | undefined,
): OptionDOutcome {
  const sbpEmergency = sbp != null && sbp >= EMERGENCY_SBP
  const dbpEmergency = dbp != null && dbp >= EMERGENCY_DBP
  return sbpEmergency || dbpEmergency ? 'EMERGENCY' : 'CONFIRMED_NORMAL'
}
