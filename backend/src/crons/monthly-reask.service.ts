import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { ClsService } from 'nestjs-cls'
import { runAsCronActor } from '../common/cls/cron-actor.util.js'
import { EMAIL_TEMPLATE_VERSION, medicationReaskEmailHtml } from '../email/email-templates.js'
import { EmailService } from '../email/email.service.js'
import { NotificationChannel, EnrollmentStatus, AccountStatus } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { isWithinQuietHours } from './daily-reminder/helpers.js'

const REASK_TITLE = 'Confirm your medications'
const REASK_BODY =
  'Are you still taking the same medicines? Tap to review and confirm your list.'
const REASK_DAYS = 30
const IDEMPOTENCY_DAYS = 28

@Injectable()
export class MonthlyReaskService {
  private readonly logger = new Logger(MonthlyReaskService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
    private readonly cls: ClsService,
  ) {}

  @Cron('0 14 * * *') // daily 14:00 UTC
  async scheduledRun() {
    return runAsCronActor(this.cls, 'cron-monthly-reask', async () => {
      const count = await this.runScan()
      this.logger.log(`Monthly re-ask scan complete: ${count} notifications sent`)
    })
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

    // Find enrolled patients with at least one active med whose most-recent
    // touch (verifiedAt ?? reportedAt) is older than the 30-day cutoff.
    // Enrollment gate filter — not identity onboardingStatus — see gap-alert
    // for rationale.
    const patients = await this.prisma.user.findMany({
      where: {
        accountStatus: AccountStatus.ACTIVE,
        enrollmentStatus: EnrollmentStatus.ENROLLED,
        roles: { has: 'PATIENT' },
        patientMedications: {
          some: { discontinuedAt: null },
        },
      },
      select: {
        id: true,
        email: true,
        name: true,
        // N6 (2026-07-13) — pull quiet-hours fields so we can suppress the
        // re-ask during the patient's local sleep window. The re-ask is a
        // non-urgent operational nudge; it can wait until the next scan
        // outside quiet hours.
        timezone: true,
        quietHoursStart: true,
        quietHoursEnd: true,
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

      // N6 (2026-07-13) — respect the patient's quiet-hours window. The next
      // day's scan retries; no in-cron re-scheduling.
      if (
        isWithinQuietHours(
          {
            quietHoursStart: p.quietHoursStart,
            quietHoursEnd: p.quietHoursEnd,
            timezone: p.timezone,
          },
          now,
        )
      ) {
        continue
      }

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
          body: REASK_BODY,
          dispatchTrigger: 'SYSTEM_CRON',
        },
      })

      // EMAIL is the actual out-of-app reach: a patient who never opens the app
      // still gets the re-ask. Mirrors gap-alert's PUSH + EMAIL dispatch. Guard
      // on a present email — invited-but-not-activated rows can lack one.
      if (p.email) {
        await this.prisma.notification.create({
          data: {
            userId: p.id,
            channel: NotificationChannel.EMAIL,
            title: REASK_TITLE,
            body: REASK_BODY,
            dispatchTrigger: 'SYSTEM_CRON',
          },
        })
        await this.emailService.sendEmail(
          p.email,
          `Cardioplace: ${REASK_TITLE}`,
          medicationReaskEmailHtml(p.name ?? 'Patient', REASK_BODY),
          {
            template: 'medication_reask',
            templateVersion: EMAIL_TEMPLATE_VERSION,
            patientUserId: p.id,
          },
        )
      }

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
