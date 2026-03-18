import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { AnomalyTrackedEvent } from '../interfaces/events.interface.js'

@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(JOURNAL_EVENTS.ANOMALY_TRACKED, { async: true })
  async handleAnomalyTracked(payload: AnomalyTrackedEvent) {
    try {
      // Escalation only triggers when the same deviation type
      // occurred on the past two days and today (3+ occurrences
      // in the last 3 days). Fewer than 3 are just tracked alerts.
      if (payload.occurrencesInLast3Days < 3) {
        this.logger.log(
          `Alert ${payload.alertId}: ${payload.occurrencesInLast3Days} occurrence(s) in last 3 days — below escalation threshold (need 3)`,
        )
        return
      }

      const typeLabel = payload.type.toLowerCase().replace('_', ' ')
      const reason = `${payload.occurrencesInLast3Days} occurrence(s) of ${typeLabel} deviation in the last 3 days (${payload.severity})`

      const escalation = await this.prisma.escalationEvent.create({
        data: {
          alertId: payload.alertId,
          userId: payload.userId,
          escalationLevel: 'LEVEL_3',
          reason,
        },
      })

      await this.prisma.deviationAlert.update({
        where: { id: payload.alertId },
        data: { escalated: true },
      })

      this.logger.log(
        `Escalation LEVEL_3 created for alert ${payload.alertId}: ${reason}`,
      )

      this.eventEmitter.emit(JOURNAL_EVENTS.ESCALATION_CREATED, {
        userId: payload.userId,
        escalationEventId: escalation.id,
        alertId: payload.alertId,
        escalationLevel: 'LEVEL_3',
        deviationType: payload.type,
        reason,
      })
    } catch (error) {
      this.logger.error(
        `Escalation failed for alert ${payload.alertId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }
}
