import { Injectable, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
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
  BP_LEVEL_1_PATIENT_T0,
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
  private readonly adminBaseUrl: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly emailService: EmailService,
    config: ConfigService,
  ) {
    // Used by escalation emails to deep-link providers to the alert in the
    // admin app. Defaults to the local admin port so dev emails are clickable
    // even without the env var set.
    this.adminBaseUrl = config
      .get<string>('ADMIN_BASE_URL', 'http://localhost:3001')
      .replace(/\/+$/, '')
  }

  // ─── event + cron entry points ──────────────────────────────────────────

  @OnEvent(JOURNAL_EVENTS.ALERT_CREATED, { async: true })
  async handleAlertCreated(payload: AlertCreatedEvent, now: Date = new Date()): Promise<void> {
    try {
      await this.fireT0(payload, now)
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

  private async fireT0(payload: AlertCreatedEvent, now: Date): Promise<void> {
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

    // Layer B dispatch gate — the DeviationAlert row is preserved (admin can
    // see it on the dashboard once the patient is enrolled), but we do not
    // notify anyone until the 4-piece enrollment gate has been passed.
    // Without assignment we'd have no PRIMARY/BACKUP/MD to resolve, and the
    // fail-loud path would just write DISPATCH ERROR rows. See
    // TESTING_FLOW_GUIDE.md §6.2–§6.3.
    if (alert.user.enrollmentStatus !== 'ENROLLED') {
      this.logger.log(
        `Alert ${payload.alertId}: patient ${alert.userId} not enrolled — deferring dispatch`,
      )
      return
    }

    const practice = alert.user.providerAssignmentAsPatient?.practice ?? null
    const assignment = alert.user.providerAssignmentAsPatient ?? null

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

    // Tier 1 after-hours safety net: fire BACKUP immediately so someone is
    // paged while PRIMARY is queued to next business hours. During business
    // hours the PRIMARY fires at T+0 anyway, so BACKUP's proper entry point
    // is the T+4h step — no courtesy fire needed.
    //
    // CLINICAL_SPEC §V2-D After-Hours handling: "Tier 1: Queue for first
    // business day. Immediate push to backup. Escalation clock starts next
    // business day." The "immediate push to backup" scopes to after-hours.
    if (ladder.kind === 'TIER_1' && practice != null) {
      const afterHours = !isWithinBusinessHours(now, practice)
      if (afterHours) {
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

    // Phase/23 — BP Level 1 patient-side T+0. Spec mandates out-of-app
    // notification so the patient doesn't have to open the app to learn
    // their BP needs attention. Fires immediately regardless of business
    // hours; channel=PUSH writes a Notification row that surfaces in-app
    // and (once web-push transport ships) delivers as an OS-level push.
    if (ladder.kind === 'BP_LEVEL_1') {
      await this.dispatchStep({
        alert,
        step: BP_LEVEL_1_PATIENT_T0,
        ladderKind: ladder.kind,
        recipientRoles: BP_LEVEL_1_PATIENT_T0.recipientRoles,
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

      // Layer B gate — patient un-enrolled between queue time and dispatch
      // time (e.g. admin revoked enrollment). Leave the row in place;
      // re-enrollment will pick it up on the next cron pass.
      if (alert.user.enrollmentStatus !== 'ENROLLED') {
        this.logger.debug(
          `Pending event ${row.id}: patient ${alert.userId} not enrolled — deferring`,
        )
        continue
      }

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

      // Layer B gate — skip advancing for un-enrolled patients. This also
      // catches alerts created pre-enrollment-split (when fireT0 didn't gate)
      // so their ladders don't keep walking once the filter kicks in.
      if (alert.user.enrollmentStatus !== 'ENROLLED') {
        this.logger.debug(
          `Alert ${alert.id}: patient ${alert.userId} not enrolled — ladder paused`,
        )
        continue
      }

      // Fetch all escalation events for the alert — need both dispatched rows
      // (for "completed" step set) AND the primary T+0 row (for anchor, whether
      // dispatched or still queued).
      const events = await this.prisma.escalationEvent.findMany({
        where: { alertId: alert.id },
        orderBy: { triggeredAt: 'asc' },
        select: {
          ladderStep: true,
          recipientRoles: true,
          triggeredAt: true,
          scheduledFor: true,
          notificationSentAt: true,
        },
      })

      // Tier 1 T+0 has TWO rows: the ladder row (recipientRoles includes
      // PRIMARY_PROVIDER) and the courtesy backup row. Only the primary counts
      // as the ladder anchor; the backup is not on the main ladder. Other
      // tiers have a single T+0 row.
      const isCourtesyBackup = (e: {
        ladderStep: string | null
        recipientRoles: string[]
      }) =>
        ladder.kind === 'TIER_1' &&
        e.ladderStep === 'T0' &&
        !e.recipientRoles.includes('PRIMARY_PROVIDER')

      const completedIds = new Set(
        events
          .filter((e) => e.notificationSentAt != null && !isCourtesyBackup(e))
          .map((e) => e.ladderStep),
      )

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

      // Deadline anchor per CLINICAL_SPEC §V2-D "After-hours handling" — the
      // escalation clock starts when T+0 actually dispatched (not when the
      // alert was created). For BP L2 (immediate fire) and Tier 2 (queued at
      // T+0), this collapses to alert.createdAt in the happy path; for Tier 1
      // after-hours it correctly defers the whole ladder to next-business-open.
      const t0Primary = events.find(
        (e) =>
          e.ladderStep === 'T0' &&
          !isCourtesyBackup(e),
      )
      const anchor =
        t0Primary?.notificationSentAt ??
        t0Primary?.scheduledFor ??
        t0Primary?.triggeredAt ??
        alert.createdAt

      const deadline = new Date(anchor.getTime() + upcoming.offsetMs)
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

    const resolved = await this.getRecipientUserIds(
      assignment,
      args.recipientRoles,
      alert.userId,
    )
    const dispatchReason = this.buildDispatchReason(
      step.step,
      resolved.missingRequiredRoles,
    )
    if (resolved.missingRequiredRoles.length > 0) {
      this.logger.error(
        `Alert ${alert.id} step ${step.step}: data-integrity bug — missing required roles: ${resolved.missingRequiredRoles.join(',')}. Enrollment gate should have caught this. Continuing with partial dispatch.`,
      )
    }

    if (shouldQueue && practice) {
      const scheduledFor = nextBusinessHoursStart(now, practice)
      await this.prisma.escalationEvent.create({
        data: {
          alertId: alert.id,
          userId: alert.userId,
          escalationLevel: this.legacyLevelFor(args.ladderKind),
          reason: `Queued for business hours — ${step.step}${dispatchReason.suffix}`,
          ladderStep: step.step,
          // Persist what we'd dispatch when the queue fires. The cron will
          // re-resolve at fire time too (practice staff may change before
          // then), but we keep the snapshot for audit.
          recipientIds: resolved.recipientIds,
          recipientRoles: resolved.recipientRoles,
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

    const created = await this.prisma.escalationEvent.create({
      data: {
        alertId: alert.id,
        userId: alert.userId,
        escalationLevel: this.legacyLevelFor(args.ladderKind),
        reason: `${step.step} dispatched${dispatchReason.suffix}`,
        ladderStep: step.step,
        recipientIds: resolved.recipientIds,
        recipientRoles: resolved.recipientRoles,
        notificationChannel: step.channels[0] ?? 'PUSH',
        afterHours,
        notificationSentAt: now,
      },
    })

    await this.writeNotificationsAndEmit({
      eventId: created.id,
      alert,
      step,
      recipientIds: resolved.recipientIds,
      recipientRoles: resolved.recipientRoles,
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
    const resolved = await this.getRecipientUserIds(
      args.assignment,
      args.recipientRoles,
      args.alert.userId,
    )
    const dispatchReason = this.buildDispatchReason(
      args.step.step,
      resolved.missingRequiredRoles,
    )
    if (resolved.missingRequiredRoles.length > 0) {
      this.logger.error(
        `Alert ${args.alert.id} step ${args.step.step} (scheduled): data-integrity bug — missing required roles: ${resolved.missingRequiredRoles.join(',')}. Continuing with partial dispatch.`,
      )
    }

    const afterHours =
      args.practice != null && !isWithinBusinessHours(args.now, args.practice)

    await this.prisma.escalationEvent.update({
      where: { id: args.eventId },
      data: {
        notificationSentAt: args.now,
        recipientIds: resolved.recipientIds,
        recipientRoles: resolved.recipientRoles,
        afterHours,
        reason: `${args.step.step} dispatched${args.triggeredByResolution ? ' (retry)' : ''}${dispatchReason.suffix}`,
      },
    })

    await this.writeNotificationsAndEmit({
      eventId: args.eventId,
      alert: args.alert,
      step: args.step,
      recipientIds: resolved.recipientIds,
      recipientRoles: resolved.recipientRoles,
      afterHours,
      now: args.now,
      triggeredByResolution: args.triggeredByResolution,
    })
  }

  /**
   * Builds the `reason` suffix on EscalationEvent when required roles are
   * missing. Empty suffix when all required roles resolved. Appears on the
   * audit trail so ops can identify data-integrity bugs at-a-glance.
   */
  private buildDispatchReason(
    step: LadderStepId,
    missingRequiredRoles: RecipientRole[],
  ): { suffix: string } {
    void step
    if (missingRequiredRoles.length === 0) return { suffix: '' }
    return {
      suffix: ` — DISPATCH ERROR: missing required roles ${missingRequiredRoles.join(',')}`,
    }
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
            const rendered = escalationEmailBody({
              alert,
              step: step.step,
              role,
              message: body,
              adminBaseUrl: this.adminBaseUrl,
              afterHours: args.afterHours,
              now: args.now,
            })
            await this.emailService.sendEmail(email, rendered.subject, rendered.html)
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

  /**
   * Resolves recipient roles to user IDs. Returns parallel `recipientIds`
   * and `recipientRoles` arrays (same length) so downstream code can pair
   * each recipient with the role that put them on the list — important for
   * HEALPLACE_OPS which can expand to multiple users.
   *
   * Integrity rule (user correction):
   *  - PRIMARY_PROVIDER / BACKUP_PROVIDER / MEDICAL_DIRECTOR are required per
   *    phase/13 enrollment gate. Missing at dispatch time = data-integrity
   *    bug; added to `missingRequiredRoles` so the caller can log + flag.
   *  - HEALPLACE_OPS is soft: empty resolution logs a warning but doesn't
   *    flag the dispatch as broken (on-call rotation is post-MVP).
   *  - PATIENT is always resolvable (just alert.userId).
   */
  private async getRecipientUserIds(
    assignment: AssignmentRow | null,
    roles: RecipientRole[],
    patientUserId: string,
  ): Promise<{
    recipientIds: string[]
    recipientRoles: RecipientRole[]
    missingRequiredRoles: RecipientRole[]
  }> {
    const ids: string[] = []
    const flatRoles: RecipientRole[] = []
    const missing: RecipientRole[] = []
    let healplaceOpsIds: string[] | null = null

    for (const role of roles) {
      switch (role) {
        case 'PATIENT':
          ids.push(patientUserId)
          flatRoles.push(role)
          break
        case 'PRIMARY_PROVIDER':
          if (assignment?.primaryProviderId) {
            ids.push(assignment.primaryProviderId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'BACKUP_PROVIDER':
          if (assignment?.backupProviderId) {
            ids.push(assignment.backupProviderId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'MEDICAL_DIRECTOR':
          if (assignment?.medicalDirectorId) {
            ids.push(assignment.medicalDirectorId)
            flatRoles.push(role)
          } else {
            missing.push(role)
          }
          break
        case 'HEALPLACE_OPS':
          // Adjustment 1 — fallback resolver: all users with UserRole.HEALPLACE_OPS.
          // Lazy + cached per call. On-call rotation is post-MVP (V2-F #35).
          if (healplaceOpsIds === null) {
            healplaceOpsIds = await this.findHealplaceOpsUserIds()
          }
          if (healplaceOpsIds.length === 0) {
            this.logger.warn(
              'No HEALPLACE_OPS users found — step recipients empty for this role',
            )
          } else {
            for (const opsId of healplaceOpsIds) {
              ids.push(opsId)
              flatRoles.push(role)
            }
          }
          break
      }
    }

    return { recipientIds: ids, recipientRoles: flatRoles, missingRequiredRoles: missing }
  }

  private async findHealplaceOpsUserIds(): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: { roles: { has: 'HEALPLACE_OPS' } },
      select: { id: true },
    })
    return users.map((u) => u.id)
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
   * LEVEL_1 = Tier 2 + BP Level 1 (non-emergent provider attention). */
  private legacyLevelFor(kind: LadderKind): 'LEVEL_1' | 'LEVEL_2' {
    return kind === 'TIER_2' || kind === 'BP_LEVEL_1' ? 'LEVEL_1' : 'LEVEL_2'
  }
}

// ─── alert-row include + types (shared fetch shape) ─────────────────────────

// Wider include than v1 — escalation emails now embed patient identifiers
// (name, email, DOB → age), the latest reading, and per-alert clinical
// metadata (pulse pressure, suboptimal-measurement flag, mode). Practice.name
// + business hours travel together so the email template can render the
// practice tag in the subject, the practice-local timestamp in the body, and
// the after-hours queueing pill where applicable.
const ALERT_INCLUDE = {
  user: {
    select: {
      id: true,
      name: true,
      email: true,
      dateOfBirth: true,
      enrollmentStatus: true,
      providerAssignmentAsPatient: {
        select: {
          primaryProviderId: true,
          backupProviderId: true,
          medicalDirectorId: true,
          practice: {
            select: {
              name: true,
              businessHoursStart: true,
              businessHoursEnd: true,
              businessHoursTimezone: true,
            },
          },
        },
      },
    },
  },
  journalEntry: {
    select: {
      systolicBP: true,
      diastolicBP: true,
      pulse: true,
      position: true,
      measuredAt: true,
    },
  },
} as const

interface AlertRow {
  id: string
  userId: string
  tier: string | null
  ruleId: string | null
  // Phase/22 — clinical metadata surfaced in the email body so the provider
  // sees mode (STANDARD / PERSONALIZED), pulse pressure, and the
  // suboptimal-measurement flag without having to click into the dashboard.
  mode: string | null
  pulsePressure: number | null
  suboptimalMeasurement: boolean
  createdAt: Date
  status: string
  acknowledgedAt: Date | null
  patientMessage: string | null
  caregiverMessage: string | null
  physicianMessage: string | null
  user: {
    id: string
    name: string | null
    email: string | null
    dateOfBirth: Date | null
    // Layer B dispatch gate — escalation only fires for patients the admin
    // has passed through the 4-piece enrollment gate (assignment + practice
    // business hours + profile + threshold-if-HFREF/HCM/DCM). See
    // TESTING_FLOW_GUIDE.md §6.2.
    enrollmentStatus: 'NOT_ENROLLED' | 'ENROLLED'
    providerAssignmentAsPatient: AssignmentRow | null
  }
  journalEntry: JournalEntrySnapshot | null
}

interface AssignmentRow {
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
  practice: {
    name: string
    businessHoursStart: string
    businessHoursEnd: string
    businessHoursTimezone: string
  }
}

interface JournalEntrySnapshot {
  systolicBP: number | null
  diastolicBP: number | null
  pulse: number | null
  position: string | null
  measuredAt: Date
}

// ─── email body ─────────────────────────────────────────────────────────────
//
// Tier-aware HTML template that wraps the role-picked clinical message
// (physicianMessage / caregiverMessage / patientMessage) in a detailed
// envelope: patient identifiers, latest reading + position, pulse pressure
// (with wide-PP flag), suboptimal-measurement flag, alert mode, escalation
// step pill, after-hours explanation, deep link to the admin dashboard, and a
// stable footer with alert + patient IDs for ops reference. Returns subject
// + html so the patient name renders in both the inbox preview and the body
// via one pass.
function escalationEmailBody(args: {
  alert: AlertRow
  step: LadderStepId
  role: RecipientRole
  message: string
  adminBaseUrl: string
  afterHours: boolean
  now: Date
}): { subject: string; html: string } {
  const { alert, step, role, message, adminBaseUrl, afterHours, now } = args

  const patientName = alert.user.name?.trim() || 'Patient (name unknown)'
  const patientEmail = alert.user.email ?? ''
  const age = ageFromDob(alert.user.dateOfBirth, now)
  const dobStr = alert.user.dateOfBirth
    ? alert.user.dateOfBirth.toISOString().slice(0, 10)
    : '(DOB unknown)'
  const ageStr = age != null ? `age ${age}` : 'age unknown'
  const practice =
    alert.user.providerAssignmentAsPatient?.practice ?? null
  const practiceName = practice?.name ?? '(practice not assigned)'
  const practiceTz = practice?.businessHoursTimezone ?? 'UTC'

  const tierLabel = tierLabelFor(alert.tier)
  const tierColor = tierColorFor(alert.tier)
  const isPatient = role === 'PATIENT'

  // Subject — patient-role emails keep the friendly, non-alarming title.
  const subject = isPatient
    ? patientSubject(alert.tier)
    : `[${humanStep(step)} ${tierLabel}] ${patientName} — ${practiceName}`

  const stepPill = `${humanStep(step)}${afterHours ? ' (after-hours queued)' : ''}`
  const ackFooter = ackFooterFor(alert.tier)
  const dashboardUrl = `${adminBaseUrl}/patients/${encodeURIComponent(alert.userId)}?alert=${encodeURIComponent(alert.id)}`

  // Recipient role banner — clarifies why THIS person is getting THIS email.
  // Skipped for PATIENT-role to avoid alarming wording like "as the patient".
  const recipientBanner = isPatient
    ? ''
    : `<div style="margin-top:14px;padding:10px 14px;background:#eef2ff;border-radius:6px;font-size:12.5px;color:#3730a3">You are receiving this notification as the <strong>${escapeHtml(roleLabel(role))}</strong>.</div>`

  // Reading block — BP, pulse, pulse pressure, position, measurement
  // timestamp (UTC + practice-local). Only renders when a JournalEntry
  // snapshot is on the alert (mostly always — created from a reading).
  const readingBlock = alert.journalEntry
    ? renderReadingBlock(alert.journalEntry, alert.pulsePressure, practiceTz)
    : ''

  // Suboptimal-measurement banner — patient missed at least one of the
  // pre-measurement checklist items (caffeine / smoking / cuff position
  // etc). Provider should weigh this before acting on the BP value.
  const suboptimalBanner = alert.suboptimalMeasurement
    ? `<div style="margin-top:12px;padding:10px 14px;background:#fef2f2;border-radius:6px;font-size:12.5px;color:#991b1b"><strong>⚠ Suboptimal measurement conditions.</strong> Patient flagged at least one pre-measurement checklist item (caffeine, smoking, recent activity, posture, or cuff position). Interpret the reading with this caveat.</div>`
    : ''

  // After-hours explanation — only render when the dispatch was queued or
  // marked as a backup courtesy fire. Helps a recipient understand why they
  // are paged at 11pm or why the primary hasn't responded yet.
  const afterHoursBlock = afterHours
    ? `<div style="margin-top:12px;padding:10px 14px;background:#fff7ed;border-radius:6px;font-size:12.5px;color:#9a3412"><strong>After-hours dispatch.</strong> The primary provider's notification is queued for the next business window (${escapeHtml(practiceName)} — ${escapeHtml(practice?.businessHoursStart ?? '')}–${escapeHtml(practice?.businessHoursEnd ?? '')} ${escapeHtml(practiceTz)}). This courtesy notification is sent to the backup so a clinician is aware overnight.</div>`
    : ''

  // Alert-metadata strip — small grey row of at-a-glance facts that don't
  // need a full block but matter for triage: tier label, ladder step, mode,
  // ruleId.
  const metaItems: string[] = [
    `Tier: <strong>${escapeHtml(tierLabel)}</strong>`,
    `Step: <strong>${escapeHtml(humanStep(step))}</strong>`,
  ]
  if (alert.mode) metaItems.push(`Mode: <strong>${escapeHtml(alert.mode)}</strong>`)
  if (alert.ruleId) metaItems.push(`Rule: <strong>${escapeHtml(alert.ruleId)}</strong>`)
  const metaStrip = `<div style="margin-top:14px;font-size:12px;color:#6b7280;line-height:1.55">${metaItems.join(' &middot; ')}</div>`

  // Timestamp block — alert created at, in both UTC and practice-local.
  const createdUtc = alert.createdAt.toISOString()
  const createdLocal = formatInTz(alert.createdAt, practiceTz)
  const createdLine = `<div style="margin-top:6px;font-size:12px;color:#6b7280">Alert created: <strong>${escapeHtml(createdLocal)}</strong> <span style="color:#9ca3af">(${escapeHtml(createdUtc)})</span></div>`

  // Footer with stable IDs so anyone replying via phone or Slack can
  // reference exactly which alert / patient.
  const idFooter = `<div style="margin-top:18px;font-size:11px;color:#9ca3af;font-family:ui-monospace,SFMono-Regular,monospace">Alert ID: ${escapeHtml(alert.id)} &middot; Patient ID: ${escapeHtml(alert.userId)}</div>`

  // Header / clinical / detail / action / footer blocks. Keep inline styles
  // — most email clients strip <style> tags.
  const html = `<html><body style="font-family:system-ui,-apple-system,sans-serif;max-width:620px;margin:auto;padding:24px;color:#111827">
  <div style="border-left:4px solid ${tierColor};padding:16px 20px;background:#f9fafb;border-radius:6px">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${tierColor}">${escapeHtml(tierLabel)} &middot; ${escapeHtml(stepPill)}</div>
    <div style="font-size:20px;font-weight:700;margin-top:6px;color:#111827">${escapeHtml(patientName)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px">${escapeHtml(patientEmail)} &middot; DOB ${escapeHtml(dobStr)} &middot; ${escapeHtml(ageStr)}</div>
    <div style="font-size:13px;color:#6b7280;margin-top:2px">Practice: ${escapeHtml(practiceName)}</div>
  </div>
  ${recipientBanner}
  <div style="margin-top:20px;font-size:14px;line-height:1.6;color:#111827;font-weight:500">${escapeHtml(message)}</div>
  ${readingBlock}
  ${suboptimalBanner}
  ${afterHoursBlock}
  ${metaStrip}
  ${createdLine}
  <div style="margin-top:22px"><a href="${escapeAttr(dashboardUrl)}" style="display:inline-block;padding:11px 20px;background:${tierColor};color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View in dashboard →</a></div>
  ${ackFooter ? `<div style="margin-top:18px;padding:12px 14px;background:#fef3c7;border-radius:6px;font-size:12.5px;color:#78350f"><strong>Acknowledgment expected.</strong> ${escapeHtml(ackFooter)}</div>` : ''}
  ${idFooter}
  <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb"/>
  <p style="font-size:11px;color:#9ca3af">Sent by Cardioplace escalation service. Do not reply to this email.</p>
</body></html>`

  return { subject, html }
}

function renderReadingBlock(
  entry: JournalEntrySnapshot,
  pulsePressure: number | null,
  practiceTz: string,
): string {
  const sbp = entry.systolicBP
  const dbp = entry.diastolicBP
  const pulse = entry.pulse
  const position = entry.position
  const utc = entry.measuredAt.toISOString()
  const local = formatInTz(entry.measuredAt, practiceTz)

  const bpPart =
    sbp != null && dbp != null
      ? `${sbp}/${dbp} mmHg`
      : sbp != null
        ? `${sbp} mmHg systolic`
        : '(no BP)'
  const pulsePart = pulse != null ? ` &middot; pulse <strong>${pulse}</strong>` : ''
  const ppPart =
    pulsePressure != null
      ? ` &middot; pulse pressure <strong>${pulsePressure}</strong>${pulsePressure > 60 ? ' <span style="color:#b91c1c">(wide)</span>' : ''}`
      : ''
  const posPart = position
    ? ` &middot; position <strong>${escapeHtml(position)}</strong>`
    : ''

  return `<div style="margin-top:14px;padding:12px 14px;background:#f3f4f6;border-radius:6px;font-size:13px;color:#111827">
    <div style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#6b7280;margin-bottom:4px">Latest reading</div>
    <div><strong>${escapeHtml(bpPart)}</strong>${pulsePart}${ppPart}${posPart}</div>
    <div style="margin-top:4px;font-size:12px;color:#6b7280">Recorded <strong>${escapeHtml(local)}</strong> <span style="color:#9ca3af">(${escapeHtml(utc)})</span></div>
  </div>`
}

function formatInTz(d: Date, tz: string): string {
  // "Apr 22, 2026, 06:00 AM EDT" — readable, timezone-aware. Falls back to
  // ISO if the runtime can't honour the tz (defensive — should never fire
  // since Node 16+ ships full ICU).
  try {
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: tz,
    }).format(d)
  } catch {
    return d.toISOString()
  }
}

function roleLabel(role: RecipientRole): string {
  switch (role) {
    case 'PRIMARY_PROVIDER':
      return 'primary provider'
    case 'BACKUP_PROVIDER':
      return 'backup provider'
    case 'MEDICAL_DIRECTOR':
      return 'medical director'
    case 'HEALPLACE_OPS':
      return 'Healplace ops'
    case 'PATIENT':
      return 'patient'
    default:
      return role
  }
}

function ageFromDob(dob: Date | null, now: Date): number | null {
  if (!dob) return null
  const ms = now.getTime() - dob.getTime()
  if (ms < 0) return null
  const years = ms / (365.25 * 24 * 3600 * 1000)
  return Math.floor(years)
}

function tierLabelFor(tier: string | null): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'BP EMERGENCY'
  }
  if (tier === 'TIER_1_CONTRAINDICATION') return 'TIER 1 CONTRAINDICATION'
  if (tier === 'BP_LEVEL_1_HIGH') return 'BP LEVEL 1 HIGH'
  if (tier === 'BP_LEVEL_1_LOW') return 'BP LEVEL 1 LOW'
  if (tier === 'TIER_2_DISCREPANCY') return 'Tier 2 Review'
  return 'Cardioplace Alert'
}

function tierColorFor(tier: string | null): string {
  if (
    tier === 'BP_LEVEL_2' ||
    tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE' ||
    tier === 'TIER_1_CONTRAINDICATION'
  ) {
    return '#b91c1c' // red-700
  }
  // BP Level 1 + Tier 2 share the amber palette — non-emergency,
  // provider-attention-required-within-a-business-day.
  if (
    tier === 'BP_LEVEL_1_HIGH' ||
    tier === 'BP_LEVEL_1_LOW' ||
    tier === 'TIER_2_DISCREPANCY'
  ) {
    return '#b45309' // amber-700
  }
  return '#1d4ed8' // blue-700
}

function ackFooterFor(tier: string | null): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'If you do not acknowledge within 2 hours, the medical director will be paged. Healplace ops will phone the practice within 4 hours.'
  }
  if (tier === 'TIER_1_CONTRAINDICATION') {
    return 'If you do not acknowledge within 4 hours, your backup provider will be paged. If unresolved within 8 hours, the medical director will be notified.'
  }
  if (tier === 'BP_LEVEL_1_HIGH' || tier === 'BP_LEVEL_1_LOW') {
    return 'If you do not acknowledge within 24 hours, your backup provider will be paged. If unresolved within 72 hours, the medical director will be notified.'
  }
  if (tier === 'TIER_2_DISCREPANCY') {
    return 'If unreviewed within 7 days, this alert will be escalated to your backup provider.'
  }
  return ''
}

function humanStep(step: LadderStepId): string {
  // The ladder uses ids like 'T0' / 'T2H' / 'T4H' / 'T8H' / 'T24H' / 'T48H'
  // / 'T72H' / 'T7D' / 'TIER2_*'. Render with a `+` so it's unambiguous in
  // the subject. Tier-2-prefixed ids drop the prefix for display.
  if (step === 'T0') return 'T+0'
  const stripped = step.replace(/^TIER2_/, '')
  return stripped.replace(/^T/, 'T+').toLowerCase().replace(/^t\+/, 'T+')
}

function patientSubject(tier: string | null): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'Urgent Blood Pressure Alert — Cardioplace'
  }
  return 'Cardioplace Alert'
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

function escapeAttr(s: string): string {
  // URLs go in href attributes; reuse escapeHtml since the same five chars
  // need to be entitised in attribute context too.
  return escapeHtml(s)
}

// Re-export for tests that want the public ladder shape without re-importing.
export { TIER_1_LADDER }
// Re-export the email-body helper so spec files can render and assert on the
// output directly without spinning up the full Nest TestingModule.
export { escalationEmailBody }
