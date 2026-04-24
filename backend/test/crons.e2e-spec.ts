import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import type { App } from 'supertest/types.js'
import { AppModule } from '../src/app.module.js'
import { GapAlertService } from '../src/crons/gap-alert.service.js'
import { MonthlyReaskService } from '../src/crons/monthly-reask.service.js'
import { EmailService } from '../src/email/email.service.js'
import { PrismaService } from '../src/prisma/prisma.service.js'

// Phase/17 — gap-alert + monthly re-ask crons.
//
// Tests call `service.runScan()` directly with injected `now` so we can
// simulate time passage without manipulating the system clock. Same real-DB
// pattern as phase/3 / phase/13.

describe('Crons (e2e)', () => {
  let app: INestApplication<App>
  let prisma: PrismaService
  let gapAlert: GapAlertService
  let reask: MonthlyReaskService

  const runTag = `crons-e2e-${Date.now()}`
  const emails = {
    fresh: `${runTag}-fresh@example.com`, // logged recently, should NOT be nudged
    gappy: `${runTag}-gappy@example.com`, // 3-day gap, SHOULD be nudged
    empty: `${runTag}-empty@example.com`, // no entries + onboarded 3d ago, SHOULD be nudged
    unenrolled: `${runTag}-unenrolled@example.com`, // not COMPLETED, SHOULD skip
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
    gapAlert = moduleFixture.get(GapAlertService)
    reask = moduleFixture.get(MonthlyReaskService)
    await app.init()
    await cleanup()
  }, 30000)

  afterAll(async () => {
    await cleanup()
    await app.close()
  })

  // ─── Gap-alert cron ────────────────────────────────────────────────────────

  describe('GapAlertService.runScan', () => {
    let freshId: string
    let gappyId: string
    let emptyId: string
    let unenrolledId: string
    const now = new Date('2026-04-22T13:00:00Z')

    beforeAll(async () => {
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 3600 * 1000)

      const fresh = await prisma.user.create({
        data: {
          email: emails.fresh,
          name: 'Fresh Patient',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          createdAt: tenDaysAgo,
        },
      })
      const gappy = await prisma.user.create({
        data: {
          email: emails.gappy,
          name: 'Gappy Patient',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          createdAt: tenDaysAgo,
        },
      })
      const empty = await prisma.user.create({
        data: {
          email: emails.empty,
          name: 'Empty Patient',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'ENROLLED',
          createdAt: tenDaysAgo,
        },
      })
      // Unenrolled — identity-onboarded patients still pending admin's
      // 4-piece gate. Gap-alert cron filters on enrollmentStatus now, so
      // these should NOT be nudged.
      const unenrolled = await prisma.user.create({
        data: {
          email: emails.unenrolled,
          name: 'Unenrolled Patient',
          roles: ['PATIENT'],
          accountStatus: 'ACTIVE',
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: 'NOT_ENROLLED',
          createdAt: tenDaysAgo,
        },
      })
      freshId = fresh.id
      gappyId = gappy.id
      emptyId = empty.id
      unenrolledId = unenrolled.id

      // Fresh: logged 2h ago (no gap).
      await prisma.journalEntry.create({
        data: {
          userId: freshId,
          measuredAt: new Date(now.getTime() - 2 * 3600 * 1000),
          systolicBP: 120,
          diastolicBP: 80,
        },
      })
      // Gappy: last entry was 3 days ago.
      await prisma.journalEntry.create({
        data: {
          userId: gappyId,
          measuredAt: new Date(now.getTime() - 3 * 24 * 3600 * 1000),
          systolicBP: 130,
          diastolicBP: 85,
        },
      })
      // Empty + unenrolled: no entries.

      // Force updatedAt to 10 days ago so the "onboarded ≥ 48h" proxy fires.
      await prisma.user.updateMany({
        where: { id: { in: [freshId, gappyId, emptyId, unenrolledId] } },
        data: { updatedAt: tenDaysAgo },
      })
    })

    it('sends gap alerts to gappy + empty patients, skips fresh + unenrolled', async () => {
      // Scan iterates over every enrolled patient in the DB (seed-leftovers
      // included), so bump the timeout well past the 5s default.
      const count = await gapAlert.runScan(now)
      expect(count).toBeGreaterThanOrEqual(2) // gappy + empty (plus any seed-leftovers)

      const notifs = await prisma.notification.findMany({
        where: {
          userId: { in: [freshId, gappyId, emptyId, unenrolledId] },
          title: 'Time for your BP check',
        },
      })
      const usersNudged = new Set(notifs.map((n) => n.userId))
      expect(usersNudged.has(gappyId)).toBe(true)
      expect(usersNudged.has(emptyId)).toBe(true)
      expect(usersNudged.has(freshId)).toBe(false)
      expect(usersNudged.has(unenrolledId)).toBe(false)
    }, 60000)

    it('is idempotent — second scan in the same 24h window does not duplicate', async () => {
      const before = await prisma.notification.count({
        where: {
          userId: gappyId,
          title: 'Time for your BP check',
        },
      })
      await gapAlert.runScan(now)
      const after = await prisma.notification.count({
        where: {
          userId: gappyId,
          title: 'Time for your BP check',
        },
      })
      expect(after).toBe(before)
    })

    it('creates both PUSH and EMAIL rows for users with an email', async () => {
      const channels = await prisma.notification.findMany({
        where: {
          userId: gappyId,
          title: 'Time for your BP check',
        },
        select: { channel: true },
      })
      const set = new Set(channels.map((c) => c.channel))
      expect(set.has('PUSH')).toBe(true)
      expect(set.has('EMAIL')).toBe(true)
    })

    it('produces an "X day(s) since your last reading" body for gappy and a first-time body for empty', async () => {
      const gappyNotif = await prisma.notification.findFirst({
        where: { userId: gappyId, title: 'Time for your BP check', channel: 'PUSH' },
      })
      const emptyNotif = await prisma.notification.findFirst({
        where: { userId: emptyId, title: 'Time for your BP check', channel: 'PUSH' },
      })
      expect(gappyNotif?.body).toMatch(/day\(s\) since your last reading/)
      expect(emptyNotif?.body).toMatch(/don't have any blood-pressure readings/)
    })
  })

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
