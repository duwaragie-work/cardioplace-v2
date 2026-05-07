import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service.js'
import { GapAlertService } from '../crons/gap-alert.service.js'
import { MonthlyReaskService } from '../crons/monthly-reask.service.js'
import { EscalationService } from '../daily_journal/services/escalation.service.js'

/**
 * Helpers backing the /test-control HTTP endpoints. Pure delegation —
 * the controller layer handles auth/secret + DTO shape.
 */
@Injectable()
export class TestControlService {
  private readonly logger = new Logger(TestControlService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly gapAlerts: GapAlertService,
    private readonly monthlyReask: MonthlyReaskService,
    private readonly escalation: EscalationService,
  ) {}

  // ─── Cron drivers ───────────────────────────────────────────────────────
  async runEscalationScan(now: Date): Promise<{ scanned: number; dispatched: number }> {
    const before = await this.prisma.escalationEvent.count()
    await this.escalation.runScan(now)
    const after = await this.prisma.escalationEvent.count()
    return { scanned: 1, dispatched: Math.max(0, after - before) }
  }

  async runGapAlertScan(now: Date): Promise<{ scanned: number; nudged: number }> {
    const sent = await this.gapAlerts.runScan(now)
    return { scanned: 1, nudged: sent }
  }

  async runMonthlyReaskScan(now: Date): Promise<{ scanned: number; reasked: number }> {
    const sent = await this.monthlyReask.runScan(now)
    return { scanned: 1, reasked: sent }
  }

  // ─── Time advancement ───────────────────────────────────────────────────
  async backdateAlertAnchor(alertId: string, deltaSeconds: number): Promise<void> {
    // Backdate the T+0 EscalationEvent's notificationSentAt + scheduledFor
    // by deltaSeconds, so subsequent runScan calls see ladder steps as overdue.
    const t0 = await this.prisma.escalationEvent.findFirst({
      where: { alertId, ladderStep: 'T0' },
      orderBy: { triggeredAt: 'asc' },
    })
    if (!t0) {
      throw new Error(`No T0 event found for alert ${alertId}`)
    }
    const sentAt = t0.notificationSentAt
      ? new Date(t0.notificationSentAt.getTime() - deltaSeconds * 1000)
      : null
    const scheduledFor = t0.scheduledFor
      ? new Date(t0.scheduledFor.getTime() - deltaSeconds * 1000)
      : null
    const triggeredAt = new Date(t0.triggeredAt.getTime() - deltaSeconds * 1000)
    await this.prisma.escalationEvent.update({
      where: { id: t0.id },
      data: { notificationSentAt: sentAt, scheduledFor, triggeredAt },
    })
  }

  async backdateLastJournalEntry(userId: string, deltaSeconds: number): Promise<void> {
    const latest = await this.prisma.journalEntry.findFirst({
      where: { userId },
      orderBy: { measuredAt: 'desc' },
    })
    if (!latest) return
    await this.prisma.journalEntry.update({
      where: { id: latest.id },
      data: { measuredAt: new Date(latest.measuredAt.getTime() - deltaSeconds * 1000) },
    })
  }

  async backdateMedicationVerified(medId: string, deltaSeconds: number): Promise<void> {
    const med = await this.prisma.patientMedication.findUnique({ where: { id: medId } })
    if (!med) throw new Error(`Medication ${medId} not found`)
    const reportedAt = med.reportedAt
      ? new Date(med.reportedAt.getTime() - deltaSeconds * 1000)
      : null
    const verifiedAt = med.verifiedAt
      ? new Date(med.verifiedAt.getTime() - deltaSeconds * 1000)
      : null
    await this.prisma.patientMedication.update({
      where: { id: medId },
      data: { reportedAt: reportedAt ?? med.reportedAt, verifiedAt },
    })
  }

  // ─── State reset ────────────────────────────────────────────────────────
  /**
   * Wipe journal/alert/escalation/notification rows for every *.cardioplace.test
   * patient seed. User row + profile + medications + practice/assignment are
   * preserved — those are seed-stable.
   */
  async resetTestPatients(): Promise<{ usersTouched: number; rowsDeleted: number }> {
    const users = await this.prisma.user.findMany({
      where: {
        email: { endsWith: '.cardioplace.test' },
        roles: { has: 'PATIENT' },
      },
      select: { id: true, email: true },
    })
    let rowsDeleted = 0
    for (const u of users) {
      const r = await this.resetUser(u.id)
      rowsDeleted += r.rowsDeleted
    }
    return { usersTouched: users.length, rowsDeleted }
  }

  async resetUser(userId: string): Promise<{ rowsDeleted: number }> {
    const [notifications, escalations, alerts, entries] = await Promise.all([
      this.prisma.notification.deleteMany({ where: { userId } }),
      this.prisma.escalationEvent.deleteMany({ where: { alert: { userId } } }),
      this.prisma.deviationAlert.deleteMany({ where: { userId } }),
      this.prisma.journalEntry.deleteMany({ where: { userId } }),
    ])
    return {
      rowsDeleted:
        notifications.count + escalations.count + alerts.count + entries.count,
    }
  }

  async setEnrollment(userId: string, status: 'NOT_ENROLLED' | 'ENROLLED'): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { enrollmentStatus: status },
    })
  }

  async setProfileVerificationStatus(
    userId: string,
    status: 'UNVERIFIED' | 'VERIFIED' | 'CORRECTED',
  ): Promise<void> {
    await this.prisma.patientProfile.updateMany({
      where: { userId },
      data: { profileVerificationStatus: status },
    })
  }

  // ─── Inspection ─────────────────────────────────────────────────────────
  async listAlerts(userId: string) {
    return this.prisma.deviationAlert.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tier: true,
        ruleId: true,
        mode: true,
        status: true,
        dismissible: true,
        patientMessage: true,
        physicianMessage: true,
        createdAt: true,
        acknowledgedAt: true,
        resolvedBy: true,
        resolutionAction: true,
      },
    })
  }

  async listEscalationEvents(alertId: string) {
    return this.prisma.escalationEvent.findMany({
      where: { alertId },
      orderBy: { triggeredAt: 'asc' },
      select: {
        id: true,
        ladderStep: true,
        recipientRoles: true,
        notificationChannel: true,
        afterHours: true,
        scheduledFor: true,
        notificationSentAt: true,
        triggeredByResolution: true,
        reason: true,
      },
    })
  }

  async listNotifications(userId: string) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      select: {
        id: true,
        title: true,
        body: true,
        channel: true,
        sentAt: true,
        readAt: true,
        alertId: true,
        escalationEventId: true,
      },
    })
  }

  async findUser(email: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        enrollmentStatus: true,
        onboardingStatus: true,
        patientProfile: {
          select: { profileVerificationStatus: true },
        },
      },
    })
    if (!user) throw new Error(`User not found: ${email}`)
    return {
      id: user.id,
      email: user.email,
      enrollmentStatus: user.enrollmentStatus,
      onboardingStatus: user.onboardingStatus,
      profileVerificationStatus: user.patientProfile?.profileVerificationStatus ?? null,
    }
  }
}
