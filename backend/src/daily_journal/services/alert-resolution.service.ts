import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import {
  ActorUser,
  PatientAccessService,
} from '../../common/patient-access.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  RESOLUTION_CATALOG,
  angioedemaPatientDeclinedEd,
  missingRequiredSubFields,
  type ResolutionAction,
} from '../escalation/resolution-actions.js'
import { EscalationService } from './escalation.service.js'
import { Prisma } from '../../generated/prisma/client.js'
import { patientLabelForResolutionAction } from '@cardioplace/shared'

/**
 * Phase/7 AlertResolutionService — business logic for the three admin
 * endpoints exposed by AlertResolutionController:
 *
 *  - acknowledge(alertId, actor) — stops the cron scanner from advancing.
 *  - resolve(alertId, actor, dto) — terminal state. Writes resolution
 *    fields on DeviationAlert + marks all open EscalationEvent rows resolved.
 *    Validates rationale per CLINICAL_SPEC §V2-D (required for Tier 1 +
 *    BP Level 2, plus specific Tier 2 actions).
 *  - buildAuditPayload(alertId) — returns the 15-field Joint Commission
 *    audit trail (13 auto + 2 from resolution).
 *
 * Special case: BP Level 2 #6 `BP_L2_UNABLE_TO_REACH_RETRY` does NOT resolve
 * the alert. It schedules a fresh T+4h EscalationEvent via
 * EscalationService.scheduleRetry and leaves the alert OPEN.
 */
@Injectable()
export class AlertResolutionService {
  private readonly logger = new Logger(AlertResolutionService.name)

  // BP L2 #6 retry offset — 4 hours per CLINICAL_SPEC §V2-D BP L2 ladder.
  private static readonly BP_L2_RETRY_OFFSET_MS = 4 * 60 * 60 * 1000

  constructor(
    private readonly prisma: PrismaService,
    private readonly escalation: EscalationService,
    private readonly access: PatientAccessService,
  ) {}

