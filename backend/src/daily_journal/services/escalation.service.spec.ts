import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { EscalationService, escalationEmailBody } from './escalation.service.js'
import type { AlertCreatedEvent } from '../interfaces/events.interface.js'

// Phase/7 — EscalationService state-machine tests.
//
// Covers the user-specified test surface:
//   • Tier 3 / BP L1 pass through, no EscalationEvent rows
//   • Tier 1 T+0 dual-fire (primary + backup in separate rows)
//   • Tier 1 after-hours: primary queued, backup fires immediately
//   • Anchor correctness: Tier 1 at 10pm → T+0 queued 8am, T+4h at noon, T+8h at 4pm
//   • BP L2: dual-notify primary + backup at T+0, fires regardless of hours
//   • advanceOverdueLadders: resolved mid-ladder → cron skips
//   • advanceOverdueLadders: acknowledged stops the cron
//   • scheduleRetry creates T+4H EscalationEvent with triggeredByResolution=true
//   • Fail-loud when PRIMARY is missing
//   • HEALPLACE_OPS fan-out when assigned

// ─── fixtures ───────────────────────────────────────────────────────────────

const NY_PRACTICE = {
  name: 'Cedar Hill Internal Medicine',
  businessHoursStart: '08:00',
  businessHoursEnd: '18:00',
  businessHoursTimezone: 'America/New_York',
}

const ASSIGNMENT_FULL = {
  primaryProviderId: 'primary-1',
  backupProviderId: 'backup-1',
  medicalDirectorId: 'director-1',
  practice: NY_PRACTICE,
}

const READING_SAMPLE = {
  systolicBP: 165,
  diastolicBP: 102,
  pulse: 88,
  position: 'SITTING',
  measuredAt: new Date('2026-04-22T09:55:00Z'),
}

function buildAlert(over: Record<string, any> = {}) {
  return {
    id: 'alert-1',
    userId: 'patient-1',
    tier: 'TIER_1_CONTRAINDICATION',
    ruleId: 'RULE_PREGNANCY_ACE_ARB',
    mode: 'STANDARD',
    pulsePressure: 63,
    suboptimalMeasurement: false,
    status: 'OPEN',
    acknowledgedAt: null,
    createdAt: new Date('2026-04-22T10:00:00Z'), // Wed 06:00 NY — after-hours
    patientMessage: 'Call your provider today.',
    caregiverMessage: 'Patient needs provider review.',
    physicianMessage: 'Tier 1 — ACE/ARB in pregnancy.',
    user: {
      id: 'patient-1',
      name: 'Alan Smith',
      email: 'alan@example.com',
      dateOfBirth: new Date('1985-04-24T00:00:00Z'),
      // Layer B gate — default fixture is ENROLLED so every existing test
      // case exercises the happy path. Override to 'NOT_ENROLLED' to verify
      // the dispatch gate.
      enrollmentStatus: 'ENROLLED',
      providerAssignmentAsPatient: ASSIGNMENT_FULL,
    },
    journalEntry: READING_SAMPLE,
    ...over,
  }
}

