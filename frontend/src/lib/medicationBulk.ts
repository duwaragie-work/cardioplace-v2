// Bug 17 / Bug 21 — bulk "Mark all taken / not taken" on the check-in
// medications step.
//
// Each button is an ABSOLUTE setter (Bug 21b): it unconditionally sets EVERY
// medication to its target state, regardless of the current state. (The earlier
// "only fill unanswered" guard meant "Mark all not taken" no-op'd after "Mark
// all taken" — they read as toggles, not setters.) The patient can still flip
// any individual med afterward, and tapping a bulk button again re-applies to
// all rows. Pure reducer so the behaviour is unit-testable.

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
    next[id] = makeAnswered(next[id], value)
  }
  return next
}
