import { Injectable, Logger } from '@nestjs/common'
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter'
import { Cron } from '@nestjs/schedule'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import type {
  AlertCreatedEvent,
  EscalationDispatchedEvent,
} from '../interfaces/events.interface.js'
import {
  ladderForTier,
  nextStep,
  findStep,
  type LadderStep,
  type LadderStepId,
  type LadderKind,
  type RecipientRole,
  type NotificationChannel as LadderChannel,
  TIER_1_BACKUP_ON_T0,
  TIER_1_LADDER,
} from '../escalation/ladder-defs.js'
import {
  isWithinBusinessHours,
  nextBusinessHoursStart,
  type BusinessHoursConfig,
} from '../utils/business-hours.js'

/**
 * Phase/7 EscalationService — the single owner of the ladder state machine.
 *
 * Responsibilities:
 *  1. @OnEvent(ALERT_CREATED) — fire T+0 for escalatable tiers (TIER_1,
 *     BP_LEVEL_2, TIER_2). Tier 3 + BP Level 1 alerts pass through silently.
 *  2. @Cron — every 15 minutes advance overdue unacknowledged alerts to the
 *     next ladder step, and dispatch any EscalationEvent whose `scheduledFor`
 *     has passed (covers after-hours queueing + BP L2 #6 retries).
 *  3. scheduleRetry(...) — public hook for AlertResolutionService to create a
 *     BP Level 2 "unable to reach patient, will retry" fresh T+4h event.
 *
 * Each dispatch writes an EscalationEvent row + one Notification row per
 * (recipient, channel) combo (idempotent via @@unique in Notification).
 * `ESCALATION_DISPATCHED` fires after every successful dispatch so downstream
 * consumers (phase/19 analytics, future dashboards) can observe the ladder
 * without scraping DB rows.
 */
