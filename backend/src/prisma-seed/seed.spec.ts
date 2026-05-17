/**
 * Phase 0 §I — seed idempotency + row-count + resetUser-invariant spec.
 *
 * This is a DB-integration spec (the project has one DATABASE_URL — the
 * shared v2 dev DB; there is no separate test DB). It connects via the
 * same PrismaClient the seed uses and runs the modular seed. Skipped when
 * DATABASE_URL is absent so a DB-less environment doesn't hard-fail.
 *
 * IMPORTANT: this spec asserts row counts that ONLY hold with the test
 * cohort seeded (Practice B + 30 fillers + 12 alerts/27 notifs/5 audit).
 * We force SEED_TEST_FIXTURES='true' in beforeAll so the spec is
 * self-contained — running it does NOT require the developer to remember
 * the flag. Baseline-only seed verification lives in a separate (faster,
 * unit-style) spec.
 *
 * Run: `npm test -- seed.spec` (jest rootDir is src, so this lives under
 * src/ even though the seed code lives in prisma/seed/).
 *
 * resetUser note: TestControlService.resetUser does NOT "restore" a user —
 * it WIPES dynamic clinical state (journal/alerts/notifications/escalation)
 * and PRESERVES the seed-stable identity rows (user/profile/medication/
 * threshold/assignment). The seed restores dynamic state. The plan's §I
 * "expect(alerts).toBe(4) after resetUser" wording was inaccurate; the test
 * below asserts the real, correct contract (STATUS_2026_05_17.md §G).
 */
import { prisma } from '../../prisma/seed/helpers.js'
import { runSeed } from '../../prisma/seed/run.js'

const HAS_DB = !!process.env.DATABASE_URL
const d = HAS_DB ? describe : describe.skip

// Each runSeed() hits a remote Postgres and upserts ~50 users + state.
const SEED_TIMEOUT = 600_000

async function snapshot() {
  const [
    user,
    patientProfile,
    practice,
    patientMedication,
    patientThreshold,
    patientProviderAssignment,
    journalEntry,
    otpCode,
    deviationAlert,
    notification,
    profileVerificationLog,
    escalationEvent,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.patientProfile.count(),
    prisma.practice.count(),
    prisma.patientMedication.count(),
    prisma.patientThreshold.count(),
    prisma.patientProviderAssignment.count(),
    prisma.journalEntry.count(),
    prisma.otpCode.count(),
    prisma.deviationAlert.count(),
    prisma.notification.count(),
    prisma.profileVerificationLog.count(),
    prisma.escalationEvent.count(),
  ])
  return {
    user,
    patientProfile,
    practice,
    patientMedication,
    patientThreshold,
    patientProviderAssignment,
    journalEntry,
    otpCode,
    deviationAlert,
    notification,
    profileVerificationLog,
    escalationEvent,
  }
}

/** Mirrors TestControlService.resetUser's deletion set exactly. */
async function resetUserRows(userId: string) {
  await prisma.$transaction([
    prisma.escalationEvent.deleteMany({ where: { alert: { userId } } }),
    prisma.notification.deleteMany({ where: { userId } }),
    prisma.deviationAlert.deleteMany({ where: { userId } }),
    prisma.journalEntry.deleteMany({ where: { userId } }),
  ])
}

