// Q3 hybrid prompt-selection (Manisha 2026-06-12 Edit-Window + Session Policy
// sign-off, Q3 — Option C). Single source of truth for WHICH post-check-in
// "take another reading" prompt the confirmation screen shows, branching on
// the patient's AFib cohort flag (PatientProfile.hasAFib):
//
//   • AFib cohort → 3-reading variant. The confirmation screen shows the
//     afib state strip (state1 → state2 → state3) and keeps nudging until the
//     session has ≥3 readings. The patient never sees the word "session".
//   • Non-AFib → default single→second-reading nudge, shown only while the
//     backend's 5-min single-reading finalize hint is live (pendingFinalizeEntryId).
//
// Q3 wording itself lives in i18n (checkin.confirm.takeSecondReading* +
// checkin.afib.state*); this module only decides which branch renders, so the
// branch is unit-testable without mounting the wizard. Keeping it pure also
// guarantees the AFib cohort can never fall through to the non-AFib 2nd-reading
// nudge (and vice-versa) regardless of how the backend hint is set.

export type ReadingPrompt =
  | {
      /** AFib 3-reading variant. `stateKey` indexes checkin.afib.<stateKey>.*. */
      kind: 'afib'
      stateKey: 'state1' | 'state2' | 'state3'
      /** true until the session reaches 3 readings — drives the leave-session guard. */
      needsMoreReadings: boolean
      /** true once ≥3 readings logged — drives the green "done" styling. */
      satisfied: boolean
    }
  /** Non-AFib default: the single→second-reading nudge (Q3 default flow). */
  | { kind: 'takeSecond' }
  /** Non-AFib, no pending nudge (already multi-reading, or backend didn't flag). */
  | { kind: 'none' }

export function selectReadingPrompt(input: {
  hasAFib: boolean
  /** Total readings in the session (incl. carried-over cross-visit readings). */
  sessionTotal: number
  /** Backend single-reading finalize hint id; truthy only for a first-in-session
   *  non-AFib non-preDay3 reading. Null tears down the nudge. */
  pendingFinalizeEntryId: string | null
}): ReadingPrompt {
  const { hasAFib, sessionTotal, pendingFinalizeEntryId } = input

  if (hasAFib) {
    const stateKey: 'state1' | 'state2' | 'state3' =
      sessionTotal >= 3 ? 'state3' : sessionTotal === 2 ? 'state2' : 'state1'
    return {
      kind: 'afib',
      stateKey,
      needsMoreReadings: sessionTotal < 3,
      satisfied: sessionTotal >= 3,
    }
  }

  if (pendingFinalizeEntryId) return { kind: 'takeSecond' }
  return { kind: 'none' }
}
