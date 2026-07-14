import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { MonthlyReaskService } from '../src/crons/monthly-reask.service.js'
import { EmailService } from '../src/email/email.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

// Phase/17 — monthly re-ask cron.
//
// N3 (2026-07-13) — the GapAlertService e2e describe block was removed with
// the service itself. The daily-reminder cron that replaces it is fully
// covered by src/crons/daily-reminder.service.spec.ts (unit) plus the
// qa/tests/15 Playwright happy-path; a second e2e here would be duplicative.
//
// Tests call `service.runScan()` directly with injected `now` so we can
// simulate time passage without manipulating the system clock. Same real-DB
// pattern as phase/3 / phase/13.

describe('Crons (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let reask: MonthlyReaskService

  const runTag = `crons-e2e-${Date.now()}`
  const emails = {
    reask: `${runTag}-reask@example.com`, // meds reported 45d ago, SHOULD re-ask
    reaskFresh: `${runTag}-reask-fresh@example.com`, // meds reported yesterday
  }

  async function cleanup() {
    const users = await prisma.user.findMany({
      where: { email: { in: Object.values(emails) } },
      select: { id: true },
    })
    const ids = users.map((u) => u.id)
    if (!ids.length) return
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
    await prisma.journalEntry.deleteMany({ where: { userId: { in: ids } } })
    await prisma.patientMedication.deleteMany({ where: { userId: { in: ids } } })
    await prisma.patientProfile.deleteMany({ where: { userId: { in: ids } } })
    await prisma.profileVerificationLog.deleteMany({
      where: { userId: { in: ids } },
    })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stub Resend — we don't want the test to send real email or spend
      // seconds on per-recipient API calls.
      .overrideProvider(EmailService)
      .useValue({ sendEmail: async () => undefined })
      .compile()

    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    prisma = moduleFixture.get(PrismaService)
    reask = moduleFixture.get(MonthlyReaskService)
    await app.init()
    await cleanup()
  }, 30000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  // ─── Gap-alert cron REMOVED (N3, 2026-07-13) ──────────────────────────────
  // The GapAlertService describe block was removed with the service itself.
  // See src/crons/daily-reminder.service.spec.ts for the replacement's unit
  // coverage; the qa Playwright spec at qa/tests/15 covers the happy path.

  // ─── Monthly re-ask cron ───────────────────────────────────────────────────

  describe('MonthlyReaskService.runScan', () => {
    let dueId: string
    let freshId: string
    const now = new Date('2026-04-22T14:00:00Z')

    beforeAll(async () => {
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000)
      const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 3600 * 1000)

      const due = await prisma.user.create({
        data: {
          email: emails.reask,
          name: 'Due Patient',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      })
      const fresh = await prisma.user.create({
        data: {
          email: emails.reaskFresh,
          name: 'Fresh Reask',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      })
      dueId = due.id
      freshId = fresh.id

      await prisma.patientMedication.create({
        data: {
          userId: dueId,
          drugName: 'Lisinopril',
          drugClass: 'ACE_INHIBITOR',
          frequency: 'ONCE_DAILY',
          source: 'PATIENT_SELF_REPORT',
          reportedAt: fortyFiveDaysAgo,
        },
      })
      await prisma.patientMedication.create({
        data: {
          userId: freshId,
          drugName: 'Carvedilol',
          drugClass: 'BETA_BLOCKER',
          frequency: 'TWICE_DAILY',
          source: 'PATIENT_SELF_REPORT',
          reportedAt: tenDaysAgo,
        },
      })
    })

    it('prompts the 45-day-old patient, skips the 10-day-old', async () => {
      await reask.runScan(now)

      const dueNotif = await prisma.notification.findFirst({
        where: { userId: dueId, title: 'Confirm your medications' },
      })
      const freshNotif = await prisma.notification.findFirst({
        where: { userId: freshId, title: 'Confirm your medications' },
      })
      expect(dueNotif).not.toBeNull()
      expect(dueNotif?.channel).toBe('PUSH')
      expect(freshNotif).toBeNull()
    })

    it('idempotent — does not re-send inside the 28-day window', async () => {
      const before = await prisma.notification.count({
        where: { userId: dueId, title: 'Confirm your medications' },
      })
      await reask.runScan(now)
      const after = await prisma.notification.count({
        where: { userId: dueId, title: 'Confirm your medications' },
      })
      expect(after).toBe(before)
    })

    it('skips patients with no active medications', async () => {
      const noMedsEmail = `${runTag}-nomeds@example.com`
      const noMeds = await prisma.user.create({
        data: {
          email: noMedsEmail,
          name: 'No Meds',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      })
      try {
        await reask.runScan(now)
        const notif = await prisma.notification.findFirst({
          where: { userId: noMeds.id, title: 'Confirm your medications' },
        })
        expect(notif).toBeNull()
      } finally {
        await prisma.notification.deleteMany({ where: { userId: noMeds.id } })
        await prisma.user.delete({ where: { id: noMeds.id } })
      }
    })

    it('skips patients whose only active med was verified recently (verifiedAt > reportedAt)', async () => {
      const email = `${runTag}-verified-recent@example.com`
      const user = await prisma.user.create({
        data: {
          email,
          name: 'Verified Recent',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          displayId: generateTestDisplayId(['PATIENT']),
        },
      })
      const fortyFiveDaysAgo = new Date(now.getTime() - 45 * 24 * 3600 * 1000)
      const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 3600 * 1000)
      await prisma.patientMedication.create({
        data: {
          userId: user.id,
          drugName: 'Amlodipine',
          drugClass: 'DHP_CCB',
          frequency: 'ONCE_DAILY',
          source: 'PATIENT_SELF_REPORT',
          reportedAt: fortyFiveDaysAgo,
          verifiedAt: twoDaysAgo,
          verificationStatus: 'VERIFIED',
        },
      })
      try {
        await reask.runScan(now)
        const notif = await prisma.notification.findFirst({
          where: { userId: user.id, title: 'Confirm your medications' },
        })
        expect(notif).toBeNull()
      } finally {
        await prisma.notification.deleteMany({ where: { userId: user.id } })
        await prisma.patientMedication.deleteMany({ where: { userId: user.id } })
        await prisma.user.delete({ where: { id: user.id } })
      }
    })
  })
})
