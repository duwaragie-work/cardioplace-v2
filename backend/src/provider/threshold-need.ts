// "Needs threshold" signal for the patient list. Mirrors the admin patient
// detail detectors (thresholdMandatory + mandatoryConditionChangedAt) so the
// list row tint / filter agrees with the in-page banner. A patient needs a
// threshold when one is MISSING (mandatory condition, no threshold) OR STALE
// (a mandatory condition changed after the current threshold was set).

export const MANDATORY_CONDITION_FIELDPATHS = [
  'profile.hasHCM',
  'profile.hasDCM',
  'profile.heartFailureType',
] as const

export interface ConditionChangeLog {
  fieldPath: string
  previousValue: unknown
  newValue: unknown
  createdAt: Date | string
}

interface MandatoryProfile {
  hasHCM?: boolean | null
  hasDCM?: boolean | null
  heartFailureType?: string | null
}

/** HFrEF / HCM / DCM require an explicit personalized threshold per spec. */
export function thresholdMandatory(profile: MandatoryProfile | null): boolean {
  if (!profile) return false
  return (
    !!profile.hasHCM ||
    !!profile.hasDCM ||
    profile.heartFailureType === 'HFREF'
  )
}

/**
 * Latest ms timestamp of a log that changed a threshold-mandatory condition:
 * hasHCM/hasDCM toggled either way, or heartFailureType moving TO or FROM HFREF.
 * Returns null when no such change is recorded.
 */
export function mandatoryConditionChangedAt(
  logs: ConditionChangeLog[],
): number | null {
  let latest = 0
  for (const log of logs) {
    const changed =
      log.fieldPath === 'profile.hasHCM' ||
      log.fieldPath === 'profile.hasDCM' ||
      (log.fieldPath === 'profile.heartFailureType' &&
        (log.newValue === 'HFREF' || log.previousValue === 'HFREF'))
    if (changed) latest = Math.max(latest, new Date(log.createdAt).getTime())
  }
  return latest === 0 ? null : latest
}

/**
 * MISSING (mandatory + no threshold) OR STALE (mandatory condition changed after
 * the threshold's setAt). Both surface as a single "needs threshold" flag.
 */
export function computeNeedsThreshold(args: {
  profile: MandatoryProfile | null
  thresholdSetAt: Date | string | null
  conditionLogs: ConditionChangeLog[]
}): boolean {
  const { profile, thresholdSetAt, conditionLogs } = args
  if (!profile) return false
  // MISSING
  if (thresholdMandatory(profile) && !thresholdSetAt) return true
  // STALE
  if (thresholdSetAt) {
    const changedAt = mandatoryConditionChangedAt(conditionLogs)
    if (changedAt != null && new Date(thresholdSetAt).getTime() < changedAt) {
      return true
    }
  }
  return false
}
