import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { NotificationChannel, OnboardingStatus, AccountStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'

const REASK_TITLE = 'Confirm your medications'
const REASK_DAYS = 30
const IDEMPOTENCY_DAYS = 28

@Injectable()
export class MonthlyReaskService {
  private readonly logger = new Logger(MonthlyReaskService.name)

  constructor(private readonly prisma: PrismaService) {}

  @Cron('0 14 * * *') // daily 14:00 UTC
  async scheduledRun() {
    const count = await this.runScan()
    this.logger.log(`Monthly re-ask scan complete: ${count} notifications sent`)
  }

  /**
   * Per-patient anniversary cadence: prompt re-confirmation 30 days after the
   * most recent `reportedAt` or `verifiedAt` on any active PatientMedication.
   *
   * Dev 1's phase/14 UI will deep-link this to the card-based intake flow;
   * until then the notification body instructs the patient to log in.
   */
  async runScan(now: Date = new Date()): Promise<number> {
    const reaskCutoff = new Date(now.getTime() - REASK_DAYS * 24 * 60 * 60 * 1000)
    const idempotencyCutoff = new Date(
      now.getTime() - IDEMPOTENCY_DAYS * 24 * 60 * 60 * 1000,
    )

    // Find patients with at least one active med whose most-recent touch
    // (verifiedAt ?? reportedAt) is older than the 30-day cutoff.
    const patients = await this.prisma.user.findMany({
      where: {
        accountStatus: AccountStatus.ACTIVE,
        onboardingStatus: OnboardingStatus.COMPLETED,
        roles: { has: 'PATIENT' },
        patientMedications: {
          some: { discontinuedAt: null },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        patientMedications: {
          where: { discontinuedAt: null },
          select: {
            reportedAt: true,
            verifiedAt: true,
          },
        },
      },
    })

    let sent = 0
    for (const p of patients) {
      const lastTouch = this.latestTouch(p.patientMedications)
      if (lastTouch > reaskCutoff) continue // still fresh

      const recent = await this.prisma.notification.findFirst({
        where: {
          userId: p.id,
          title: REASK_TITLE,
          sentAt: { gte: idempotencyCutoff },
        },
        select: { id: true },
      })
      if (recent) continue

      await this.prisma.notification.create({
        data: {
          userId: p.id,
          channel: NotificationChannel.PUSH,
          title: REASK_TITLE,
          body: 'Are you still taking the same medicines? Tap to review and confirm your list.',
        },
      })
      sent++
    }

    return sent
  }

  private latestTouch(
    meds: Array<{ reportedAt: Date; verifiedAt: Date | null }>,
  ): Date {
    let latest = new Date(0)
    for (const m of meds) {
      const t = m.verifiedAt ?? m.reportedAt
      if (t > latest) latest = t
    }
    return latest
  }
}
