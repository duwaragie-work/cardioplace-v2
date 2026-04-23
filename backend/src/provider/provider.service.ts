import { Injectable, Logger, NotFoundException } from '@nestjs/common'
import { getAgeGroup } from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import { EmailService } from '../email/email.service.js'
import { scheduleCallEmailHtml } from '../email/email-templates.js'
import { UserRole } from '../generated/prisma/enums.js'

const SEVERITY_ORDER: Record<string, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 }

type DerivedRiskTier = 'STANDARD' | 'ELEVATED' | 'HIGH'

interface PatientProfileShape {
  hasHeartFailure: boolean
  heartFailureType: string | null
  hasAFib: boolean
  hasCAD: boolean
  hasHCM: boolean
  hasDCM: boolean
  hasTachycardia: boolean
  hasBradycardia: boolean
  diagnosedHypertension: boolean
  isPregnant: boolean
  historyPreeclampsia: boolean
}

@Injectable()
export class ProviderService {
  private readonly logger = new Logger(ProviderService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  // Age bucketing now delegated to shared/derivatives.ts::getAgeGroup (phase/4).
  // The v1 `derivePrimaryCondition` / `deriveRiskTier` helpers below stay
  // inline — v2 alert rules read structured booleans directly and don't need
  // a "primary condition" string, but the v1 provider dashboard still
  // consumes these. They collapse when Dev 1 rebuilds that surface in
  // phase/11.
  private derivePrimaryCondition(
    profile: PatientProfileShape | null,
  ): string | null {
    if (!profile) return null
    if (profile.isPregnant || profile.historyPreeclampsia) {
      return 'Pregnancy / preeclampsia history'
    }
    if (profile.hasHeartFailure) {
      const t = profile.heartFailureType
      if (t === 'HFREF') return 'Heart Failure (HFrEF)'
      if (t === 'HFPEF') return 'Heart Failure (HFpEF)'
      return 'Heart Failure'
    }
    if (profile.hasCAD) return 'CAD'
    if (profile.hasAFib) return 'AFib'
    if (profile.hasHCM) return 'HCM'
    if (profile.hasDCM) return 'DCM'
    if (profile.hasTachycardia) return 'Tachycardia'
    if (profile.hasBradycardia) return 'Bradycardia'
    if (profile.diagnosedHypertension) return 'Hypertension'
    return null
  }

  private deriveRiskTier(
    profile: PatientProfileShape | null,
    dob: Date | null,
  ): DerivedRiskTier {
    // Preserve v1 default: missing DOB falls through as 40-64 (no
    // age-based escalation). getAgeGroup returns null for null/invalid/
    // under-18 DOBs; `??` keeps that defaulted to the middle bucket.
    const ageGroup = getAgeGroup(dob) ?? '40-64'
    if (!profile) {
      return ageGroup === '65+' ? 'ELEVATED' : 'STANDARD'
    }
    if (
      profile.isPregnant ||
      profile.historyPreeclampsia ||
      profile.hasHeartFailure ||
      profile.hasHCM ||
      profile.hasDCM
    ) {
      return 'HIGH'
    }
    if (
      profile.hasCAD ||
      profile.hasAFib ||
      profile.diagnosedHypertension ||
      ageGroup === '65+'
    ) {
      return 'ELEVATED'
    }
    return 'STANDARD'
  }

  // Translate an incoming `riskTier` filter (string) into a PatientProfile
  // `where` clause equivalent — HIGH → any major cardiac/pregnancy condition,
  // ELEVATED → CAD/AFib/diagnosedHypertension, STANDARD → no conditions.
  private profileWhereForRiskTier(
    riskTier: string,
  ): Record<string, unknown> | null {
    if (riskTier === 'HIGH') {
      return {
        OR: [
          { isPregnant: true },
          { historyPreeclampsia: true },
          { hasHeartFailure: true },
          { hasHCM: true },
          { hasDCM: true },
        ],
      }
    }
    if (riskTier === 'ELEVATED') {
      return {
        OR: [
          { hasCAD: true },
          { hasAFib: true },
          { diagnosedHypertension: true },
        ],
      }
    }
    if (riskTier === 'STANDARD') {
      return {
        AND: [
          { isPregnant: false },
          { historyPreeclampsia: false },
          { hasHeartFailure: false },
          { hasHCM: false },
          { hasDCM: false },
          { hasCAD: false },
          { hasAFib: false },
          { diagnosedHypertension: false },
        ],
      }
    }
    return null
  }

  private readonly profileSelect = {
    hasHeartFailure: true,
    heartFailureType: true,
    hasAFib: true,
    hasCAD: true,
    hasHCM: true,
    hasDCM: true,
    hasTachycardia: true,
    hasBradycardia: true,
    diagnosedHypertension: true,
    isPregnant: true,
    historyPreeclampsia: true,
    // Phase/8 — Flow K patient list shows the verification status pill in
    // its own column. Including it here keeps downstream callers happy too
    // (they can just ignore the field).
    profileVerificationStatus: true,
  } as const

  // ─── GET /provider/stats ──────────────────────────────────────────────────────

  async getStats() {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)

    const [totalActivePatients, monthlyInteractions, activeAlertsCount, readingsThisMonth, recentAlertPatients] =
      await Promise.all([
        // "Enrolled patients" = admin has passed the 4-piece clinical gate,
        // not just that the patient filled their identity onboarding form.
        this.prisma.user.count({
          where: { enrollmentStatus: 'ENROLLED' },
        }),
        this.prisma.journalEntry.count({
          where: { createdAt: { gte: startOfMonth } },
        }),
        this.prisma.deviationAlert.count({
          where: { status: 'OPEN' },
        }),
        this.prisma.journalEntry.count({
          where: {
            measuredAt: { gte: startOfMonth },
            systolicBP: { not: null },
          },
        }),
        this.prisma.deviationAlert.findMany({
          where: {
            status: 'OPEN',
            createdAt: { gte: twentyFourHoursAgo },
          },
          select: { userId: true },
          distinct: ['userId'],
        }),
      ])

    const usersWithEntries = await this.prisma.user.findMany({
      where: {
        enrollmentStatus: 'ENROLLED',
        journalEntries: { some: {} },
      },
      include: {
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
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
        readingsThisMonth,
        monthlyInteractions,
        activeAlertsCount,
        patientsNeedingAttention: recentAlertPatients.length,
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
      roles: { has: UserRole.PATIENT },
    }
    if (filters.riskTier) {
      const profileWhere = this.profileWhereForRiskTier(filters.riskTier)
      if (profileWhere) {
        where.patientProfile = { is: profileWhere }
      }
    }

    const users = await this.prisma.user.findMany({
      where,
      include: {
        patientProfile: { select: this.profileSelect },
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
        deviationAlerts: {
          where: { status: 'OPEN' },
          // Tier is needed for the Flow K row badge so the highest-severity
          // open alert can paint the count chip the right color.
          select: { id: true, tier: true },
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
      const activeAlertsCount = u.deviationAlerts.length
      const escalationLevel = u.escalationEvents[0]?.escalationLevel ?? null
      const profile = (u.patientProfile ?? null) as PatientProfileShape | null

      // Per-tier breakdown used by the Flow K patient list. The frontend
      // colors the alert-count badge by the highest-severity tier present
      // (BP_LEVEL_2 / TIER_1 → red, TIER_2 / BP_LEVEL_1 → amber, TIER_3 → teal).
      const alertsByTier: Record<string, number> = {}
      for (const a of u.deviationAlerts) {
        const key = a.tier ?? 'UNTIERED'
        alertsByTier[key] = (alertsByTier[key] ?? 0) + 1
      }

      return {
        id: u.id,
        name: u.name,
        email: u.email,
        riskTier: this.deriveRiskTier(profile, u.dateOfBirth),
        communicationPreference: u.communicationPreference ?? null,
        primaryCondition: this.derivePrimaryCondition(profile),
        onboardingStatus: u.onboardingStatus,
        enrollmentStatus: u.enrollmentStatus,
        // Flow K — surface the patient's profile verification state so the
        // list can render a status pill + power the "Awaiting Verification"
        // quick filter chip without a second round-trip.
        profileVerificationStatus:
          (profile as { profileVerificationStatus?: string } | null)
            ?.profileVerificationStatus ?? null,
        // latestBaseline (rolling snapshot) is gone in v2. Frontend should
        // request the BP trend endpoint when it needs averages.
        latestBaseline: null,
        activeAlertsCount,
        alertsByTier,
        lastEntryDate: latestEntry?.measuredAt ?? null,
        latestBP: latestEntry
          ? {
              systolicBP: latestEntry.systolicBP,
              diastolicBP: latestEntry.diastolicBP,
              entryDate: latestEntry.measuredAt,
              measurementTime: null,
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

  // ─── GET /provider/patients/:userId/alerts ───────────────────────────────────
  // Per-patient alerts feed with three-tier messages and linked escalation
  // events — used by the Flow H "Alerts" tab. Supports tier + status filters
  // so the UI can flip between OPEN / RESOLVED / All.
  async getPatientAlerts(
    userId: string,
    filters: { status?: string; tier?: string } = {},
  ) {
    const where: Record<string, unknown> = { userId }
    if (filters.status) where.status = filters.status
    if (filters.tier) where.tier = filters.tier

    const alerts = await this.prisma.deviationAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
        escalationEvents: {
          orderBy: { triggeredAt: 'asc' },
          // Flow I — vertical audit-trail timeline needs the recipient list,
          // role list, channel, after-hours flag and per-step Notification
          // children (one per channel/recipient combo).
          select: {
            id: true,
            escalationLevel: true,
            ladderStep: true,
            reason: true,
            triggeredAt: true,
            scheduledFor: true,
            notificationSentAt: true,
            notificationChannel: true,
            recipientIds: true,
            recipientRoles: true,
            acknowledgedAt: true,
            acknowledgedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            afterHours: true,
            triggeredByResolution: true,
            notifications: {
              orderBy: { sentAt: 'asc' },
              select: {
                id: true,
                userId: true,
                channel: true,
                title: true,
                sentAt: true,
                readAt: true,
              },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      data: alerts.map((a) => ({
        id: a.id,
        type: a.type,
        severity: a.severity,
        tier: a.tier,
        ruleId: a.ruleId,
        mode: a.mode,
        pulsePressure: a.pulsePressure,
        suboptimalMeasurement: a.suboptimalMeasurement,
        magnitude: a.magnitude != null ? Number(a.magnitude) : null,
        baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
        actualValue: a.actualValue ? Number(a.actualValue) : null,
        patientMessage: a.patientMessage,
        caregiverMessage: a.caregiverMessage,
        physicianMessage: a.physicianMessage,
        dismissible: a.dismissible,
        escalated: a.escalated,
        status: a.status,
        resolutionAction: a.resolutionAction,
        resolutionRationale: a.resolutionRationale,
        resolvedBy: a.resolvedBy,
        createdAt: a.createdAt,
        acknowledgedAt: a.acknowledgedAt,
        journalEntry: a.journalEntry,
        escalationEvents: a.escalationEvents,
      })),
    }
  }

  // ─── GET /provider/patients/:userId/summary ───────────────────────────────────

  async getPatientSummary(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        patientProfile: { select: this.profileSelect },
        journalEntries: {
          orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
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

    if (!user) throw new NotFoundException('Patient not found')

    const latestEntry = user.journalEntries[0] ?? null
    const profile = (user.patientProfile ?? null) as PatientProfileShape | null

    // v2 baseline: trailing 7-day mean, computed inline (not stored).
    const baseline = await this.trailing7dayMean(userId)

    const patient = {
      id: user.id,
      name: user.name,
      email: user.email,
      riskTier: this.deriveRiskTier(profile, user.dateOfBirth),
      communicationPreference: user.communicationPreference ?? null,
      primaryCondition: this.derivePrimaryCondition(profile),
      onboardingStatus: user.onboardingStatus,
      enrollmentStatus: user.enrollmentStatus,
      latestBaseline: baseline,
      activeAlertsCount: user.deviationAlerts.length,
      lastEntryDate: latestEntry?.measuredAt ?? null,
      latestBP: latestEntry
        ? {
            systolicBP: latestEntry.systolicBP,
            diastolicBP: latestEntry.diastolicBP,
            entryDate: latestEntry.measuredAt,
            measurementTime: null,
          }
        : null,
      escalationLevel:
        user.escalationEvents[0]?.escalationLevel ?? null,
    }

    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId },
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take: 14,
      select: {
        id: true,
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
        weight: true,
        medicationTaken: true,
        otherSymptoms: true,
      },
    })

    const activeAlerts = await this.prisma.deviationAlert.findMany({
      where: { userId, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      include: {
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
      },
    })

    const activeEscalations = await this.prisma.escalationEvent.findMany({
      where: { userId },
      orderBy: { triggeredAt: 'desc' },
      select: {
        id: true,
        escalationLevel: true,
        reason: true,
        triggeredAt: true,
        notificationSentAt: true,
      },
    })

    return {
      statusCode: 200,
      data: {
        patient,
        recentEntries: recentEntries.map((e) => ({
          id: e.id,
          entryDate: e.measuredAt,
          measurementTime: null,
          systolicBP: e.systolicBP,
          diastolicBP: e.diastolicBP,
          weight: e.weight != null ? Number(e.weight) : null,
          medicationTaken: e.medicationTaken,
          symptoms: e.otherSymptoms,
        })),
        activeAlerts: activeAlerts.map((a) => ({
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
          createdAt: a.createdAt,
          journalEntry: a.journalEntry
            ? {
                entryDate: a.journalEntry.measuredAt,
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
        entryDate: entry.measuredAt,
        measurementTime: null,
        systolicBP: entry.systolicBP,
        diastolicBP: entry.diastolicBP,
        weight: entry.weight != null ? Number(entry.weight) : null,
        medicationTaken: entry.medicationTaken,
        missedDoses: entry.missedDoses,
        symptoms: entry.otherSymptoms,
        teachBackAnswer: entry.teachBackAnswer,
        teachBackCorrect: entry.teachBackCorrect,
        notes: entry.notes,
        source: entry.source.toLowerCase(),
        sourceMetadata: entry.sourceMetadata,
        baseline: null,
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

  // ─── GET /provider/patients/:userId/bp-trend ────────────────────────────────

  async getPatientBpTrend(userId: string, startDate: string, endDate: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
        systolicBP: { not: null },
      },
      orderBy: [{ measuredAt: 'asc' }, { createdAt: 'asc' }],
      select: {
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
      },
    })

    const dateCounts = new Map<string, number>()

    return {
      statusCode: 200,
      data: entries.map((e, i) => {
        const dateLabel = new Date(e.measuredAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        })
        const count = (dateCounts.get(dateLabel) ?? 0) + 1
        dateCounts.set(dateLabel, count)
        const day = count > 1 ? `${dateLabel} #${count}` : dateLabel
        return {
          day,
          systolic: e.systolicBP,
          diastolic: e.diastolicBP,
          date: e.measuredAt,
          time: new Date(e.measuredAt).toISOString().slice(11, 16),
          _index: i,
        }
      }),
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
            dateOfBirth: true,
            communicationPreference: true,
            patientProfile: { select: this.profileSelect },
          },
        },
        journalEntry: {
          select: {
            measuredAt: true,
            systolicBP: true,
            diastolicBP: true,
          },
        },
      },
    })

    alerts.sort(
      (a, b) =>
        (SEVERITY_ORDER[a.severity ?? ''] ?? 3) -
        (SEVERITY_ORDER[b.severity ?? ''] ?? 3),
    )

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
        const profile = (a.user?.patientProfile ?? null) as PatientProfileShape | null
        return {
          id: a.id,
          type: a.type,
          severity: a.severity,
          magnitude: a.magnitude != null ? Number(a.magnitude) : null,
          baselineValue: a.baselineValue ? Number(a.baselineValue) : null,
          actualValue: a.actualValue ? Number(a.actualValue) : null,
          escalated: a.escalated,
          status: a.status,
          // V2 tier fields — needed by the admin Flow F dashboard for the
          // 3-layer architecture (Layer 1 banners, Layer 2 queue filter,
          // Layer 3 tier-based stats) and the tier-aware resolution modals.
          tier: a.tier,
          ruleId: a.ruleId,
          mode: a.mode,
          pulsePressure: a.pulsePressure,
          patientMessage: a.patientMessage,
          dismissible: a.dismissible,
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
                riskTier: this.deriveRiskTier(profile, a.user.dateOfBirth),
                communicationPreference: a.user.communicationPreference,
              }
            : null,
          journalEntry: a.journalEntry
            ? {
                entryDate: a.journalEntry.measuredAt,
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
            patientProfile: { select: this.profileSelect },
          },
        },
        journalEntry: {
          select: {
            measuredAt: true,
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

    const latestBaseline = await this.trailing7dayMean(userId)

    const recentEntries = await this.prisma.journalEntry.findMany({
      where: { userId, systolicBP: { not: null } },
      orderBy: [{ measuredAt: 'desc' }, { createdAt: 'desc' }],
      take: 7,
      select: {
        measuredAt: true,
        systolicBP: true,
        diastolicBP: true,
      },
    })

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
          select: { measuredAt: true },
        },
      },
    })

    const medEntries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: threeDaysAgo },
        medicationTaken: { not: null },
      },
      orderBy: { measuredAt: 'desc' },
      take: 3,
      select: {
        measuredAt: true,
        medicationTaken: true,
      },
    })

    const baselineSystolic = latestBaseline?.baselineSystolic ?? null
    const baselineDiastolic = latestBaseline?.baselineDiastolic ?? null

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
          const d = a.journalEntry?.measuredAt ?? a.createdAt
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

    const commPref = alert.user?.communicationPreference ?? 'STANDARD'

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const bpTrend = [...recentEntries].reverse().map((e) => ({
      day: dayNames[new Date(e.measuredAt).getDay()],
      systolic: e.systolicBP,
      diastolic: e.diastolicBP,
      date: e.measuredAt,
    }))

    const profile = (alert.user?.patientProfile ?? null) as PatientProfileShape | null

    return {
      statusCode: 200,
      data: {
        id: alert.id,
        type: alert.type,
        severity: alert.severity,
        magnitude: alert.magnitude != null ? Number(alert.magnitude) : null,
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
          riskTier: this.deriveRiskTier(profile, alert.user?.dateOfBirth ?? null),
        },
        journalEntry: alert.journalEntry
          ? {
              entryDate: alert.journalEntry.measuredAt,
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
          preference: commPref,
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
    const patient = await this.prisma.user.findUnique({
      where: { id: body.patientUserId },
      select: { id: true, email: true, name: true },
    })
    if (!patient) throw new NotFoundException('Patient not found')

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
        'Follow-up Call Scheduled — Cardioplace',
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
          select: {
            id: true,
            name: true,
            email: true,
            dateOfBirth: true,
            patientProfile: { select: this.profileSelect },
          },
        },
        deviationAlert: {
          select: {
            id: true,
            type: true,
            severity: true,
            status: true,
            createdAt: true,
            journalEntry: {
              select: { systolicBP: true, diastolicBP: true, measuredAt: true },
            },
          },
        },
      },
    })

    return {
      statusCode: 200,
      data: calls.map((c) => {
        const profile = (c.user?.patientProfile ?? null) as PatientProfileShape | null
        return {
          id: c.id,
          callDate: c.callDate,
          callTime: c.callTime,
          callType: c.callType,
          notes: c.notes,
          status: c.status.toLowerCase(),
          createdAt: c.createdAt,
          updatedAt: c.updatedAt,
          patient: c.user
            ? {
                id: c.user.id,
                name: c.user.name,
                email: c.user.email,
                riskTier: this.deriveRiskTier(profile, c.user.dateOfBirth),
              }
            : null,
          alert: c.deviationAlert
            ? {
                id: c.deviationAlert.id,
                type: c.deviationAlert.type,
                severity: c.deviationAlert.severity,
                alertStatus: c.deviationAlert.status,
                createdAt: c.deviationAlert.createdAt,
                journalEntry: c.deviationAlert.journalEntry
                  ? {
                      systolicBP: c.deviationAlert.journalEntry.systolicBP,
                      diastolicBP: c.deviationAlert.journalEntry.diastolicBP,
                      entryDate: c.deviationAlert.journalEntry.measuredAt,
                    }
                  : null,
              }
            : null,
        }
      }),
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

  // ─── Private: trailing 7-day BP mean (v2 replacement for BaselineSnapshot) ─
  private async trailing7dayMean(
    userId: string,
  ): Promise<{ baselineSystolic: number; baselineDiastolic: number } | null> {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const entries = await this.prisma.journalEntry.findMany({
      where: {
        userId,
        measuredAt: { gte: sevenDaysAgo },
        systolicBP: { not: null },
        diastolicBP: { not: null },
      },
      select: { systolicBP: true, diastolicBP: true },
    })

    if (entries.length === 0) return null

    const sbp = Math.round(
      entries.reduce((a, e) => a + (e.systolicBP as number), 0) / entries.length,
    )
    const dbp = Math.round(
      entries.reduce((a, e) => a + (e.diastolicBP as number), 0) / entries.length,
    )
    return { baselineSystolic: sbp, baselineDiastolic: dbp }
  }
}