function buildAlertCreatedPayload(
  over: Partial<AlertCreatedEvent> = {},
): AlertCreatedEvent {
  return {
    userId: 'patient-1',
    alertId: 'alert-1',
    type: 'MEDICATION_ADHERENCE',
    severity: 'HIGH',
    escalated: false,
    tier: 'TIER_1_CONTRAINDICATION',
    ruleId: 'RULE_PREGNANCY_ACE_ARB',
    ...over,
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('EscalationService', () => {
  let service: EscalationService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }
  let email: { sendEmail: jest.Mock }
  let createdEvents: Array<{ id: string; data: any }>

  beforeEach(async () => {
    createdEvents = []

    prisma = {
      deviationAlert: {
        findUnique: jest.fn() as jest.Mock<any>,
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      escalationEvent: {
        create: jest.fn() as jest.Mock<any>,
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'notif-1' }),
      },
      user: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          email: 'recipient@example.com',
        }),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
    }

    // Create stub auto-generates a stable id per call so tests can assert.
    ;(prisma.escalationEvent.create as jest.Mock<any>).mockImplementation(
      (args: any) => {
        const id = `esc-${createdEvents.length + 1}`
        createdEvents.push({ id, data: args.data })
        return Promise.resolve({ id, ...args.data })
      },
    )

    ;(prisma.deviationAlert.findUnique as jest.Mock<any>).mockResolvedValue(
      buildAlert(),
    )

    eventEmitter = { emit: jest.fn() }
    email = { sendEmail: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined) }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
        { provide: EmailService, useValue: email },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) =>
              key === 'ADMIN_BASE_URL'
                ? 'https://admin.cardioplaceai.com'
                : (fallback ?? undefined),
          },
        },
      ],
    }).compile()

    service = module.get(EscalationService)
  })

  // ────────────────────────────────────────────────────────────────────────
  // Tier routing
  // ────────────────────────────────────────────────────────────────────────
  describe('tier routing at T+0', () => {
    it('TIER_3_INFO → no EscalationEvent rows', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'TIER_3_INFO' }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'TIER_3_INFO' }),
      )
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    // Phase/23 — BP_LEVEL_1_HIGH and BP_LEVEL_1_LOW are now escalatable. The
    // detailed dispatch behavior (provider + patient T+0 fan-out, ladder
    // walk, ack-stops-ladder) lives in the dedicated `BP Level 1 dispatch`
    // describe block below; we only assert here that fireT0 routes them
    // through ladderForTier instead of dropping them.
    it('BP_LEVEL_1_HIGH → fires T+0 dispatch (was a no-op before phase/23)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_1_HIGH' }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_HIGH' }),
      )
      expect(prisma.escalationEvent.create).toHaveBeenCalled()
    })

    it('BP_LEVEL_1_LOW → fires T+0 dispatch (was a no-op before phase/23)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_1_LOW' }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_LOW' }),
      )
      expect(prisma.escalationEvent.create).toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Layer B — escalation dispatch gate
  //   The DeviationAlert row is already persisted by the rule engine; this
  //   gate only controls whether EscalationEvent rows + Notifications get
  //   written. Un-enrolled patients' alerts sit in the DB visible to admin
  //   but no provider is paged until the 4-piece enrollment gate is passed.
  // ────────────────────────────────────────────────────────────────────────
  describe('Layer B enrollment dispatch gate', () => {
    it('un-enrolled patient + escalatable tier → no EscalationEvent, no notifications', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({
          tier: 'TIER_1_CONTRAINDICATION',
          user: {
            id: 'patient-1',
            enrollmentStatus: 'NOT_ENROLLED',
            providerAssignmentAsPatient: ASSIGNMENT_FULL,
          },
        }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'TIER_1_CONTRAINDICATION' }),
      )
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
      expect(prisma.notification.create).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('un-enrolled patient + BP Level 2 emergency → still gated (patient 911 CTA is rendered client-side via GET /daily-journal/alerts)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({
          tier: 'BP_LEVEL_2',
          user: {
            id: 'patient-1',
            enrollmentStatus: 'NOT_ENROLLED',
            providerAssignmentAsPatient: ASSIGNMENT_FULL,
          },
        }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_2' }),
      )
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Tier 1 T+0 business-hours → primary only (no courtesy backup fire).
  // Backup enters properly at T+4h.
  // ────────────────────────────────────────────────────────────────────────
  describe('Tier 1 T+0 business hours', () => {
    const duringBusinessHours = buildAlert({
      createdAt: new Date('2026-04-22T14:00:00Z'), // Wed 10:00 NY — open
    })
    const businessHoursNow = new Date('2026-04-22T14:00:00Z')

    beforeEach(() => {
      prisma.deviationAlert.findUnique.mockResolvedValue(duringBusinessHours)
    })

    it('fires ONLY the primary row (no backup courtesy fire during business hours)', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), businessHoursNow)

      expect(createdEvents).toHaveLength(1)
      const only = createdEvents[0]
      expect(only.data.ladderStep).toBe('T0')
      expect(only.data.recipientRoles).toEqual(['PRIMARY_PROVIDER'])
    })

    it('emits ESCALATION_DISPATCHED once', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), businessHoursNow)
      const calls = eventEmitter.emit.mock.calls.filter(
        (c) => c[0] === JOURNAL_EVENTS.ESCALATION_DISPATCHED,
      )
      expect(calls).toHaveLength(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Tier 1 T+4h — primary reminder + backup notification (fix 1).
  // ────────────────────────────────────────────────────────────────────────
  describe('Tier 1 T+4h advance', () => {
    it('dispatches to BOTH PRIMARY_PROVIDER and BACKUP_PROVIDER (spec V2-D T+4h)', async () => {
      // Alert created 10am NY Mon (business hours); scan at 2:30pm NY Mon
      // (past 4h deadline) so the cron advances to T+4h.
      const alertCreatedAt = new Date('2026-04-20T14:00:00Z') // Mon 10:00 NY
      const scanAt = new Date('2026-04-20T18:30:00Z') // Mon 14:30 NY (> T+4h)
      const overdueAlert = buildAlert({ createdAt: alertCreatedAt })
      prisma.deviationAlert.findMany.mockResolvedValue([overdueAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === overdueAlert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: alertCreatedAt,
              scheduledFor: null,
              notificationSentAt: alertCreatedAt,
            },
          ])
        }
        return Promise.resolve([])
      })

      await service.runScan(scanAt)

      const t4 = createdEvents.find((e) => e.data.ladderStep === 'T4H')
      expect(t4).toBeDefined()
      expect(t4 && new Set(t4.data.recipientRoles)).toEqual(
        new Set(['PRIMARY_PROVIDER', 'BACKUP_PROVIDER']),
      )
      expect(t4 && new Set(t4.data.recipientIds)).toEqual(
        new Set(['primary-1', 'backup-1']),
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Tier 1 after-hours — anchor correctness (user-specified test)
  // ────────────────────────────────────────────────────────────────────────
  describe('Tier 1 after-hours anchor correctness', () => {
    // Monday 2026-04-20 22:00 NY = 2026-04-21 02:00 UTC (Mon 22:00 EDT)
    const ALERT_CREATED_AT = new Date('2026-04-21T02:00:00Z')
    const EXPECTED_T0_BUSINESS_OPEN = new Date('2026-04-21T12:00:00Z') // Tue 08:00 NY
    const EXPECTED_T4H_DEADLINE = new Date('2026-04-21T16:00:00Z') // 08:00 + 4h = Tue 12:00 NY
    const EXPECTED_T8H_DEADLINE = new Date('2026-04-21T20:00:00Z') // 08:00 + 8h = Tue 16:00 NY

    const afterHoursAlert = buildAlert({ createdAt: ALERT_CREATED_AT })

    beforeEach(() => {
      prisma.deviationAlert.findUnique.mockResolvedValue(afterHoursAlert)
    })

    it('T+0 primary queued for next business open (Tue 08:00 NY)', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), ALERT_CREATED_AT)

      const primary = createdEvents.find((e) =>
        e.data.recipientRoles.includes('PRIMARY_PROVIDER'),
      )
      expect(primary!.data.scheduledFor.toISOString()).toBe(
        EXPECTED_T0_BUSINESS_OPEN.toISOString(),
      )
      expect(primary!.data.afterHours).toBe(true)
      expect(primary!.data.notificationSentAt).toBeUndefined()
    })

    it('T+0 backup courtesy fires immediately (not queued)', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), ALERT_CREATED_AT)

      const backup = createdEvents.find((e) =>
        e.data.recipientRoles.includes('BACKUP_PROVIDER'),
      )
      expect(backup!.data.scheduledFor).toBeUndefined()
      expect(backup!.data.notificationSentAt).toEqual(expect.any(Date))
    })

    it('cron scan at 10:30am (before T+4h deadline 12:00) → does not advance', async () => {
      // Set up DB state post-T+0 dispatch (queued primary + dispatched backup)
      prisma.deviationAlert.findMany.mockResolvedValue([afterHoursAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === afterHoursAlert.id) {
          return Promise.resolve([
            // Queued primary
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: EXPECTED_T0_BUSINESS_OPEN,
              notificationSentAt: null,
            },
            // Dispatched backup
            {
              ladderStep: 'T0',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: null,
              notificationSentAt: ALERT_CREATED_AT,
            },
          ])
        }
        return Promise.resolve([])
      })

      // 10:30 NY Tuesday = 14:30 UTC
      const scanAt = new Date('2026-04-21T14:30:00Z')
      await service.runScan(scanAt)

      // Only the firePendingScheduled may have fired T+0 primary at business
      // open — but not T+4h (anchor=08:00, deadline=12:00, current 10:30 < 12:00).
      // Filter to non-T0 events created.
      const nonT0 = createdEvents.filter((e) => e.data.ladderStep !== 'T0')
      expect(nonT0).toHaveLength(0)
    })

    it('cron scan at 12:30pm (after T+4h deadline Tue 12:00 NY) → advances to T4H — key anchor-correctness assertion', async () => {
      // Simulate primary T+0 has since been dispatched at business open.
      prisma.deviationAlert.findMany.mockResolvedValue([afterHoursAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === afterHoursAlert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: EXPECTED_T0_BUSINESS_OPEN,
              notificationSentAt: EXPECTED_T0_BUSINESS_OPEN,
            },
            {
              ladderStep: 'T0',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: null,
              notificationSentAt: ALERT_CREATED_AT,
            },
          ])
        }
        return Promise.resolve([])
      })

      // 12:30 NY Tuesday = 16:30 UTC (30 min past T+4h deadline of Tue 12:00 NY)
      const scanAt = new Date('2026-04-21T16:30:00Z')
      await service.runScan(scanAt)

      const t4hEvents = createdEvents.filter(
        (e) => e.data.ladderStep === 'T4H',
      )
      expect(t4hEvents).toHaveLength(1)
    })

    it('confirms T+4H deadline does NOT follow alert.createdAt+4h (would fire 02:00 NY — middle of the night)', async () => {
      // createdAt+4h = Tue 02:00 NY. advanceOverdueLadders at Tue 02:30 NY
      // would — with the wrong anchor — fire T+4H at the worst possible time.
      // With the correct T+0 anchor (Tue 08:00 NY), T+4H deadline is 12:00 NY,
      // so a scan at 02:30 NY sees no deadline crossed and skips.
      prisma.deviationAlert.findMany.mockResolvedValue([afterHoursAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === afterHoursAlert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: EXPECTED_T0_BUSINESS_OPEN,
              notificationSentAt: null, // still queued at this moment
            },
            {
              ladderStep: 'T0',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: null,
              notificationSentAt: ALERT_CREATED_AT,
            },
          ])
        }
        return Promise.resolve([])
      })

      // Tue 02:30 NY = 06:30 UTC
      await service.runScan(new Date('2026-04-21T06:30:00Z'))
      const nonT0 = createdEvents.filter((e) => e.data.ladderStep !== 'T0')
      expect(nonT0).toHaveLength(0)
    })

    it('T+8H deadline follows anchor + 8h = Tue 16:00 NY', async () => {
      // Scan at 15:59 NY Tuesday = 19:59 UTC — before T+8H (Tue 16:00 NY = 20:00 UTC)
      prisma.deviationAlert.findMany.mockResolvedValue([afterHoursAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === afterHoursAlert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: ALERT_CREATED_AT,
              scheduledFor: EXPECTED_T0_BUSINESS_OPEN,
              notificationSentAt: EXPECTED_T0_BUSINESS_OPEN,
            },
            {
              ladderStep: 'T4H',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: EXPECTED_T4H_DEADLINE,
              scheduledFor: null,
              notificationSentAt: EXPECTED_T4H_DEADLINE,
            },
          ])
        }
        return Promise.resolve([])
      })
      await service.runScan(new Date('2026-04-21T19:59:00Z'))
      const t8hEvents = createdEvents.filter(
        (e) => e.data.ladderStep === 'T8H',
      )
      expect(t8hEvents).toHaveLength(0)

      // Now past deadline
      createdEvents.length = 0
      await service.runScan(new Date('2026-04-21T20:01:00Z'))
      const t8h = createdEvents.filter((e) => e.data.ladderStep === 'T8H')
      expect(t8h).toHaveLength(1)
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // BP Level 2 T+0 (dual-notify primary + backup + patient, fires regardless of hours)
  // ────────────────────────────────────────────────────────────────────────
  describe('BP Level 2 T+0', () => {
    it('fires immediately even after-hours with primary + backup + patient', async () => {
      const afterHoursBpL2 = buildAlert({
        tier: 'BP_LEVEL_2',
        createdAt: new Date('2026-04-21T02:00:00Z'), // Mon 22:00 NY
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(afterHoursBpL2)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_2' }),
      )

      // Only one T+0 event for BP L2 (no separate backup courtesy row).
      const t0 = createdEvents.filter((e) => e.data.ladderStep === 'T0')
      expect(t0).toHaveLength(1)

      expect(new Set(t0[0].data.recipientRoles)).toEqual(
        new Set(['PRIMARY_PROVIDER', 'BACKUP_PROVIDER', 'PATIENT']),
      )
      expect(new Set(t0[0].data.recipientIds)).toEqual(
        new Set(['primary-1', 'backup-1', 'patient-1']),
      )
      // Fires immediately (notificationSentAt set, no scheduledFor).
      expect(t0[0].data.notificationSentAt).toEqual(expect.any(Date))
      expect(t0[0].data.scheduledFor).toBeUndefined()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // BP Level 2 T+2h routing — absolute-emergency vs symptom-override variants
  // ────────────────────────────────────────────────────────────────────────
  describe('BP Level 2 T+2h recipient routing', () => {
    // Alert at Mon 10am NY (business hours — doesn't matter for BP L2 since
    // it's FIRE_IMMEDIATELY, but keeps anchor math simple).
    const t0Dispatch = new Date('2026-04-20T14:00:00Z')
    const scanPastT2h = new Date('2026-04-20T16:30:00Z') // Mon 12:30 NY, > T+2h

    function mockAlertAndLatestT0(alert: ReturnType<typeof buildAlert>) {
      prisma.deviationAlert.findMany.mockResolvedValue([alert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === alert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER', 'PATIENT'],
              triggeredAt: t0Dispatch,
              scheduledFor: null,
              notificationSentAt: t0Dispatch,
            },
          ])
        }
        return Promise.resolve([])
      })
    }

    it('BP_LEVEL_2 (no symptoms) T+2h → ONLY MEDICAL_DIRECTOR (no patient follow-up)', async () => {
      const alert = buildAlert({
        tier: 'BP_LEVEL_2',
        createdAt: t0Dispatch,
      })
      mockAlertAndLatestT0(alert)

      await service.runScan(scanPastT2h)

      const t2 = createdEvents.find((e) => e.data.ladderStep === 'T2H')
      expect(t2).toBeDefined()
      expect(t2?.data.recipientRoles).toEqual(['MEDICAL_DIRECTOR'])
      expect(t2?.data.recipientIds).toEqual(['director-1'])
      expect(t2?.data.recipientRoles).not.toContain('PATIENT')
    })

    it('BP_LEVEL_2_SYMPTOM_OVERRIDE T+2h → MEDICAL_DIRECTOR + PATIENT ("Have you called 911?")', async () => {
      const alert = buildAlert({
        tier: 'BP_LEVEL_2_SYMPTOM_OVERRIDE',
        createdAt: t0Dispatch,
      })
      mockAlertAndLatestT0(alert)

      await service.runScan(scanPastT2h)

      const t2 = createdEvents.find((e) => e.data.ladderStep === 'T2H')
      expect(t2).toBeDefined()
      expect(t2 && new Set(t2.data.recipientRoles)).toEqual(
        new Set(['MEDICAL_DIRECTOR', 'PATIENT']),
      )
      expect(t2 && new Set(t2.data.recipientIds)).toEqual(
        new Set(['director-1', 'patient-1']),
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // advanceOverdueLadders — resolved / acknowledged / retry
  // ────────────────────────────────────────────────────────────────────────
  describe('advanceOverdueLadders gating', () => {
    it('resolved mid-ladder: cron skips the alert entirely (not in OPEN filter)', async () => {
      // advanceOverdueLadders filters status=OPEN, so RESOLVED alerts never
      // reach the comparison. Verify by passing empty findMany.
      prisma.deviationAlert.findMany.mockResolvedValue([])
      await service.runScan(new Date('2026-04-22T20:00:00Z'))
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })

    it('acknowledged alert: cron skips (filtered by acknowledgedAt: null)', async () => {
      prisma.deviationAlert.findMany.mockResolvedValue([])
      await service.runScan(new Date())
      // findMany where clause includes acknowledgedAt: null — verify.
      expect(prisma.deviationAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            acknowledgedAt: null,
            status: 'OPEN',
          }),
        }),
      )
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // firePendingScheduled — resolved alert skip
  // ────────────────────────────────────────────────────────────────────────
  describe('firePendingScheduled gating', () => {
    it('RESOLVED alert → marks pending event sent with skip reason, no notifications', async () => {
      const pendingRow = {
        id: 'esc-pending',
        alertId: 'alert-1',
        userId: 'patient-1',
        ladderStep: 'T4H',
        recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
        triggeredByResolution: true,
        scheduledFor: new Date('2026-04-22T10:00:00Z'),
        notificationSentAt: null,
      }
      prisma.escalationEvent.findMany.mockResolvedValue([pendingRow])
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ status: 'RESOLVED' }),
      )

      await service.runScan(new Date('2026-04-22T10:30:00Z'))

      // Update marks it sent with a skip reason.
      expect(prisma.escalationEvent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'esc-pending' },
          data: expect.objectContaining({
            notificationSentAt: expect.any(Date),
            reason: expect.stringContaining('skipped'),
          }),
        }),
      )
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // scheduleRetry (BP L2 #6)
  // ────────────────────────────────────────────────────────────────────────
  describe('scheduleRetry', () => {
    it('creates T4H EscalationEvent with scheduledFor=now+offset + triggeredByResolution=true', async () => {
      const now = new Date('2026-04-22T14:00:00Z')
      await service.scheduleRetry({
        alertId: 'alert-1',
        userId: 'patient-1',
        ladderStep: 'T4H',
        offsetMs: 4 * 60 * 60 * 1000,
        recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
        channels: ['PUSH'],
        now,
      })

      expect(createdEvents).toHaveLength(1)
      const ev = createdEvents[0]
      expect(ev.data.ladderStep).toBe('T4H')
      expect(ev.data.triggeredByResolution).toBe(true)
      expect(ev.data.scheduledFor).toEqual(
        new Date('2026-04-22T18:00:00Z'), // +4h
      )
      expect(ev.data.recipientRoles).toEqual([
        'PRIMARY_PROVIDER',
        'BACKUP_PROVIDER',
      ])
      // notificationSentAt intentionally unset — cron picks it up later.
      expect(ev.data.notificationSentAt).toBeUndefined()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Fail-loud on missing required roles
  // ────────────────────────────────────────────────────────────────────────
  describe('missing required roles', () => {
    it('missing PRIMARY_PROVIDER → dispatch continues with partial + error reason', async () => {
      const brokenAssignment = {
        // No primaryProviderId — simulates a data-integrity bug.
        primaryProviderId: '',
        backupProviderId: 'backup-1',
        medicalDirectorId: 'director-1',
        practice: NY_PRACTICE,
      }
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({
          createdAt: new Date('2026-04-22T14:00:00Z'), // business hours
          user: {
            id: 'patient-1',
            enrollmentStatus: 'ENROLLED',
            providerAssignmentAsPatient: brokenAssignment,
          },
        }),
      )

      await service.handleAlertCreated(buildAlertCreatedPayload())

      const primary = createdEvents.find((e) =>
        (e.data.recipientRoles as string[]).includes('PRIMARY_PROVIDER') ||
        e.data.reason?.includes('PRIMARY_PROVIDER'),
      )
      // The primary row should carry the error suffix in its reason field —
      // recipientIds empty, notificationSentAt still set so cron doesn't retry.
      const firstRow = createdEvents[0]
      expect(firstRow.data.reason).toMatch(/DISPATCH ERROR/)
      expect(firstRow.data.reason).toMatch(/PRIMARY_PROVIDER/)
      expect(firstRow.data.recipientIds).toEqual([])
      // Primary row still gets an EscalationEvent created (audit preserved).
      expect(primary).toBeDefined()
    })

    it('HEALPLACE_OPS with no matching users → warn + empty recipients, no dispatch error', async () => {
      // Tier 1 T+24h calls HEALPLACE_OPS. Set up state so cron fires that step.
      const overdueAlert = buildAlert({
        createdAt: new Date('2026-04-20T14:00:00Z'), // >24h ago
      })
      prisma.deviationAlert.findMany.mockResolvedValue([overdueAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === overdueAlert.id) {
          const now = new Date('2026-04-20T14:00:00Z')
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: now,
              scheduledFor: null,
              notificationSentAt: now,
            },
            {
              ladderStep: 'T4H',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: new Date('2026-04-20T18:00:00Z'),
              scheduledFor: null,
              notificationSentAt: new Date('2026-04-20T18:00:00Z'),
            },
            {
              ladderStep: 'T8H',
              recipientRoles: ['MEDICAL_DIRECTOR'],
              triggeredAt: new Date('2026-04-20T22:00:00Z'),
              scheduledFor: null,
              notificationSentAt: new Date('2026-04-20T22:00:00Z'),
            },
          ])
        }
        return Promise.resolve([])
      })
      // No HEALPLACE_OPS users exist.
      prisma.user.findMany.mockResolvedValue([])

      // Scan well past T+24h (alert at 14:00 UTC Mon → T+24h anchor at same
      // since T+0 fired immediately; run at 14:30 Tue = past 24h deadline).
      await service.runScan(new Date('2026-04-21T14:30:00Z'))

      const t24h = createdEvents.find((e) => e.data.ladderStep === 'T24H')
      expect(t24h).toBeDefined()
      // No DISPATCH ERROR tag — HEALPLACE_OPS missing is soft.
      expect(t24h!.data.reason).not.toMatch(/DISPATCH ERROR/)
      expect(t24h!.data.recipientIds).toEqual([])
    })

    it('HEALPLACE_OPS fan-out: multiple users → all notified', async () => {
      prisma.user.findMany.mockResolvedValue([
        { id: 'ops-1' },
        { id: 'ops-2' },
      ])
      const overdueAlert = buildAlert({
        createdAt: new Date('2026-04-20T14:00:00Z'),
      })
      prisma.deviationAlert.findMany.mockResolvedValue([overdueAlert])
      prisma.escalationEvent.findMany.mockImplementation((args: any) => {
        if (args?.where?.alertId === overdueAlert.id) {
          return Promise.resolve([
            {
              ladderStep: 'T0',
              recipientRoles: ['PRIMARY_PROVIDER'],
              triggeredAt: new Date('2026-04-20T14:00:00Z'),
              scheduledFor: null,
              notificationSentAt: new Date('2026-04-20T14:00:00Z'),
            },
            {
              ladderStep: 'T4H',
              recipientRoles: ['BACKUP_PROVIDER'],
              triggeredAt: new Date('2026-04-20T18:00:00Z'),
              scheduledFor: null,
              notificationSentAt: new Date('2026-04-20T18:00:00Z'),
            },
            {
              ladderStep: 'T8H',
              recipientRoles: ['MEDICAL_DIRECTOR'],
              triggeredAt: new Date('2026-04-20T22:00:00Z'),
              scheduledFor: null,
              notificationSentAt: new Date('2026-04-20T22:00:00Z'),
            },
          ])
        }
        return Promise.resolve([])
      })

      await service.runScan(new Date('2026-04-21T14:30:00Z'))
      const t24h = createdEvents.find((e) => e.data.ladderStep === 'T24H')
      expect(t24h!.data.recipientIds).toEqual(['ops-1', 'ops-2'])
      expect(t24h!.data.recipientRoles).toEqual([
        'HEALPLACE_OPS',
        'HEALPLACE_OPS',
      ])
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // Email body content (phase/22) — verifies that escalation emails carry
  // patient identifiers, alert timestamp, BP reading, escalation step, and
  // a deep link to the admin dashboard. The previous template only carried
  // the alert message, which forced providers to log in and hunt for
  // context on every notification.
  // ────────────────────────────────────────────────────────────────────────
  describe('email body content', () => {
    it('Tier 1 T+0 to primary provider includes name, practice, BP reading, and dashboard link', async () => {
      // Business-hours dispatch so the email fires immediately — no queueing.
      const now = new Date('2026-04-22T15:00:00Z') // 11:00 NY, in hours
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ createdAt: now }),
      )
      ;(prisma.user.findUnique as jest.Mock<any>).mockResolvedValue({
        email: 'primary@example.com',
      })

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'TIER_1_CONTRAINDICATION' }),
        now,
      )

      expect(email.sendEmail).toHaveBeenCalled()
      const [to, subject, html] = email.sendEmail.mock.calls[0] as [
        string,
        string,
        string,
      ]
      expect(to).toBe('primary@example.com')
      // Subject — step + tier prefix + patient name + practice.
      expect(subject).toContain('T+0')
      expect(subject).toContain('TIER 1 CONTRAINDICATION')
      expect(subject).toContain('Alan Smith')
      expect(subject).toContain('Cedar Hill Internal Medicine')
      // Body — patient identifiers, BP reading, dashboard link, ack footer.
      expect(html).toContain('Alan Smith')
      expect(html).toContain('alan@example.com')
      expect(html).toContain('1985-04-24')
      expect(html).toMatch(/age 4[01]/) // 40 or 41 depending on now/dob math
      expect(html).toContain('Cedar Hill Internal Medicine')
      expect(html).toContain('165/102 mmHg')
      expect(html).toContain('pulse <strong>88</strong>')
      expect(html).toContain('Tier 1 — ACE/ARB in pregnancy.')
      expect(html).toContain(
        'https://admin.cardioplaceai.com/patients/patient-1?alert=alert-1',
      )
      expect(html).toContain('within 4 hours')
      // Detail richness — recipient role banner, alert metadata strip,
      // pulse pressure, position, alert + patient IDs in footer.
      expect(html).toContain('primary provider')
      expect(html).toContain('pulse pressure <strong>63</strong>')
      expect(html).toContain('(wide)') // pulsePressure 63 > 60
      expect(html).toContain('position <strong>SITTING</strong>')
      expect(html).toContain('Mode: <strong>STANDARD</strong>')
      expect(html).toContain('Rule: <strong>RULE_PREGNANCY_ACE_ARB</strong>')
      expect(html).toContain('Alert ID: alert-1')
      expect(html).toContain('Patient ID: patient-1')
    })

    it('renders the suboptimal-measurement banner when the alert flagged it', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ suboptimalMeasurement: true }) as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'Tier 1 — ACE/ARB in pregnancy.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(out.html).toContain('Suboptimal measurement conditions')
      expect(out.html).toMatch(/checklist item/i)
    })

    it('renders the after-hours explanation block when afterHours=true', () => {
      const out = escalationEmailBody({
        alert: buildAlert() as any,
        step: 'T0',
        role: 'BACKUP_PROVIDER',
        message: 'Tier 1 — ACE/ARB in pregnancy.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: true,
        now: new Date('2026-04-22T10:00:00Z'),
      })
      expect(out.html).toContain('After-hours dispatch')
      expect(out.html).toContain('queued for the next business window')
      expect(out.html).toContain('America/New_York')
      expect(out.html).toContain('backup provider')
    })

    it('renders practice-local timestamps in addition to UTC', () => {
      const out = escalationEmailBody({
        alert: buildAlert() as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'Tier 1 — ACE/ARB in pregnancy.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      // Both UTC and a practice-local rendering present.
      expect(out.html).toContain('2026-04-22T10:00:00.000Z') // alert.createdAt UTC
      expect(out.html).toMatch(/Apr 22, 2026/) // practice-local readable form
    })

    it('BP Level 2 T+0 carries the 2-hour acknowledgment footer', async () => {
      const now = new Date('2026-04-22T15:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({
          tier: 'BP_LEVEL_2',
          ruleId: 'RULE_ABSOLUTE_EMERGENCY',
          physicianMessage: 'BP Level 2 — 190/120 mmHg.',
          createdAt: now,
        }),
      )

      await service.handleAlertCreated(
        buildAlertCreatedPayload({
          tier: 'BP_LEVEL_2',
          ruleId: 'RULE_ABSOLUTE_EMERGENCY',
        }),
        now,
      )

      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      expect(emailCalls.length).toBeGreaterThan(0)
      const html = emailCalls[0][2]
      const subject = emailCalls[0][1]
      expect(subject).toContain('BP EMERGENCY')
      expect(html).toContain('within 2 hours')
      expect(html).toContain('Healplace ops will phone the practice')
      expect(html).toContain('BP Level 2 — 190/120 mmHg.')
    })

    it('after-hours Tier 1 backup courtesy fire flags "(after-hours queued)" in the body', async () => {
      // Default fixture's createdAt is 06:00 NY = after-hours.
      const afterHoursNow = new Date('2026-04-22T10:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue(buildAlert())

      await service.handleAlertCreated(
        buildAlertCreatedPayload(),
        afterHoursNow,
      )

      // Tier 1 after-hours: primary queued (no email yet) + backup courtesy
      // fire (email goes out with afterHours flag). The first call here is
      // the backup courtesy email.
      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      expect(emailCalls.length).toBeGreaterThan(0)
      const html = emailCalls[0][2]
      expect(html).toContain('after-hours queued')
    })

    it('escalationEmailBody renders friendly subject (no tier prefix) for PATIENT role', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ tier: 'BP_LEVEL_2' }) as any,
        step: 'T0',
        role: 'PATIENT',
        message: 'Your BP is 190/120. If you have chest pain, call 911 now.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(out.subject).toBe('Urgent Blood Pressure Alert — Cardioplace')
      expect(out.subject).not.toContain('TIER')
      expect(out.subject).not.toContain('T+0')
      expect(out.html).toContain(
        'Your BP is 190/120. If you have chest pain, call 911 now.',
      )
    })

    it('escalationEmailBody handles missing DOB gracefully', () => {
      const alert = buildAlert({
        user: {
          id: 'patient-1',
          name: 'Alan Smith',
          email: 'alan@example.com',
          dateOfBirth: null,
          enrollmentStatus: 'ENROLLED',
          providerAssignmentAsPatient: ASSIGNMENT_FULL,
        },
      })
      const out = escalationEmailBody({
        alert: alert as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'Tier 1 — ACE/ARB in pregnancy.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(out.html).toContain('(DOB unknown)')
      expect(out.html).toContain('age unknown')
    })

    it('escalationEmailBody handles missing practice gracefully', () => {
      const alert = buildAlert({
        user: {
          id: 'patient-1',
          name: 'Alan Smith',
          email: 'alan@example.com',
          dateOfBirth: new Date('1985-04-24T00:00:00Z'),
          enrollmentStatus: 'ENROLLED',
          providerAssignmentAsPatient: null,
        },
      })
      const out = escalationEmailBody({
        alert: alert as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'Tier 1 — ACE/ARB in pregnancy.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(out.html).toContain('(practice not assigned)')
      expect(out.subject).toContain('(practice not assigned)')
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // BP Level 1 dispatch (phase/23) — fixes the gap where stage-2 HTN /
  // hypotension alerts wrote a DeviationAlert row but no EscalationEvent or
  // Notification, leaving providers + patients with no out-of-app surface.
  // ────────────────────────────────────────────────────────────────────────
  describe('BP Level 1 dispatch', () => {
    function buildBpL1HighAlert(over: Record<string, any> = {}) {
      return buildAlert({
        tier: 'BP_LEVEL_1_HIGH',
        ruleId: 'RULE_PREGNANCY_L1_HIGH',
        physicianMessage:
          'BP Level 1 High — pregnancy SBP ≥140 / DBP ≥90: 148/94 mmHg. Assess for preeclampsia features.',
        patientMessage:
          'Your blood pressure is higher than the goal for your pregnancy. Please contact your care team today.',
        ...over,
      })
    }

    function buildBpL1Payload(
      over: Partial<AlertCreatedEvent> = {},
    ): AlertCreatedEvent {
      return buildAlertCreatedPayload({
        tier: 'BP_LEVEL_1_HIGH',
        ruleId: 'RULE_PREGNANCY_L1_HIGH',
        ...over,
      })
    }

    it('BP_LEVEL_1_HIGH T+0 in business hours fires PRIMARY (email+dashboard) AND PATIENT (push+dashboard)', async () => {
      const now = new Date('2026-04-22T15:00:00Z') // 11:00 NY business hours
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildBpL1HighAlert({ createdAt: now }),
      )

      await service.handleAlertCreated(buildBpL1Payload(), now)

      // Two EscalationEvent rows at T+0: one for the provider step, one for
      // the patient courtesy fire.
      expect(prisma.escalationEvent.create).toHaveBeenCalledTimes(2)
      const recipientRoles = createdEvents.map(
        (e) => e.data.recipientRoles as string[],
      )
      // Provider event has PRIMARY_PROVIDER, patient event has PATIENT.
      expect(recipientRoles.flat()).toEqual(
        expect.arrayContaining(['PRIMARY_PROVIDER', 'PATIENT']),
      )

      // Notification rows fan out per (recipient × channel).
      const notifChannels = (
        prisma.notification.create.mock.calls as Array<[{ data: any }]>
      ).map((c) => c[0].data.channel)
      expect(notifChannels).toEqual(
        expect.arrayContaining(['EMAIL', 'DASHBOARD', 'PUSH']),
      )

      // Provider email subject/body uses the new BP LEVEL 1 HIGH label.
      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      expect(emailCalls.length).toBeGreaterThan(0)
      const [, subject, html] = emailCalls[0]
      expect(subject).toContain('T+0')
      expect(subject).toContain('BP LEVEL 1 HIGH')
      expect(subject).toContain('Alan Smith')
      expect(html).toContain('within 24 hours')
      expect(html).toContain('148/94 mmHg')
    })

    it('BP_LEVEL_1_LOW uses the same ladder shape with HIGH→LOW label swap', async () => {
      const now = new Date('2026-04-22T15:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildBpL1HighAlert({
          tier: 'BP_LEVEL_1_LOW',
          ruleId: 'RULE_HFREF_LOW',
          createdAt: now,
          physicianMessage:
            'BP Level 1 Low — HFrEF SBP <85: 82/55 mmHg. Review GDMT titration.',
        }),
      )

      await service.handleAlertCreated(
        buildBpL1Payload({
          tier: 'BP_LEVEL_1_LOW',
          ruleId: 'RULE_HFREF_LOW',
        }),
        now,
      )

      expect(prisma.escalationEvent.create).toHaveBeenCalledTimes(2)
      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      const [, subject] = emailCalls[0]
      expect(subject).toContain('BP LEVEL 1 LOW')
    })

    it('after-hours: PRIMARY queued for next business window, PATIENT push fires immediately', async () => {
      // Default fixture's createdAt is 06:00 NY = after-hours.
      const afterHoursNow = new Date('2026-04-22T10:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue(buildBpL1HighAlert())

      await service.handleAlertCreated(buildBpL1Payload(), afterHoursNow)

      // Provider event is created but its scheduledFor is set to next
      // business open; patient event has notificationSentAt set (immediate).
      const events = createdEvents.map((e) => e.data)
      const providerEvent = events.find((e) =>
        (e.recipientRoles as string[]).includes('PRIMARY_PROVIDER'),
      )!
      const patientEvent = events.find((e) =>
        (e.recipientRoles as string[]).includes('PATIENT'),
      )!
      expect(providerEvent.scheduledFor).toBeTruthy()
      expect(providerEvent.notificationSentAt).toBeFalsy()
      expect(patientEvent.notificationSentAt).toBeTruthy()
    })

    it('Layer B enrollment gate suppresses BP L1 dispatch for un-enrolled patients', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildBpL1HighAlert({
          user: {
            id: 'patient-1',
            name: 'Alan Smith',
            email: 'alan@example.com',
            dateOfBirth: new Date('1985-04-24T00:00:00Z'),
            enrollmentStatus: 'NOT_ENROLLED',
            providerAssignmentAsPatient: ASSIGNMENT_FULL,
          },
        }),
      )

      await service.handleAlertCreated(buildBpL1Payload())

      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
      expect(prisma.notification.create).not.toHaveBeenCalled()
    })

    it('escalationEmailBody renders amber tier color + 24-hour ack footer for BP L1', () => {
      const out = escalationEmailBody({
        alert: buildBpL1HighAlert() as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'BP Level 1 High — pregnancy SBP ≥140 / DBP ≥90.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      // Amber palette (#b45309) drives the sidebar border + header label +
      // CTA button. (The wide-pulse-pressure inline tag uses red regardless
      // of tier — that's a clinical flag, not a tier signal.)
      expect(out.html).toContain('border-left:4px solid #b45309')
      expect(out.html).toContain('color:#b45309')
      expect(out.html).toContain('background:#b45309')
      expect(out.html).toContain('BP LEVEL 1 HIGH')
      expect(out.html).toContain('within 24 hours')
      expect(out.html).toContain('72 hours')
    })

    it('humanStep renders T72H and T7D with the canonical T+ prefix', () => {
      // Step display in the email subject pill — verifies the new helpers
      // didn't break either the existing or the new step IDs.
      const t72h = escalationEmailBody({
        alert: buildBpL1HighAlert() as any,
        step: 'T72H',
        role: 'MEDICAL_DIRECTOR',
        message: 'BP Level 1 High',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(t72h.subject).toContain('T+72h')

      const t7d = escalationEmailBody({
        alert: buildBpL1HighAlert() as any,
        step: 'T7D',
        role: 'HEALPLACE_OPS',
        message: 'BP Level 1 High',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(t7d.subject).toContain('T+7d')
    })

    // ────────────────────────────────────────────────────────────────────
    // Cron-driven ladder progression. The walk logic is shared with Tier 1
    // / Tier 2 / BP L2 (advanceOverdueLadders is tier-agnostic), so these
    // three tests verify that BP L1 alerts route through that machinery
    // correctly — picking the right next step from the BP L1 ladder, not
    // accidentally falling through to a different ladder's step IDs.
    // ────────────────────────────────────────────────────────────────────
    it('advanceOverdueLadders walks BP L1 from T+0 → T+24H → T+72H → T+7D', async () => {
      // Anchor alert at Tuesday 11:00 NY (15:00 UTC) — clean business hours
      // so QUEUE_UNTIL_BUSINESS_HOURS doesn't push the next-step deadlines
      // out into the next morning.
      const alertCreatedAt = new Date('2026-04-21T15:00:00Z')
      const overdueAlert = buildBpL1HighAlert({ createdAt: alertCreatedAt })

      prisma.deviationAlert.findUnique.mockResolvedValue(overdueAlert)
      prisma.deviationAlert.findMany.mockResolvedValue([overdueAlert])

      // Round 1 — alert is past T+24h with only the T+0 events on file.
      // The cron should create a T24H event addressed to PRIMARY+BACKUP.
      ;(prisma.escalationEvent.findMany as jest.Mock<any>).mockImplementation(
        (args: any) => {
          if (args?.where?.alertId === overdueAlert.id) {
            return Promise.resolve([
              {
                ladderStep: 'T0',
                recipientRoles: ['PRIMARY_PROVIDER'],
                triggeredAt: alertCreatedAt,
                scheduledFor: null,
                notificationSentAt: alertCreatedAt,
              },
              {
                ladderStep: 'T0',
                recipientRoles: ['PATIENT'],
                triggeredAt: alertCreatedAt,
                scheduledFor: null,
                notificationSentAt: alertCreatedAt,
              },
            ])
          }
          return Promise.resolve([])
        },
      )

      const t24Scan = new Date('2026-04-22T15:30:00Z') // T+0 + 24h30m
      await service.runScan(t24Scan)

      const t24 = createdEvents.find((e) => e.data.ladderStep === 'T24H')
      expect(t24).toBeDefined()
      expect(t24 && new Set(t24.data.recipientRoles)).toEqual(
        new Set(['PRIMARY_PROVIDER', 'BACKUP_PROVIDER']),
      )

      // Round 2 — pretend T+24H is now on the timeline; cron should walk
      // to T+72H (medical director).
      createdEvents.length = 0
      ;(prisma.escalationEvent.findMany as jest.Mock<any>).mockImplementation(
        (args: any) => {
          if (args?.where?.alertId === overdueAlert.id) {
            return Promise.resolve([
              {
                ladderStep: 'T0',
                recipientRoles: ['PRIMARY_PROVIDER'],
                triggeredAt: alertCreatedAt,
                scheduledFor: null,
                notificationSentAt: alertCreatedAt,
              },
              {
                ladderStep: 'T24H',
                recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
                triggeredAt: t24Scan,
                scheduledFor: null,
                notificationSentAt: t24Scan,
              },
            ])
          }
          return Promise.resolve([])
        },
      )

      const t72Scan = new Date('2026-04-24T15:30:00Z') // T+0 + 72h30m
      await service.runScan(t72Scan)

      const t72 = createdEvents.find((e) => e.data.ladderStep === 'T72H')
      expect(t72).toBeDefined()
      expect(t72 && t72.data.recipientRoles).toEqual(['MEDICAL_DIRECTOR'])

      // Round 3 — past T+7d; cron walks to T+7D (Healplace ops).
      createdEvents.length = 0
      ;(prisma.escalationEvent.findMany as jest.Mock<any>).mockImplementation(
        (args: any) => {
          if (args?.where?.alertId === overdueAlert.id) {
            return Promise.resolve([
              {
                ladderStep: 'T72H',
                recipientRoles: ['MEDICAL_DIRECTOR'],
                triggeredAt: t72Scan,
                scheduledFor: null,
                notificationSentAt: t72Scan,
              },
            ])
          }
          return Promise.resolve([])
        },
      )
      ;(prisma.user.findMany as jest.Mock<any>).mockResolvedValue([
        { id: 'ops-1' },
      ])

      const t7dScan = new Date('2026-04-28T16:00:00Z') // T+0 + 7d+1h
      await service.runScan(t7dScan)

      const t7d = createdEvents.find((e) => e.data.ladderStep === 'T7D')
      expect(t7d).toBeDefined()
      expect(t7d && t7d.data.recipientRoles).toEqual(['HEALPLACE_OPS'])
    })

    it('acknowledged BP L1 alert is filtered out of advanceOverdueLadders', async () => {
      // The cron's findMany clause excludes `acknowledgedAt != null`, so an
      // acked alert never reaches the ladder comparator. Verify the same
      // OPEN+unack filter applies regardless of tier.
      prisma.deviationAlert.findMany.mockResolvedValue([])
      await service.runScan(new Date('2026-04-22T20:00:00Z'))
      expect(prisma.deviationAlert.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            acknowledgedAt: null,
            status: 'OPEN',
          }),
        }),
      )
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })

    it('resolved BP L1 alert: cron skips, no T+24H ever fires', async () => {
      // Even if a stale pending event exists for a now-resolved BP L1
      // alert, the alert's status: 'OPEN' filter on findMany excludes it.
      prisma.deviationAlert.findMany.mockResolvedValue([])
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildBpL1HighAlert({ status: 'RESOLVED' }),
      )
      await service.runScan(new Date('2026-04-22T20:00:00Z'))
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })
  })
})
