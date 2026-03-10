import { Injectable, Logger } from '@nestjs/common'
import { OnEvent } from '@nestjs/event-emitter'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type {
  BaselineComputedEvent,
  BaselineUnavailableEvent,
} from '../interfaces/events.interface.js'

type DeviationType = 'SLEEP_HOURS' | 'SLEEP_QUALITY' | 'AWAKENINGS'
type DeviationSeverity = 'MEDIUM' | 'HIGH'

interface DetectedDeviation {
  type: DeviationType
  severity: DeviationSeverity
  magnitude: number
  baselineValue: number | null
  actualValue: number
}

@Injectable()
export class DeviationService {
  private readonly logger = new Logger(DeviationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * When baseline IS available (>= 10 entries in 14-day window):
   * Check all 3 deviation types using baseline-relative + absolute thresholds.
   */
  @OnEvent(JOURNAL_EVENTS.BASELINE_COMPUTED, { async: true })
  async handleBaselineComputed(payload: BaselineComputedEvent) {
    try {
      const deviations = this.detectDeviations({
        sleepHours: payload.sleepHours,
        sleepQuality: payload.sleepQuality,
        awakenings: payload.awakenings,
        baselineSleepHours: payload.baselineSleepHours,
        baselineSleepQuality: payload.baselineSleepQuality,
        baselineAwakenings: payload.baselineAwakenings,
        hasBaseline: true,
      })

      if (deviations.length === 0) {
        this.logger.log(
          `No deviations detected for entry ${payload.entryId}`,
        )
        await this.resolveOpenAlerts(payload.userId)
        return
      }

      await this.processDeviations(
        deviations,
        payload.userId,
        payload.entryId,
        payload.entryDate,
      )
    } catch (error) {
      this.logger.error(
        `Deviation detection failed for entry ${payload.entryId}`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  /**
   * When baseline is NOT available (< 10 entries):
   * Only check the absolute sleep hours threshold (< 5 = HIGH).
   * Quality and awakening deviations require a baseline, so they're skipped.
   */
  @OnEvent(JOURNAL_EVENTS.BASELINE_UNAVAILABLE, { async: true })
  async handleBaselineUnavailable(payload: BaselineUnavailableEvent) {
    try {
      const deviations = this.detectDeviations({
        sleepHours: payload.sleepHours,
        sleepQuality: payload.sleepQuality,
        awakenings: payload.awakenings,
        baselineSleepHours: 0,
        baselineSleepQuality: 0,
        baselineAwakenings: 0,
        hasBaseline: false,
      })

      if (deviations.length === 0) {
        this.logger.log(
          `No absolute-threshold deviations for entry ${payload.entryId} (baseline unavailable)`,
        )
        return
      }

      await this.processDeviations(
        deviations,
        payload.userId,
        payload.entryId,
        payload.entryDate,
      )
    } catch (error) {
      this.logger.error(
        `Deviation detection failed for entry ${payload.entryId} (baseline unavailable)`,
        error instanceof Error ? error.stack : error,
      )
    }
  }

  /**
   * Shared logic: upsert alerts, track anomalies, emit events.
   */
  private async processDeviations(
    deviations: DetectedDeviation[],
    userId: string,
    entryId: string,
    entryDate: Date,
  ) {
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
          baselineValue:
            deviation.baselineValue != null
              ? new Prisma.Decimal(deviation.baselineValue.toFixed(2))
              : null,
          actualValue: new Prisma.Decimal(deviation.actualValue.toFixed(2)),
        },
        create: {
          userId,
          journalEntryId: entryId,
          type: deviation.type,
          severity: deviation.severity,
          magnitude: new Prisma.Decimal(deviation.magnitude.toFixed(2)),
          baselineValue:
            deviation.baselineValue != null
              ? new Prisma.Decimal(deviation.baselineValue.toFixed(2))
              : null,
          actualValue: new Prisma.Decimal(deviation.actualValue.toFixed(2)),
        },
      })

      const occurrencesInLast3Days = await this.countOccurrencesInLast3Days(
        userId,
        entryDate,
        deviation.type,
      )

      this.logger.log(
        `Deviation detected: ${deviation.type} (${deviation.severity}) for user ${userId}, ` +
          `occurrences in last 3 days: ${occurrencesInLast3Days}`,
      )

      this.eventEmitter.emit(JOURNAL_EVENTS.ANOMALY_TRACKED, {
        userId,
        alertId: alert.id,
        type: deviation.type,
        severity: deviation.severity,
        occurrencesInLast3Days,
        escalated: alert.escalated,
      })
    }
  }

