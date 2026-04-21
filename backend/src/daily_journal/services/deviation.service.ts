import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type {
  JournalEntryCreatedEvent,
  JournalEntryUpdatedEvent,
} from '../interfaces/events.interface.js'

type DeviationType = 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'WEIGHT' | 'MEDICATION_ADHERENCE'
type DeviationSeverity = 'MEDIUM' | 'HIGH'

interface DetectedDeviation {
  type: DeviationType
  severity: DeviationSeverity
  magnitude: number
  actualValue: number
}

// TODO(phase/5): replace this entire service with AlertEngineService (Dev 2).
// v2 has no rolling baseline, so the v1 baseline-relative triggers are gone.
// For phase/2 we keep only absolute-threshold alerts so existing patient/admin
// dashboards continue to surface critical BP readings while the real rule
// engine is built.
@Injectable()
export class DeviationService {
  private readonly logger = new Logger(DeviationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED, { async: true })
  async handleEntryCreated(payload: JournalEntryCreatedEvent) {
    await this.evaluate(payload)
  }

  @OnEvent(JOURNAL_EVENTS.ENTRY_UPDATED, { async: true })
  async handleEntryUpdated(payload: JournalEntryUpdatedEvent) {
    await this.evaluate(payload)
  }

  private async evaluate(
    payload: JournalEntryCreatedEvent | JournalEntryUpdatedEvent,
  ) {
    if (payload.systolicBP == null || payload.diastolicBP == null) {
      this.logger.log(
        `Skipping deviation check for entry ${payload.entryId} — incomplete BP`,
      )
      return
    }

    try {
      const deviations = this.detectDeviations({
        systolicBP: payload.systolicBP,
        diastolicBP: payload.diastolicBP,
      })

      if (deviations.length === 0) {
        await this.resolveOpenAlerts(payload.userId)
        return
      }

      await this.processDeviations(deviations, payload.userId, payload.entryId)
    } catch (error) {
      this.logger.error(
        `Deviation detection failed for entry ${payload.entryId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  private async processDeviations(
    deviations: DetectedDeviation[],
    userId: string,
    entryId: string,
  ) {
    const upsertedAlerts: { id: string; type: string; severity: string; escalated: boolean }[] = []

    for (const deviation of deviations) {
      const alert = await this.prisma.deviationAlert.upsert({
        where: {
          journalEntryId_type: {
            journalEntryId: entryId,
            type: deviation.type,
          },
        },
        update: {
          severity: deviation.severity,
          magnitude: new Prisma.Decimal(deviation.magnitude.toFixed(2)),
          actualValue: new Prisma.Decimal(deviation.actualValue.toFixed(2)),
        },
        create: {
          userId,
          journalEntryId: entryId,
          type: deviation.type,
          severity: deviation.severity,
          magnitude: new Prisma.Decimal(deviation.magnitude.toFixed(2)),
          actualValue: new Prisma.Decimal(deviation.actualValue.toFixed(2)),
        },
      })

      upsertedAlerts.push({
        id: alert.id,
        type: deviation.type,
        severity: deviation.severity,
        escalated: alert.escalated,
      })

      this.logger.log(
        `Deviation detected: ${deviation.type} (${deviation.severity}) for user ${userId}`,
      )
    }

    const worstAlert = upsertedAlerts.find((a) => a.severity === 'HIGH')
      ?? upsertedAlerts[0]

    const types = upsertedAlerts.map((a) => a.type)
    const consolidatedType = (types.includes('SYSTOLIC_BP') && types.includes('DIASTOLIC_BP'))
      ? 'BP_COMBINED'
      : worstAlert.type

    this.eventEmitter.emit(JOURNAL_EVENTS.ANOMALY_TRACKED, {
      userId,
      alertId: worstAlert.id,
      type: consolidatedType,
      severity: worstAlert.severity,
      escalated: worstAlert.escalated,
    })
  }

  private detectDeviations(params: {
    systolicBP: number
    diastolicBP: number
  }): DetectedDeviation[] {
    const deviations: DetectedDeviation[] = []

    if (params.systolicBP > 160) {
      deviations.push({
        type: 'SYSTOLIC_BP',
        severity: params.systolicBP > 180 ? 'HIGH' : 'MEDIUM',
        magnitude: Math.abs(params.systolicBP - 160),
        actualValue: params.systolicBP,
      })
    }

    if (params.diastolicBP > 100) {
      deviations.push({
        type: 'DIASTOLIC_BP',
        severity: params.diastolicBP > 110 ? 'HIGH' : 'MEDIUM',
        magnitude: Math.abs(params.diastolicBP - 100),
        actualValue: params.diastolicBP,
      })
    }

    return deviations
  }

  private async resolveOpenAlerts(userId: string) {
    const openAlerts = await this.prisma.deviationAlert.findMany({
      where: {
        userId,
        status: { in: ['OPEN', 'ACKNOWLEDGED'] },
      },
    })

    if (openAlerts.length > 0) {
      await this.prisma.deviationAlert.updateMany({
        where: {
          userId,
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        data: { status: 'RESOLVED' },
      })

      this.logger.log(
        `Resolved ${openAlerts.length} open alert(s) for user ${userId} — BP returned to normal`,
      )
    }
  }
}
