import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { EmailService } from '../email/email.service.js'
import { NotificationChannel, OnboardingStatus, AccountStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

// Title is load-bearing: the idempotency check filters Notifications by this
// exact string. If the copy changes, add a migration/one-off to reconcile.
const GAP_ALERT_TITLE = 'Time for your BP check'
const GAP_HOURS = 48
const IDEMPOTENCY_HOURS = 24

@Injectable()
export class GapAlertService {
  private readonly logger = new Logger(GapAlertService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @Cron('0 13 * * *') // daily 13:00 UTC ≈ 9AM ET
  async scheduledRun() {
    const count = await this.runScan()
    this.logger.log(`Gap-alert scan complete: ${count} notifications sent`)
  }

  /**
   * Finds enrolled patients whose last reading was > 48h ago (or who've never
   * logged since onboarding completed 48h+ ago) and nudges them.
   *
   * Public so tests and ops tooling can trigger on demand without waiting
   * for the cron.
   */
  async runScan(now: Date = new Date()): Promise<number> {
    const gapCutoff = new Date(now.getTime() - GAP_HOURS * 60 * 60 * 1000)
    const idempotencyCutoff = new Date(
      now.getTime() - IDEMPOTENCY_HOURS * 60 * 60 * 1000,
    )

    const candidates = await this.prisma.user.findMany({
      where: {
        accountStatus: AccountStatus.ACTIVE,
        onboardingStatus: OnboardingStatus.COMPLETED,
        roles: { has: 'PATIENT' },
        updatedAt: { lte: gapCutoff }, // onboarding completed ≥ 48h ago (proxy)
      },
      select: {
        id: true,
        email: true,
        name: true,
        journalEntries: {
          orderBy: { measuredAt: 'desc' },
          take: 1,
          select: { measuredAt: true },
        },
      },
    })

    let sent = 0
    for (const user of candidates) {
      const last = user.journalEntries[0]?.measuredAt
      const hasGap = !last || last < gapCutoff
      if (!hasGap) continue

      const recent = await this.prisma.notification.findFirst({
        where: {
          userId: user.id,
          title: GAP_ALERT_TITLE,
          sentAt: { gte: idempotencyCutoff },
        },
        select: { id: true },
      })
      if (recent) continue

      const daysSince = last
        ? Math.floor((now.getTime() - last.getTime()) / (24 * 60 * 60 * 1000))
        : null
      const body = daysSince
        ? `It's been ${daysSince} day(s) since your last reading. Please log today's BP.`
        : `We don't have any blood-pressure readings yet. Please log today's BP.`

      await this.prisma.notification.create({
        data: {
          userId: user.id,
          channel: NotificationChannel.PUSH,
          title: GAP_ALERT_TITLE,
          body,
        },
      })

      if (user.email) {
        await this.prisma.notification.create({
          data: {
            userId: user.id,
            channel: NotificationChannel.EMAIL,
            title: GAP_ALERT_TITLE,
            body,
          },
        })
        await this.emailService.sendEmail(
          user.email,
          `Cardioplace: ${GAP_ALERT_TITLE}`,
          renderGapAlertHtml(user.name ?? 'Patient', body),
        )
      }

      sent++
    }

    return sent
  }
}

function renderGapAlertHtml(name: string, body: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto;">
      <h2>Hi ${escapeHtml(name)},</h2>
      <p>${escapeHtml(body)}</p>
      <p>Log in to Cardioplace to enter your reading.</p>
    </div>
  `
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
