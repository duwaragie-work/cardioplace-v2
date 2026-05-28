// Phase 0 §C — seed orchestrator.
//
// Importable from the idempotency spec WITHOUT triggering process.exit (the
// CLI wrapper lives in ../seed.ts). Pre-seeded mixed state (§G) only runs
// outside production.
import { seedPractices } from './practices.js'
import { seedAdmins } from './admins.js'
import { seedPatients } from './patients.js'
import { seedState } from './state.js'

export async function runSeed() {
  console.log('Seeding phase/19 demo fixtures …\n')
  const practices = await seedPractices()
  const admins = await seedAdmins()
  await seedPatients(practices, admins)

  // DCHA demo seed — state.ts is a no-op (alert/notification seeding moved
  // inline into patients.ts so production can populate the admin queue for
  // the recording). The prior `NODE_ENV !== 'production'` gate was removed;
  // the call kept so the type contract / module shape stays stable.
  await seedState(practices, admins)

  console.log('\nSeed complete.')
  console.log('All users login via OTP 666666 (perma-expiry).')
}
