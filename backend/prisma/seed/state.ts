// Pre-seeded mixed state (alerts / notifications / audit) — intentionally empty.
//
// Phase 0 §G originally fired alerts + notifications here, gated by
// `NODE_ENV !== 'production'` in run.ts so production seeds stayed clean.
//
// DCHA demo seed (May 2026) — that gate no longer makes sense for our use
// case: production needs the populated admin queue for the recording, so the
// five companion patients now carry their inline alert + escalation +
// notification state inside patients.ts itself (alongside their JournalEntry
// rows). This module stays as an explicit no-op rather than being deleted so
// run.ts's call shape is unchanged and the type contract still compiles.
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'

export async function seedState(
  _practices: SeededPractices,
  _admins: SeededAdmins,
): Promise<void> {
  // No-op. See module comment above.
}
