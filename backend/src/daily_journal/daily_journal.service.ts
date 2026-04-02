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

@Injectable()
export class DailyJournalService {
  private readonly logger = new Logger(DailyJournalService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  private inferMeasurementTime(): string {
    const now = new Date()
    const hh = String(now.getHours()).padStart(2, '0')
    const mm = String(now.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  }

  async create(userId: string, dto: CreateJournalEntryDto) {
    try {
      const measurementTime = dto.measurementTime ?? this.inferMeasurementTime()

      const entry = await this.prisma.journalEntry.create({
        data: {
          userId,
          entryDate: new Date(dto.entryDate),
          measurementTime,
          systolicBP: dto.systolicBP ?? null,
          diastolicBP: dto.diastolicBP ?? null,
          weight: dto.weight != null ? new Prisma.Decimal(dto.weight) : null,
          medicationTaken: dto.medicationTaken ?? null,
          missedDoses: dto.missedDoses ?? null,
          symptoms: dto.symptoms ?? [],
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
        entryDate: entry.entryDate,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        weight: entry.weight != null ? Number(entry.weight) : null,
        medicationTaken: entry.medicationTaken,
        measurementTime: entry.measurementTime,
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
          'A journal entry already exists for this date and time',
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

      if (dto.entryDate !== undefined) data.entryDate = new Date(dto.entryDate)
      if (dto.measurementTime !== undefined) data.measurementTime = dto.measurementTime
      if (dto.systolicBP !== undefined) data.systolicBP = dto.systolicBP
      if (dto.diastolicBP !== undefined) data.diastolicBP = dto.diastolicBP
      if (dto.weight !== undefined)
        data.weight = dto.weight != null ? new Prisma.Decimal(dto.weight) : null
      if (dto.medicationTaken !== undefined) data.medicationTaken = dto.medicationTaken
      if (dto.missedDoses !== undefined) data.missedDoses = dto.missedDoses
      if (dto.symptoms !== undefined) data.symptoms = dto.symptoms ?? []
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
        entryDate: updated.entryDate,
        systolicBP: updated.systolicBP,
        diastolicBP: updated.diastolicBP,
        weight: updated.weight != null ? Number(updated.weight) : null,
        medicationTaken: updated.medicationTaken,
        measurementTime: updated.measurementTime,
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
          'A journal entry already exists for this date and time',
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
      where.entryDate = {}
      if (startDate) where.entryDate.gte = new Date(startDate)
      if (endDate) where.entryDate.lte = new Date(endDate)
    }

    const take = Math.min(limit ?? 50, 200)

    const entries = await this.prisma.journalEntry.findMany({
      where,
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
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
        orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
        include: {
          snapshot: {
            select: {
              id: true,
              computedForDate: true,
              baselineSystolic: true,
              baselineDiastolic: true,
              baselineWeight: true,
            },
          },
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
        entryDate: entry.entryDate,
        measurementTime: entry.measurementTime,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        weight: entry.weight != null ? Number(entry.weight) : null,
        medicationTaken: entry.medicationTaken,
        missedDoses: entry.missedDoses,
        symptoms: entry.symptoms,
        teachBackAnswer: entry.teachBackAnswer,
        teachBackCorrect: entry.teachBackCorrect,
        notes: entry.notes,
        source: entry.source.toLowerCase(),
        sourceMetadata: entry.sourceMetadata,
        baseline: entry.snapshot
          ? {
              id: entry.snapshot.id,
              baselineSystolic: entry.snapshot.baselineSystolic
                ? Number(entry.snapshot.baselineSystolic)
                : null,
              baselineDiastolic: entry.snapshot.baselineDiastolic
                ? Number(entry.snapshot.baselineDiastolic)
                : null,
              baselineWeight: entry.snapshot.baselineWeight
                ? Number(entry.snapshot.baselineWeight)
                : null,
            }
          : null,
        deviations: entry.deviationAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: Number(a.magnitude),
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
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
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
        magnitude: Number(alert.magnitude),
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

  async getLatestBaseline(userId: string) {
    const snapshot = await this.prisma.baselineSnapshot.findFirst({
      where: {
        userId,
        baselineSystolic: { gt: 0 },
        baselineDiastolic: { gt: 0 },
      },
      orderBy: { computedForDate: 'desc' },
    })

    if (!snapshot) {
      return {
        statusCode: 200,
        message: 'No baseline available yet',
        data: null,
      }
    }

    return {
      statusCode: 200,
      message: 'Baseline retrieved successfully',
      data: {
        id: snapshot.id,
        userId: snapshot.userId,
        computedForDate: snapshot.computedForDate,
        baselineSystolic: snapshot.baselineSystolic
          ? Number(snapshot.baselineSystolic)
          : null,
        baselineDiastolic: snapshot.baselineDiastolic
          ? Number(snapshot.baselineDiastolic)
          : null,
        baselineWeight: snapshot.baselineWeight
          ? Number(snapshot.baselineWeight)
          : null,
        createdAt: snapshot.createdAt,
      },
    }
  }

  async delete(userId: string, id: string) {
    const entry = await this.prisma.journalEntry.findFirst({
      where: { id, userId },
    })

    if (!entry) {
      throw new NotFoundException('Journal entry not found')
    }

    const { entryDate, snapshotId } = entry
    const hadBPData = entry.systolicBP != null && entry.diastolicBP != null

    await this.prisma.journalEntry.delete({ where: { id } })

    // Clean up orphaned BaselineSnapshot if no other entries reference it
    if (snapshotId) {
      const otherRefs = await this.prisma.journalEntry.count({
        where: { snapshotId },
      })
      if (otherRefs === 0) {
        await this.prisma.baselineSnapshot
          .delete({ where: { id: snapshotId } })
          .catch((err) => {
            this.logger.warn(
              `Failed to clean up orphaned snapshot ${snapshotId}`,
              err,
            )
          })
      }
    }

    // Recompute baselines only if the deleted entry had BP data
    // (entries without BP never contributed to any baseline)
    if (hadBPData) {
      const affectedWindowEnd = new Date(entryDate)
      affectedWindowEnd.setDate(affectedWindowEnd.getDate() + 7)

      const affectedEntries = await this.prisma.journalEntry.findMany({
        where: {
          userId,
          entryDate: { gte: entryDate, lte: affectedWindowEnd },
          systolicBP: { not: null },
          diastolicBP: { not: null },
        },
      })

      for (const affected of affectedEntries) {
        this.eventEmitter.emit(JOURNAL_EVENTS.ENTRY_UPDATED, {
          userId: affected.userId,
          entryId: affected.id,
          entryDate: affected.entryDate,
          systolicBP: affected.systolicBP,
          diastolicBP: affected.diastolicBP,
          weight: affected.weight != null ? Number(affected.weight) : null,
        })
      }
    }

    return {
      statusCode: 200,
      message: 'Journal entry deleted successfully',
    }
  }

  async getStats(userId: string) {
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const thirtyDaysAgo = new Date(today)
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

    const [totalEntries, recentEntries, allEntries] = await Promise.all([
      this.prisma.journalEntry.count({ where: { userId } }),
      this.prisma.journalEntry.findMany({
        where: { userId, entryDate: { gte: thirtyDaysAgo } },
        select: { systolicBP: true, diastolicBP: true },
      }),
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { entryDate: 'desc' },
        select: { entryDate: true, medicationTaken: true },
      }),
    ])

    // Current streak: consecutive days ending today
    let currentStreak = 0
    if (allEntries.length > 0) {
      const checkDate = new Date(today)
      const entryDates = new Set(
        allEntries.map((e) => e.entryDate.toISOString().slice(0, 10)),
      )
      while (entryDates.has(checkDate.toISOString().slice(0, 10))) {
        currentStreak++
        checkDate.setDate(checkDate.getDate() - 1)
      }
    }

    // Medication adherence rate
    const medEntries = allEntries.filter((e) => e.medicationTaken !== null)
    const medTaken = medEntries.filter((e) => e.medicationTaken === true).length
    const medicationAdherenceRate =
      medEntries.length > 0 ? Math.round((medTaken / medEntries.length) * 100) : 0

    // Average BP from last 30 days
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
        ? allEntries[0].entryDate.toISOString().slice(0, 10)
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
            actualValue: true,
            journalEntry: {
              select: {
                entryDate: true,
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

        const patientMessage =
          e.escalationLevel === EscalationLevel.LEVEL_2
            ? 'URGENT: Your blood pressure reading indicates a medical emergency. Call 911 immediately or go to your nearest emergency room.'
            : 'Your recent blood pressure reading has been flagged. Your care team has been notified and will follow up with you within 24 hours.'

        const careTeamMessage =
          e.escalationLevel === EscalationLevel.LEVEL_2
            ? `IMMEDIATE ACTION REQUIRED: Patient ${e.userId} has critical BP readings (${systolicBP}/${diastolicBP} mmHg). Emergency escalation triggered.`
            : `FOLLOW-UP WITHIN 24H: Patient ${e.userId} has elevated BP readings (${systolicBP}/${diastolicBP} mmHg). Review recommended.`

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
            actualValue: e.alert.actualValue ? Number(e.alert.actualValue) : null,
            journalEntry: e.alert.journalEntry
              ? {
                  entryDate: e.alert.journalEntry.entryDate,
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
    entryDate: Date
    measurementTime: string | null
    systolicBP: number | null
    diastolicBP: number | null
    weight: Prisma.Decimal | number | null
    medicationTaken: boolean | null
    missedDoses: number | null
    symptoms: string[]
    teachBackAnswer: string | null
    teachBackCorrect: boolean | null
    notes: string | null
    source: EntrySource
    sourceMetadata: JsonValue
    snapshotId: string | null
    createdAt: Date
    updatedAt: Date
  }) {
    return {
      id: entry.id,
      userId: entry.userId,
      entryDate: entry.entryDate,
      measurementTime: entry.measurementTime,
      systolicBP: entry.systolicBP,
      diastolicBP: entry.diastolicBP,
      weight: entry.weight != null ? Number(entry.weight) : null,
      medicationTaken: entry.medicationTaken,
      missedDoses: entry.missedDoses,
      symptoms: entry.symptoms,
      teachBackAnswer: entry.teachBackAnswer,
      teachBackCorrect: entry.teachBackCorrect,
      notes: entry.notes,
      source: entry.source.toLowerCase(),
      sourceMetadata: entry.sourceMetadata,
      snapshotId: entry.snapshotId,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    }
  }
}
