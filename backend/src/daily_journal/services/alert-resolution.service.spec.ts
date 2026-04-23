import { jest } from '@jest/globals'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PrismaService } from '../../prisma/prisma.service.js'
import { AlertResolutionService } from './alert-resolution.service.js'
import { EscalationService } from './escalation.service.js'

// Phase/7 — covers the user-specified test surface items related to
// resolution: tier-compat + rationale validation (Tier 1 / Tier 2 #1 / Tier 2
// happy path), BP L2 #6 retry, audit payload shape (15 fields).

describe('AlertResolutionService', () => {
  let service: AlertResolutionService
  let prisma: Record<string, any>
  let escalation: { scheduleRetry: jest.Mock }

  const adminId = 'admin-1'
  const alertId = 'alert-1'
  const baseAlert = {
    id: alertId,
    userId: 'user-1',
    tier: 'TIER_1_CONTRAINDICATION',
    ruleId: 'RULE_PREGNANCY_ACE_ARB',
    status: 'OPEN',
    acknowledgedAt: null,
    resolutionAction: null,
    resolutionRationale: null,
    createdAt: new Date('2026-04-22T10:00:00Z'),
  }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        findUnique: jest.fn() as jest.Mock<any>,
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      escalationEvent: {
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
    }
    ;(prisma.deviationAlert.findUnique as jest.Mock<any>).mockResolvedValue(
      baseAlert,
    )

    escalation = {
      scheduleRetry: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertResolutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EscalationService, useValue: escalation },
      ],
    }).compile()

    service = module.get(AlertResolutionService)
  })

  // ────────────────────────────────────────────────────────────────────────
  // acknowledge
  // ────────────────────────────────────────────────────────────────────────
  describe('acknowledge', () => {
    it('marks alert ACKNOWLEDGED + closes open escalation events', async () => {
      const r = await service.acknowledge(alertId, adminId)
      expect(r.acknowledgedAt).toBeInstanceOf(Date)
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.objectContaining({ status: 'ACKNOWLEDGED' }),
      })
      expect(prisma.escalationEvent.updateMany).toHaveBeenCalledWith({
        where: { alertId, acknowledgedAt: null, resolvedAt: null },
        data: expect.objectContaining({ acknowledgedBy: adminId }),
      })
    })

    it('idempotent on already-acknowledged alert', async () => {
      const prevAck = new Date('2026-04-22T11:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        acknowledgedAt: prevAck,
      })
      const r = await service.acknowledge(alertId, adminId)
      expect(r.acknowledgedAt).toBe(prevAck)
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    })

    it('rejects on RESOLVED alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        status: 'RESOLVED',
      })
      await expect(service.acknowledge(alertId, adminId)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('404 on missing alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(null)
      await expect(service.acknowledge(alertId, adminId)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // resolve — rationale validation (user-specified tests)
  // ────────────────────────────────────────────────────────────────────────
  describe('resolve — rationale validation', () => {
    it('Tier 1 no-rationale → 400', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_CONTRAINDICATION',
      })
      await expect(
        service.resolve(alertId, adminId, {
          resolutionAction: 'TIER1_DISCONTINUED',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('Tier 1 WITH rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_CONTRAINDICATION',
      })
      const r = await service.resolve(alertId, adminId, {
        resolutionAction: 'TIER1_DISCONTINUED',
        resolutionRationale: 'Patient switched to labetalol',
      })
      expect(r.status).toBe('RESOLVED')
    })

    it('Tier 2 #1 (REVIEWED_NO_ACTION) no-rationale → 400', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      await expect(
        service.resolve(alertId, adminId, {
          resolutionAction: 'TIER2_REVIEWED_NO_ACTION',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('Tier 2 #2 (WILL_CONTACT) no-rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      const r = await service.resolve(alertId, adminId, {
        resolutionAction: 'TIER2_WILL_CONTACT',
      })
      expect(r.status).toBe('RESOLVED')
    })

    it('Tier 2 #3 (CHANGE_ORDERED) no-rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      const r = await service.resolve(alertId, adminId, {
        resolutionAction: 'TIER2_CHANGE_ORDERED',
      })
      expect(r.status).toBe('RESOLVED')
    })

    it('BP Level 2 no-rationale → 400', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'BP_LEVEL_2',
      })
      await expect(
        service.resolve(alertId, adminId, {
          resolutionAction: 'BP_L2_CONTACTED_MED_ADJUSTED',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('rejects tier-mismatched action (Tier 1 action on BP L2 alert)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'BP_LEVEL_2',
      })
      await expect(
        service.resolve(alertId, adminId, {
          resolutionAction: 'TIER1_DISCONTINUED',
          resolutionRationale: 'explanation here',
        }),
      ).rejects.toThrow(/not valid for alert tier/)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // resolve — BP L2 #6 retry (user-specified)
  // ────────────────────────────────────────────────────────────────────────
  describe('resolve — BP L2 #6 UNABLE_TO_REACH_RETRY', () => {
    beforeEach(() => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'BP_LEVEL_2',
      })
    })

    it('leaves alert OPEN + calls EscalationService.scheduleRetry', async () => {
      const r = await service.resolve(alertId, adminId, {
        resolutionAction: 'BP_L2_UNABLE_TO_REACH_RETRY',
        resolutionRationale: 'Phone unanswered, left voicemail',
      })
      expect(r.status).toBe('OPEN')
      expect(r.retryScheduledFor).toBeInstanceOf(Date)

      expect(escalation.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId,
          userId: 'user-1',
          ladderStep: 'T4H',
          offsetMs: 4 * 60 * 60 * 1000,
          recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
        }),
      )

      // Alert is NOT moved to RESOLVED.
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.not.objectContaining({ status: 'RESOLVED' }),
      })
    })

    it('still requires rationale', async () => {
      await expect(
        service.resolve(alertId, adminId, {
          resolutionAction: 'BP_L2_UNABLE_TO_REACH_RETRY',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // buildAuditPayload — 15-field contract (user-specified)
  // ────────────────────────────────────────────────────────────────────────
  describe('buildAuditPayload', () => {
    it('returns 13 auto-computed fields + 2 from resolution with time deltas', async () => {
      const t0 = new Date('2026-04-22T10:00:00Z')
      const ackAt = new Date('2026-04-22T10:30:00Z') // +30 min
      const resolvedAt = new Date('2026-04-22T12:00:00Z') // +2 h

      prisma.deviationAlert.findUnique.mockResolvedValue({
        id: alertId,
        userId: 'user-1',
        tier: 'TIER_1_CONTRAINDICATION',
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        createdAt: t0,
        acknowledgedAt: ackAt,
        resolutionAction: 'TIER1_DISCONTINUED',
        resolutionRationale: 'Switched to labetalol',
        escalationEvents: [
          {
            id: 'esc-1',
            ladderStep: 'T0',
            triggeredAt: t0,
            scheduledFor: null,
            notificationSentAt: t0,
            recipientIds: ['primary-1'],
            recipientRoles: ['PRIMARY_PROVIDER'],
            notificationChannel: 'PUSH',
            afterHours: false,
            acknowledgedAt: ackAt,
            acknowledgedBy: adminId,
            resolvedAt,
            resolvedBy: adminId,
            triggeredByResolution: false,
          },
          {
            id: 'esc-2',
            ladderStep: 'T0',
            triggeredAt: t0,
            scheduledFor: null,
            notificationSentAt: t0,
            recipientIds: ['backup-1'],
            recipientRoles: ['BACKUP_PROVIDER'],
            notificationChannel: 'PUSH',
            afterHours: false,
            acknowledgedAt: null,
            acknowledgedBy: null,
            resolvedAt: null,
            resolvedBy: null,
            triggeredByResolution: false,
          },
        ],
      })

      const payload = await service.buildAuditPayload(alertId)

      // Auto-populated 13 (per CLINICAL_SPEC §V2-D audit table)
      expect(payload.alertId).toBe(alertId)
      expect(payload.alertType).toBe('Tier 1 — Contraindication')
      expect(payload.alertTrigger).toBe('RULE_PREGNANCY_ACE_ARB')
      expect(payload.patientId).toBe('user-1')
      expect(payload.alertGenerationTimestamp).toBe(t0)
      expect(payload.escalationLevel).toBe('T0')
      expect(payload.escalationTimestamp).toBe(t0)
      expect(payload.recipientsNotified).toEqual(['primary-1', 'backup-1'])
      expect(payload.acknowledgmentTimestamp).toBe(ackAt)
      expect(payload.resolutionTimestamp).toEqual(resolvedAt)
      expect(payload.timeToAcknowledgmentMs).toBe(30 * 60 * 1000)
      expect(payload.timeToResolutionMs).toBe(2 * 60 * 60 * 1000)
      expect(payload.escalationTriggered).toBe(true)

      // Provider-input 2
      expect(payload.resolutionAction).toBe('TIER1_DISCONTINUED')
      expect(payload.resolutionRationale).toBe('Switched to labetalol')

      // Extra — escalation timeline
      expect(payload.escalationTimeline).toHaveLength(2)
    })

    it('unacknowledged alert: time deltas are null', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        id: alertId,
        userId: 'user-1',
        tier: 'TIER_1_CONTRAINDICATION',
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        createdAt: new Date('2026-04-22T10:00:00Z'),
        acknowledgedAt: null,
        resolutionAction: null,
        resolutionRationale: null,
        escalationEvents: [],
      })
      const payload = await service.buildAuditPayload(alertId)
      expect(payload.timeToAcknowledgmentMs).toBeNull()
      expect(payload.timeToResolutionMs).toBeNull()
      expect(payload.escalationTriggered).toBe(false)
    })

    it('404 on missing alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(null)
      await expect(service.buildAuditPayload(alertId)).rejects.toThrow(
        NotFoundException,
      )
    })
  })
})