  async acknowledge(
    alertId: string,
    actor: ActorUser,
    ctx?: { practiceId: string | null },
  ): Promise<{ acknowledgedAt: Date }> {
    const alert = await this.loadAlertOrThrow(alertId)
    // Role-scope check uses the alert's patient — same as every other
    // patient-detail mutation. PROVIDER must be in panel; MED_DIR must
    // head the patient's practice; OPS/SUPER unscoped.
    await this.access.assertCanAccessPatient(actor, alert.userId)
    if (alert.status === 'RESOLVED') {
      throw new BadRequestException('Alert is already resolved')
    }
    if (alert.acknowledgedAt) {
      return { acknowledgedAt: alert.acknowledgedAt }
    }
    const now = new Date()
    const actorPracticeContext = ctx?.practiceId ?? null
    await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now,
        // Phase 1 polish Finding 1 — alert-level actor (symmetric with the
        // /provider/alerts/:id/acknowledge path); was omitted so the audit
        // footer showed "Acknowledged" with no name.
        acknowledgedByUserId: actor.id,
        // Phase/practice-identity (Manisha 2026-06-12 §1, HIPAA 45 CFR
        // §164.312(a)(2)(i)) — capture WHICH practice the actor was
        // acting under at ack time.
        actorPracticeContext,
      },
    })
    // Mark open escalation events acknowledged so the cron skips them.
    await this.prisma.escalationEvent.updateMany({
      where: { alertId, acknowledgedAt: null, resolvedAt: null },
      data: { acknowledgedAt: now, acknowledgedBy: actor.id, actorPracticeContext },
    })
    this.logger.log(`Alert ${alertId} acknowledged by ${actor.id}`)
    return { acknowledgedAt: now }
  }

  async resolve(
    alertId: string,
    actor: ActorUser,
    dto: {
      resolutionAction: ResolutionAction
      resolutionRationale?: string
      resolutionDetails?: Record<string, unknown>
    },
    ctx?: { practiceId: string | null },
  ): Promise<{ status: string; resolvedAt: Date | null; retryScheduledFor?: Date }> {
    const actorPracticeContext = ctx?.practiceId ?? null
    void actorPracticeContext // referenced inside the write blocks below
    const alert = await this.loadAlertOrThrow(alertId)
    await this.access.assertCanAccessPatient(actor, alert.userId)
    const actionDef = RESOLUTION_CATALOG[dto.resolutionAction]

    // 1. Tier-compat check — reject resolution actions from the wrong tier.
    const allowed = this.allowedGroupFor(alert.tier)
    if (!allowed || actionDef.tier !== allowed) {
      throw new BadRequestException(
        `Action ${dto.resolutionAction} is not valid for alert tier ${alert.tier}`,
      )
    }

    // 2. Rationale validation — required per CLINICAL_SPEC §V2-D for Tier 1,
    // BP Level 2, and specific Tier 2 actions (catalog-tagged).
    if (actionDef.requiresRationale) {
      if (!dto.resolutionRationale || dto.resolutionRationale.trim().length < 3) {
        throw new BadRequestException(
          `resolutionRationale is required for ${dto.resolutionAction}`,
        )
      }
    }

    // 2b. Sub-field validation — angioedema actions (Manisha 5/24 Q4) require
    // their conditional sub-fields (willGo, facility, replacementOrdered,
    // outcome, actualCause) before they can resolve.
    const missing = missingRequiredSubFields(
      dto.resolutionAction,
      dto.resolutionDetails,
    )
    if (missing.length > 0) {
      throw new BadRequestException(
        `Missing required sub-fields for ${dto.resolutionAction}: ${missing.join(', ')}`,
      )
    }
    const resolutionDetails = dto.resolutionDetails ?? null

    const now = new Date()

    // 3a. Angioedema special handling (Manisha 5/24 Q4) — runs before the
    // generic terminal-resolve path because several actions either keep the
    // alert OPEN or carry transactional side-effects.
    if (allowed === 'TIER_1_ANGIOEDEMA') {
      return this.resolveAngioedema(alert, actor, dto, actionDef, resolutionDetails, now, actorPracticeContext)
    }

    // 3. Special case — BP L2 #6 retry: leave alert OPEN, schedule a T+4h
    // fresh EscalationEvent. Alert keeps escalating.
    if (actionDef.triggersBpL2Retry) {
      await this.escalation.scheduleRetry({
        alertId: alert.id,
        userId: alert.userId,
        ladderStep: 'T4H',
        offsetMs: AlertResolutionService.BP_L2_RETRY_OFFSET_MS,
        recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
        channels: ['PUSH', 'DASHBOARD'],
        now,
      })
      // Log the resolution attempt on the alert row for audit — store the
      // action + rationale but keep status OPEN.
      await this.prisma.deviationAlert.update({
        where: { id: alertId },
        data: {
          resolutionAction: dto.resolutionAction,
          resolutionRationale: dto.resolutionRationale ?? null,
          resolvedBy: actor.id,
          actorPracticeContext,
        },
      })
      const retryScheduledFor = new Date(
        now.getTime() + AlertResolutionService.BP_L2_RETRY_OFFSET_MS,
      )
      this.logger.log(
        `Alert ${alertId} BP L2 retry scheduled for ${retryScheduledFor.toISOString()} by ${actor.id}`,
      )
      return { status: 'OPEN', resolvedAt: null, retryScheduledFor }
    }

    // 4. Terminal resolution — mark resolved + close open escalation rows.
    // Admin resolution is independent of patient acknowledgment: the patient
    // still gets to click "I've seen this" on their detail page when the
    // alert is dismissible. acknowledgedAt is patient-only state.
    //
    // `resolvedAt` on DeviationAlert is the canonical timestamp the JCAHO
    // NPSG.03.06.01 15-field audit footer reads for the "Resolved" row.
    // Symmetric to the ack handler's `acknowledgedAt` write — without it the
    // alert-level audit shows a blank cell even though the event-level
    // timestamps update correctly.
    await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        resolutionAction: dto.resolutionAction,
        resolutionRationale: dto.resolutionRationale ?? null,
        resolvedBy: actor.id,
        actorPracticeContext,
        ...(resolutionDetails
          ? { resolutionDetails: resolutionDetails as Prisma.InputJsonValue }
          : {}),
      },
    })
    await this.prisma.escalationEvent.updateMany({
      where: { alertId, resolvedAt: null },
      data: { resolvedAt: now, resolvedBy: actor.id, actorPracticeContext },
    })

    // 5. Patient notification — let the patient know an action was taken so
    // they don't have to manually re-open every alert. Skipped for Tier 2
    // (admin-only per CLINICAL_SPEC §V2-C) and for the retry case (alert
    // still OPEN, handled above).
    if (this.shouldNotifyPatient(alert.tier)) {
      const actionLabel =
        patientLabelForResolutionAction(dto.resolutionAction) ??
        'Action taken by your care team.'
      const body = `${this.alertTypeLabelForNotification(alert.tier)}: ${actionLabel}`
      await this.prisma.notification
        .create({
          data: {
            userId: alert.userId,
            alertId: alert.id,
            channel: 'PUSH',
            title: 'Care team update',
            body,
            tips: [],
          },
        })
        .catch((err: unknown) => {
          // P2002 = duplicate (resolve called twice on the same alert).
          // Idempotent — first notification is the source of truth.
          const code = (err as { code?: string })?.code
          if (code !== 'P2002') throw err
        })
    }

    this.logger.log(
      `Alert ${alertId} resolved by ${actor.id} via ${dto.resolutionAction}`,
    )
    return { status: 'RESOLVED', resolvedAt: now }
  }

  /**
   * Manisha 5/24 Q4 — bespoke angioedema resolution. Six actions, three with
   * special behavior:
   *  - ANGIO_UNABLE_TO_REACH (leavesAlertOpen): record action, keep OPEN so the
   *    existing compressed angioedema ladder (T0/T15M/T1H/T4H) keeps escalating.
   *  - ANGIO_ADVISED_ED with willGo=NO: airway emergency + patient refusing the
   *    ED → keep OPEN and fire an immediate Medical Director escalation.
   *  - ANGIO_ACE_DISCONTINUED: transactional — resolve the alert AND discontinue
   *    every active ACE_INHIBITOR/ARB med AND stamp the permanent
   *    PatientProfile.aceContraindicatedAt flag.
   * All other actions (CONFIRMED_ED, SEEN_IN_OFFICE, FALSE_ALARM) resolve
   * terminally with no side-effects (false alarm deliberately sets NO flag).
   */
  private async resolveAngioedema(
    alert: { id: string; userId: string; tier: string | null },
    actor: ActorUser,
    dto: {
      resolutionAction: ResolutionAction
      resolutionRationale?: string
      resolutionDetails?: Record<string, unknown>
    },
    actionDef: (typeof RESOLUTION_CATALOG)[ResolutionAction],
    resolutionDetails: Record<string, unknown> | null,
    now: Date,
    actorPracticeContext: string | null = null,
  ): Promise<{ status: string; resolvedAt: Date | null }> {
    const detailsData = resolutionDetails
      ? { resolutionDetails: resolutionDetails as Prisma.InputJsonValue }
      : {}

    // Case A — leave OPEN so the compressed ladder keeps running, OR the patient
    // declined the ED and we escalate the Medical Director immediately.
    const declinedEd = angioedemaPatientDeclinedEd(
      dto.resolutionAction,
      resolutionDetails,
    )
    if (actionDef.leavesAlertOpen || declinedEd) {
      await this.prisma.deviationAlert.update({
        where: { id: alert.id },
        data: {
          resolutionAction: dto.resolutionAction,
          resolutionRationale: dto.resolutionRationale ?? null,
          resolvedBy: actor.id,
          actorPracticeContext,
          ...detailsData,
        },
      })
      if (declinedEd) {
        await this.escalation.scheduleRetry({
          alertId: alert.id,
          userId: alert.userId,
          ladderStep: 'T0',
          offsetMs: 0,
          recipientRoles: ['MEDICAL_DIRECTOR'],
          channels: ['PUSH', 'DASHBOARD'],
          now,
          reason: 'Angioedema — patient declined ED; immediate Medical Director escalation',
          escalationLevel: 'LEVEL_2',
        })
        this.logger.warn(
          `Angioedema alert ${alert.id}: patient declined ED — MD escalated by ${actor.id}`,
        )
      } else {
        this.logger.log(
          `Angioedema alert ${alert.id} left OPEN (unable to reach) by ${actor.id}`,
        )
      }
      return { status: 'OPEN', resolvedAt: null }
    }

    // Case B — ACE/ARB discontinued: transactional resolve + med discontinue +
    // permanent contraindication flag.
    if (actionDef.discontinuesAceArb) {
      await this.prisma.$transaction([
        this.prisma.deviationAlert.update({
          where: { id: alert.id },
          data: {
            status: 'RESOLVED',
            resolvedAt: now,
            resolutionAction: dto.resolutionAction,
            resolutionRationale: dto.resolutionRationale ?? null,
            resolvedBy: actor.id,
            ...detailsData,
          },
        }),
        this.prisma.escalationEvent.updateMany({
          where: { alertId: alert.id, resolvedAt: null },
          data: { resolvedAt: now, resolvedBy: actor.id, actorPracticeContext },
        }),
        // #84 — discontinuing every live ACE/ARB here is a STRONGER outcome
        // than the PROVIDER_DIRECTED_HOLD retro-upgrade (discontinued meds drop
        // off the patient's med surfaces entirely), so this path already
        // satisfies the "no benign hold left behind" guarantee. The reusable
        // retroUpgradeAceArbHoldsForContraindication helper covers the paths
        // that set the flag WITHOUT discontinuing.
        this.prisma.patientMedication.updateMany({
          where: {
            userId: alert.userId,
            drugClass: { in: ['ACE_INHIBITOR', 'ARB'] },
            discontinuedAt: null,
          },
          data: { discontinuedAt: now },
        }),
        this.prisma.patientProfile.updateMany({
          where: { userId: alert.userId },
          data: {
            aceContraindicatedAt: now,
            aceContraindicationReason: `Angioedema (alert ${alert.id})`,
          },
        }),
      ])
      this.logger.warn(
        `Angioedema alert ${alert.id}: ACE/ARB discontinued + permanent contraindication flag set by ${actor.id}`,
      )
      await this.notifyAngioedemaPatient(alert, dto.resolutionAction)
      return { status: 'RESOLVED', resolvedAt: now }
    }

    // Case C — terminal resolve, no side-effects (CONFIRMED_ED, SEEN_IN_OFFICE,
    // FALSE_ALARM). False alarm deliberately sets NO contraindication flag.
    await this.prisma.deviationAlert.update({
      where: { id: alert.id },
      data: {
        status: 'RESOLVED',
        resolvedAt: now,
        resolutionAction: dto.resolutionAction,
        resolutionRationale: dto.resolutionRationale ?? null,
        resolvedBy: actor.id,
        ...detailsData,
      },
    })
    await this.prisma.escalationEvent.updateMany({
      where: { alertId: alert.id, resolvedAt: null },
      data: { resolvedAt: now, resolvedBy: actor.id, actorPracticeContext },
    })
    this.logger.log(
      `Angioedema alert ${alert.id} resolved by ${actor.id} via ${dto.resolutionAction}`,
    )
    await this.notifyAngioedemaPatient(alert, dto.resolutionAction)
    return { status: 'RESOLVED', resolvedAt: now }
  }

  /** Patient notification for a resolved angioedema alert (idempotent). */
  private async notifyAngioedemaPatient(
    alert: { id: string; userId: string },
    action: ResolutionAction,
  ): Promise<void> {
    const actionLabel =
      patientLabelForResolutionAction(action) ?? 'Action taken by your care team.'
    await this.prisma.notification
      .create({
        data: {
          userId: alert.userId,
          alertId: alert.id,
          channel: 'PUSH',
          title: 'Care team update',
          body: `Angioedema alert reviewed: ${actionLabel}`,
          tips: [],
        },
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string })?.code
        if (code !== 'P2002') throw err
      })
  }

  private shouldNotifyPatient(tier: string | null): boolean {
    return (
      tier === 'TIER_1_CONTRAINDICATION' ||
      tier === 'TIER_1_ANGIOEDEMA' ||
      tier === 'BP_LEVEL_2' ||
      tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
    )
  }

  private alertTypeLabelForNotification(tier: string | null): string {
    switch (tier) {
      case 'TIER_1_CONTRAINDICATION':
        return 'Medication alert reviewed'
      case 'TIER_1_ANGIOEDEMA':
        return 'Angioedema alert reviewed'
      case 'BP_LEVEL_2':
      case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
        return 'Blood pressure alert reviewed'
      default:
        return 'Alert reviewed'
    }
  }

  /**
   * Joint Commission NPSG.03.06.01 — 15-field audit trail per CLINICAL_SPEC
   * §V2-D. 13 fields auto-computed from DB state, 2 filled by the resolver.
   * Shape is the endpoint contract; keep stable once phase/11 wires the
   * admin UI.
   */
  async buildAuditPayload(alertId: string): Promise<AuditPayload> {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
      include: {
        escalationEvents: {
          orderBy: { triggeredAt: 'asc' },
          select: {
            id: true,
            ladderStep: true,
            triggeredAt: true,
            scheduledFor: true,
            notificationSentAt: true,
            recipientIds: true,
            recipientRoles: true,
            notificationChannel: true,
            afterHours: true,
            acknowledgedAt: true,
            acknowledgedBy: true,
            resolvedAt: true,
            resolvedBy: true,
            triggeredByResolution: true,
          },
        },
      },
    })
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`)

    const firstEscalation = alert.escalationEvents[0] ?? null
    const ackAt = alert.acknowledgedAt
    const resolvedAt = alert.escalationEvents.find((e) => e.resolvedAt)?.resolvedAt ?? null

    return {
      // Auto-populated (13) — CLINICAL_SPEC §V2-D audit-trail list
      alertId: alert.id,
      alertType: this.labelForTier(alert.tier),
      alertTrigger: alert.ruleId ?? null,
      patientId: alert.userId,
      alertGenerationTimestamp: alert.createdAt,
      escalationLevel: firstEscalation?.ladderStep ?? null,
      escalationTimestamp: firstEscalation?.triggeredAt ?? null,
      recipientsNotified: alert.escalationEvents.flatMap((e) => e.recipientIds),
      acknowledgmentTimestamp: ackAt,
      resolutionTimestamp: resolvedAt,
      timeToAcknowledgmentMs:
        ackAt ? ackAt.getTime() - alert.createdAt.getTime() : null,
      timeToResolutionMs:
        resolvedAt ? resolvedAt.getTime() - alert.createdAt.getTime() : null,
      escalationTriggered: alert.escalationEvents.length > 0,

      // Provider-input (2)
      resolutionAction: (alert.resolutionAction as ResolutionAction | null) ?? null,
      resolutionRationale: alert.resolutionRationale,

      // Extras — useful for dashboards, not required by spec
      escalationTimeline: alert.escalationEvents.map((e) => ({
        id: e.id,
        ladderStep: e.ladderStep,
        triggeredAt: e.triggeredAt,
        scheduledFor: e.scheduledFor,
        notificationSentAt: e.notificationSentAt,
        recipientIds: e.recipientIds,
        recipientRoles: e.recipientRoles,
        channel: e.notificationChannel,
        afterHours: e.afterHours,
        acknowledgedAt: e.acknowledgedAt,
        acknowledgedBy: e.acknowledgedBy,
        resolvedAt: e.resolvedAt,
        resolvedBy: e.resolvedBy,
        triggeredByResolution: e.triggeredByResolution,
      })),
    }
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async loadAlertOrThrow(alertId: string) {
    const alert = await this.prisma.deviationAlert.findUnique({
      where: { id: alertId },
    })
    if (!alert) throw new NotFoundException(`Alert ${alertId} not found`)
    return alert
  }

  private allowedGroupFor(
    tier: string | null,
  ): 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2' | 'TIER_1_ANGIOEDEMA' | null {
    switch (tier) {
      case 'TIER_1_CONTRAINDICATION':
        return 'TIER_1'
      // Manisha 5/24 Q4 — angioedema now has its own bespoke 6-option catalog
      // (auto-discontinue ACE/ARB, permanent contraindication flag, targeted
      // MD escalation, compressed re-escalation), no longer the generic Tier 1.
      case 'TIER_1_ANGIOEDEMA':
        return 'TIER_1_ANGIOEDEMA'
      case 'TIER_2_DISCREPANCY':
        return 'TIER_2'
      case 'BP_LEVEL_2':
      case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
        return 'BP_LEVEL_2'
      default:
        return null
    }
  }

  private labelForTier(tier: string | null): string | null {
    switch (tier) {
      case 'TIER_1_CONTRAINDICATION':
        return 'Tier 1 — Contraindication'
      case 'TIER_1_ANGIOEDEMA':
        return 'Tier 1 — Angioedema (airway emergency)'
      case 'TIER_2_DISCREPANCY':
        return 'Tier 2 — Discrepancy'
      case 'BP_LEVEL_2':
      case 'BP_LEVEL_2_SYMPTOM_OVERRIDE':
        return 'BP Level 2 — Emergency'
      case 'BP_LEVEL_1_HIGH':
        return 'BP Level 1 — High'
      case 'BP_LEVEL_1_LOW':
        return 'BP Level 1 — Low'
      case 'TIER_3_INFO':
        return 'Tier 3 — Informational'
      default:
        return null
    }
  }
}

/** Keep `_throwForbidden` out of line length golf in case future roles need it. */
export function throwForbiddenIfNotAdmin(roles: string[] | undefined): void {
  if (!roles || !roles.some((r) => r !== 'PATIENT')) {
    throw new ForbiddenException('Admin role required to resolve alerts')
  }
}

export interface AuditPayload {
  alertId: string
  alertType: string | null
  alertTrigger: string | null
  patientId: string
  alertGenerationTimestamp: Date
  escalationLevel: string | null
  escalationTimestamp: Date | null
  recipientsNotified: string[]
  acknowledgmentTimestamp: Date | null
  resolutionTimestamp: Date | null
  timeToAcknowledgmentMs: number | null
  timeToResolutionMs: number | null
  escalationTriggered: boolean
  resolutionAction: ResolutionAction | null
  resolutionRationale: string | null
  escalationTimeline: Array<{
    id: string
    ladderStep: string | null
    triggeredAt: Date
    scheduledFor: Date | null
    notificationSentAt: Date | null
    recipientIds: string[]
    recipientRoles: string[]
    channel: string | null
    afterHours: boolean
    acknowledgedAt: Date | null
    acknowledgedBy: string | null
    resolvedAt: Date | null
    resolvedBy: string | null
    triggeredByResolution: boolean
  }>
}
