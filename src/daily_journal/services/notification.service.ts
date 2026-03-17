import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { EscalationCreatedEvent } from '../interfaces/events.interface.js'
import { SLEEP_TIPS } from '../utils/tips.js'

@Injectable()
export class JournalNotificationService {
  private readonly logger = new Logger(JournalNotificationService.name)

  constructor(private readonly prisma: PrismaService) {}

  @OnEvent(JOURNAL_EVENTS.ESCALATION_CREATED, { async: true })
  async handleEscalation(payload: EscalationCreatedEvent) {
    try {
      const { title, body } = this.generateContent(payload)
      const tips = this.selectTips(payload)

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
    const titles: Record<string, string> = {
      LEVEL_1: 'Sleep Pattern Notice',
      LEVEL_2: 'Sleep Warning',
      LEVEL_3: 'Urgent Sleep Alert',
    }

    const bodies: Record<string, string> = {
      LEVEL_1:
        'We noticed a change in your sleep pattern. Keep an eye on it.',
      LEVEL_2:
        'Your sleep has been off for 2 days in a row. Consider reviewing your habits.',
      LEVEL_3:
        'Your sleep quality has been consistently poor. We strongly recommend taking action.',
    }

    return {
      title: titles[payload.escalationLevel] ?? 'Sleep Alert',
      body:
        bodies[payload.escalationLevel] ??
        payload.reason,
    }
  }

  private selectTips(payload: EscalationCreatedEvent): string[] {
    const deviationType = payload.deviationType ?? ''
    const typeTips = SLEEP_TIPS[deviationType] ?? []

    const tipCount =
      payload.escalationLevel === 'LEVEL_3'
        ? 4
        : payload.escalationLevel === 'LEVEL_2'
          ? 3
          : 2

    if (typeTips.length >= tipCount) {
      return typeTips.slice(0, tipCount)
    }

    const allTips = [
      ...typeTips,
      ...Object.entries(SLEEP_TIPS)
        .filter(([key]) => key !== deviationType)
        .flatMap(([, tips]) => tips),
    ]

    return allTips.slice(0, tipCount)
  }
}
