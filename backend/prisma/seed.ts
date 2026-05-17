// Prisma seed entry point (CLI wrapper).
//
// Phase 0 §C — the 665-LOC monolith was split into prisma/seed/*:
//   helpers.ts    — PrismaClient + perma-OTP + date/hash utils + types
//   practices.ts  — Practice roster (A + B)
//   admins.ts     — admin / provider / ops roster
//   patients.ts   — 13 clinical personas + filler cohort
//   state.ts      — pre-seeded mixed alerts/notifications/audit (dev/test)
//   run.ts        — orchestrator (importable by the idempotency spec)
//
// Five+ patient archetypes each exercise one clinical branch of the rule
// engine (phase/5). Every user — including providers and ops — gets the
// perma-OTP 666666 so demos can log in as anyone without a real email
// inbox. The perma-OTP trick relies on auth.service.sendOtp short-
// circuiting when a row with expiresAt > 2098-01-01 exists.
import { prisma } from './seed/helpers.js'
import { runSeed } from './seed/run.js'

runSeed()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
