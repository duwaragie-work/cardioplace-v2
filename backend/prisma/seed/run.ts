// Phase 0 §C — seed orchestrator.
//
// Importable from the idempotency spec WITHOUT triggering process.exit (the
// CLI wrapper lives in ../seed.ts).
//
// Two-tier seed (gated by SEED_TEST_FIXTURES env var):
//   default   → baseline only: Practice A + 6 admin/provider/ops rows + 13
//               clinical personas. Safe for dev/staging/prod.
//   "true"    → baseline + Practice B + 4 matrix admins + 30 filler patients
//               + 12 pre-seeded alerts/27 notifications/5 audit rows.
//               Intended for Playwright + local QA work. NEVER set in prod.
//
// State (§G) is additionally gated on NODE_ENV !== 'production' as a
// belt-and-braces guard — if SEED_TEST_FIXTURES somehow leaks into prod,
// state still won't seed.
import { seedPractices } from './practices.js'
import { seedAdmins } from './admins.js'
import { seedPatients } from './patients.js'
import { seedFillers } from './fillers.js'
import { seedState } from './state.js'

export async function runSeed() {
  // Read the flag every call (not at module load) so tests can toggle it
  // between invocations via process.env without re-importing this module.
  const seedTestFixtures = process.env.SEED_TEST_FIXTURES === 'true'

  console.log(
    `Seeding phase/19 demo fixtures (test cohort=${seedTestFixtures}) …\n`,
  )
  const practices = await seedPractices({ includeTestPractices: seedTestFixtures })
  const admins = await seedAdmins({ includeTestMatrix: seedTestFixtures })
  await seedPatients(practices, admins)

  if (seedTestFixtures) {
    await seedFillers(practices, admins)
    if (process.env.NODE_ENV !== 'production') {
      await seedState(practices, admins)
    }
  }

  console.log('\nSeed complete.')
  console.log('All users login via OTP 666666 (perma-expiry).')
  if (!seedTestFixtures) {
    console.log(
      '(Set SEED_TEST_FIXTURES=true to also seed Practice B + 30 fillers + 12 alerts/27 notifs/5 audit.)',
    )
  }
}
