// Phase 0 §C/§D — practice roster.
//
// Practice A (`seed-cedar-hill`) is copied verbatim from the pre-Phase-0
// seed.ts — same stable id + fields so existing assignments/tests are
// unaffected. Practice B (`seed-river-east`, §D) gives SUPER_ADMIN
// cross-practice tests + PROVIDER scope-to-practice tests a second practice.
//
// NOTE: the Prisma `Practice` model has NO default-threshold columns
// (defaultSbpUpperTarget etc. do not exist — see STATUS_2026_05_17.md §2).
// Per-practice default thresholds were dropped from Phase 0 scope
// (Phase 3 §22h deferred to product spec). Both practices differ only by
// id/name + business hours, which is enough for practice-scoping tests.
import { prisma } from './helpers.js'

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
  const practiceB = await prisma.practice.upsert({
    where: { id: 'seed-river-east' },
    update: {},
    create: {
      id: 'seed-river-east',
      name: 'River East Cardiology (Ward 8)',
      // Slightly different hours so practice-scoped tests can tell A from B
      // by an observable field (no threshold columns exist to differ on).
      businessHoursStart: '09:00',
      businessHoursEnd: '17:00',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol:
        'Ward 8 after-hours: page the on-call cardiologist for urgent BP L2; queue all else to next business day.',
    },
  })
  console.log(`  practice: ${practiceA.name}`)
  console.log(`  practice: ${practiceB.name}`)

  return { practiceA, practiceB }
}

export type SeededPractices = Awaited<ReturnType<typeof seedPractices>>
