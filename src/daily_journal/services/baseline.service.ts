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
    if (
      payload.sleepHours == null ||
      payload.sleepQuality == null ||
      payload.awakenings == null
    ) {
      this.logger.log(
        `Skipping baseline for entry ${payload.entryId} — incomplete sleep metrics`,
      )
      return
    }

    try {
      const fourteenDaysAgo = new Date(payload.entryDate)
      fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14)

      const entries = await this.prisma.journalEntry.findMany({
        where: {
          userId: payload.userId,
          entryDate: { gte: fourteenDaysAgo },
          sleepHours: { not: null },
          sleepQuality: { not: null },
          awakenings: { not: null },
        },
        orderBy: { entryDate: 'desc' },
      })

      const baselineMet = entries.length >= 10

      let avgSleepHours = 0
      let avgSleepQuality = 0
      let avgAwakenings = 0

      if (baselineMet) {
        const count = entries.length
        avgSleepHours =
          entries.reduce((sum, e) => sum + Number(e.sleepHours), 0) / count
        avgSleepQuality =
          entries.reduce((sum, e) => sum + Number(e.sleepQuality), 0) / count
        avgAwakenings =
          entries.reduce((sum, e) => sum + Number(e.awakenings), 0) / count
      } else {
        this.logger.log(
          `Baseline threshold not met for user ${payload.userId}: ${entries.length}/10 entries — storing zeros`,
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
          baselineSleepHours: new Prisma.Decimal(avgSleepHours.toFixed(2)),
          baselineSleepQuality: new Prisma.Decimal(
            avgSleepQuality.toFixed(2),
          ),
          baselineAwakenings: new Prisma.Decimal(avgAwakenings.toFixed(2)),
        },
        create: {
          userId: payload.userId,
          computedForDate: payload.entryDate,
          baselineSleepHours: new Prisma.Decimal(avgSleepHours.toFixed(2)),
          baselineSleepQuality: new Prisma.Decimal(
            avgSleepQuality.toFixed(2),
          ),
          baselineAwakenings: new Prisma.Decimal(avgAwakenings.toFixed(2)),
        },
      })

      await this.prisma.journalEntry.update({
        where: { id: payload.entryId },
        data: { snapshotId: snapshot.id },
      })

      if (baselineMet) {
        this.logger.log(
          `Baseline computed for user ${payload.userId} on ${payload.entryDate}: ` +
            `hours=${avgSleepHours.toFixed(2)}, quality=${avgSleepQuality.toFixed(2)}, awakenings=${avgAwakenings.toFixed(2)}`,
        )

        this.eventEmitter.emit(JOURNAL_EVENTS.BASELINE_COMPUTED, {
          userId: payload.userId,
          entryId: payload.entryId,
          entryDate: payload.entryDate,
          snapshotId: snapshot.id,
          baselineSleepHours: avgSleepHours,
          baselineSleepQuality: avgSleepQuality,
          baselineAwakenings: avgAwakenings,
          sleepHours: payload.sleepHours,
          sleepQuality: payload.sleepQuality,
          awakenings: payload.awakenings,
        })
      } else {
        this.eventEmitter.emit(JOURNAL_EVENTS.BASELINE_UNAVAILABLE, {
          userId: payload.userId,
          entryId: payload.entryId,
          entryDate: payload.entryDate,
          sleepHours: payload.sleepHours,
          sleepQuality: payload.sleepQuality,
          awakenings: payload.awakenings,
          reason: `Only ${entries.length} entries in last 14 days (need 10) — baseline set to zero`,
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