  /**
   * Two-track detection:
   *
   * Sleep Hours:
   *   Track B (absolute) — sleepHours < 5 → always HIGH (works with or without baseline)
   *   Track A (baseline-relative) — sleepHours < baseline - 1.5 → HIGH if drop >= 2, else MEDIUM
   *
   * Sleep Quality (baseline required):
   *   quality < baseline - 3 → HIGH if drop >= 4, else MEDIUM
   *
   * Awakenings (baseline required):
   *   awakenings >= 3 AND > baseline → HIGH if >= 5, else MEDIUM
   */
  private detectDeviations(params: {
    sleepHours: number
    sleepQuality: number
    awakenings: number
    baselineSleepHours: number
    baselineSleepQuality: number
    baselineAwakenings: number
    hasBaseline: boolean
  }): DetectedDeviation[] {
    const deviations: DetectedDeviation[] = []

    // ── Sleep Hours ──────────────────────────────────────────────

    // Track B — absolute threshold (always active, even without baseline)
    if (params.sleepHours < 5) {
      deviations.push({
        type: 'SLEEP_HOURS',
        severity: 'HIGH',
        magnitude: params.hasBaseline
          ? Math.abs(params.baselineSleepHours - params.sleepHours)
          : Math.abs(5 - params.sleepHours),
        baselineValue: params.hasBaseline
          ? params.baselineSleepHours
          : null,
        actualValue: params.sleepHours,
      })
    }
    // Track A — baseline-relative (only when baseline exists, and Track B didn't fire)
    else if (
      params.hasBaseline &&
      params.sleepHours < params.baselineSleepHours - 1.5
    ) {
      const drop = params.baselineSleepHours - params.sleepHours
      deviations.push({
        type: 'SLEEP_HOURS',
        severity: drop >= 2 ? 'HIGH' : 'MEDIUM',
        magnitude: Math.abs(drop),
        baselineValue: params.baselineSleepHours,
        actualValue: params.sleepHours,
      })
    }

    // ── Sleep Quality (baseline required) ────────────────────────
    if (params.hasBaseline) {
      const qualityDrop =
        params.baselineSleepQuality - params.sleepQuality
      if (params.sleepQuality < params.baselineSleepQuality - 3) {
        deviations.push({
          type: 'SLEEP_QUALITY',
          severity: qualityDrop >= 4 ? 'HIGH' : 'MEDIUM',
          magnitude: Math.abs(qualityDrop),
          baselineValue: params.baselineSleepQuality,
          actualValue: params.sleepQuality,
        })
      }
    }

    // ── Awakenings (baseline required) ───────────────────────────
    if (params.hasBaseline) {
      if (
        params.awakenings >= 3 &&
        params.awakenings > params.baselineAwakenings
      ) {
        deviations.push({
          type: 'AWAKENINGS',
          severity: params.awakenings >= 5 ? 'HIGH' : 'MEDIUM',
          magnitude: params.awakenings - params.baselineAwakenings,
          baselineValue: params.baselineAwakenings,
          actualValue: params.awakenings,
        })
      }
    }

    return deviations
  }

  private async countOccurrencesInLast3Days(
    userId: string,
    entryDate: Date,
    type: DeviationType,
  ): Promise<number> {
    let count = 1 // today already has an alert

    for (let offset = 1; offset <= 2; offset++) {
      const previousDate = new Date(entryDate)
      previousDate.setDate(previousDate.getDate() - offset)

      const previousEntry =
        await this.prisma.journalEntry.findUnique({
          where: {
            userId_entryDate: { userId, entryDate: previousDate },
          },
          include: {
            deviationAlerts: {
              where: { type },
            },
          },
        })

      if (previousEntry?.deviationAlerts?.length) {
        count += 1
      }
    }

    return count
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
        `Resolved ${openAlerts.length} open alert(s) for user ${userId} — sleep returned to normal`,
      )
    }
  }
}
