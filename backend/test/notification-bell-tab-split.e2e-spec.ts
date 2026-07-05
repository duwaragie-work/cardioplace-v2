import { jest } from '@jest/globals'
import { INestApplication, ValidationPipe } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AppModule } from '../src/app.module.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { DailyJournalService } from '../src/daily_journal/daily_journal.service.js'
import { generateTestDisplayId } from './helpers/generate-test-display-id.js'

/**
 * Notification bell tab-split — full-stack integration
 * (project_notification_tab_split_2026_06_04).
 *
 * Load-bearing regression for the leak the dispatchTrigger discriminator fixes:
 * an alert Notification whose `alertId` was nulled by the DeviationAlert cascade
 * (journal-entry delete → Notification.alert onDelete:SetNull) used to be
 * indistinguishable from a legit null-alertId action row, so it LEAKED into the
 * bell. Now the bell keys off `dispatchTrigger`, so the orphan stays hidden.
 *
 * Bootstraps the real AppModule and hits the dev DB (docker cardio-e2e-pg;
 * invoke with the [::1] loopback DATABASE_URL). Not part of the Playwright CI
 * gate — must pass locally (see reference_ci_no_backend_jest).
 */
jest.setTimeout(30_000)

describe('Notification bell tab-split (e2e)', () => {
  let app: INestApplication
  let prisma: PrismaService
  let journal: DailyJournalService

  const runTag = `notif-tabsplit-e2e-${Date.now()}`
  const userEmail = `${runTag}@example.com`
  let userId: string

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile()
    app = moduleFixture.createNestApplication()
    app.useGlobalPipes(new ValidationPipe({ transform: true }))
    await app.init()

    prisma = app.get(PrismaService)
    journal = app.get(DailyJournalService)

    const user = await prisma.user.create({
      data: {
        email: userEmail,
        name: 'Tab Split Patient',
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
        displayId: generateTestDisplayId(['PATIENT']),
      },
    })
    userId = user.id
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } })
    // Alerts + journal entries cascade-clean when the user is removed, but be
    // explicit so a partial run doesn't strand rows in the shared dev DB.
    await prisma.deviationAlert.deleteMany({ where: { userId } })
    await prisma.journalEntry.deleteMany({ where: { userId } })
    await prisma.user.deleteMany({ where: { id: userId } })
    await app.close()
  })

  it('orphaned alert notification (alertId nulled by cascade) is HIDDEN from the bell; the action row still shows', async () => {
    // 1) A real alert bound to a journal entry, plus the patient PUSH the
    //    escalation ladder writes for it (alert-class → ALERT_CREATED).
    const entry = await prisma.journalEntry.create({
      data: {
        userId,
        measuredAt: new Date(),
        systolicBP: 185,
        diastolicBP: 125,
        pulse: 92,
        position: 'SITTING',
      },
    })
    const alert = await prisma.deviationAlert.create({
      data: {
        userId,
        journalEntryId: entry.id,
        tier: 'BP_LEVEL_2',
        patientMessage: 'Urgent — your blood pressure is dangerously high.',
      },
    })
    const alertNotif = await prisma.notification.create({
      data: {
        userId,
        alertId: alert.id,
        channel: 'PUSH',
        title: 'Urgent Blood Pressure Alert',
        body: 'Your care team has been alerted.',
        dispatchTrigger: 'ALERT_CREATED',
      },
    })
    // 2) A legit null-alertId action notification — must stay visible.
    const actionNotif = await prisma.notification.create({
      data: {
        userId,
        channel: 'PUSH',
        title: 'Care team update',
        body: 'Your care team adjusted your monitoring.',
        dispatchTrigger: 'CARE_TEAM_UPDATE',
      },
    })

    // 3) Delete the journal entry → cascade deletes the alert → SetNull nulls
    //    alertId on the surviving notification (the exact orphan scenario).
    await prisma.journalEntry.delete({ where: { id: entry.id } })

    // The notification row survives the cascade (write path intact), alertId
    // was nulled by onDelete:SetNull, and the trigger is the durable discriminator.
    const orphan = await prisma.notification.findUnique({ where: { id: alertNotif.id } })
    expect(orphan).not.toBeNull()
    expect(orphan!.alertId).toBeNull()
    expect(orphan!.dispatchTrigger).toBe('ALERT_CREATED')

    // 4) The bell excludes the orphan (would have leaked under the old
    //    alertId-based filter) but keeps the action row.
    const res = await journal.getNotifications(userId)
    const ids = (res.data as Array<{ id: string }>).map((n) => n.id)
    expect(ids).not.toContain(alertNotif.id)
    expect(ids).toContain(actionNotif.id)

    // Unread count uses the same predicate — orphan not counted, action counted.
    const unread = await journal.getNotificationsUnreadCount(userId)
    expect(unread.data.unread).toBe(1)
  })

  it('NOT NULL guarantees zero null dispatchTrigger — untagged insert is rejected', async () => {
    // The DB-level constraint means no dispatcher can silently produce a
    // null-trigger row the bell filter cannot classify.
    await expect(
      prisma.notification.create({
        data: {
          userId,
          channel: 'PUSH',
          title: 'No trigger',
          body: 'should fail',
        } as any,
      }),
    ).rejects.toThrow()

    const [{ nulls }] = await prisma.$queryRawUnsafe<Array<{ nulls: number }>>(
      'SELECT COUNT(*)::int AS nulls FROM "Notification" WHERE "dispatchTrigger" IS NULL',
    )
    expect(nulls).toBe(0)
  })
})
