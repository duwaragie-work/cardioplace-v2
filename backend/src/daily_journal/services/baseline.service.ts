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

@Injectable()
export class BaselineService {
  private readonly logger = new Logger(BaselineService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  @OnEvent(JOURNAL_EVENTS.ENTRY_CREATED, { async: true })
  async handleEntryCreated(payload: JournalEntryCreatedEvent) {
    await this.computeBaseline(payload)
  }

  @OnEvent(JOURNAL_EVENTS.ENTRY_UPDATED, { async: true })
  async handleEntryUpdated(payload: JournalEntryUpdatedEvent) {
    await this.computeBaseline(payload)
  }

  private async computeBaseline(
    payload: JournalEntryCreatedEvent | JournalEntryUpdatedEvent,
  ) {
    if (payload.systolicBP == null || payload.diastolicBP == null) {
      this.logger.log(
        `Skipping baseline for entry ${payload.entryId} — incomplete BP metrics`,
      )
      return
    }

    try {
      const sevenDaysAgo = new Date(payload.entryDate)
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const entries = await this.prisma.journalEntry.findMany({
        where: {
          userId: payload.userId,
          entryDate: { gte: sevenDaysAgo },
          systolicBP: { not: null },
          diastolicBP: { not: null },
        },
        orderBy: { entryDate: 'desc' },
      })

      const sampleSize = entries.length
      const baselineMet = sampleSize >= 3

      let avgSystolic = 0
      let avgDiastolic = 0
      let avgWeight: number | null = null

      if (baselineMet) {
        avgSystolic =
          entries.reduce((sum, e) => sum + Number(e.systolicBP), 0) / sampleSize
        avgDiastolic =
          entries.reduce((sum, e) => sum + Number(e.diastolicBP), 0) / sampleSize
        const weightEntries = entries.filter((e) => e.weight != null)
        if (weightEntries.length > 0) {
          avgWeight =
            weightEntries.reduce((sum, e) => sum + Number(e.weight), 0) /
            weightEntries.length
        }
      } else {
        this.logger.log(
          `Baseline threshold not met for user ${payload.userId}: ${sampleSize}/3 entries — storing zeros`,
        )
      }

      const snapshot = await this.prisma.baselineSnapshot.upsert({
        where: {
          userId_computedForDate: {
            userId: payload.userId,
            computedForDate: payload.entryDate,
          },
        },
        update: {
          baselineSystolic: new Prisma.Decimal(avgSystolic.toFixed(2)),
          baselineDiastolic: new Prisma.Decimal(avgDiastolic.toFixed(2)),
          baselineWeight:
            avgWeight != null ? new Prisma.Decimal(avgWeight.toFixed(2)) : null,
          sampleSize,
        },
        create: {
          userId: payload.userId,
          computedForDate: payload.entryDate,
          baselineSystolic: new Prisma.Decimal(avgSystolic.toFixed(2)),
          baselineDiastolic: new Prisma.Decimal(avgDiastolic.toFixed(2)),
          baselineWeight:
            avgWeight != null ? new Prisma.Decimal(avgWeight.toFixed(2)) : null,
          sampleSize,
        },
      })

      await this.prisma.journalEntry.update({
        where: { id: payload.entryId },
        data: { snapshotId: snapshot.id },
      })

      if (baselineMet) {
        this.logger.log(
          `Baseline computed for user ${payload.userId} on ${payload.entryDate}: ` +
            `systolic=${avgSystolic.toFixed(2)}, diastolic=${avgDiastolic.toFixed(2)}, weight=${avgWeight?.toFixed(2) ?? 'n/a'}`,
        )

        this.eventEmitter.emit(JOURNAL_EVENTS.BASELINE_COMPUTED, {
          userId: payload.userId,
          entryId: payload.entryId,
          entryDate: payload.entryDate,
          snapshotId: snapshot.id,
          baselineSystolic: avgSystolic,
          baselineDiastolic: avgDiastolic,
          baselineWeight: avgWeight,
          systolicBP: payload.systolicBP,
          diastolicBP: payload.diastolicBP,
        })
      } else {
        this.eventEmitter.emit(JOURNAL_EVENTS.BASELINE_UNAVAILABLE, {
          userId: payload.userId,
          entryId: payload.entryId,
          entryDate: payload.entryDate,
          systolicBP: payload.systolicBP,
          diastolicBP: payload.diastolicBP,
          reason: `Only ${sampleSize} entries in last 7 days (need 3) — baseline set to zero`,
        })
      }
    } catch (error) {
      this.logger.error(
        `Baseline computation failed for entry ${payload.entryId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }
}
