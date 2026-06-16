// Bug 17 — bulk "Mark all taken / not taken" on the check-in medications step.
//
// Pure reducer so the "don't overwrite an answer the patient already gave"
// rule is unit-testable independent of the wizard. Only medications still
// UNANSWERED (taken == null) are set; explicit yes/no/not-due answers are left
// untouched so a bulk tap can't silently flip a deliberate choice.

export function applyBulkMedicationStatus<
  E extends { taken: 'yes' | 'no' | 'scheduledLater' | null },
>(
  current: Record<string, E>,
  medIds: string[],
  value: 'yes' | 'no',
  // Builds the answered entry for a med (caller owns the entry shape so reason /
  // missedDoses defaults match the step's own setTaken).
  makeAnswered: (prev: E | undefined, value: 'yes' | 'no') => E,
): Record<string, E> {
  const next: Record<string, E> = { ...current }
  for (const id of medIds) {
    if (next[id]?.taken != null) continue // keep explicit answers
    next[id] = makeAnswered(next[id], value)
  }
  return next
}
