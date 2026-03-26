import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── GET /provider/stats ──────────────────────────────────────────────────────

  async getStats() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

    const [totalActivePatients, monthlyInteractions, activeAlertsCount] =
      await Promise.all([
        this.prisma.user.count({
          where: { onboardingStatus: 'COMPLETED' },
        }),
        this.prisma.journalEntry.count({
          where: { createdAt: { gte: startOfMonth } },
        }),
        this.prisma.deviationAlert.count({
          where: { status: 'OPEN' },
        }),
      ])

    // BP controlled %: patients whose latest journal entry has systolicBP < 130
    const usersWithEntries = await this.prisma.user.findMany({
      where: {
        onboardingStatus: 'COMPLETED',
        journalEntries: { some: {} },
      },
      include: {
        journalEntries: {
          orderBy: { entryDate: 'desc' },
          take: 1,
          select: { systolicBP: true },
        },
      },
    })

    const totalWithEntries = usersWithEntries.length
    const controlled = usersWithEntries.filter(
      (u) =>
        u.journalEntries[0]?.systolicBP != null &&
        u.journalEntries[0].systolicBP < 130,
    ).length

    const bpControlledPercent =
      totalWithEntries > 0
        ? Math.round((controlled / totalWithEntries) * 100)
        : 0

    return {
      statusCode: 200,
      data: {
        totalActivePatients,
        monthlyInteractions,
        activeAlertsCount,
        bpControlledPercent,
      },
    }
  }

  // ─── GET /provider/patients ───────────────────────────────────────────────────

  async getPatients(filters: {
    riskTier?: string
    hasActiveAlerts?: boolean
  }) {
    const where: Record<string, unknown> = {
      roles: { has: 'REGISTERED_USER' },
    }
    if (filters.riskTier) {
      where.riskTier = filters.riskTier
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        journalEntries: {
          orderBy: { entryDate: 'desc' },
          take: 1,
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
        baselineSnapshots: {
          where: { baselineSystolic: { gt: 0 } },
          orderBy: { computedForDate: 'desc' },
          take: 1,
          select: {
            baselineSystolic: true,
            baselineDiastolic: true,
          },
        },
        deviationAlerts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { escalationLevel: true },
        },
      },
    })

    let patients = users.map((u) => {
      const latestEntry = u.journalEntries[0] ?? null
      const latestBaseline = u.baselineSnapshots[0] ?? null
      const activeAlertsCount = u.deviationAlerts.length
      const escalationLevel =
        u.escalationEvents[0]?.escalationLevel ?? null

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        riskTier: u.riskTier ?? 'STANDARD',
        communicationPreference: u.communicationPreference ?? null,
        primaryCondition: u.primaryCondition,
        onboardingStatus: u.onboardingStatus,
        latestBaseline: latestBaseline
          ? {
              baselineSystolic: Number(latestBaseline.baselineSystolic),
              baselineDiastolic: Number(latestBaseline.baselineDiastolic),
            }
          : null,
        activeAlertsCount,
        lastEntryDate: latestEntry?.entryDate ?? null,
        latestBP: latestEntry
          ? {
              systolicBP: latestEntry.systolicBP,
              diastolicBP: latestEntry.diastolicBP,
              entryDate: latestEntry.entryDate,
            }
          : null,
        escalationLevel,
      }
    })

    if (filters.hasActiveAlerts != null) {
      patients = patients.filter((p) =>
        filters.hasActiveAlerts
          ? p.activeAlertsCount > 0
          : p.activeAlertsCount === 0,
      )
    }

    return { statusCode: 200, data: patients }
  }

  // ─── GET /provider/patients/:userId/summary ───────────────────────────────────

  async getPatientSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        journalEntries: {
          orderBy: { entryDate: 'desc' },
          take: 1,
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
        baselineSnapshots: {
          where: { baselineSystolic: { gt: 0 } },
          orderBy: { computedForDate: 'desc' },
          take: 1,
        },
        deviationAlerts: {
          where: { status: 'OPEN' },
          select: { id: true },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: { escalationLevel: true },
        },
      },
    })

    if (!user) throw new NotFoundException('Patient not found')

    const latestEntry = user.journalEntries[0] ?? null
    const latestBaseline = user.baselineSnapshots[0] ?? null

    const patient = {
      id: user.id,
      name: user.name,
      email: user.email,
      riskTier: user.riskTier ?? 'STANDARD',
      communicationPreference: user.communicationPreference ?? null,
      primaryCondition: user.primaryCondition,
      onboardingStatus: user.onboardingStatus,
      latestBaseline: latestBaseline
        ? {
            baselineSystolic: Number(latestBaseline.baselineSystolic),
            baselineDiastolic: Number(latestBaseline.baselineDiastolic),
          }
        : null,
      activeAlertsCount: user.deviationAlerts.length,
      lastEntryDate: latestEntry?.entryDate ?? null,
      latestBP: latestEntry
        ? {
            systolicBP: latestEntry.systolicBP,
            diastolicBP: latestEntry.diastolicBP,
            entryDate: latestEntry.entryDate,
          }
        : null,
      escalationLevel:
        user.escalationEvents[0]?.escalationLevel ?? null,
    }

    // Recent 14 entries
    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: { entryDate: 'desc' },
      take: 14,
      select: {
        id: true,
        entryDate: true,
        systolicBP: true,
        diastolicBP: true,
        weight: true,
        medicationTaken: true,
        symptoms: true,
      },
    })

    // Active alerts with journal entry data
    const activeAlerts = await this.prisma.deviationAlert.findMany({
      where: { userId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
      },
    })

    // Active escalations
    const activeEscalations = await this.prisma.escalationEvent.findMany(
      {
        where: { userId },
        orderBy: { triggeredAt: 'desc' },
        select: {
          id: true,
          escalationLevel: true,
          reason: true,
          triggeredAt: true,
          notificationSentAt: true,
        },
      },
    )

    // Full baseline
    const baseline = latestBaseline
      ? {
          id: latestBaseline.id,
          computedForDate: latestBaseline.computedForDate,
          baselineSystolic: Number(latestBaseline.baselineSystolic),
          baselineDiastolic: Number(latestBaseline.baselineDiastolic),
          baselineWeight: latestBaseline.baselineWeight
            ? Number(latestBaseline.baselineWeight)
            : null,
          sampleSize: latestBaseline.sampleSize,
        }
      : null

    return {
      statusCode: 200,
      data: {
        patient,
        recentEntries: recentEntries.map((e) => ({
          ...e,
          weight: e.weight != null ? Number(e.weight) : null,
        })),
        activeAlerts: activeAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: Number(a.magnitude),
          baselineValue: a.baselineValue
            ? Number(a.baselineValue)
            : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
          createdAt: a.createdAt,
          journalEntry: a.journalEntry
            ? {
                entryDate: a.journalEntry.entryDate,
                systolicBP: a.journalEntry.systolicBP,
                diastolicBP: a.journalEntry.diastolicBP,
              }
            : null,
        })),
        activeEscalations: activeEscalations.map((e) => ({
          id: e.id,
          level: e.escalationLevel,
          reason: e.reason,
          careTeamMessage: e.reason,
          patientMessage: null,
          createdAt: e.triggeredAt,
        })),
        baseline,
      },
    }
  }

  // ─── GET /provider/patients/:userId/journal ───────────────────────────────────

  async getPatientJournal(userId: string, page: number, limit: number) {
    const skip = (page - 1) * limit

    const [entries, total] = await Promise.all([
      this.prisma.journalEntry.findMany({
        where: { userId },
        orderBy: { entryDate: 'desc' },
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
          baselineValue: a.baselineValue
            ? Number(a.baselineValue)
            : null,
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

  // ─── GET /provider/alerts ─────────────────────────────────────────────────────

  async getAlerts(filters: { severity?: string; escalated?: boolean }) {
    const where: Record<string, unknown> = { status: 'OPEN' }
    if (filters.severity) {
      where.severity = filters.severity
    }
    if (filters.escalated != null) {
      where.escalated = filters.escalated
    }

    const alerts = await this.prisma.deviationAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            riskTier: true,
            communicationPreference: true,
          },
        },
        journalEntry: {
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
      },
    })

    // Sort by severity (HIGH first), then createdAt desc (already from query)
    alerts.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity] ?? 3) -
        (SEVERITY_ORDER[b.severity] ?? 3),
    )

    return {
      statusCode: 200,
      data: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        magnitude: Number(a.magnitude),
        baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
        actualValue: a.actualValue ? Number(a.actualValue) : null,
        escalated: a.escalated,
        status: a.status,
        createdAt: a.createdAt,
        acknowledgedAt: a.acknowledgedAt,
        patient: a.user
          ? {
              id: a.user.id,
              name: a.user.name,
              riskTier: a.user.riskTier,
              communicationPreference: a.user.communicationPreference,
            }
          : null,
        journalEntry: a.journalEntry
          ? {
              entryDate: a.journalEntry.entryDate,
              systolicBP: a.journalEntry.systolicBP,
              diastolicBP: a.journalEntry.diastolicBP,
            }
          : null,
      })),
    }
  }

  // ─── PATCH /provider/alerts/:alertId/acknowledge ──────────────────────────────

  async acknowledgeAlert(alertId: string) {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
    })

    if (!alert) throw new NotFoundException('Alert not found')

    if (alert.status === 'ACKNOWLEDGED') {
      return {
        statusCode: 200,
        message: 'Alert already acknowledged',
        data: {
          id: alert.id,
          status: alert.status,
          acknowledgedAt: alert.acknowledgedAt,
        },
      }
    }

    const updated = await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    })

    return {
      statusCode: 200,
      message: 'Alert acknowledged',
      data: {
        id: updated.id,
        status: updated.status,
        acknowledgedAt: updated.acknowledgedAt,
      },
    }
  }
}
