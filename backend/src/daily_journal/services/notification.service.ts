import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { escalationEmailHtml } from '../../email/email-templates.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { EscalationCreatedEvent } from '../interfaces/events.interface.js'
import { CARDIO_TIPS } from '../utils/tips.js'

@Injectable()
export class JournalNotificationService {
  private readonly logger = new Logger(JournalNotificationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  @OnEvent(JOURNAL_EVENTS.ESCALATION_CREATED, { async: true })
  async handleEscalation(payload: EscalationCreatedEvent) {
    try {
      // ── Idempotency: skip if this escalation already has notifications ──
      const existingNotif = await this.prisma.notification.findFirst({
        where: { escalationEventId: payload.escalationEventId },
      })

      if (existingNotif) {
        this.logger.log(
          `Escalation ${payload.escalationEventId}: notifications already sent — skipping`,
        )
        return
      }

      const { title, body } = this.generateContent(payload)
      const tips = this.selectTips(payload)

      // ── PUSH notification ──
      const notification = await this.prisma.notification.create({
        data: {
          userId: payload.userId,
          alertId: payload.alertId,
          escalationEventId: payload.escalationEventId,
          channel: 'PUSH',
          title,
          body,
          tips,
        },
      })

      await this.prisma.escalationEvent.update({
        where: { id: payload.escalationEventId },
        data: { notificationSentAt: new Date() },
      })

      this.logger.log(
        `Notification ${notification.id} sent to user ${payload.userId} [${payload.escalationLevel}]`,
      )

      // ── Email notification ──
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { email: true, name: true },
      })

      if (user?.email) {
        await this.prisma.notification.create({
          data: {
            userId: payload.userId,
            alertId: payload.alertId,
            escalationEventId: payload.escalationEventId,
            channel: 'EMAIL',
            title,
            body,
            tips,
          },
        })

        const isLow = payload.reason?.includes('without symptoms')
        const emailSubject = isLow
          ? 'Cardioplace: Blood Pressure Trend Update'
          : payload.escalationLevel === 'LEVEL_2'
            ? 'Cardioplace Alert: Blood Pressure Reading Requires Attention'
            : 'Cardioplace: Blood Pressure — Please Take Your Medication'
        await this.emailService.sendEmail(
          user.email,
          emailSubject,
          escalationEmailHtml(
            user.name ?? 'Patient',
            payload.escalationLevel,
            title,
            body,
            tips,
          ),
        )
      } else {
        this.logger.warn(
          `No email for user ${payload.userId} — skipping email notification`,
        )
      }
    } catch (error) {
      this.logger.error(
        `Notification failed for escalation ${payload.escalationEventId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  private generateContent(payload: EscalationCreatedEvent): {
    title: string
    body: string
  } {
    // Determine title from reason context (LOW vs LEVEL_1 vs LEVEL_2)
    const isLow = payload.reason?.includes('without symptoms')
    const title = isLow
      ? 'Blood Pressure Trend Notice'
      : payload.escalationLevel === 'LEVEL_2'
        ? 'Urgent Blood Pressure Alert'
        : 'Blood Pressure Alert — Action Needed'

    return { title, body: payload.patientMessage }
  }

  private selectTips(payload: EscalationCreatedEvent): string[] {
    const deviationType = payload.deviationType ?? ''
    // For consolidated BP alerts, use systolic tips
    const tipKey = deviationType === 'BP_COMBINED' ? 'SYSTOLIC_BP' : deviationType
    const typeTips = CARDIO_TIPS[tipKey] ?? []

    const tipCount = payload.escalationLevel === 'LEVEL_2' ? 4 : 2

    if (typeTips.length >= tipCount) {
      return typeTips.slice(0, tipCount)
    }

    const allTips = [
      ...typeTips,
      ...Object.entries(CARDIO_TIPS)
        .filter(([key]) => key !== tipKey)
        .flatMap(([, tips]) => tips),
    ]

    return allTips.slice(0, tipCount)
  }
}