d('Phase 0 seed (test cohort)', () => {
  const previousSeedFlag = process.env.SEED_TEST_FIXTURES

  beforeAll(async () => {
    // Force the test cohort on; the asserted counts below assume Practice B
    // + 30 fillers + 12 alerts/27 notifs/5 audit are present.
    process.env.SEED_TEST_FIXTURES = 'true'
    // Normalize to canonical seeded state before assertions.
    await runSeed()
  }, SEED_TIMEOUT)

  afterAll(async () => {
    if (previousSeedFlag === undefined) {
      delete process.env.SEED_TEST_FIXTURES
    } else {
      process.env.SEED_TEST_FIXTURES = previousSeedFlag
    }
    await prisma.$disconnect()
  })

  it(
    'running seed twice produces identical row counts (idempotent)',
    async () => {
      const first = await snapshot()
      await runSeed()
      const second = await snapshot()
      expect(second).toEqual(first)
    },
    SEED_TIMEOUT,
  )

  it(
    'produces exactly the documented row counts',
    async () => {
      const s = await snapshot()
      expect(s).toEqual({
        user: 53,
        patientProfile: 43,
        practice: 2,
        patientMedication: 23,
        patientThreshold: 4,
        patientProviderAssignment: 43,
        journalEntry: 70,
        otpCode: 53,
        deviationAlert: 12,
        notification: 27,
        profileVerificationLog: 5,
        escalationEvent: 0,
      })

      const [
        patient,
        provider,
        medicalDirector,
        superAdmin,
        ops,
        suspended,
        notEnrolled,
      ] = await Promise.all([
        prisma.user.count({ where: { roles: { has: 'PATIENT' } } }),
        prisma.user.count({ where: { roles: { has: 'PROVIDER' } } }),
        prisma.user.count({ where: { roles: { has: 'MEDICAL_DIRECTOR' } } }),
        prisma.user.count({ where: { roles: { has: 'SUPER_ADMIN' } } }),
        prisma.user.count({ where: { roles: { has: 'HEALPLACE_OPS' } } }),
        prisma.user.count({ where: { accountStatus: 'SUSPENDED' } }),
        prisma.user.count({
          where: { enrollmentStatus: 'NOT_ENROLLED', roles: { has: 'PATIENT' } },
        }),
      ])
      expect(patient).toBe(43)
      expect(provider).toBe(7)
      expect(medicalDirector).toBe(3)
      expect(superAdmin).toBe(2)
      expect(ops).toBe(1)
      expect(suspended).toBe(3) // 1 admin (suspended-provider) + 2 fillers
      expect(notEnrolled).toBe(2)
    },
    SEED_TIMEOUT,
  )

  it(
    'resetUser wipes dynamic state, preserves seed-stable rows, and re-seed restores',
    async () => {
      const aisha = await prisma.user.findUniqueOrThrow({
        where: { email: 'aisha.johnson@cardioplace.test' },
        select: { id: true },
      })

      // Seeded baseline for Aisha: 5 readings + 4 §G alerts.
      expect(
        await prisma.journalEntry.count({ where: { userId: aisha.id } }),
      ).toBe(5)
      expect(
        await prisma.deviationAlert.count({ where: { userId: aisha.id } }),
      ).toBe(4)

      // An extra ad-hoc alert (with its own entry) — must be wiped too.
      const je = await prisma.journalEntry.create({
        data: {
          userId: aisha.id,
          measuredAt: new Date(),
          systolicBP: 160,
          diastolicBP: 100,
          pulse: 88,
          position: 'SITTING',
          source: 'MANUAL',
        },
      })
      await prisma.deviationAlert.create({
        data: {
          userId: aisha.id,
          journalEntryId: je.id,
          tier: 'BP_LEVEL_2',
          status: 'OPEN',
          mode: 'STANDARD',
          ruleId: 'TEST_EXTRA',
        },
      })

      await resetUserRows(aisha.id)

      // Dynamic state wiped …
      expect(
        await prisma.deviationAlert.count({ where: { userId: aisha.id } }),
      ).toBe(0)
      expect(
        await prisma.journalEntry.count({ where: { userId: aisha.id } }),
      ).toBe(0)
      expect(
        await prisma.notification.count({ where: { userId: aisha.id } }),
      ).toBe(0)

      // … but seed-stable identity rows preserved.
      expect(
        await prisma.user.count({ where: { id: aisha.id } }),
      ).toBe(1)
      expect(
        await prisma.patientProfile.count({ where: { userId: aisha.id } }),
      ).toBe(1)
      expect(
        await prisma.patientMedication.count({ where: { userId: aisha.id } }),
      ).toBe(2)
      expect(
        await prisma.patientProviderAssignment.count({
          where: { userId: aisha.id },
        }),
      ).toBe(1)

      // Re-seed restores Aisha's dynamic state to the seeded baseline.
      await runSeed()
      expect(
        await prisma.journalEntry.count({ where: { userId: aisha.id } }),
      ).toBe(5)
      expect(
        await prisma.deviationAlert.count({ where: { userId: aisha.id } }),
      ).toBe(4)
    },
    SEED_TIMEOUT,
  )
})
