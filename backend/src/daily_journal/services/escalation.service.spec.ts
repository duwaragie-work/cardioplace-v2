import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { SmsService } from '../../sms/sms.service.js'
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
        // F9/#82 — present so a regression that starts mutating the alert at
        // T+0 dispatch (e.g. rewriting physicianMessage / bumping updatedAt)
        // is detectable. The escalation path must NEVER write the alert row.
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
      },
      escalationEvent: {
        create: jest.fn() as jest.Mock<any>,
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
        // Bug 1 — dispatchStep's idempotency guard queries findFirst before
        // creating. Stateful against createdEvents so a re-run sees prior rows.
        findFirst: jest.fn() as jest.Mock<any>,
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

    // findFirst matches a previously-created event by alertId + ladderStep +
    // exact recipientRoles (Bug 1 dedup key). Returns null until one exists, so
    // the first dispatch of each recipient group proceeds unchanged.
    ;(prisma.escalationEvent.findFirst as jest.Mock<any>).mockImplementation(
      (args: any) => {
        const w = args?.where ?? {}
        const want = w.recipientRoles?.equals as string[] | undefined
        const match = createdEvents.find((e) => {
          if (w.alertId != null && e.data.alertId !== w.alertId) return false
          if (w.ladderStep != null && e.data.ladderStep !== w.ladderStep) return false
          if (want != null) {
            const got = (e.data.recipientRoles ?? []) as string[]
            if (got.length !== want.length || !got.every((r, i) => r === want[i])) {
              return false
            }
          }
          return true
        })
        return Promise.resolve(match ? { id: match.id } : null)
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
          provide: SmsService,
          useValue: { isConfigured: () => false, sendSms: jest.fn() },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback?: string) => {
              if (key === 'ADMIN_BASE_URL') return 'https://admin.cardioplaceai.com'
              if (key === 'PATIENT_BASE_URL') return 'https://app.cardioplaceai.com'
              return fallback ?? undefined
            },
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
  // Bug 1 — idempotent T+0 dispatch (duplicate-row regression)
  //   A reading that fires immediately and is later re-evaluated by the
  //   single-reading finalize (or the frontend 5-min timer racing the finalize
  //   cron) re-emits ALERT_CREATED. fireT0 must NOT write a second T0 row.
  // ────────────────────────────────────────────────────────────────────────
  describe('idempotent T+0 dispatch', () => {
    it('re-firing the same alert creates no second T0 EscalationEvent row', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_1_HIGH' }),
      )
      const payload = buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_HIGH' })

      await service.handleAlertCreated(payload)
      const t0AfterFirst = createdEvents.filter(
        (e) => e.data.ladderStep === 'T0',
      ).length
      expect(t0AfterFirst).toBeGreaterThan(0)

      // Second emit for the SAME alert — the duplicate-T0 bug. Now a no-op.
      await service.handleAlertCreated(payload)
      const t0AfterSecond = createdEvents.filter(
        (e) => e.data.ladderStep === 'T0',
      ).length
      expect(t0AfterSecond).toBe(t0AfterFirst)
    })

    it('exactly one T0 EscalationEvent per (alert, recipient set) across repeated evals', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_1_HIGH' }),
      )
      const payload = buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_HIGH' })

      // post-fire + finalize cron + frontend timer = up to 3 evaluations.
      await service.handleAlertCreated(payload)
      await service.handleAlertCreated(payload)
      await service.handleAlertCreated(payload)

      const t0 = createdEvents.filter((e) => e.data.ladderStep === 'T0')
      const keys = t0.map(
        (e) => `${e.data.alertId}|${(e.data.recipientRoles ?? []).join(',')}`,
      )
      // every (alert, recipient) combination appears exactly once
      expect(new Set(keys).size).toBe(keys.length)
    })

    // F9/#82 — the escalation T+0 dispatch reads the alert (findUnique) and
    // writes EscalationEvent + Notification rows, but must never write back to
    // the DeviationAlert itself. A write there would bump updatedAt and could
    // rewrite the immutable at-fire-time three-tier messages.
    it('T+0 dispatch does NOT write the DeviationAlert row (emergency)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_2', ruleId: 'RULE_ABSOLUTE_EMERGENCY' }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({
          tier: 'BP_LEVEL_2',
          ruleId: 'RULE_ABSOLUTE_EMERGENCY',
        }),
      )
      // It fired the ladder (proof the path ran)…
      expect(prisma.escalationEvent.create).toHaveBeenCalled()
      // …but never touched the alert record.
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
    })

    it('T+0 dispatch does NOT write the DeviationAlert row (adherence Tier 2)', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({
          tier: 'TIER_2_DISCREPANCY',
          ruleId: 'RULE_MEDICATION_MISSED',
        }),
      )
      await service.handleAlertCreated(
        buildAlertCreatedPayload({
          tier: 'TIER_2_DISCREPANCY',
          ruleId: 'RULE_MEDICATION_MISSED',
        }),
      )
      expect(prisma.deviationAlert.update).not.toHaveBeenCalled()
      expect(prisma.deviationAlert.updateMany).not.toHaveBeenCalled()
    })
  })

  // ────────────────────────────────────────────────────────────────────────
  // dispatchT0ForAlert — test-control deterministic T+0 driver (spec 22 G.4)
  //   Reconstructs the AlertCreatedEvent from the persisted alert and awaits
  //   the same fireT0 path, so a Playwright spec can guarantee the T+0
  //   Notification rows exist (the async @OnEvent handler can't be awaited).
  // ────────────────────────────────────────────────────────────────────────
  describe('dispatchT0ForAlert', () => {
    it('writes the patient PUSH Notification row for a BP_LEVEL_2 alert', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildAlert({ tier: 'BP_LEVEL_2', ruleId: 'RULE_ABSOLUTE_EMERGENCY' }),
      )

      await service.dispatchT0ForAlert('alert-1')

      // The patient (alert.userId) gets a PUSH row linked to the alert — the
      // exact row spec 22 asserts the write path produced (G.4 hides it from
      // the bell on the READ side, but the WRITE must happen).
      const patientPush = (prisma.notification.create as jest.Mock).mock.calls.find(
        ([arg]: [any]) =>
          arg?.data?.userId === 'patient-1' &&
          arg?.data?.channel === 'PUSH' &&
          arg?.data?.alertId === 'alert-1',
      )
      expect(patientPush).toBeDefined()
    })

    it('throws NotFoundException when the alert does not exist', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue(null)
      await expect(service.dispatchT0ForAlert('missing')).rejects.toThrow(
        /not found/i,
      )
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

    it('fires the primary provider row + D5 patient mirror, but NO backup courtesy fire during business hours', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), businessHoursNow)

      // D5 (Manisha 2026-06-06): TIER_1_CONTRAINDICATION now mirrors a patient
      // EMAIL row at T+0 alongside the provider step. Both are T0; neither
      // pages the BACKUP provider during business hours (backup enters at T+4h).
      const roles = createdEvents
        .map((e) => e.data.recipientRoles as string[])
        .flat()
      expect(roles).toContain('PRIMARY_PROVIDER')
      expect(roles).toContain('PATIENT')
      expect(roles).not.toContain('BACKUP_PROVIDER')
      expect(createdEvents.every((e) => e.data.ladderStep === 'T0')).toBe(true)
    })

    it('emits ESCALATION_DISPATCHED per dispatch — provider step + D5 patient mirror', async () => {
      await service.handleAlertCreated(buildAlertCreatedPayload(), businessHoursNow)
      const calls = eventEmitter.emit.mock.calls.filter(
        (c) => c[0] === JOURNAL_EVENTS.ESCALATION_DISPATCHED,
      )
      // ESCALATION_DISPATCHED fires after every successful dispatch, so the
      // provider step + the D5 patient EMAIL mirror = 2 emits.
      expect(calls).toHaveLength(2)
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

    it('F12 — BP Level 2 T+0 writes NO patient DASHBOARD bell row, but patient PUSH + provider DASHBOARD survive', async () => {
      const bpL2 = buildAlert({
        tier: 'BP_LEVEL_2',
        createdAt: new Date('2026-04-21T02:00:00Z'),
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(bpL2)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_2' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientNotifs = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1',
      )
      // No clinical alert mirrors into the patient bell.
      expect(
        patientNotifs.filter((c) => c[0].data.channel === 'DASHBOARD'),
      ).toHaveLength(0)
      // The out-of-app PUSH to the patient is preserved (emergency wake).
      expect(
        patientNotifs.some((c) => c[0].data.channel === 'PUSH'),
      ).toBe(true)
      // Providers still get their DASHBOARD (admin bell) rows.
      const providerDashboard = notifCalls.filter(
        (c) =>
          c[0].data.userId !== 'patient-1' && c[0].data.channel === 'DASHBOARD',
      )
      expect(providerDashboard.length).toBeGreaterThan(0)
    })

    // ──────────────────────────────────────────────────────────────────────
    // Manisha Open-Decisions sign-off 2026-06-06 — D5 (TIER_1_CONTRAINDICATION
    // patient email at T+0) + D6 (BP_LEVEL_1_HIGH patient email re-instated,
    // cohort-gated to STANDARD mode only; HIGH only, not LOW).
    // ──────────────────────────────────────────────────────────────────────
    it('D5 — TIER_1_CONTRAINDICATION T+0 writes a patient EMAIL row + sends the email', async () => {
      const alert = buildAlert({
        tier: 'TIER_1_CONTRAINDICATION',
        ruleId: 'RULE_PREGNANCY_ACE_ARB',
        patientMessage:
          'We noticed something about one of your medications. Your care team is reviewing and will contact you. Please don’t stop any medicine without talking to your doctor.',
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(alert)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'TIER_1_CONTRAINDICATION' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientEmailRows = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1' && c[0].data.channel === 'EMAIL',
      )
      // Patient gets the EMAIL row (no in-app bell DASHBOARD row — F12 filter).
      expect(patientEmailRows.length).toBeGreaterThan(0)
      // Real send went out — Manisha's whole point of D5: close the
      // "continued exposure before they open the app" gap.
      expect(email.sendEmail).toHaveBeenCalled()
    })

    it('D6 — BP_LEVEL_1_HIGH + STANDARD mode T+0 writes patient EMAIL row + sends', async () => {
      const alert = buildAlert({
        tier: 'BP_LEVEL_1_HIGH',
        mode: 'STANDARD',
        ruleId: 'RULE_STANDARD_L1_HIGH',
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(alert)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_HIGH' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientEmailRows = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1' && c[0].data.channel === 'EMAIL',
      )
      expect(patientEmailRows.length).toBeGreaterThan(0)
      expect(email.sendEmail).toHaveBeenCalled()
    })

    it('D6 — BP_LEVEL_1_HIGH + PERSONALIZED mode T+0 writes NO patient EMAIL (alarm-fatigue guard)', async () => {
      const alert = buildAlert({
        tier: 'BP_LEVEL_1_HIGH',
        mode: 'PERSONALIZED',
        ruleId: 'RULE_HFREF_HIGH',
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(alert)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_HIGH' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientEmailRows = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1' && c[0].data.channel === 'EMAIL',
      )
      // Personalized cohort (HFrEF/HCM) is on tighter thresholds; suppressing
      // the patient email avoids alarm fatigue per Manisha 2026-06-06.
      expect(patientEmailRows).toHaveLength(0)
    })

    it('D6 — BP_LEVEL_1_LOW + STANDARD mode T+0 writes NO patient EMAIL (HIGH-only sign-off)', async () => {
      const alert = buildAlert({
        tier: 'BP_LEVEL_1_LOW',
        mode: 'STANDARD',
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(alert)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_1_LOW' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientEmailRows = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1' && c[0].data.channel === 'EMAIL',
      )
      // Manisha's D6 sign-off is HIGH-specific (severe Stage 2 reading at
      // 165/100). LOW alerts retain the previous suppression.
      expect(patientEmailRows).toHaveLength(0)
    })

    it('G.4 — read-side filter does NOT touch the write/email path: patient PUSH + EMAIL rows still written + patient email still SENT', async () => {
      const bpL2 = buildAlert({
        tier: 'BP_LEVEL_2',
        createdAt: new Date('2026-04-21T02:00:00Z'),
      })
      prisma.deviationAlert.findUnique.mockResolvedValue(bpL2)

      await service.handleAlertCreated(
        buildAlertCreatedPayload({ tier: 'BP_LEVEL_2' }),
      )

      const notifCalls = prisma.notification.create.mock.calls as Array<
        [{ data: { userId: string; channel: string } }]
      >
      const patientNotifs = notifCalls.filter(
        (c) => c[0].data.userId === 'patient-1',
      )
      // G.4 is READ-SIDE ONLY — the write path is unchanged. The PUSH row is
      // still WRITTEN (the bell query hides it); the EMAIL row is still WRITTEN.
      expect(patientNotifs.some((c) => c[0].data.channel === 'PUSH')).toBe(true)
      expect(patientNotifs.some((c) => c[0].data.channel === 'EMAIL')).toBe(true)
      // And the real Resend email STILL dispatches (the regression lock — the
      // read filter must never suppress the actual patient email send).
      expect(email.sendEmail).toHaveBeenCalled()
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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

    // Manisha Open-Decisions sign-off 2026-06-06 (Decision 5) — calm,
    // care-team-led subject. Pairs with the registry patientMessage's
    // "please don't stop any medicine without talking to your doctor".
    it('escalationEmailBody renders Manisha contraindication subject for TIER_1_CONTRAINDICATION patient email', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ tier: 'TIER_1_CONTRAINDICATION' }) as any,
        step: 'T0',
        role: 'PATIENT',
        message:
          'We noticed something about one of your medications. Your care team is reviewing and will contact you. Please don’t stop any medicine without talking to your doctor.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        patientBaseUrl: 'https://app.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-06-06T15:00:00Z'),
      })
      expect(out.subject).toBe(
        'Important medication alert from your care team — Cardioplace',
      )
      expect(out.html).toContain('Please don’t stop any medicine')
    })

    // Manisha Open-Decisions sign-off 2026-06-06 (Decision 6) — patient
    // email subject for the cohort-gated BP_LEVEL_1_HIGH re-instatement
    // (standard cohort only). Informative without alarming.
    it('escalationEmailBody renders informational subject for BP_LEVEL_1_HIGH patient email', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ tier: 'BP_LEVEL_1_HIGH' }) as any,
        step: 'T0',
        role: 'PATIENT',
        message: 'Your blood pressure is higher than your target.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        patientBaseUrl: 'https://app.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-06-06T15:00:00Z'),
      })
      expect(out.subject).toBe(
        'Your recent blood pressure reading — Cardioplace',
      )
      expect(out.subject).not.toMatch(/urgent/i)
    })

    it('escalationEmailBody routes PATIENT recipients to the patient app /alerts/{id} URL', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ tier: 'BP_LEVEL_2' }) as any,
        step: 'T0',
        role: 'PATIENT',
        message: 'Your BP is 190/120.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        patientBaseUrl: 'https://app.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      // Patient gets the patient-app URL and the patient-flavored CTA label.
      expect(out.html).toContain('https://app.cardioplaceai.com/alerts/alert-1')
      expect(out.html).toContain('View your alert')
      // Crucially — does NOT include the admin-app URL anywhere.
      expect(out.html).not.toContain('https://admin.cardioplaceai.com')
      expect(out.html).not.toContain('/patients/patient-1')
    })

    it('escalationEmailBody routes provider recipients to the admin app /patients/{id}?alert={id} URL', () => {
      const out = escalationEmailBody({
        alert: buildAlert({ tier: 'BP_LEVEL_2' }) as any,
        step: 'T0',
        role: 'PRIMARY_PROVIDER',
        message: 'BP Level 2 — 190/120 mmHg.',
        adminBaseUrl: 'https://admin.cardioplaceai.com',
        patientBaseUrl: 'https://app.cardioplaceai.com',
        afterHours: false,
        now: new Date('2026-04-22T15:00:00Z'),
      })
      expect(out.html).toContain(
        'https://admin.cardioplaceai.com/patients/patient-1?alert=alert-1',
      )
      expect(out.html).toContain('View in dashboard')
      // Provider should NOT see the patient-app URL.
      expect(out.html).not.toContain('https://app.cardioplaceai.com')
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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

    // D6 (Manisha sign-off 2026-06-06) — BP Level 1 patient EMAIL mirror is
    // RE-INSTATED, cohort-gated to BP_LEVEL_1_HIGH + STANDARD mode. The provider
    // ladder (PRIMARY email + dashboard) fires unchanged; the patient now also
    // receives an out-of-app EMAIL (BP_LEVEL_1_PATIENT_T0) at T+0.

    it('BP_LEVEL_1_HIGH + STANDARD T+0 in business hours fires PRIMARY (email+dashboard) + D6 patient EMAIL mirror', async () => {
      const now = new Date('2026-04-22T15:00:00Z') // 11:00 NY business hours
      prisma.deviationAlert.findUnique.mockResolvedValue(
        buildBpL1HighAlert({ createdAt: now }),
      )

      await service.handleAlertCreated(buildBpL1Payload(), now)

      // Two EscalationEvent rows at T+0: the provider step + the D6-reinstated
      // patient EMAIL mirror (cohort-gated to BP_LEVEL_1_HIGH + STANDARD).
      expect(prisma.escalationEvent.create).toHaveBeenCalledTimes(2)
      const recipientRoles = createdEvents.map(
        (e) => e.data.recipientRoles as string[],
      )
      expect(recipientRoles.flat()).toEqual(
        expect.arrayContaining(['PRIMARY_PROVIDER', 'PATIENT']),
      )

      // Provider notifications fan out (EMAIL + DASHBOARD); the patient mirror
      // is EMAIL-only (no in-app DASHBOARD bell row — F12 filter).
      const notifCalls = prisma.notification.create.mock.calls as Array<[{ data: any }]>
      const notifChannels = notifCalls.map((c) => c[0].data.channel)
      expect(notifChannels).toEqual(
        expect.arrayContaining(['EMAIL', 'DASHBOARD']),
      )
      const patientUserId = (buildBpL1HighAlert().user as any).id
      const patientWrites = notifCalls.filter((c) => c[0].data.userId === patientUserId)
      expect(patientWrites.length).toBeGreaterThan(0)
      expect(patientWrites.every((c) => c[0].data.channel === 'EMAIL')).toBe(true)

      // Provider email subject/body uses the BP LEVEL 1 HIGH label.
      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      const providerEmail = emailCalls.find(
        ([, subject]) =>
          subject.includes('BP LEVEL 1 HIGH') && subject.includes('Alan Smith'),
      )
      expect(providerEmail).toBeTruthy()
      const [, subject, html] = providerEmail!
      expect(subject).toContain('T+0')
      expect(subject).toContain('BP LEVEL 1 HIGH')
      expect(subject).toContain('Alan Smith')
      expect(html).toContain('within 24 hours')
      expect(html).toContain('148/94 mmHg')
    })

    it('BP_LEVEL_1_LOW uses the same provider ladder shape with HIGH→LOW label swap (no patient mirror)', async () => {
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

      expect(prisma.escalationEvent.create).toHaveBeenCalledTimes(1)
      const emailCalls = email.sendEmail.mock.calls as Array<
        [string, string, string]
      >
      const [, subject] = emailCalls[0]
      expect(subject).toContain('BP LEVEL 1 LOW')
    })

    it('after-hours: PRIMARY queued for next business window; D6 patient EMAIL fires immediately', async () => {
      // Default fixture's createdAt is 06:00 NY = after-hours.
      const afterHoursNow = new Date('2026-04-22T10:00:00Z')
      prisma.deviationAlert.findUnique.mockResolvedValue(buildBpL1HighAlert())

      await service.handleAlertCreated(buildBpL1Payload(), afterHoursNow)

      // Two T+0 rows. The provider step is queued (scheduledFor set,
      // notificationSentAt null) for the next business window. The D6 patient
      // EMAIL mirror is FIRE_IMMEDIATELY (out-of-app reach doesn't wait for
      // business hours), so it dispatches now (notificationSentAt set).
      expect(createdEvents).toHaveLength(2)
      const providerEvent = createdEvents.find((e) =>
        (e.data.recipientRoles as string[]).includes('PRIMARY_PROVIDER'),
      )!.data
      expect(providerEvent.scheduledFor).toBeTruthy()
      expect(providerEvent.notificationSentAt).toBeFalsy()
      const patientEvent = createdEvents.find((e) =>
        (e.data.recipientRoles as string[]).includes('PATIENT'),
      )!.data
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
        patientBaseUrl: 'https://app.cardioplaceai.com',
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
