import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EscalationLevel } from '../../generated/prisma/enums.js'
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

      // Fetch journal entry + user data for clinical context
      const alert = await this.prisma.deviationAlert.findUnique({
        where: { id: payload.alertId },
        include: {
          journalEntry: {
            select: { entryDate: true, measurementTime: true, systolicBP: true, diastolicBP: true, symptoms: true },
          },
          user: {
            select: { name: true },
          },
        },
      })

      const systolicBP = alert?.journalEntry?.systolicBP ?? 0
      const diastolicBP = alert?.journalEntry?.diastolicBP ?? 0
      const symptoms = alert?.journalEntry?.symptoms ?? []
      const patientName = alert?.user?.name ?? 'Patient'
      const entryDate = alert?.journalEntry?.entryDate
        ? new Date(alert.journalEntry.entryDate).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
        : 'Unknown date'
      const entryTime = alert?.journalEntry?.measurementTime ?? ''

      // Determine escalation level
      const hasHighSeverity = payload.severity === 'HIGH'
      const hasEmergencySymptoms = this.checkEmergencySymptoms(symptoms)
      const level =
        hasHighSeverity || hasEmergencySymptoms
          ? EscalationLevel.LEVEL_2
          : EscalationLevel.LEVEL_1

      const typeLabel = payload.type.toLowerCase().replace('_', ' ')
      const reason = `${payload.occurrencesInLast3Days} consecutive day(s) of ${typeLabel} deviation (${payload.severity})`

      const readingStr = `${systolicBP}/${diastolicBP} mmHg`
      const dateTimeStr = entryTime ? `${entryDate} at ${entryTime}` : entryDate

      // Patient-facing message — personalized with reading and date
      const patientMessage =
        level === EscalationLevel.LEVEL_2
          ? `🚨 URGENT: Your blood pressure reading of ${readingStr} on ${dateTimeStr} is critically high. This is ${payload.occurrencesInLast3Days} consecutive days of dangerous readings. Call 911 immediately or go to your nearest emergency room.`
          : `📋 Your blood pressure reading of ${readingStr} on ${dateTimeStr} has been flagged. This is ${payload.occurrencesInLast3Days} consecutive days of elevated readings. Your care team has been notified and will follow up within 24 hours.`

      // Care team notification — personalized
      const careTeamMessage =
        level === EscalationLevel.LEVEL_2
          ? `IMMEDIATE ACTION REQUIRED: ${patientName} recorded ${readingStr} on ${dateTimeStr}. ${payload.occurrencesInLast3Days} consecutive days of critical BP. Emergency escalation triggered.`
          : `FOLLOW-UP WITHIN 24H: ${patientName} recorded ${readingStr} on ${dateTimeStr}. ${payload.occurrencesInLast3Days} consecutive days of elevated BP. Review recommended.`

      const escalation = await this.prisma.escalationEvent.create({
        data: {
          alertId: payload.alertId,
          userId: payload.userId,
          escalationLevel: level,
          reason,
        },
      })

      await this.prisma.deviationAlert.update({
        where: { id: payload.alertId },
        data: { escalated: true },
      })

      this.logger.log(
        `Escalation ${level} created for alert ${payload.alertId}: ${reason}`,
      )
      this.logger.log(`Patient message: ${patientMessage}`)
      this.logger.log(`Care team message: ${careTeamMessage}`)

      this.eventEmitter.emit(JOURNAL_EVENTS.ESCALATION_CREATED, {
        userId: payload.userId,
        escalationEventId: escalation.id,
        alertId: payload.alertId,
        escalationLevel: level,
        deviationType: payload.type,
        reason,
        symptoms,
        patientMessage,
        careTeamMessage,
      })
    } catch (error) {
      this.logger.error(
        `Escalation failed for alert ${payload.alertId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  private checkEmergencySymptoms(symptoms: string[]): boolean {
    const emergencyKeywords = [
      'chest pain',
      'severe headache',
      'sudden numbness',
      'vision changes',
      'shortness of breath',
      'syncope',
      'fainting',
    ]
    return symptoms.some((s) =>
      emergencyKeywords.some((kw) => s.toLowerCase().includes(kw)),
    )
  }
}
