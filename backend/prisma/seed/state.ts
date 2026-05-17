// Phase 0 — pre-seeded mixed state (alerts / notifications / audit).
//
// §C stub: intentionally a no-op so the modularization commit produces
// byte-identical output to the pre-Phase-0 seed. §G fills this in (guarded
// by NODE_ENV !== 'production' at the call site in run.ts).
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'

export async function seedState(
  _practices: SeededPractices,
  _admins: SeededAdmins,
): Promise<void> {
  // §G — implemented in a later commit.
}
