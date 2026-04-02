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

type DeviationType = 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'WEIGHT' | 'MEDICATION_ADHERENCE'
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
   * Check all deviation types using baseline-relative + absolute thresholds.
   */
  @OnEvent(JOURNAL_EVENTS.BASELINE_COMPUTED, { async: true })
  async handleBaselineComputed(payload: BaselineComputedEvent) {
    try {
      const deviations = this.detectDeviations({
        systolicBP: payload.systolicBP,
        diastolicBP: payload.diastolicBP,
        medicationTaken: payload.medicationTaken ?? null,
        baselineSystolic: payload.baselineSystolic,
        baselineDiastolic: payload.baselineDiastolic,
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
   * Only check absolute BP thresholds and medication adherence.
   */
  @OnEvent(JOURNAL_EVENTS.BASELINE_UNAVAILABLE, { async: true })
  async handleBaselineUnavailable(payload: BaselineUnavailableEvent) {
    try {
      const deviations = this.detectDeviations({
        systolicBP: payload.systolicBP,
        diastolicBP: payload.diastolicBP,
        medicationTaken: payload.medicationTaken ?? null,
        baselineSystolic: null,
        baselineDiastolic: null,
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

      // Check for 3 consecutive days with this deviation type
      // Look at a 5-day window (2 days back, today, 2 days forward)
      const consecutiveResult = await this.findConsecutiveDeviationDays(
        userId,
        entryDate,
        deviation.type,
      )

      this.logger.log(
        `Deviation detected: ${deviation.type} (${deviation.severity}) for user ${userId}, ` +
          `max consecutive days: ${consecutiveResult.maxConsecutive}`,
      )

      // Fire escalation if:
      // - streak is 3+ days AND
      // - THIS specific alert hasn't been escalated yet
      // This means: every new day extending a streak gets its own
      // escalation, but reprocessing the same entry won't duplicate.
      const shouldEscalate =
        consecutiveResult.maxConsecutive >= 3 && !alert.escalated

      this.eventEmitter.emit(JOURNAL_EVENTS.ANOMALY_TRACKED, {
        userId,
        alertId: alert.id,
        type: deviation.type,
        severity: deviation.severity,
        occurrencesInLast3Days: consecutiveResult.maxConsecutive,
        escalated: alert.escalated,
      })

      // If this entry is new to the streak, also check if any
      // neighbour alerts were never escalated (backdated fill-in scenario)
      if (shouldEscalate) {
        for (const neighbourAlertId of consecutiveResult.neighbourAlertIds) {
          if (neighbourAlertId === alert.id) continue
          const neighbour = await this.prisma.deviationAlert.findUnique({
            where: { id: neighbourAlertId },
            include: {
              journalEntry: {
                select: { systolicBP: true, diastolicBP: true },
              },
            },
          })
          if (neighbour && !neighbour.escalated) {
            this.eventEmitter.emit(JOURNAL_EVENTS.ANOMALY_TRACKED, {
              userId,
              alertId: neighbourAlertId,
              type: deviation.type,
              severity: neighbour.severity,
              occurrencesInLast3Days: consecutiveResult.maxConsecutive,
              escalated: false,
            })
          }
        }
      }
    }
  }

  /**
   * SYSTOLIC_BP:
   *   Fires if systolicBP > 160 (absolute) OR systolicBP > baseline + 20
   *   severity: HIGH if > 180, MEDIUM otherwise
   *
   * DIASTOLIC_BP:
   *   Fires if diastolicBP > 100 (absolute) OR diastolicBP > baseline + 15
   *   severity: HIGH if > 110, MEDIUM otherwise
   *
   * MEDICATION_ADHERENCE:
   *   Fires if medicationTaken === false
   *   severity: MEDIUM always
   */
  private detectDeviations(params: {
    systolicBP: number
    diastolicBP: number
    medicationTaken: boolean | null
    baselineSystolic: number | null
    baselineDiastolic: number | null
    hasBaseline: boolean
  }): DetectedDeviation[] {
    const deviations: DetectedDeviation[] = []

    // ── SYSTOLIC_BP ────────────────────────────────────────────────
    {
      const absoluteTrigger = params.systolicBP > 160
      const relativeTrigger =
        params.hasBaseline &&
        params.baselineSystolic != null &&
        params.systolicBP > params.baselineSystolic + 20

      if (absoluteTrigger || relativeTrigger) {
        deviations.push({
          type: 'SYSTOLIC_BP',
          severity: params.systolicBP > 180 ? 'HIGH' : 'MEDIUM',
          magnitude:
            params.baselineSystolic != null
              ? Math.abs(params.systolicBP - params.baselineSystolic)
              : Math.abs(params.systolicBP - 160),
          baselineValue: params.baselineSystolic,
          actualValue: params.systolicBP,
        })
      }
    }

    // ── DIASTOLIC_BP ───────────────────────────────────────────────
    {
      const absoluteTrigger = params.diastolicBP > 100
      const relativeTrigger =
        params.hasBaseline &&
        params.baselineDiastolic != null &&
        params.diastolicBP > params.baselineDiastolic + 15

      if (absoluteTrigger || relativeTrigger) {
        deviations.push({
          type: 'DIASTOLIC_BP',
          severity: params.diastolicBP > 110 ? 'HIGH' : 'MEDIUM',
          magnitude:
            params.baselineDiastolic != null
              ? Math.abs(params.diastolicBP - params.baselineDiastolic)
              : Math.abs(params.diastolicBP - 100),
          baselineValue: params.baselineDiastolic,
          actualValue: params.diastolicBP,
        })
      }
    }

    // ── MEDICATION_ADHERENCE ───────────────────────────────────────
    if (params.medicationTaken === false) {
      deviations.push({
        type: 'MEDICATION_ADHERENCE',
        severity: 'MEDIUM',
        magnitude: 1,
        baselineValue: null,
        actualValue: 0,
      })
    }

    return deviations
  }

  /**
   * Check a 5-day window (2 days back, today, 2 days forward) for this
   * deviation type. Returns the longest consecutive run of days with alerts
   * that includes the current entryDate, plus the alert IDs in that run.
   *
   * This handles backdated entries: if submitting Mar 31 completes a
   * Mar 31 → Apr 1 → Apr 2 streak, the escalation fires immediately.
   */
  private async findConsecutiveDeviationDays(
    userId: string,
    entryDate: Date,
    type: DeviationType,
  ): Promise<{ maxConsecutive: number; neighbourAlertIds: string[]; anyAlreadyEscalated: boolean }> {
    // Build a 5-day window: [D-2, D-1, D, D+1, D+2]
    const days: Date[] = []
    for (let offset = -2; offset <= 2; offset++) {
      const d = new Date(entryDate)
      d.setDate(d.getDate() + offset)
      days.push(d)
    }

    // For each day, check if any entry has a deviation alert of this type
    const dayHasAlert: boolean[] = []
    const dayAlertIds: string[][] = []
    const dayHasEscalated: boolean[] = []

    for (const day of days) {
      const entries = await this.prisma.journalEntry.findMany({
        where: { userId, entryDate: day },
        include: {
          deviationAlerts: { where: { type } },
        },
      })

      const alerts = entries.flatMap((e) => e.deviationAlerts)
      dayHasAlert.push(alerts.length > 0)
      dayAlertIds.push(alerts.map((a) => a.id))
      dayHasEscalated.push(alerts.some((a) => a.escalated))
    }

    // Find the longest consecutive run that includes the center day (index 2)
    let start = 2
    while (start > 0 && dayHasAlert[start - 1]) {
      start--
    }

    let end = 2
    while (end < 4 && dayHasAlert[end + 1]) {
      end++
    }

    const maxConsecutive = end - start + 1
    const neighbourAlertIds = dayAlertIds.slice(start, end + 1).flat()
    const anyAlreadyEscalated = dayHasEscalated
      .slice(start, end + 1)
      .some((v) => v)

    return { maxConsecutive, neighbourAlertIds, anyAlreadyEscalated }
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
