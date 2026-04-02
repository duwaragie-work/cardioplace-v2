import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmailService } from '../email/email.service.js'
import { scheduleCallEmailHtml } from '../email/email-templates.js'

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

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
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
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
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            entryDate: true,
            measurementTime: true,
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
              measurementTime: latestEntry.measurementTime ?? null,
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
          orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            entryDate: true,
            measurementTime: true,
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
            measurementTime: latestEntry.measurementTime ?? null,
          }
        : null,
      escalationLevel:
        user.escalationEvents[0]?.escalationLevel ?? null,
    }

    // Recent 14 entries
    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 14,
      select: {
        id: true,
        entryDate: true,
        measurementTime: true,
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

    // Fetch scheduled calls linked to these alerts
    const alertIds = alerts.map((a) => a.id)
    const scheduledCalls = alertIds.length
      ? await this.prisma.scheduledCall.findMany({
          where: { alertId: { in: alertIds } },
          orderBy: { createdAt: 'desc' },
          select: {
            alertId: true,
            callDate: true,
            callTime: true,
            callType: true,
            status: true,
            createdAt: true,
          },
        })
      : []

    // Keep the latest scheduled call per alert
    const followUpMap = new Map<string, (typeof scheduledCalls)[0]>()
    for (const sc of scheduledCalls) {
      if (sc.alertId && !followUpMap.has(sc.alertId)) {
        followUpMap.set(sc.alertId, sc)
      }
    }

    return {
      statusCode: 200,
      data: alerts.map((a) => {
        const followUp = followUpMap.get(a.id)
        return {
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
          followUpScheduledAt: followUp?.createdAt ?? null,
          followUpCallDate: followUp?.callDate ?? null,
          followUpCallTime: followUp?.callTime ?? null,
          followUpCallType: followUp?.callType ?? null,
          followUpStatus: followUp?.status ?? null,
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
        }
      }),
    }
  }

  // ─── GET /provider/alerts/:alertId/detail ─────────────────────────────────────

  async getAlertDetail(alertId: string) {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            dateOfBirth: true,
            communicationPreference: true,
            riskTier: true,
          },
        },
        journalEntry: {
          select: {
            entryDate: true,
            systolicBP: true,
            diastolicBP: true,
            weight: true,
            medicationTaken: true,
          },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'desc' },
          take: 1,
          select: {
            id: true,
            escalationLevel: true,
            reason: true,
            triggeredAt: true,
          },
        },
      },
    })

    if (!alert) throw new NotFoundException('Alert not found')

    const userId = alert.userId

    // Latest baseline snapshot
    const latestBaseline = await this.prisma.baselineSnapshot.findFirst({
      where: { userId, baselineSystolic: { gt: 0 } },
      orderBy: { computedForDate: 'desc' },
      select: {
        baselineSystolic: true,
        baselineDiastolic: true,
      },
    })

    // Last 7 journal entries for BP trend chart
    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId, systolicBP: { not: null } },
      orderBy: [{ entryDate: 'desc' }, { createdAt: 'desc' }],
      take: 7,
      select: {
        entryDate: true,
        measurementTime: true,
        systolicBP: true,
        diastolicBP: true,
      },
    })

    // Recent alerts of the same type in last 3 days (for consecutive reading dates)
    const threeDaysAgo = new Date()
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)
    const consecutiveAlerts = await this.prisma.deviationAlert.findMany({
      where: {
        userId,
        type: alert.type,
        createdAt: { gte: threeDaysAgo },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        journalEntry: {
          select: { entryDate: true },
        },
      },
    })

    // Medication adherence in last 3 days
    const medEntries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        entryDate: { gte: threeDaysAgo },
        medicationTaken: { not: null },
      },
      orderBy: { entryDate: 'desc' },
      take: 3,
      select: {
        entryDate: true,
        medicationTaken: true,
      },
    })

    const baselineSystolic = latestBaseline?.baselineSystolic
      ? Number(latestBaseline.baselineSystolic)
      : null
    const baselineDiastolic = latestBaseline?.baselineDiastolic
      ? Number(latestBaseline.baselineDiastolic)
      : null

    // Build trigger reasons dynamically
    const triggerReasons: string[] = []

    const baselineStr =
      baselineSystolic != null && baselineDiastolic != null
        ? `${Math.round(baselineSystolic)}/${Math.round(baselineDiastolic)}`
        : 'N/A'
    const readingStr =
      alert.journalEntry?.systolicBP != null &&
      alert.journalEntry?.diastolicBP != null
        ? `${alert.journalEntry.systolicBP}/${alert.journalEntry.diastolicBP}`
        : '—'
    triggerReasons.push(
      `Elevated BP: ${readingStr} (Baseline: ${baselineStr})`,
    )

    if (consecutiveAlerts.length >= 2) {
      const dates = consecutiveAlerts
        .map((a) => {
          const d = a.journalEntry?.entryDate ?? a.createdAt
          return new Date(d).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
          })
        })
        .join(', ')
      triggerReasons.push(
        `${consecutiveAlerts.length} consecutive elevated readings — ${dates}`,
      )
    }

    const missedCount = medEntries.filter((e) => e.medicationTaken === false).length
    if (missedCount > 0) {
      triggerReasons.push(
        `Medication missed: ${missedCount} of last ${medEntries.length} days`,
      )
    }

    // Generate AI summary from real data
    const entryCount = recentEntries.length
    const bpValues = recentEntries
      .filter((e) => e.systolicBP != null)
      .map((e) => e.systolicBP as number)
    let trendDirection = 'stable'
    if (bpValues.length >= 3) {
      const first = bpValues[bpValues.length - 1]
      const last = bpValues[0]
      if (last - first > 5) trendDirection = 'an upward'
      else if (first - last > 5) trendDirection = 'a downward'
    }

    const medAdherence =
      missedCount > 0
        ? `concurrent medication non-adherence (${missedCount} missed doses)`
        : 'consistent medication adherence'

    const action =
      alert.severity === 'HIGH'
        ? 'Recommend immediate clinical review and patient contact'
        : 'Recommend proactive care team outreach within 24 hours'

    const aiSummary = `Patient shows ${trendDirection} BP trend over the last ${entryCount} readings with ${medAdherence}. ${action} to assess current cardiovascular status.`

    // Build communication preference info
    const commPref = alert.user?.communicationPreference
    let commLabel = 'Standard Communication'
    let commDescription =
      'No specific communication preference indicated.'
    if (commPref === 'AUDIO_FIRST') {
      commLabel = 'Audio-First Patient'
      commDescription =
        'Use verbal communication and visual aids at next visit. Patient prefers spoken over written instructions.'
    } else if (commPref === 'TEXT_FIRST') {
      commLabel = 'Text-First Patient'
      commDescription =
        'Patient prefers written communication. Use text messages and written care plans.'
    }

    // Format BP trend for chart (reverse to chronological order)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const bpTrend = [...recentEntries].reverse().map((e) => ({
      day: dayNames[new Date(e.entryDate).getDay()],
      systolic: e.systolicBP,
      diastolic: e.diastolicBP,
      date: e.entryDate,
    }))

    return {
      statusCode: 200,
      data: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        magnitude: Number(alert.magnitude),
        baselineValue: alert.baselineValue
          ? Number(alert.baselineValue)
          : null,
        actualValue: alert.actualValue ? Number(alert.actualValue) : null,
        escalated: alert.escalated,
        status: alert.status,
        createdAt: alert.createdAt,
        patient: {
          id: alert.user?.id ?? '',
          name: alert.user?.name ?? 'Unknown',
          dateOfBirth: alert.user?.dateOfBirth ?? null,
          communicationPreference: commPref ?? null,
          riskTier: alert.user?.riskTier ?? 'STANDARD',
        },
        journalEntry: alert.journalEntry
          ? {
              entryDate: alert.journalEntry.entryDate,
              systolicBP: alert.journalEntry.systolicBP,
              diastolicBP: alert.journalEntry.diastolicBP,
            }
          : null,
        baseline: {
          systolic: baselineSystolic,
          diastolic: baselineDiastolic,
        },
        triggerReasons,
        aiSummary,
        communication: {
          label: commLabel,
          description: commDescription,
        },
        bpTrend,
        escalation: alert.escalationEvents[0]
          ? {
              level: alert.escalationEvents[0].escalationLevel,
              reason: alert.escalationEvents[0].reason,
            }
          : null,
      },
    }
  }

  // ─── POST /provider/schedule-call ───────────────────────────────────────────────

  async scheduleCall(body: {
    patientUserId: string
    alertId?: string
    callDate: string
    callTime: string
    callType: string
    notes?: string
  }) {
    // Verify patient exists
    const patient = await this.prisma.user.findUnique({
      where: { id: body.patientUserId },
      select: { id: true, email: true, name: true },
    })
    if (!patient) throw new NotFoundException('Patient not found')

    // ─── Create ScheduledCall record ─────────────────────────────────
    const scheduledCall = await this.prisma.scheduledCall.create({
      data: {
        userId: body.patientUserId,
        alertId: body.alertId ?? null,
        callDate: body.callDate,
        callTime: body.callTime,
        callType: body.callType,
        notes: body.notes ?? null,
        status: 'UPCOMING',
      },
    })

    // ─── Notifications (patient-facing) ──────────────────────────────
    const notifTitle = 'Follow-up Call Scheduled'
    const notifBody = `Your care team has scheduled a ${body.callType} call on ${body.callDate} at ${body.callTime}.${body.notes ? ` Note: ${body.notes}` : ''}`

    await this.prisma.notification.create({
      data: {
        userId: body.patientUserId,
        alertId: body.alertId ?? null,
        channel: 'PUSH',
        title: notifTitle,
        body: notifBody,
        tips: [],
      },
    })

    // ─── Email notification ──────────────────────────────────────────
    if (patient.email) {
      await this.prisma.notification.create({
        data: {
          userId: body.patientUserId,
          alertId: body.alertId ?? null,
          channel: 'EMAIL',
          title: notifTitle,
          body: notifBody,
          tips: [],
        },
      })

      await this.emailService.sendEmail(
        patient.email,
        'Follow-up Call Scheduled — Healplace Cardio',
        scheduleCallEmailHtml(
          patient.name ?? 'Patient',
          body.callType,
          body.callDate,
          body.callTime,
        ),
      )
    } else {
      this.logger.warn(
        `No email for patient ${body.patientUserId} — skipping email notification`,
      )
    }

    return {
      statusCode: 201,
      message: 'Call scheduled. Patient notified.',
      data: { scheduledCallId: scheduledCall.id },
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

  // ─── GET /provider/scheduled-calls ──────────────────────────────────────────

  async getScheduledCalls(filters: { status?: string }) {
    const where: Record<string, unknown> = {}
    if (filters.status) {
      where.status = filters.status.toUpperCase()
    }

    const calls = await this.prisma.scheduledCall.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, riskTier: true },
        },
        deviationAlert: {
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            createdAt: true,
            journalEntry: {
              select: { systolicBP: true, diastolicBP: true, entryDate: true },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      data: calls.map((c) => ({
        id: c.id,
        callDate: c.callDate,
        callTime: c.callTime,
        callType: c.callType,
        notes: c.notes,
        status: c.status.toLowerCase(),
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        patient: c.user
          ? { id: c.user.id, name: c.user.name, email: c.user.email, riskTier: c.user.riskTier }
          : null,
        alert: c.deviationAlert
          ? {
              id: c.deviationAlert.id,
              type: c.deviationAlert.type,
              severity: c.deviationAlert.severity,
              alertStatus: c.deviationAlert.status,
              createdAt: c.deviationAlert.createdAt,
              journalEntry: c.deviationAlert.journalEntry,
            }
          : null,
      })),
    }
  }

  // ─── PATCH /provider/scheduled-calls/:id/status ─────────────────────────────

  async updateCallStatus(id: string, status: string) {
    const validStatuses = ['UPCOMING', 'COMPLETED', 'MISSED', 'CANCELLED']
    const upper = status.toUpperCase()
    if (!validStatuses.includes(upper)) {
      throw new NotFoundException(`Invalid status: ${status}`)
    }

    const call = await this.prisma.scheduledCall.findUnique({ where: { id } })
    if (!call) throw new NotFoundException('Scheduled call not found')

    const updated = await this.prisma.scheduledCall.update({
      where: { id },
      data: { status: upper as 'UPCOMING' | 'COMPLETED' | 'MISSED' | 'CANCELLED' },
    })

    return { statusCode: 200, data: { id: updated.id, status: updated.status } }
  }

  // ─── DELETE /provider/scheduled-calls/:id ───────────────────────────────────

  async deleteScheduledCall(id: string) {
    const call = await this.prisma.scheduledCall.findUnique({ where: { id } })
    if (!call) throw new NotFoundException('Scheduled call not found')

    await this.prisma.scheduledCall.delete({ where: { id } })
    return { statusCode: 200, message: 'Scheduled call deleted' }
  }
}
