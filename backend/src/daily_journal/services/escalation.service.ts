import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EscalationLevel } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type { AnomalyTrackedEvent } from '../interfaces/events.interface.js'

type ClinicalEscalationLevel = 'LEVEL_2' | 'LEVEL_1' | 'LOW'

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
      // ── Idempotency: skip if this alert already has an escalation ──
      const existingEscalation = await this.prisma.escalationEvent.findFirst({
        where: { alertId: payload.alertId },
      })

      if (existingEscalation) {
        this.logger.log(
          `Alert ${payload.alertId}: already escalated — skipping`,
        )
        return
      }

      // ── Fetch alert + journal entry for clinical context ──
      const alert = await this.prisma.deviationAlert.findUnique({
        where: { id: payload.alertId },
        include: {
          journalEntry: {
            select: {
              entryDate: true,
              measurementTime: true,
              systolicBP: true,
              diastolicBP: true,
              symptoms: true,
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

      // ── Query streak ──
      const streakResult = await this.evaluateStreak(
        payload.userId,
        alert.journalEntry.entryDate,
      )

      if (streakResult.consecutiveDays < 3) {
        this.logger.log(
          `Alert ${payload.alertId}: ${streakResult.consecutiveDays} consecutive day(s) — below threshold (need 3)`,
        )
        return
      }

      // ── Determine clinical escalation level ──
      const currentSymptoms = alert.journalEntry.symptoms ?? []
      const hasSymptoms = currentSymptoms.length > 0
      const medicationCompliant = streakResult.medicationComplianceRate >= 0.5

      const clinicalLevel = this.determineClinicalLevel(
        hasSymptoms,
        medicationCompliant,
      )

      // Map clinical level to DB enum (LOW uses LEVEL_1 in DB but with different messaging)
      const dbLevel =
        clinicalLevel === 'LEVEL_2'
          ? EscalationLevel.LEVEL_2
          : EscalationLevel.LEVEL_1

      // ── Build personalized messages ──
      const systolicBP = alert.journalEntry.systolicBP ?? 0
      const diastolicBP = alert.journalEntry.diastolicBP ?? 0
      const patientName = alert.user?.name ?? 'Patient'
      const readingStr = `${systolicBP}/${diastolicBP} mmHg`
      const entryDate = new Date(alert.journalEntry.entryDate).toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      })
      const entryTime = alert.journalEntry.measurementTime ?? ''
      const dateTimeStr = entryTime ? `${entryDate} at ${entryTime}` : entryDate
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

      // ── Create escalation ──
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

  /**
   * Determine clinical escalation level based on symptoms + medication compliance.
   *
   * LEVEL_2: Has symptoms + medication taken (meds not working → needs clinical review)
   * LEVEL_1: Has symptoms + medication NOT taken (remind patient + update care team)
   * LOW:     No symptoms (mild alert to both)
   */
  private determineClinicalLevel(
    hasSymptoms: boolean,
    medicationCompliant: boolean,
  ): ClinicalEscalationLevel {
    if (hasSymptoms && medicationCompliant) return 'LEVEL_2'
    if (hasSymptoms && !medicationCompliant) return 'LEVEL_1'
    return 'LOW'
  }

  /**
   * Evaluate the streak: consecutive days with deviation alerts +
   * medication compliance across the streak window.
   */
  private async evaluateStreak(
    userId: string,
    entryDate: Date,
  ): Promise<{ consecutiveDays: number; medicationComplianceRate: number }> {
    // Build 5-day window: [D-2, D-1, D, D+1, D+2]
    const days: Date[] = []
    for (let offset = -2; offset <= 2; offset++) {
      const d = new Date(entryDate)
      d.setDate(d.getDate() + offset)
      days.push(d)
    }

    const dayHasAlert: boolean[] = []
    for (const day of days) {
      const count = await this.prisma.deviationAlert.count({
        where: {
          userId,
          journalEntry: { entryDate: day },
        },
      })
      dayHasAlert.push(count > 0)
    }

    // Walk backward from center (index 2)
    let start = 2
    while (start > 0 && dayHasAlert[start - 1]) start--

    // Walk forward from center
    let end = 2
    while (end < 4 && dayHasAlert[end + 1]) end++

    const consecutiveDays = end - start + 1

    // Medication compliance across the streak window
    const streakDays = days.slice(start, end + 1)
    const streakEntries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        entryDate: { in: streakDays },
        medicationTaken: { not: null },
      },
      select: { medicationTaken: true },
    })

    const totalMedEntries = streakEntries.length
    const medTakenCount = streakEntries.filter((e) => e.medicationTaken === true).length
    const medicationComplianceRate = totalMedEntries > 0
      ? medTakenCount / totalMedEntries
      : 1 // default to compliant if no medication data

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
        // Meds taken but BP still high + symptoms → critical, care team review
        return {
          patientMessage:
            `Your BP of ${readingStr} on ${dateTimeStr} has been elevated for ${days} consecutive days despite taking medication. ` +
            `Symptoms reported: ${symptomStr}. Your care team has been notified for urgent review.`,
          careTeamMessage:
            `URGENT: ${patientName} shows persistent BP elevation (${readingStr}) over ${days} days WITH medication compliance. ` +
            `Symptoms: ${symptomStr}. Medication review required.`,
        }

      case 'LEVEL_1':
        // Meds not taken + symptoms → remind patient, update care team
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
        // No symptoms → mild alert
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
