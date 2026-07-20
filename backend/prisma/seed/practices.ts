// Phase 0 §C — practice roster.
//
// Practice A (`seed-cedar-hill`) is copied verbatim from the pre-Phase-0
// seed.ts — same stable id + fields so existing assignments/tests are
// unaffected.
//
// Practice B (`seed-bridgepoint`) is gated behind `SEED_TEST_FIXTURES=true`
// so it only seeds in CI / local test environments. Drives the
// phase/practice-identity selector + switcher Playwright specs (34/35/36):
// a multi-practice provider needs at least two practices to switch between.
// Production seeds stay single-practice unless the flag is explicitly set.
import { prisma } from './helpers.js'

const SEED_TEST_FIXTURES = process.env.SEED_TEST_FIXTURES === 'true'

export async function seedPractices() {
  const practiceA = await prisma.practice.upsert({
    where: { id: 'seed-cedar-hill' },
    update: {},
    create: {
      id: 'seed-cedar-hill',
      name: 'Cedar Hill Internal Medicine',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol:
        'Route urgent alerts to the on-call line; defer non-urgent to next business day.',
    },
  })
  console.log(`  practice: ${practiceA.name}`)

  let practiceB: Awaited<ReturnType<typeof prisma.practice.upsert>> | null = null
  if (SEED_TEST_FIXTURES) {
    practiceB = await prisma.practice.upsert({
      where: { id: 'seed-bridgepoint' },
      update: {},
      create: {
        id: 'seed-bridgepoint',
        name: 'BridgePoint Cardiology',
        businessHoursStart: '07:30',
        businessHoursEnd: '17:30',
        businessHoursTimezone: 'America/New_York',
        afterHoursProtocol:
          'After-hours BP escalations route to the shared on-call rotation.',
      },
    })
    console.log(`  practice: ${practiceB.name} (SEED_TEST_FIXTURES)`)
  }

  // Harness practice for spec 76 (V-01/V-04 IDOR). Purpose: give the seeded
  // outOfScopeProvider EXACTLY one PracticeProvider membership so
  // resolvePracticeContext() returns 'auto' (they can sign in) — but attach
  // that membership to a practice that holds ZERO patients, so every seed
  // alert is in a DIFFERENT practice than the actor's active context.
  // PatientAccessService.assertCanAccessPatient's inActiveScope() check then
  // trips the 403 branch, which is what the V-01/V-04 test needs to observe.
  //
  // Unconditional (unlike Practice B) because spec 76 is a security-critical
  // finding that must run in every CI shard — the ~2 extra seed rows are the
  // whole cost, and no patient / assignment / staff-link touches this row.
  const practiceIdorHarness = await prisma.practice.upsert({
    where: { id: 'seed-idor-harness' },
    update: {},
    create: {
      id: 'seed-idor-harness',
      name: 'IDOR Harness Practice (spec 76 only — no patients)',
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol: 'N/A — test-harness practice, never receives clinical traffic.',
    },
  })
  console.log(`  practice: ${practiceIdorHarness.name}`)

  return { practiceA, practiceB, practiceIdorHarness }
}

export type SeededPractices = Awaited<ReturnType<typeof seedPractices>>
