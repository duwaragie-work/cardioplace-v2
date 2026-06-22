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

  return { practiceA, practiceB }
}

export type SeededPractices = Awaited<ReturnType<typeof seedPractices>>
