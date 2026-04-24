import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma, EntrySource, EscalationLevel } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from './constants/events.js'
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto.js'
import { UpdateJournalEntryDto } from './dto/update-journal-entry.dto.js'

type JsonValue = Prisma.JsonValue

const SOURCE_MAP: Record<string, EntrySource> = {
  manual: EntrySource.MANUAL,
  healthkit: EntrySource.HEALTHKIT,
}

const POSITION_VALUES = ['SITTING', 'STANDING', 'LYING'] as const

@Injectable()
export class DailyJournalService {
  private readonly logger = new Logger(DailyJournalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(userId: string, dto: CreateJournalEntryDto) {
    try {
      const entry = await this.prisma.journalEntry.create({
        data: {
          userId,
          measuredAt: new Date(dto.measuredAt),
          systolicBP: dto.systolicBP ?? null,
          diastolicBP: dto.diastolicBP ?? null,
          pulse: dto.pulse ?? null,
          weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
          position: dto.position ?? null,
          sessionId: dto.sessionId ?? null,
          measurementConditions: (dto.measurementConditions as JsonValue) ?? Prisma.JsonNull,
          medicationTaken: dto.medicationTaken ?? null,
          missedDoses: dto.missedDoses ?? null,
          missedMedications: (dto.missedMedications as unknown as JsonValue) ?? Prisma.JsonNull,
          // V2 structured Level-2 symptom triggers (Flow B). Prefer the
          // explicit booleans, otherSymptoms goes to the same column. The
          // legacy `symptoms` array (v1 clients) is appended so nothing is
          // lost during the transition.
          severeHeadache: dto.severeHeadache ?? false,
          visualChanges: dto.visualChanges ?? false,
          alteredMentalStatus: dto.alteredMentalStatus ?? false,
          chestPainOrDyspnea: dto.chestPainOrDyspnea ?? false,
          focalNeuroDeficit: dto.focalNeuroDeficit ?? false,
          severeEpigastricPain: dto.severeEpigastricPain ?? false,
          newOnsetHeadache: dto.newOnsetHeadache ?? false,
          ruqPain: dto.ruqPain ?? false,
          edema: dto.edema ?? false,
          otherSymptoms: [
            ...(dto.otherSymptoms ?? []),
            ...(dto.symptoms ?? []),
          ],
          teachBackAnswer: dto.teachBackAnswer ?? null,
          teachBackCorrect: dto.teachBackCorrect ?? null,
          notes: dto.notes ?? null,
          source: dto.source ? SOURCE_MAP[dto.source] : EntrySource.MANUAL,
          sourceMetadata: (dto.sourceMetadata as JsonValue) ?? Prisma.JsonNull,
        },
      })

      this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_CREATED, {
        userId,
        entryId: entry.id,
        measuredAt: entry.measuredAt,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        pulse: entry.pulse,
        weight: entry.weight != null ? Number(entry.weight) : null,
        sessionId: entry.sessionId,
      })

      return {
        statusCode: 202,
        message: 'Journal entry accepted. Background analysis in progress.',
        data: this.serializeEntry(entry),
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A journal entry already exists for this timestamp',
        )
      }

      this.logger.error('Failed to create journal entry', error)
      throw new InternalServerErrorException(
        'An unexpected error occurred while saving the journal entry',
      )
    }
  }

  async update(userId: string, entryId: string, dto: UpdateJournalEntryDto) {
    const existing = await this.prisma.journalEntry.findFirst({
      where: { id: entryId, userId },
    })

    if (!existing) {
      throw new NotFoundException('Journal entry not found')
    }

    try {
      const data: Prisma.JournalEntryUpdateInput = {}

      if (dto.measuredAt !== undefined) data.measuredAt = new Date(dto.measuredAt)
      if (dto.systolicBP !== undefined) data.systolicBP = dto.systolicBP
      if (dto.diastolicBP !== undefined) data.diastolicBP = dto.diastolicBP
      if (dto.pulse !== undefined) data.pulse = dto.pulse
      if (dto.weight !== undefined)
        data.weight = dto.weight != null ? new Prisma.Decimal(dto.weight) : null
      if (dto.position !== undefined)
        data.position = POSITION_VALUES.includes(dto.position as typeof POSITION_VALUES[number])
          ? (dto.position as typeof POSITION_VALUES[number])
          : null
      if (dto.sessionId !== undefined) data.sessionId = dto.sessionId
      if (dto.measurementConditions !== undefined)
        data.measurementConditions =
          (dto.measurementConditions as JsonValue) ?? Prisma.JsonNull
      if (dto.medicationTaken !== undefined) data.medicationTaken = dto.medicationTaken
      if (dto.missedDoses !== undefined) data.missedDoses = dto.missedDoses
      if (dto.missedMedications !== undefined) {
        data.missedMedications =
          (dto.missedMedications as unknown as JsonValue) ?? Prisma.JsonNull
      }

      // Structured V2 symptom booleans (Flow B). Each is independently
      // patchable so a partial update doesn't blow away the others.
      if (dto.severeHeadache !== undefined) data.severeHeadache = dto.severeHeadache
      if (dto.visualChanges !== undefined) data.visualChanges = dto.visualChanges
      if (dto.alteredMentalStatus !== undefined) data.alteredMentalStatus = dto.alteredMentalStatus
      if (dto.chestPainOrDyspnea !== undefined) data.chestPainOrDyspnea = dto.chestPainOrDyspnea
      if (dto.focalNeuroDeficit !== undefined) data.focalNeuroDeficit = dto.focalNeuroDeficit
      if (dto.severeEpigastricPain !== undefined) data.severeEpigastricPain = dto.severeEpigastricPain
      if (dto.newOnsetHeadache !== undefined) data.newOnsetHeadache = dto.newOnsetHeadache
      if (dto.ruqPain !== undefined) data.ruqPain = dto.ruqPain
      if (dto.edema !== undefined) data.edema = dto.edema

      if (dto.otherSymptoms !== undefined || dto.symptoms !== undefined) {
        data.otherSymptoms = [
          ...(dto.otherSymptoms ?? []),
          ...(dto.symptoms ?? []),
        ]
      }
      if (dto.teachBackAnswer !== undefined) data.teachBackAnswer = dto.teachBackAnswer
      if (dto.teachBackCorrect !== undefined) data.teachBackCorrect = dto.teachBackCorrect
      if (dto.notes !== undefined) data.notes = dto.notes
      if (dto.source !== undefined)
        data.source = dto.source ? SOURCE_MAP[dto.source] : EntrySource.MANUAL
      if (dto.sourceMetadata !== undefined)
        data.sourceMetadata = (dto.sourceMetadata as JsonValue) ?? Prisma.JsonNull

      const updated = await this.prisma.journalEntry.update({
        where: { id: entryId },
        data,
      })

      this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_UPDATED, {
        userId,
        entryId: updated.id,
        measuredAt: updated.measuredAt,
        systolicBP: updated.systolicBP,
        diastolicBP: updated.diastolicBP,
        pulse: updated.pulse,
        weight: updated.weight != null ? Number(updated.weight) : null,
        sessionId: updated.sessionId,
      })

      return {
        statusCode: 202,
        message:
          'Journal entry updated. Background re-analysis in progress.',
        data: this.serializeEntry(updated),
      }
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A journal entry already exists for this timestamp',
        )
      }

      this.logger.error('Failed to update journal entry', error)
      throw new InternalServerErrorException(
        'An unexpected error occurred while updating the journal entry',
      )
    }
  }

  async findAll(
    userId: string,
    startDate?: string,
    endDate?: string,
    limit?: number,
  ) {
    const where: Prisma.JournalEntryWhereInput = { userId }

    if (startDate || endDate) {
      where.measuredAt = {}
      if (startDate) where.measuredAt.gte = new Date(startDate)
      if (endDate) where.measuredAt.lte = new Date(endDate)
    }

    const take = Math.min(limit ?? 50, 200)

    const entries = await this.prisma.journalEntry.findMany({
      where,
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take,
    })

    return {
      statusCode: 200,
      message: 'Journal entries retrieved successfully',
      data: entries.map((entry) => this.serializeEntry(entry)),
    }
  }

  async getHistory(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          deviationAlerts: {
            select: {
              id: true,
              type: true,
              severity: true,
              magnitude: true,
              baselineValue: true,
              actualValue: true,
              escalated: true,
              status: true,
            },
          },
        },
      }),
      this.prisma.journalEntry.count({ where: { userId } }),
    ])

    return {
      statusCode: 200,
      message: 'Journal history retrieved successfully',
      data: entries.map((entry) => ({
        id: entry.id,
        measuredAt: entry.measuredAt,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        pulse: entry.pulse,
        weight: entry.weight != null ? Number(entry.weight) : null,
        position: entry.position,
        sessionId: entry.sessionId,
        medicationTaken: entry.medicationTaken,
        missedDoses: entry.missedDoses,
        otherSymptoms: entry.otherSymptoms,
        teachBackAnswer: entry.teachBackAnswer,
        teachBackCorrect: entry.teachBackCorrect,
        notes: entry.notes,
        source: entry.source.toLowerCase(),
        sourceMetadata: entry.sourceMetadata,
        deviations: entry.deviationAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
        })),
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    }
  }

  async findOne(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId },
    })

    if (!entry) {
      throw new NotFoundException('Journal entry not found')
    }

    return {
      statusCode: 200,
      message: 'Journal entry retrieved successfully',
      data: this.serializeEntry(entry),
    }
  }

  async getAlerts(userId: string) {
    const alerts = await this.prisma.deviationAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            id: true,
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
            pulse: true,
            weight: true,
          },
        },
      },
    })

    return {
      statusCode: 200,
      message: 'Alerts retrieved successfully',
      data: alerts.map((alert) => ({
        ...alert,
        magnitude: alert.magnitude != null ? Number(alert.magnitude) : null,
        baselineValue: alert.baselineValue
          ? Number(alert.baselineValue)
          : null,
        actualValue: alert.actualValue ? Number(alert.actualValue) : null,
        journalEntry: alert.journalEntry
          ? {
              ...alert.journalEntry,
              weight: alert.journalEntry.weight != null
                ? Number(alert.journalEntry.weight)
                : null,
            }
          : null,
      })),
    }
  }

  async acknowledgeAlert(userId: string, alertId: string) {
    const alert = await this.prisma.deviationAlert.findFirst({
      where: { id: alertId, userId },
    })

    if (!alert) {
      throw new NotFoundException('Alert not found')
    }

    if (alert.status === 'ACKNOWLEDGED') {
      return {
        statusCode: 200,
        message: 'Alert already acknowledged',
        data: alert,
      }
    }

    const updated = await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    })

    return {
      statusCode: 200,
      message: 'Alert acknowledged',
      data: updated,
    }
  }

  async getNotifications(
    userId: string,
    status: 'all' | 'unread' | 'read' = 'all',
  ) {
    const where: Prisma.NotificationWhereInput = { userId }

    if (status === 'unread') {
      where.readAt = null
    } else if (status === 'read') {
      where.readAt = { not: null }
    }

    const notifications = await this.prisma.notification.findMany({
      where,
      orderBy: { sentAt: 'desc' },
    })

    return {
      statusCode: 200,
      message: 'Notifications retrieved successfully',
      data: notifications.map((notification) => ({
        ...notification,
        watched: notification.readAt != null,
      })),
    }
  }

  async getNotificationById(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      throw new NotFoundException('Notification not found')
    }

    return {
      statusCode: 200,
      message: 'Notification retrieved successfully',
      data: {
        ...notification,
        watched: notification.readAt != null,
      },
    }
  }

  async updateNotificationStatus(
    userId: string,
    id: string,
    watched: boolean,
  ) {
    const existing = await this.prisma.notification.findFirst({
      where: { id, userId },
    })

    if (!existing) {
      throw new NotFoundException('Notification not found')
    }

    const readAt = watched ? existing.readAt ?? new Date() : null

    const updated = await this.prisma.notification.update({
      where: { id },
      data: { readAt },
    })

    return {
      statusCode: 200,
      message: 'Notification status updated',
      data: {
        ...updated,
        watched: updated.readAt != null,
      },
    }
  }

  async bulkUpdateNotificationStatus(
    userId: string,
    ids: string[],
    watched: boolean,
  ) {
    if (!ids.length) {
      return {
        statusCode: 200,
        message: 'Notifications status updated',
        data: { count: 0 },
      }
    }

    const readAt = watched ? new Date() : null

    const result = await this.prisma.notification.updateMany({
      where: {
        id: { in: ids },
        userId,
      },
      data: { readAt },
    })

    return {
      statusCode: 200,
      message: 'Notifications status updated',
      data: { count: result.count },
    }
  }

  // v2: trend averages are derived on the fly, not stored. This endpoint used
  // to read BaselineSnapshot rows; now it computes a trailing 7-day mean of
  // complete (SBP + DBP) readings from JournalEntry. Returns null when the
  // window has no usable data.
  async getLatestBaseline(userId: string) {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: sevenDaysAgo },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { systolicBP: true, diastolicBP: true, weight: true },
    })

    if (entries.length === 0) {
      return {
        statusCode: 200,
        message: 'No baseline available yet',
        data: null,
      }
    }

    const sbps = entries.map((e) => e.systolicBP as number)
    const dbps = entries.map((e) => e.diastolicBP as number)
    const weights = entries
      .filter((e) => e.weight != null)
      .map((e) => Number(e.weight))

    const avg = (xs: number[]) =>
      xs.length > 0 ? xs.reduce((a, b) => a + b, 0) / xs.length : null

    return {
      statusCode: 200,
      message: 'Baseline retrieved successfully',
      data: {
        baselineSystolic: avg(sbps),
        baselineDiastolic: avg(dbps),
        baselineWeight: avg(weights),
        sampleSize: entries.length,
      },
    }
  }

  async delete(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        measuredAt: true,
      },
    })

    if (!entry) {
      throw new NotFoundException('Journal entry not found')
    }

    // Resolve the session anchor that will trigger a re-evaluation BEFORE the
    // delete cascades. SessionAveragerService groups by sessionId OR a 30-min
    // measuredAt window; we mirror that here so the rule engine recomputes the
    // averaged vitals for what's left of the session.
    //
    // DeviationAlert / EscalationEvent rows owned by `entry` cascade-delete
    // via the FK (phase/2 schema). The re-evaluation below takes care of any
    // *sibling-owned* alert that should now be resolved or re-classified — if
    // the average changes such that no rule fires, AlertEngine.resolveOpenAlerts
    // flips open BP_LEVEL_1 alerts to RESOLVED.
    const survivingAnchor = await this.findSessionReevalAnchor(entry)

    await this.prisma.journalEntry.delete({ where: { id } })

    if (survivingAnchor) {
      this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_UPDATED, {
        userId: survivingAnchor.userId,
        entryId: survivingAnchor.id,
        measuredAt: survivingAnchor.measuredAt,
        systolicBP: survivingAnchor.systolicBP,
        diastolicBP: survivingAnchor.diastolicBP,
        pulse: survivingAnchor.pulse,
        weight:
          survivingAnchor.weight != null ? Number(survivingAnchor.weight) : null,
        sessionId: survivingAnchor.sessionId,
      })
    }

    return {
      statusCode: 200,
      message: 'Journal entry deleted successfully',
    }
  }

  /**
   * Returns the newest remaining session-sibling of `entry`, or null if no
   * sibling exists. The rule engine will re-average the session from that
   * anchor after delete cascades.
   */
  private async findSessionReevalAnchor(entry: {
    id: string
    userId: string
    sessionId: string | null
    measuredAt: Date
  }) {
    const SESSION_WINDOW_MS = 30 * 60 * 1000

    if (entry.sessionId) {
      return this.prisma.journalEntry.findFirst({
        where: {
          userId: entry.userId,
          sessionId: entry.sessionId,
          id: { not: entry.id },
        },
        orderBy: { measuredAt: 'desc' },
        select: {
          id: true,
          userId: true,
          sessionId: true,
          measuredAt: true,
          systolicBP: true,
          diastolicBP: true,
          pulse: true,
          weight: true,
        },
      })
    }

    const windowStart = new Date(entry.measuredAt.getTime() - SESSION_WINDOW_MS)
    const windowEnd = new Date(entry.measuredAt.getTime() + SESSION_WINDOW_MS)
    return this.prisma.journalEntry.findFirst({
      where: {
        userId: entry.userId,
        sessionId: null,
        id: { not: entry.id },
        measuredAt: { gte: windowStart, lte: windowEnd },
      },
      orderBy: { measuredAt: 'desc' },
      select: {
        id: true,
        userId: true,
        sessionId: true,
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
        pulse: true,
        weight: true,
      },
    })
  }

  async getStats(userId: string) {
    const now = new Date()
    const thirtyDaysAgo = new Date(now)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [totalEntries, recentEntries, allEntries] = await Promise.all([
      this.prisma.journalEntry.count({ where: { userId } }),
      this.prisma.journalEntry.findMany({
        where: { userId, measuredAt: { gte: thirtyDaysAgo } },
        select: { systolicBP: true, diastolicBP: true },
      }),
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { measuredAt: 'desc' },
        select: { measuredAt: true, medicationTaken: true },
      }),
    ])

    // Current streak: consecutive days ending today (tolerates UTC drift
    // by starting from tomorrow UTC for users east of UTC).
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    let currentStreak = 0
    if (allEntries.length > 0) {
      const entryDates = new Set(
        allEntries.map((e) => e.measuredAt.toISOString().slice(0, 10)),
      )
      const checkDate = new Date(today)
      checkDate.setDate(checkDate.getDate() + 1)
      while (
        !entryDates.has(checkDate.toISOString().slice(0, 10)) &&
        checkDate >= today
      ) {
        checkDate.setDate(checkDate.getDate() - 1)
      }
      while (entryDates.has(checkDate.toISOString().slice(0, 10))) {
        currentStreak++
        checkDate.setDate(checkDate.getDate() - 1)
      }
    }

    const medEntries = allEntries.filter((e) => e.medicationTaken !== null)
    const medTaken = medEntries.filter((e) => e.medicationTaken === true).length
    const medicationAdherenceRate =
      medEntries.length > 0 ? Math.round((medTaken / medEntries.length) * 100) : 0

    const systolicValues = recentEntries
      .filter((e) => e.systolicBP !== null)
      .map((e) => Number(e.systolicBP))
    const diastolicValues = recentEntries
      .filter((e) => e.diastolicBP !== null)
      .map((e) => Number(e.diastolicBP))

    const averageSystolic =
      systolicValues.length > 0
        ? Math.round(systolicValues.reduce((a, b) => a + b, 0) / systolicValues.length)
        : null
    const averageDiastolic =
      diastolicValues.length > 0
        ? Math.round(diastolicValues.reduce((a, b) => a + b, 0) / diastolicValues.length)
        : null

    const lastEntryDate =
      allEntries.length > 0
        ? allEntries[0].measuredAt.toISOString().slice(0, 10)
        : null

    return {
      statusCode: 200,
      message: 'Journal stats retrieved successfully',
      data: {
        totalEntries,
        currentStreak,
        medicationAdherenceRate,
        averageSystolic,
        averageDiastolic,
        lastEntryDate,
      },
    }
  }

  async getEscalations(userId: string) {
    const escalations = await this.prisma.escalationEvent.findMany({
      where: { userId },
      orderBy: { triggeredAt: 'desc' },
      include: {
        alert: {
          select: {
            id: true,
            type: true,
            severity: true,
            tier: true,
            ruleId: true,
            actualValue: true,
            // Three-tier messages populated by OutputGenerator (phase/6).
            // Reviewed wording signed off by Dr. Singal; prefer these over
            // any hand-rolled strings in this endpoint.
            patientMessage: true,
            caregiverMessage: true,
            physicianMessage: true,
            journalEntry: {
              select: {
                measuredAt: true,
                systolicBP: true,
                diastolicBP: true,
              },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      message: 'Escalation events retrieved successfully',
      data: escalations.map((e) => {
        const systolicBP = e.alert.journalEntry?.systolicBP ?? 0
        const diastolicBP = e.alert.journalEntry?.diastolicBP ?? 0

        // Prefer the three-tier messages persisted on DeviationAlert
        // (populated by OutputGenerator in phase/6). The v1 fallback copy
        // below only fires when a legacy escalation has all three message
        // columns null — shouldn't happen for phase/5+ alerts but kept as
        // a defensive last resort so the endpoint never returns an empty
        // string to the dashboard.
        const patientMessage =
          e.alert.patientMessage ??
          (e.escalationLevel === EscalationLevel.LEVEL_2
            ? 'URGENT: Your blood pressure reading indicates a medical emergency. Call 911 immediately or go to your nearest emergency room.'
            : 'Your recent blood pressure reading has been flagged. Your care team has been notified and will follow up with you within 24 hours.')

        // Provider dashboard consumes this as the clinical-side message.
        // `physicianMessage` is the reviewed clinician wording; fall back
        // to `caregiverMessage` if for some reason physician is null
        // (Tier 3 physician-only rules DO populate physicianMessage, so
        // this fallback is belt-and-suspenders).
        const careTeamMessage =
          e.alert.physicianMessage ??
          e.alert.caregiverMessage ??
          (e.escalationLevel === EscalationLevel.LEVEL_2
            ? `IMMEDIATE ACTION REQUIRED: Patient ${e.userId} has critical BP readings (${systolicBP}/${diastolicBP} mmHg). Emergency escalation triggered.`
            : `FOLLOW-UP WITHIN 24H: Patient ${e.userId} has elevated BP readings (${systolicBP}/${diastolicBP} mmHg). Review recommended.`)

        return {
          id: e.id,
          level: e.escalationLevel,
          patientMessage,
          careTeamMessage,
          createdAt: e.triggeredAt,
          alert: {
            id: e.alert.id,
            type: e.alert.type,
            severity: e.alert.severity,
            tier: e.alert.tier,
            ruleId: e.alert.ruleId,
            actualValue: e.alert.actualValue ? Number(e.alert.actualValue) : null,
            journalEntry: e.alert.journalEntry
              ? {
                  measuredAt: e.alert.journalEntry.measuredAt,
                  systolicBP: e.alert.journalEntry.systolicBP,
                  diastolicBP: e.alert.journalEntry.diastolicBP,
                }
              : null,
          },
        }
      }),
    }
  }

  private serializeEntry(entry: {
    id: string
    userId: string
    measuredAt: Date
    systolicBP: number | null
    diastolicBP: number | null
    pulse: number | null
    weight: Prisma.Decimal | number | null
    position: string | null
    sessionId: string | null
    medicationTaken: boolean | null
    missedDoses: number | null
    severeHeadache?: boolean
    visualChanges?: boolean
    alteredMentalStatus?: boolean
    chestPainOrDyspnea?: boolean
    focalNeuroDeficit?: boolean
    severeEpigastricPain?: boolean
    newOnsetHeadache?: boolean
    ruqPain?: boolean
    edema?: boolean
    otherSymptoms: string[]
    teachBackAnswer: string | null
    teachBackCorrect: boolean | null
    notes: string | null
    source: EntrySource
    sourceMetadata: JsonValue
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: entry.id,
      userId: entry.userId,
      measuredAt: entry.measuredAt,
      systolicBP: entry.systolicBP,
      diastolicBP: entry.diastolicBP,
      pulse: entry.pulse,
      weight: entry.weight != null ? Number(entry.weight) : null,
      position: entry.position,
      sessionId: entry.sessionId,
      medicationTaken: entry.medicationTaken,
      missedDoses: entry.missedDoses,
      severeHeadache: entry.severeHeadache ?? false,
      visualChanges: entry.visualChanges ?? false,
      alteredMentalStatus: entry.alteredMentalStatus ?? false,
      chestPainOrDyspnea: entry.chestPainOrDyspnea ?? false,
      focalNeuroDeficit: entry.focalNeuroDeficit ?? false,
      severeEpigastricPain: entry.severeEpigastricPain ?? false,
      newOnsetHeadache: entry.newOnsetHeadache ?? false,
      ruqPain: entry.ruqPain ?? false,
      edema: entry.edema ?? false,
      otherSymptoms: entry.otherSymptoms,
      teachBackAnswer: entry.teachBackAnswer,
      teachBackCorrect: entry.teachBackCorrect,
      notes: entry.notes,
      source: entry.source.toLowerCase(),
      sourceMetadata: entry.sourceMetadata,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }
}
