// Phase 0 §C — seed orchestrator.
//
// Importable from the idempotency spec WITHOUT triggering process.exit (the
// CLI wrapper lives in ../seed.ts). Pre-seeded mixed state (§G) only runs
// outside production.
import { seedPractices } from './practices.js'
import { seedAdmins } from './admins.js'
import { seedPatients } from './patients.js'
import { seedFillers } from './fillers.js'
import { seedState } from './state.js'

export async function runSeed() {
  console.log('Seeding phase/19 demo fixtures …\n')
  const practices = await seedPractices()
  const admins = await seedAdmins()
  await seedPatients(practices, admins)
  await seedFillers(practices, admins)

  // Pre-seeded alerts/notifications/audit are dev/test fixtures only —
  // a production seed must never insert them.
  if (process.env.NODE_ENV !== 'production') {
    await seedState(practices, admins)
  }

  console.log('\nSeed complete.')
  console.log('All users login via OTP 666666 (perma-expiry).')
}