@Injectable()
export class EscalationService {
  private readonly logger = new Logger(EscalationService.name)

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
  ) {}

  // ─── event + cron entry points ──────────────────────────────────────────

  @OnEvent(JOURNAL_EVENTS.ALERT_CREATED, { async: true })
  async handleAlertCreated(payload: AlertCreatedEvent): Promise<void> {
    try {
      await this.fireT0(payload)
    } catch (err) {
      this.logger.error(
        `T+0 dispatch failed for alert ${payload.alertId}`,
        err instanceof Error ? err.stack : err,
      )
    }
  }

  @Cron('*/15 * * * *')
  async handleCron(): Promise<void> {
    await this.runScan(new Date()).catch((err) =>
      this.logger.error(
        'Escalation cron scan failed',
        err instanceof Error ? err.stack : err,
      ),
    )
  }

  /** Public sync entry for tests + ops tooling. */
  async runScan(now: Date): Promise<void> {
    await this.firePendingScheduled(now)
    await this.advanceOverdueLadders(now)
  }

  /**
   * Called by AlertResolutionService when an admin picks BP L2 #6
   * `BP_L2_UNABLE_TO_REACH_RETRY`. Creates a fresh EscalationEvent with
   * scheduledFor=now+offsetMs; the next cron pass dispatches it via
   * `firePendingScheduled`.
   */
  async scheduleRetry(args: {
    alertId: string
    userId: string
    ladderStep: LadderStepId
    offsetMs: number
    recipientRoles: RecipientRole[]
    channels: LadderChannel[]
    now: Date
  }): Promise<void> {
    const scheduledFor = new Date(args.now.getTime() + args.offsetMs)
    await this.prisma.escalationEvent.create({
      data: {
        alertId: args.alertId,
        userId: args.userId,
        escalationLevel: 'LEVEL_2',
        reason: `BP L2 retry — ${args.ladderStep} scheduled ${scheduledFor.toISOString()}`,
        ladderStep: args.ladderStep,
        recipientIds: [],
        recipientRoles: args.recipientRoles,
        scheduledFor,
        triggeredByResolution: true,
        afterHours: false,
      },
    })
    this.logger.log(
      `Scheduled BP L2 retry for alert ${args.alertId} at ${scheduledFor.toISOString()}`,
    )
  }

  // ─── T+0 on alert creation ──────────────────────────────────────────────

  private async fireT0(payload: AlertCreatedEvent): Promise<void> {
    const ladder = ladderForTier(payload.tier)
    if (!ladder) {
      this.logger.debug(
        `Alert ${payload.alertId} tier=${payload.tier} — not escalatable, skipping`,
      )
      return
    }

    const alert = await this.loadAlert(payload.alertId)
    if (!alert) {
      this.logger.warn(`Alert ${payload.alertId} not found — skipping T+0`)
      return
    }

    const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
    const assignment = alert.user.providerAssignmentAsPatient ?? null
    const now = new Date()

    const firstStep = ladder.steps[0]
    if (!firstStep) return

    // Normal T+0 dispatch (respects after-hours per step config).
    await this.dispatchStep({
      alert,
      step: firstStep,
      ladderKind: ladder.kind,
      recipientRoles: firstStep.recipientRoles,
      practice,
      assignment,
      now,
    })

    // Tier 1 special rule: backup provider always fires immediately at T+0,
    // even when primary is queued to next business hours.
    // CLINICAL_SPEC §V2-D Tier 1 T+4h says "Simultaneously notify practice-level
    // backup" — interpreted + confirmed in phase/7 plan as "backup gets an
    // immediate push at T+0 too so no one is silent overnight."
    if (ladder.kind === 'TIER_1') {
      await this.dispatchStep({
        alert,
        step: { ...firstStep, afterHoursBehavior: 'FIRE_IMMEDIATELY' },
        ladderKind: ladder.kind,
        recipientRoles: TIER_1_BACKUP_ON_T0,
        practice,
        assignment,
        now,
      })
    }
  }

  // ─── cron: dispatch scheduled events whose time has come ────────────────

  private async firePendingScheduled(now: Date): Promise<void> {
    const rows = await this.prisma.escalationEvent.findMany({
      where: {
        scheduledFor: { lte: now, not: null },
        notificationSentAt: null,
      },
    })
    for (const row of rows) {
      const alert = await this.loadAlert(row.alertId)
      if (!alert) continue

      // Check alert still open + not acknowledged; if it's been resolved /
      // acknowledged since, skip and mark the event as sent (so we don't
      // re-scan it forever).
      if (alert.status !== 'OPEN' || alert.acknowledgedAt) {
        await this.prisma.escalationEvent.update({
          where: { id: row.id },
          data: { notificationSentAt: now, reason: 'skipped — alert resolved or acknowledged' },
        })
        continue
      }

      const ladder = ladderForTier(alert.tier)
      const step = ladder ? findStep(ladder.steps, row.ladderStep ?? 'T0') : null
      if (!ladder || !step) {
        await this.prisma.escalationEvent.update({
          where: { id: row.id },
          data: { notificationSentAt: now, reason: 'skipped — no ladder match' },
        })
        continue
      }

      const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
      const assignment = alert.user.providerAssignmentAsPatient ?? null
      await this.dispatchForExistingEvent({
        eventId: row.id,
        alert,
        step,
        ladderKind: ladder.kind,
        recipientRoles: row.recipientRoles.length
          ? (row.recipientRoles as RecipientRole[])
          : step.recipientRoles,
        practice,
        assignment,
        now,
        triggeredByResolution: row.triggeredByResolution,
      })
    }
  }

  // ─── cron: advance ladder for overdue unacknowledged alerts ─────────────

  private async advanceOverdueLadders(now: Date): Promise<void> {
    const candidates = await this.prisma.deviationAlert.findMany({
      where: {
        status: 'OPEN',
        acknowledgedAt: null,
        tier: {
          in: [
            'TIER_1_CONTRAINDICATION',
            'TIER_2_DISCREPANCY',
            'BP_LEVEL_2',
            'BP_LEVEL_2_SYMPTOM_OVERRIDE',
          ],
        },
      },
      include: ALERT_INCLUDE,
    })

    for (const alert of candidates) {
      const ladder = ladderForTier(alert.tier)
      if (!ladder) continue

      const events = await this.prisma.escalationEvent.findMany({
        where: { alertId: alert.id, notificationSentAt: { not: null } },
        select: { ladderStep: true },
      })
      const completedIds = new Set(events.map((e) => e.ladderStep))

      // Find the latest completed step's ladder index, or -1 if nothing fired.
      let latestIdx = -1
      ladder.steps.forEach((s, i) => {
        if (completedIds.has(s.step)) latestIdx = Math.max(latestIdx, i)
      })

      const upcoming = nextStep(
        ladder.steps,
        latestIdx >= 0 ? ladder.steps[latestIdx].step : null,
      )
      if (!upcoming) continue // ladder finished

      const deadline = new Date(alert.createdAt.getTime() + upcoming.offsetMs)
      if (now < deadline) continue

      const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
      const assignment = alert.user.providerAssignmentAsPatient ?? null
      await this.dispatchStep({
        alert,
        step: upcoming,
        ladderKind: ladder.kind,
        recipientRoles: upcoming.recipientRoles,
        practice,
        assignment,
        now,
      })
    }
  }

  // ─── dispatch primitives ────────────────────────────────────────────────

  /**
   * Creates a fresh EscalationEvent and dispatches (or queues) per the step's
   * after-hours behavior. Called by fireT0 + advanceOverdueLadders.
   */
  private async dispatchStep(args: {
    alert: AlertRow
    step: LadderStep
    ladderKind: LadderKind
    recipientRoles: RecipientRole[]
    practice: BusinessHoursConfig | null
    assignment: AssignmentRow | null
    now: Date
  }): Promise<void> {
    const { alert, step, practice, assignment, now } = args
    const afterHours =
      practice != null && !isWithinBusinessHours(now, practice)
    const shouldQueue =
      afterHours &&
      step.afterHoursBehavior === 'QUEUE_UNTIL_BUSINESS_HOURS' &&
      practice != null

    if (shouldQueue && practice) {
      const scheduledFor = nextBusinessHoursStart(now, practice)
      await this.prisma.escalationEvent.create({
        data: {
          alertId: alert.id,
          userId: alert.userId,
          escalationLevel: this.legacyLevelFor(args.ladderKind),
          reason: `Queued for business hours — ${step.step}`,
          ladderStep: step.step,
          recipientIds: this.getRecipientUserIds(assignment, args.recipientRoles, alert.userId),
          recipientRoles: args.recipientRoles,
          notificationChannel: step.channels[0] ?? 'PUSH',
          afterHours: true,
          scheduledFor,
        },
      })
      this.logger.log(
        `Queued ${step.step} for alert ${alert.id} until ${scheduledFor.toISOString()}`,
      )
      return
    }

    const recipientIds = this.getRecipientUserIds(
      assignment,
      args.recipientRoles,
      alert.userId,
    )

    const created = await this.prisma.escalationEvent.create({
      data: {
        alertId: alert.id,
        userId: alert.userId,
        escalationLevel: this.legacyLevelFor(args.ladderKind),
        reason: `${step.step} dispatched`,
        ladderStep: step.step,
        recipientIds,
        recipientRoles: args.recipientRoles,
        notificationChannel: step.channels[0] ?? 'PUSH',
        afterHours,
        notificationSentAt: now,
      },
    })

    await this.writeNotificationsAndEmit({
      eventId: created.id,
      alert,
      step,
      recipientIds,
      recipientRoles: args.recipientRoles,
      afterHours,
      now,
      triggeredByResolution: false,
    })
  }

  /**
   * Dispatches a pre-existing EscalationEvent (already inserted at queue-time
   * or retry-time). Used by firePendingScheduled for queued-from-after-hours
   * events + BP L2 #6 retries.
   */
  private async dispatchForExistingEvent(args: {
    eventId: string
    alert: AlertRow
    step: LadderStep
    ladderKind: LadderKind
    recipientRoles: RecipientRole[]
    practice: BusinessHoursConfig | null
    assignment: AssignmentRow | null
    now: Date
    triggeredByResolution: boolean
  }): Promise<void> {
    const recipientIds = this.getRecipientUserIds(
      args.assignment,
      args.recipientRoles,
      args.alert.userId,
    )

    const afterHours =
      args.practice != null && !isWithinBusinessHours(args.now, args.practice)

    await this.prisma.escalationEvent.update({
      where: { id: args.eventId },
      data: {
        notificationSentAt: args.now,
        recipientIds,
        afterHours,
      },
    })

    await this.writeNotificationsAndEmit({
      eventId: args.eventId,
      alert: args.alert,
      step: args.step,
      recipientIds,
      recipientRoles: args.recipientRoles,
      afterHours,
      now: args.now,
      triggeredByResolution: args.triggeredByResolution,
    })
  }

  /**
   * Fans out notifications to (recipient × channel), writes Notification rows
   * idempotently (@@unique([alertId, escalationEventId, userId, channel])),
   * and emits ESCALATION_DISPATCHED.
   */
  private async writeNotificationsAndEmit(args: {
    eventId: string
    alert: AlertRow
    step: LadderStep
    recipientIds: string[]
    recipientRoles: RecipientRole[]
    afterHours: boolean
    now: Date
    triggeredByResolution: boolean
  }): Promise<void> {
    const { alert, step, recipientIds, recipientRoles, eventId } = args

    // Role ↔ recipientId pairing is 1:1 by position. getRecipientUserIds
    // preserves order.
    for (let i = 0; i < recipientIds.length; i++) {
      const userId = recipientIds[i]
      const role = recipientRoles[i] ?? 'PRIMARY_PROVIDER'
      const body = this.pickMessageForRole(alert, role)
      if (!body) continue
      const title = this.titleForRoleAndTier(role, args.step.step, alert.tier)

      for (const channel of step.channels) {
        // DASHBOARD notifications are implicit via DeviationAlert rows; we
        // still write a row so the admin UI can surface the escalation timeline.
        await this.prisma.notification
          .create({
            data: {
              userId,
              alertId: alert.id,
              escalationEventId: eventId,
              channel,
              title,
              body,
              tips: [],
            },
          })
          .catch((err: unknown) => {
            // P2002 = duplicate (@@unique retry idempotency). Safe to ignore.
            const code = (err as { code?: string })?.code
            if (code !== 'P2002') throw err
          })

        if (channel === 'EMAIL') {
          const email = await this.emailFor(userId)
          if (email) {
            await this.emailService.sendEmail(email, title, escalationEmailBody(title, body))
          }
        }
      }
    }

    const dispatched: EscalationDispatchedEvent = {
      alertId: alert.id,
      escalationEventId: eventId,
      userId: alert.userId,
      alertTier: alert.tier ?? 'UNKNOWN',
      ruleId: alert.ruleId,
      ladderStep: step.step,
      recipientIds,
      recipientRoles,
      channels: step.channels,
      afterHours: args.afterHours,
      dispatchedAt: args.now,
      triggeredByResolution: args.triggeredByResolution,
    }
    this.eventEmitter.emit(JOURNAL_EVENTS.ESCALATION_DISPATCHED, dispatched)
    this.logger.log(
      `Dispatched ${step.step} for alert ${alert.id} to ${recipientIds.length} recipient(s) (${step.channels.join('+')})${args.afterHours ? ' [after-hours]' : ''}${args.triggeredByResolution ? ' [retry]' : ''}`,
    )
  }

  // ─── helpers ─────────────────────────────────────────────────────────────

  private async loadAlert(alertId: string): Promise<AlertRow | null> {
    return this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      include: ALERT_INCLUDE,
    }) as Promise<AlertRow | null>
  }

  private getRecipientUserIds(
    assignment: AssignmentRow | null,
    roles: RecipientRole[],
    patientUserId: string,
  ): string[] {
    const out: string[] = []
    for (const role of roles) {
      switch (role) {
        case 'PATIENT':
          out.push(patientUserId)
          break
        case 'PRIMARY_PROVIDER':
          if (assignment?.primaryProviderId) out.push(assignment.primaryProviderId)
          break
        case 'BACKUP_PROVIDER':
          if (assignment?.backupProviderId) out.push(assignment.backupProviderId)
          break
        case 'MEDICAL_DIRECTOR':
          if (assignment?.medicalDirectorId) out.push(assignment.medicalDirectorId)
          break
        case 'HEALPLACE_OPS':
          // MVP: notify any SUPER_ADMIN / HEALPLACE_OPS user. Real routing
          // (on-call rotation) is post-MVP per CLINICAL_SPEC §V2-F #35.
          // Left empty here; phase/11+ will populate via practice config.
          break
      }
    }
    return out
  }

  private pickMessageForRole(alert: AlertRow, role: RecipientRole): string | null {
    if (role === 'PATIENT') return alert.patientMessage ?? null
    // All provider + ops roles use the clinical-shorthand physicianMessage.
    return alert.physicianMessage ?? alert.caregiverMessage ?? null
  }

  private titleForRoleAndTier(
    role: RecipientRole,
    step: LadderStepId,
    tier: string | null,
  ): string {
    if (role === 'PATIENT') {
      if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
        return 'Urgent Blood Pressure Alert'
      }
      return 'Cardioplace Alert'
    }
    const isEmergency =
      tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
    const isTier1 = tier === 'TIER_1_CONTRAINDICATION'
    const prefix = isEmergency
      ? 'BP EMERGENCY'
      : isTier1
        ? 'TIER 1 CONTRAINDICATION'
        : 'Tier 2 Review'
    return `[${step}] ${prefix} — Patient needs review`
  }

  private async emailFor(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    })
    return u?.email ?? null
  }

  /** Maps phase/7 ladder kinds back to the legacy EscalationLevel enum until
   * the column is dropped. LEVEL_2 = Tier 1 + BP Level 2 (safety-critical),
   * LEVEL_1 = Tier 2 (discrepancy). */
  private legacyLevelFor(kind: LadderKind): 'LEVEL_1' | 'LEVEL_2' {
    return kind === 'TIER_2' ? 'LEVEL_1' : 'LEVEL_2'
  }
}

// ─── alert-row include + types (shared fetch shape) ─────────────────────────

const ALERT_INCLUDE = {
  user: {
    include: {
      providerAssignmentAsPatient: {
        include: { practice: true },
      },
    },
  },
} as const

interface AlertRow {
  id: string
  userId: string
  tier: string | null
  ruleId: string | null
  createdAt: Date
  status: string
  acknowledgedAt: Date | null
  patientMessage: string | null
  caregiverMessage: string | null
  physicianMessage: string | null
  user: {
    id: string
    providerAssignmentAsPatient: AssignmentRow | null
  }
}

interface AssignmentRow {
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
  practice: {
    businessHoursStart: string
    businessHoursEnd: string
    businessHoursTimezone: string
  }
}

function escalationEmailBody(title: string, body: string): string {
  return `<html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2 style="color:#b91c1c">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p><hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb"/><p style="font-size:12px;color:#6b7280">Sent by Cardioplace escalation service. Do not reply to this email.</p></body></html>`
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ] as string,
  )
}

// Re-export for tests that want the public ladder shape without re-importing.
export { TIER_1_LADDER }
