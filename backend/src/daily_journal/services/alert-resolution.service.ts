import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  RESOLUTION_CATALOG,
  type ResolutionAction,
} from '../escalation/resolution-actions.js'
import { EscalationService } from './escalation.service.js'

/**
 * Phase/7 AlertResolutionService — business logic for the three admin
 * endpoints exposed by AlertResolutionController:
 *
 *  - acknowledge(alertId, adminId) — stops the cron scanner from advancing.
 *  - resolve(alertId, adminId, dto) — terminal state. Writes resolution
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
  ) {}

  async acknowledge(alertId: string, adminId: string): Promise<{ acknowledgedAt: Date }> {
    const alert = await this.loadAlertOrThrow(alertId)
    if (alert.status === 'RESOLVED') {
      throw new BadRequestException('Alert is already resolved')
    }
    if (alert.acknowledgedAt) {
      return { acknowledgedAt: alert.acknowledgedAt }
    }
    const now = new Date()
    await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: now,
      },
    })
    // Mark open escalation events acknowledged so the cron skips them.
    await this.prisma.escalationEvent.updateMany({
      where: { alertId, acknowledgedAt: null, resolvedAt: null },
      data: { acknowledgedAt: now, acknowledgedBy: adminId },
    })
    this.logger.log(`Alert ${alertId} acknowledged by ${adminId}`)
    return { acknowledgedAt: now }
  }

  async resolve(
    alertId: string,
    adminId: string,
    dto: { resolutionAction: ResolutionAction; resolutionRationale?: string },
  ): Promise<{ status: string; resolvedAt: Date | null; retryScheduledFor?: Date }> {
    const alert = await this.loadAlertOrThrow(alertId)
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

    const now = new Date()

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
          resolvedBy: adminId,
        },
      })
      const retryScheduledFor = new Date(
        now.getTime() + AlertResolutionService.BP_L2_RETRY_OFFSET_MS,
      )
      this.logger.log(
        `Alert ${alertId} BP L2 retry scheduled for ${retryScheduledFor.toISOString()} by ${adminId}`,
      )
      return { status: 'OPEN', resolvedAt: null, retryScheduledFor }
    }

    // 4. Terminal resolution — mark resolved + close open escalation rows.
    await this.prisma.deviationAlert.update({
      where: { id: alertId },
      data: {
        status: 'RESOLVED',
        resolutionAction: dto.resolutionAction,
        resolutionRationale: dto.resolutionRationale ?? null,
        resolvedBy: adminId,
        acknowledgedAt: alert.acknowledgedAt ?? now,
      },
    })
    await this.prisma.escalationEvent.updateMany({
      where: { alertId, resolvedAt: null },
      data: { resolvedAt: now, resolvedBy: adminId },
    })
    this.logger.log(
      `Alert ${alertId} resolved by ${adminId} via ${dto.resolutionAction}`,
    )
    return { status: 'RESOLVED', resolvedAt: now }
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
  ): 'TIER_1' | 'TIER_2' | 'BP_LEVEL_2' | null {
    switch (tier) {
      case 'TIER_1_CONTRAINDICATION':
        return 'TIER_1'
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
