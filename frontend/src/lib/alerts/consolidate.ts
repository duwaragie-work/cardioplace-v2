/**
 * Minimal shape `consolidateAlertsByEntry` needs. The patient notifications
 * Alert type satisfies it structurally.
 */
export interface ConsolidatableAlert {
  id: string
  type?: string | null
  status?: string
  severity?: string | null
  escalated?: boolean
  journalEntry?: { id?: string } | null
}

/**
 * B2 (patient side) — collapse alerts that came from the SAME reading into one
 * card so a co-fire (e.g. systolic + diastolic from one reading) doesn't look
 * like three unrelated alerts the patient might dismiss as duplicates.
 *
 * Grouped by `journalEntry.id` (falls back to the alert id when there's no
 * journal entry). A merged card takes the worst severity, marks itself OPEN if
 * ANY member is open, escalated if ANY member escalated, and labels a
 * systolic+diastolic pair as a combined BP alert.
 */
export function consolidateAlertsByEntry<T extends ConsolidatableAlert>(
  alerts: readonly T[],
): T[] {
  const byEntry = new Map<string, T[]>()
  for (const a of alerts) {
    const key = a.journalEntry?.id ?? a.id
    if (!byEntry.has(key)) byEntry.set(key, [])
    byEntry.get(key)!.push(a)
  }
  return [...byEntry.values()].map((group) => {
    if (group.length === 1) return group[0]
    // Merge: worst severity wins; combine types; keep OPEN/escalated if ANY is.
    const worst = group.find((a) => a.severity === 'HIGH') ?? group[0]
    const types = group.map((a) => a.type)
    const hasBoth = types.includes('SYSTOLIC_BP') && types.includes('DIASTOLIC_BP')
    return {
      ...worst,
      type: hasBoth ? 'BP_COMBINED' : worst.type,
      status: group.some((a) => a.status === 'OPEN') ? 'OPEN' : worst.status,
      escalated: group.some((a) => a.escalated),
    } as T
  })
}
