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
          entryDate: { gte: sevenDaysAgo, lte: new Date(payload.entryDate) },
          systolicBP: { not: null },
          diastolicBP: { not: null },
        },
        orderBy: { entryDate: 'desc' },
      })

      // Per-day-first averaging: group entries by date, average each day,
      // then average across days. Prevents days with more readings from
      // dominating the baseline.
      const dailyMap = new Map<string, { sys: number[]; dia: number[]; weights: number[] }>()
      for (const e of entries) {
        const dateKey = e.entryDate.toISOString().slice(0, 10)
        if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, { sys: [], dia: [], weights: [] })
        const day = dailyMap.get(dateKey)!
        day.sys.push(Number(e.systolicBP))
        day.dia.push(Number(e.diastolicBP))
        if (e.weight != null) day.weights.push(Number(e.weight))
      }

      const dailyAverages = [...dailyMap.values()].map((d) => ({
        avgSys: d.sys.reduce((a, b) => a + b, 0) / d.sys.length,
        avgDia: d.dia.reduce((a, b) => a + b, 0) / d.dia.length,
        avgWeight: d.weights.length > 0
          ? d.weights.reduce((a, b) => a + b, 0) / d.weights.length
          : null,
      }))

      const dayCount = dailyAverages.length
      const baselineMet = dayCount >= 3

      let avgSystolic = 0
      let avgDiastolic = 0
      let avgWeight: number | null = null

      if (baselineMet) {
        avgSystolic = dailyAverages.reduce((s, d) => s + d.avgSys, 0) / dayCount
        avgDiastolic = dailyAverages.reduce((s, d) => s + d.avgDia, 0) / dayCount
        const daysWithWeight = dailyAverages.filter((d) => d.avgWeight != null)
        if (daysWithWeight.length > 0) {
          avgWeight =
            daysWithWeight.reduce((s, d) => s + d.avgWeight!, 0) / daysWithWeight.length
        }
      } else {
        this.logger.log(
          `Baseline threshold not met for user ${payload.userId}: ${dayCount}/3 days — storing zeros`,
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
          sampleSize: dayCount,
        },
        create: {
          userId: payload.userId,
          computedForDate: payload.entryDate,
          baselineSystolic: new Prisma.Decimal(avgSystolic.toFixed(2)),
          baselineDiastolic: new Prisma.Decimal(avgDiastolic.toFixed(2)),
          baselineWeight:
            avgWeight != null ? new Prisma.Decimal(avgWeight.toFixed(2)) : null,
          sampleSize: dayCount,
        },
      })

      await this.prisma.journalEntry.update({
        where: { id: payload.entryId },
        data: { snapshotId: snapshot.id },
      })

      // Recompute affected future baselines
      const entryDate = new Date(payload.entryDate)
      const sevenDaysLater = new Date(entryDate)
      sevenDaysLater.setDate(sevenDaysLater.getDate() + 7)

      const affectedSnapshots = await this.prisma.baselineSnapshot.findMany({
        where: {
          userId: payload.userId,
          computedForDate: {
            gt: entryDate,
            lte: sevenDaysLater,
          },
        },
      })

      for (const affectedSnapshot of affectedSnapshots) {
        const snapshotDate = new Date(affectedSnapshot.computedForDate)
        const windowStart = new Date(snapshotDate)
        windowStart.setDate(windowStart.getDate() - 7)

        const windowEntries = await this.prisma.journalEntry.findMany({
          where: {
            userId: payload.userId,
            systolicBP: { not: null },
            diastolicBP: { not: null },
            entryDate: {
              gte: windowStart,
              lte: snapshotDate,
            },
          },
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
            weight: true,
          },
        })

        // Per-day-first averaging for recomputation
        const reDailyMap = new Map<string, { sys: number[]; dia: number[]; weights: number[] }>()
        for (const e of windowEntries) {
          const dateKey = e.entryDate.toISOString().slice(0, 10)
          if (!reDailyMap.has(dateKey)) reDailyMap.set(dateKey, { sys: [], dia: [], weights: [] })
          const day = reDailyMap.get(dateKey)!
          day.sys.push(Number(e.systolicBP))
          day.dia.push(Number(e.diastolicBP))
          if (e.weight != null) day.weights.push(Number(e.weight))
        }

        const reDailyAvgs = [...reDailyMap.values()].map((d) => ({
          avgSys: d.sys.reduce((a, b) => a + b, 0) / d.sys.length,
          avgDia: d.dia.reduce((a, b) => a + b, 0) / d.dia.length,
          avgWeight: d.weights.length > 0
            ? d.weights.reduce((a, b) => a + b, 0) / d.weights.length
            : null,
        }))

        const reDayCount = reDailyAvgs.length
        if (reDayCount < 3) continue

        const reAvgSystolic = reDailyAvgs.reduce((s, d) => s + d.avgSys, 0) / reDayCount
        const reAvgDiastolic = reDailyAvgs.reduce((s, d) => s + d.avgDia, 0) / reDayCount
        const reDaysWithWeight = reDailyAvgs.filter((d) => d.avgWeight != null)
        const reAvgWeight =
          reDaysWithWeight.length > 0
            ? reDaysWithWeight.reduce((s, d) => s + d.avgWeight!, 0) / reDaysWithWeight.length
            : null

        await this.prisma.baselineSnapshot.update({
          where: { id: affectedSnapshot.id },
          data: {
            baselineSystolic: new Prisma.Decimal(reAvgSystolic.toFixed(2)),
            baselineDiastolic: new Prisma.Decimal(reAvgDiastolic.toFixed(2)),
            baselineWeight:
              reAvgWeight != null
                ? new Prisma.Decimal(reAvgWeight.toFixed(2))
                : null,
            sampleSize: reDayCount,
          },
        })

        this.logger.log(
          `Recomputed baseline for ${affectedSnapshot.computedForDate.toISOString().split('T')[0]} ` +
            `after new entry on ${payload.entryDate}: ` +
            `systolic=${reAvgSystolic.toFixed(2)}, diastolic=${reAvgDiastolic.toFixed(2)}`,
        )
      }

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
          reason: `Only ${dayCount} days in last 7 days (need 3) — baseline set to zero`,
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
