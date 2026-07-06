// Phase 0 §C — seed orchestrator.
//
// Importable from the idempotency spec WITHOUT triggering process.exit (the
// CLI wrapper lives in ../seed.ts). Pre-seeded mixed state (§G) only runs
// outside production.
import { seedPractices } from './practices.js'
import { seedAdmins } from './admins.js'
import { seedPatients } from './patients.js'
import { seedState } from './state.js'
import { seedDisplayIds } from './display-ids.js'
import { seedSystemPrincipals } from './system-principals.js'
import { prisma } from './helpers.js'

export async function runSeed() {
  console.log('Seeding phase/19 demo fixtures …\n')
  const practices = await seedPractices()
  const admins = await seedAdmins()
  await seedPatients(practices, admins)

  // Pre-seeded alerts/notifications/audit are dev/test fixtures only —
  // a production seed must never insert them.
  if (process.env.NODE_ENV !== 'production') {
    await seedState(practices, admins)
  }

  // System-principal registry (audit) — runs in EVERY environment, not just
  // dev/test: crons resolve their actor id from these rows at runtime, so prod
  // needs them too. Idempotent. Before seedDisplayIds so its self-written
  // SYSTEM-class ledger rows are in place (seedDisplayIds then skips them).
  await seedSystemPrincipals()

  // Final pass: every seeded user gets a permanent DisplayId. Mirrors the
  // runtime issuance at the 4 user-create sites in auth.service.ts (which
  // the seed bypasses via direct prisma.upsert). See
  // docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
  await seedDisplayIds(prisma)

  console.log('\nSeed complete.')
  console.log('All users login via OTP 666666 (perma-expiry).')
}
