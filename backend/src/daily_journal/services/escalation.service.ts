import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EscalationLevel } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { AlertCreatedEvent } from '../interfaces/events.interface.js'

type ClinicalEscalationLevel = 'LEVEL_2' | 'LEVEL_1' | 'LOW'

// TODO(phase/7): replace the 5-day streak heuristic with the T+N ladder cron
// (T+0 / T+4h / T+8h / T+24h / T+48h) defined in CLINICAL_SPEC V2-D. The
// 15-field audit trail (ladderStep, recipientIds, acknowledgedAt, etc.) on
// EscalationEvent is unpopulated by this phase/2 stub.
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(JOURNAL_EVENTS.ALERT_CREATED, { async: true })
  async handleAnomalyTracked(payload: AlertCreatedEvent) {
    try {
      const existingEscalation = await this.prisma.escalationEvent.findFirst({
        where: { alertId: payload.alertId },
      })

      if (existingEscalation) {
        this.logger.log(
          `Alert ${payload.alertId}: already escalated — skipping`,
        )
        return
      }

      const alert = await this.prisma.deviationAlert.findUnique({
        where: { id: payload.alertId },
        include: {
          journalEntry: {
            select: {
              measuredAt: true,
              systolicBP: true,
              diastolicBP: true,
              otherSymptoms: true,
              medicationTaken: true,
            },
          },
          user: {
            select: { name: true },
          },
        },
      })

      if (!alert?.journalEntry) {
        this.logger.warn(`Alert ${payload.alertId}: journal entry not found — skipping`)
        return
      }

      const streakResult = await this.evaluateStreak(
        payload.userId,
        alert.journalEntry.measuredAt,
      )

      if (streakResult.consecutiveDays < 3) {
        this.logger.log(
          `Alert ${payload.alertId}: ${streakResult.consecutiveDays} consecutive day(s) — below threshold (need 3)`,
        )
        return
      }

      const currentSymptoms = alert.journalEntry.otherSymptoms ?? []
      const hasSymptoms = currentSymptoms.length > 0
      const medicationCompliant = streakResult.medicationComplianceRate >= 0.5

      const clinicalLevel = this.determineClinicalLevel(
        hasSymptoms,
        medicationCompliant,
      )

      const dbLevel =
        clinicalLevel === 'LEVEL_2'
          ? EscalationLevel.LEVEL_2
          : EscalationLevel.LEVEL_1

      const systolicBP = alert.journalEntry.systolicBP ?? 0
      const diastolicBP = alert.journalEntry.diastolicBP ?? 0
      const patientName = alert.user?.name ?? 'Patient'
      const readingStr = `${systolicBP}/${diastolicBP} mmHg`
      const measuredAt = alert.journalEntry.measuredAt
      const dateTimeStr = measuredAt.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      const days = streakResult.consecutiveDays

      const { patientMessage, careTeamMessage } = this.buildMessages(
        clinicalLevel,
        readingStr,
        dateTimeStr,
        days,
        patientName,
        currentSymptoms,
      )

      const typeLabel = payload.type === 'BP_COMBINED'
        ? 'blood pressure'
        : payload.type.toLowerCase().replace('_', ' ')

      const reason = `${days} consecutive day(s) of ${typeLabel} deviation — `
        + (clinicalLevel === 'LEVEL_2'
          ? 'medication compliant but BP still elevated with symptoms'
          : clinicalLevel === 'LEVEL_1'
            ? 'medication non-adherence with symptoms'
            : 'elevated BP without symptoms')

      const escalation = await this.prisma.escalationEvent.create({
        data: {
          alertId: payload.alertId,
          userId: payload.userId,
          escalationLevel: dbLevel,
          reason,
        },
      })

      await this.prisma.deviationAlert.update({
        where: { id: payload.alertId },
        data: { escalated: true },
      })

      this.logger.log(`Escalation ${clinicalLevel} created for alert ${payload.alertId}: ${reason}`)

      this.eventEmitter.emit(JOURNAL_EVENTS.ESCALATION_CREATED, {
        userId: payload.userId,
        escalationEventId: escalation.id,
        alertId: payload.alertId,
        escalationLevel: dbLevel,
        deviationType: payload.type,
        reason,
        symptoms: currentSymptoms,
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

  private determineClinicalLevel(
    hasSymptoms: boolean,
    medicationCompliant: boolean,
  ): ClinicalEscalationLevel {
    if (hasSymptoms && medicationCompliant) return 'LEVEL_2'
    if (hasSymptoms && !medicationCompliant) return 'LEVEL_1'
    return 'LOW'
  }

  private async evaluateStreak(
    userId: string,
    measuredAt: Date,
  ): Promise<{ consecutiveDays: number; medicationComplianceRate: number }> {
    // Build 5-day window centered on the reading's UTC date: [D-2 .. D+2]
    const centerDay = new Date(measuredAt)
    centerDay.setUTCHours(0, 0, 0, 0)

    const dayRanges: { start: Date; end: Date }[] = []
    for (let offset = -2; offset <= 2; offset++) {
      const start = new Date(centerDay)
      start.setUTCDate(start.getUTCDate() + offset)
      const end = new Date(start)
      end.setUTCDate(end.getUTCDate() + 1)
      dayRanges.push({ start, end })
    }

    const dayHasAlert: boolean[] = []
    for (const range of dayRanges) {
      const count = await this.prisma.deviationAlert.count({
        where: {
          userId,
          journalEntry: { measuredAt: { gte: range.start, lt: range.end } },
        },
      })
      dayHasAlert.push(count > 0)
    }

    let start = 2
    while (start > 0 && dayHasAlert[start - 1]) start--

    let end = 2
    while (end < 4 && dayHasAlert[end + 1]) end++

    const consecutiveDays = end - start + 1

    const streakWindowStart = dayRanges[start].start
    const streakWindowEnd = dayRanges[end].end
    const streakEntries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: streakWindowStart, lt: streakWindowEnd },
        medicationTaken: { not: null },
      },
      select: { medicationTaken: true },
    })

    const totalMedEntries = streakEntries.length
    const medTakenCount = streakEntries.filter((e) => e.medicationTaken === true).length
    const medicationComplianceRate = totalMedEntries > 0
      ? medTakenCount / totalMedEntries
      : 1

    return { consecutiveDays, medicationComplianceRate }
  }

  private buildMessages(
    level: ClinicalEscalationLevel,
    readingStr: string,
    dateTimeStr: string,
    days: number,
    patientName: string,
    symptoms: string[],
  ): { patientMessage: string; careTeamMessage: string } {
    const symptomStr = symptoms.length > 0 ? symptoms.join(', ') : ''

    switch (level) {
      case 'LEVEL_2':
        return {
          patientMessage:
            `Your BP of ${readingStr} on ${dateTimeStr} has been elevated for ${days} consecutive days despite taking medication. ` +
            `Symptoms reported: ${symptomStr}. Your care team has been notified for urgent review.`,
          careTeamMessage:
            `URGENT: ${patientName} shows persistent BP elevation (${readingStr}) over ${days} days WITH medication compliance. ` +
            `Symptoms: ${symptomStr}. Medication review required.`,
        }

      case 'LEVEL_1':
        return {
          patientMessage:
            `Your BP of ${readingStr} on ${dateTimeStr} has been elevated for ${days} consecutive days. ` +
            `Symptoms reported: ${symptomStr}. Please take your medication regularly. Your care team has been updated.`,
          careTeamMessage:
            `${patientName} has elevated BP (${readingStr}) for ${days} consecutive days with symptoms (${symptomStr}). ` +
            `Medication non-adherence detected.`,
        }

      case 'LOW':
      default:
        return {
          patientMessage:
            `Your BP of ${readingStr} on ${dateTimeStr} has been elevated for ${days} consecutive days. ` +
            `Continue monitoring and taking your medication as prescribed.`,
          careTeamMessage:
            `${patientName} has elevated BP trend (${readingStr}) for ${days} consecutive days. No symptoms reported.`,
        }
    }
  }
}
