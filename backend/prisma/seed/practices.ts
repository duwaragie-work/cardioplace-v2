// Phase 0 §C — practice roster.
//
// Practice A (`seed-cedar-hill`) is copied verbatim from the pre-Phase-0
// seed.ts — same stable id + fields so existing assignments/tests are
// unaffected. Practice B is added in §D.
import { prisma } from './helpers.js'

export async function seedPractices() {
  const practiceA = await prisma.practice.upsert({
    where: { id: 'seed-cedar-hill' },
    // DCHA demo seed — force the rename onto existing prod rows on re-seed.
    update: { name: 'Cedar Hill Regional Medical Center' },
    create: {
      id: 'seed-cedar-hill',
      name: 'Cedar Hill Regional Medical Center',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol:
        'Route urgent alerts to the on-call line; defer non-urgent to next business day.',
    },
  })
  console.log(`  practice: ${practiceA.name}`)

  return { practiceA }
}

export type SeededPractices = Awaited<ReturnType<typeof seedPractices>>
