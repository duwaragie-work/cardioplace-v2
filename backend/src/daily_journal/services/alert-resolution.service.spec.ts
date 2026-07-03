import { jest } from '@jest/globals'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { PatientAccessService } from '../../common/patient-access.service.js'
import { UserRole } from '../../generated/prisma/enums.js'
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
  // Actor wraps adminId + roles to match the May 2026 role-scope service
  // signature. SUPER_ADMIN short-circuits the access check so tests don't
  // need to set up assignment / practice membership mocks.
  const actor = { id: adminId, roles: [UserRole.SUPER_ADMIN] as UserRole[] }
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
      notification: {
        // Resolve handler fires a patient notification for Tier 1 + BP L2.
        // Mocked here so the resolve path doesn't crash on undefined.
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      // Manisha 5/24 Q4 — angioedema #3 side-effects run inside $transaction.
      patientMedication: {
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 1 }),
      },
      patientProfile: {
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 1 }),
      },
      // $transaction receives an array of prepared queries; resolve them all.
      $transaction: (jest.fn() as jest.Mock<any>).mockImplementation((ops: any) =>
        Array.isArray(ops) ? Promise.all(ops) : ops(prisma),
      ),
    }
    ;(prisma.deviationAlert.findUnique as jest.Mock<any>).mockResolvedValue(
      baseAlert,
    )

    escalation = {
      scheduleRetry: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined),
    }

    // PatientAccessService is no-op mocked: SUPER_ADMIN actor bypasses the
    // real implementation's scope lookup anyway, but a stub keeps the unit
    // tests isolated from PrismaService internals.
    const access = {
      assertCanAccessPatient: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlertResolutionService,
        { provide: PrismaService, useValue: prisma },
        { provide: EscalationService, useValue: escalation },
        { provide: PatientAccessService, useValue: access },
      ],
    }).compile()

    service = module.get(AlertResolutionService)
  })

  // ────────────────────────────────────────────────────────────────────────
  // acknowledge
  // ────────────────────────────────────────────────────────────────────────
  describe('acknowledge', () => {
    it('marks alert ACKNOWLEDGED + closes open escalation events', async () => {
      const r = await service.acknowledge(alertId, actor)
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

    // Phase/practice-identity (Manisha 2026-06-12 §1, HIPAA 45 CFR
    // §164.312(a)(2)(i)) — ack writes must capture WHICH practice the
    // actor was acting under, both on the DeviationAlert row and on the
    // EscalationEvent rows that get closed alongside.
    it('persists actorPracticeContext on DeviationAlert + EscalationEvent when ctx provided', async () => {
      await service.acknowledge(alertId, actor, { practiceId: 'p-bridge' })
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.objectContaining({ actorPracticeContext: 'p-bridge' }),
      })
      expect(prisma.escalationEvent.updateMany).toHaveBeenCalledWith({
        where: { alertId, acknowledgedAt: null, resolvedAt: null },
        data: expect.objectContaining({ actorPracticeContext: 'p-bridge' }),
      })
    })

    it('falls back to null actorPracticeContext when ctx omitted (org-wide actor)', async () => {
      await service.acknowledge(alertId, actor)
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.objectContaining({ actorPracticeContext: null }),
      })
    })

    it('idempotent on already-acknowledged alert', async () => {
      const prevAck = new Date('2026-04-22T11:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        acknowledgedAt: prevAck,
      })
      const r = await service.acknowledge(alertId, actor)
      expect(r.acknowledgedAt).toBe(prevAck)
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
    })

    it('rejects on RESOLVED alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        status: 'RESOLVED',
      })
      await expect(service.acknowledge(alertId, actor)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('404 on missing alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(null)
      await expect(service.acknowledge(alertId, actor)).rejects.toThrow(
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
        service.resolve(alertId, actor, {
          resolutionAction: 'TIER1_DISCONTINUED',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('Tier 1 WITH rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_CONTRAINDICATION',
      })
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'TIER1_DISCONTINUED',
        resolutionRationale: 'Patient switched to labetalol',
      })
      expect(r.status).toBe('RESOLVED')
    })

    it('terminal resolve writes resolvedAt + resolvedBy + action to DeviationAlert (JCAHO audit)', async () => {
      // Regression — original handler set status/resolvedBy/resolutionAction
      // but NOT resolvedAt, leaving the canonical alert-level timestamp blank
      // in the 15-field audit footer even though the EscalationEvent rows
      // carried it. Symmetric to the acknowledge handler.
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_CONTRAINDICATION',
      })
      await service.resolve(alertId, actor, {
        resolutionAction: 'TIER1_DISCONTINUED',
        resolutionRationale: 'Patient switched to labetalol',
      })
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolvedAt: expect.any(Date),
          resolvedBy: adminId,
          resolutionAction: 'TIER1_DISCONTINUED',
          resolutionRationale: 'Patient switched to labetalol',
        }),
      })
    })

    it('Tier 2 #1 (REVIEWED_NO_ACTION) no-rationale → 400', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      await expect(
        service.resolve(alertId, actor, {
          resolutionAction: 'TIER2_REVIEWED_NO_ACTION',
        }),
      ).rejects.toThrow(BadRequestException)
    })

    it('Tier 2 #2 (WILL_CONTACT) no-rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'TIER2_WILL_CONTACT',
      })
      expect(r.status).toBe('RESOLVED')
    })

    it('Tier 2 #3 (CHANGE_ORDERED) no-rationale → 200', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      const r = await service.resolve(alertId, actor, {
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
        service.resolve(alertId, actor, {
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
        service.resolve(alertId, actor, {
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
      const r = await service.resolve(alertId, actor, {
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
        service.resolve(alertId, actor, {
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

  // ────────────────────────────────────────────────────────────────────────
  // resolve — angioedema bespoke actions (Manisha 5/24 Q4)
  // ────────────────────────────────────────────────────────────────────────
  describe('resolve — angioedema (Q4)', () => {
    beforeEach(() => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_ANGIOEDEMA',
        ruleId: 'RULE_ACE_ANGIOEDEMA',
      })
    })

    it('rejects a generic Tier 1 action on an angioedema alert', async () => {
      await expect(
        service.resolve(alertId, actor, {
          resolutionAction: 'TIER1_DISCONTINUED',
          resolutionRationale: 'explanation here',
        }),
      ).rejects.toThrow(/not valid for alert tier/)
    })

    it('requires the willGo sub-field for ANGIO_ADVISED_ED', async () => {
      await expect(
        service.resolve(alertId, actor, {
          resolutionAction: 'ANGIO_ADVISED_ED',
          resolutionRationale: 'Told patient to go to ED',
        }),
      ).rejects.toThrow(/Missing required sub-fields/)
    })

    it('willGo=NO → leaves OPEN + fires immediate MD escalation', async () => {
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'ANGIO_ADVISED_ED',
        resolutionRationale: 'Patient refuses ED',
        resolutionDetails: { willGo: 'NO' },
      })
      expect(r.status).toBe('OPEN')
      expect(escalation.scheduleRetry).toHaveBeenCalledWith(
        expect.objectContaining({
          alertId,
          recipientRoles: ['MEDICAL_DIRECTOR'],
          offsetMs: 0,
        }),
      )
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.not.objectContaining({ status: 'RESOLVED' }),
      })
    })

    it('willGo=YES → resolves terminally, no MD escalation', async () => {
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'ANGIO_ADVISED_ED',
        resolutionRationale: 'Patient agreed to go',
        resolutionDetails: { willGo: 'YES' },
      })
      expect(r.status).toBe('RESOLVED')
      expect(escalation.scheduleRetry).not.toHaveBeenCalled()
    })

    it('ANGIO_ACE_DISCONTINUED → discontinues ACE/ARB meds + sets permanent contraindication flag', async () => {
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'ANGIO_ACE_DISCONTINUED',
        resolutionRationale: 'Stopped lisinopril after angioedema',
        resolutionDetails: { replacementOrdered: 'YES', replacementMed: 'amlodipine' },
      })
      expect(r.status).toBe('RESOLVED')
      expect(prisma.$transaction).toHaveBeenCalledTimes(1)
      expect(prisma.patientMedication.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          drugClass: { in: ['ACE_INHIBITOR', 'ARB'] },
          discontinuedAt: null,
        },
        data: { discontinuedAt: expect.any(Date) },
      })
      expect(prisma.patientProfile.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: expect.objectContaining({
          aceContraindicatedAt: expect.any(Date),
        }),
      })
    })

    it('ANGIO_FALSE_ALARM → resolves WITHOUT setting the contraindication flag', async () => {
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'ANGIO_FALSE_ALARM',
        resolutionRationale: 'Symptoms were from a food allergy',
        resolutionDetails: { actualCause: 'food allergy' },
      })
      expect(r.status).toBe('RESOLVED')
      expect(prisma.patientProfile.updateMany).not.toHaveBeenCalled()
      expect(prisma.patientMedication.updateMany).not.toHaveBeenCalled()
    })

    it('ANGIO_UNABLE_TO_REACH → leaves OPEN, no escalation scheduled (existing ladder runs)', async () => {
      const r = await service.resolve(alertId, actor, {
        resolutionAction: 'ANGIO_UNABLE_TO_REACH',
        resolutionRationale: 'No answer on two calls',
      })
      expect(r.status).toBe('OPEN')
      expect(escalation.scheduleRetry).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: alertId },
        data: expect.not.objectContaining({ status: 'RESOLVED' }),
      })
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // resolve — patient in-app notification kept-paths (Round 2 Group B)
  // ────────────────────────────────────────────────────────────────────────
  // Group B retired the patient in-app mirror on alert FIRE; admin-action
  // resolves on Tier 1 / BP L2 STILL write a patient Notification ("Care team
  // update"). These assertions pin that kept-path so a future refactor can't
  // accidentally drop it. Tier 2 is admin-only (shouldNotifyPatient returns
  // false) — we explicitly assert no patient notif fires there too.
  describe('resolve — patient in-app notification kept-paths (Round 2 B)', () => {
    it('Tier 1 contraindication resolve writes a patient PUSH Notification', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_1_CONTRAINDICATION',
      })
      await service.resolve(alertId, actor, {
        resolutionAction: 'TIER1_DISCONTINUED',
        resolutionRationale: 'Patient switched to labetalol',
      })
      expect(prisma.notification.create).toHaveBeenCalledTimes(1)
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: baseAlert.userId,
          alertId,
          channel: 'PUSH',
          title: 'Care team update',
          // Patient action notice → visible in the bell (NOT an ALERT_* trigger).
          dispatchTrigger: 'CARE_TEAM_UPDATE',
        }),
      })
    })

    it('BP Level 2 resolve writes a patient PUSH Notification', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'BP_LEVEL_2',
      })
      await service.resolve(alertId, actor, {
        resolutionAction: 'BP_L2_CONTACTED_MED_ADJUSTED',
        resolutionRationale: 'Increased lisinopril dose',
      })
      expect(prisma.notification.create).toHaveBeenCalledTimes(1)
      expect(prisma.notification.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: baseAlert.userId,
          channel: 'PUSH',
          title: 'Care team update',
          dispatchTrigger: 'CARE_TEAM_UPDATE',
        }),
      })
    })

    it('Tier 2 resolve does NOT write a patient notification (admin-only per §V2-C)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'TIER_2_DISCREPANCY',
      })
      await service.resolve(alertId, actor, {
        resolutionAction: 'TIER2_WILL_CONTACT',
      })
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('BP L2 retry (unable-to-reach) leaves alert OPEN + writes no patient notification', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        ...baseAlert,
        tier: 'BP_LEVEL_2',
      })
      await service.resolve(alertId, actor, {
        resolutionAction: 'BP_L2_UNABLE_TO_REACH_RETRY',
        resolutionRationale: 'Voicemail full',
      })
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })
  })
})
