import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ConfigService } from '@nestjs/config'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { ClsService } from 'nestjs-cls'
import { PrismaService } from '../../prisma/prisma.service.js'
import { EmailService } from '../../email/email.service.js'
import { SmsService } from '../../sms/sms.service.js'
import { EscalationService } from './escalation.service.js'
import type { AlertCreatedEvent } from '../interfaces/events.interface.js'
import { EncryptionService } from '../../common/encryption.service.js'
import { encryptionMock } from '../../common/test/encryption.mock.js'

// Gap 5 — caregiver dispatch unit coverage.
//
// Surface:
//   • flag OFF → no dispatch
//   • non-caregiver-routed rule → no dispatch
//   • flag ON + consented EMAIL caregiver → EmailService.sendEmail once with
//     ONLY the caregiverMessage (Minimum Necessary)
//   • idempotency — CaregiverDispatchLog.createMany count 0 → no send
//   • SMS caregiver routes to SmsService (noop throws, caught — no crash)
//   • DASHBOARD account caregiver → Notification.create
//   • consent gate enforced at the query (findCaregivers filters
//     consentGivenAt != null) — asserted via the where clause
//
// We use a Tier-3 caregiver-routed rule (RULE_HF_CAREGIVER_EDEMA) so fireT0
// exits early (Tier 3 has no ladder) and only the caregiver path runs.

function caregiverPayload(
  over: Partial<AlertCreatedEvent> = {},
): AlertCreatedEvent {
  // Tier-3 caregiver-only alerts have null type/severity at the DB layer.
  // The AlertCreatedEvent interface declares both as `string` (non-null),
  // which is a separate interface-vs-runtime drift not in scope for this
  // test — cast through `unknown` to preserve the intended fixture shape.
  return {
    userId: 'patient-1',
    alertId: 'alert-cg-1',
    type: null as unknown as string,
    severity: null as unknown as string,
    escalated: false,
    tier: 'TIER_3_INFO',
    ruleId: 'RULE_HF_CAREGIVER_EDEMA',
    ...over,
  }
}

function alertRow(over: Record<string, any> = {}) {
  return {
    id: 'alert-cg-1',
    userId: 'patient-1',
    tier: 'TIER_3_INFO',
    ruleId: 'RULE_HF_CAREGIVER_EDEMA',
    caregiverMessage: 'Alan reported new ankle swelling — please weigh them today.',
    patientMessage: '',
    physicianMessage: 'Tier 3 — HF + edema.',
    user: { id: 'patient-1', name: 'Alan', providerAssignmentAsPatient: null },
    journalEntry: { measuredAt: new Date() },
    ...over,
  }
}

function emailCaregiver(over: Record<string, any> = {}) {
  return {
    id: 'cg-1',
    name: 'Dana',
    email: 'dana@example.com',
    phone: null,
    caregiverUserId: null,
    notifyChannel: 'EMAIL',
    ...over,
  }
}

describe('EscalationService — caregiver dispatch (Gap 5)', () => {
  let service: EscalationService
  let prisma: Record<string, any>
  let email: { sendEmail: jest.Mock }
  let sms: { isConfigured: jest.Mock; sendSms: jest.Mock }
  const ORIGINAL_FLAG = process.env.CAREGIVER_DISPATCH_ENABLED

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue(alertRow()),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      escalationEvent: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'e1' }),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
        updateMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 0 }),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      notification: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'n1' }),
      },
      patientCaregiver: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
      caregiverDispatchLog: {
        // Default: first dispatch (count 1 = newly inserted).
        createMany: (jest.fn() as jest.Mock<any>).mockResolvedValue({ count: 1 }),
      },
      user: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({ email: null }),
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([]),
      },
    }
    email = { sendEmail: (jest.fn() as jest.Mock<any>).mockResolvedValue(undefined) }
    sms = {
      isConfigured: (jest.fn() as jest.Mock<any>).mockReturnValue(false),
      sendSms: (jest.fn() as jest.Mock<any>).mockRejectedValue(
        new Error('SMS not configured'),
      ),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: EmailService, useValue: email },
        { provide: SmsService, useValue: sms },
        {
          provide: ConfigService,
          useValue: { get: (_k: string, fb?: string) => fb ?? undefined },
        },
        {
          provide: ClsService,
          useValue: {
            run: (fn: () => unknown) => fn(),
            set: () => undefined,
            get: () => null,
          },
        },
        { provide: EncryptionService, useValue: encryptionMock() },
      ],
    }).compile()

    service = module.get(EscalationService)
  })

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) delete process.env.CAREGIVER_DISPATCH_ENABLED
    else process.env.CAREGIVER_DISPATCH_ENABLED = ORIGINAL_FLAG
  })

  it('does NOT dispatch when CAREGIVER_DISPATCH_ENABLED is off', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'false'
    prisma.patientCaregiver.findMany.mockResolvedValue([emailCaregiver()])

    await service.handleAlertCreated(caregiverPayload())

    expect(prisma.patientCaregiver.findMany).not.toHaveBeenCalled()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('does NOT dispatch for a non-caregiver-routed rule', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([emailCaregiver()])

    await service.handleAlertCreated(
      caregiverPayload({ ruleId: 'RULE_STANDARD_L1_HIGH' }),
    )

    expect(prisma.patientCaregiver.findMany).not.toHaveBeenCalled()
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('queries only consented, active, channel-set caregivers (consent gate)', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([])

    await service.handleAlertCreated(caregiverPayload())

    expect(prisma.patientCaregiver.findMany).toHaveBeenCalledTimes(1)
    const where = prisma.patientCaregiver.findMany.mock.calls[0][0].where
    expect(where).toEqual(
      expect.objectContaining({
        patientUserId: 'patient-1',
        active: true,
        consentGivenAt: { not: null },
        notifyChannel: { not: 'NONE' },
      }),
    )
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('emails a consented EMAIL caregiver exactly once with only the caregiverMessage', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([emailCaregiver()])

    await service.handleAlertCreated(caregiverPayload())

    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    const [to, subject, html] = email.sendEmail.mock.calls[0]
    expect(to).toBe('dana@example.com')
    expect(typeof subject).toBe('string')
    // Minimum Necessary — the caregiverMessage text is present in the body.
    expect(html).toContain('ankle swelling')

    // A6 — a CAREGIVER EscalationEvent is written so the dispatch shows in
    // the admin audit trail, not just CaregiverDispatchLog.
    expect(prisma.escalationEvent.create).toHaveBeenCalledTimes(1)
    const evt = prisma.escalationEvent.create.mock.calls[0][0].data
    expect(evt.recipientRoles).toEqual(['CAREGIVER'])
    expect(evt.notificationChannel).toBe('EMAIL')
    expect(evt.ladderStep).toBe('T0')
  })

  it('is idempotent — a re-fired alert (createMany count 0) does not re-send', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([emailCaregiver()])
    prisma.caregiverDispatchLog.createMany.mockResolvedValue({ count: 0 })

    await service.handleAlertCreated(caregiverPayload())

    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('routes a DASHBOARD account caregiver to a Notification row', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([
      emailCaregiver({
        notifyChannel: 'DASHBOARD',
        email: null,
        caregiverUserId: 'cg-user-9',
      }),
    ])

    await service.handleAlertCreated(caregiverPayload())

    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
    const data = prisma.notification.create.mock.calls[0][0].data
    expect(data).toEqual(
      expect.objectContaining({
        userId: 'cg-user-9',
        channel: 'DASHBOARD',
        // Caregiver alert notice → visible in the caregiver bell (not ALERT_*).
        dispatchTrigger: 'CAREGIVER_UPDATE',
      }),
    )
    expect(email.sendEmail).not.toHaveBeenCalled()
  })

  it('SUPPRESSES caregiver SMS by default (Addendum Decision 2 — email-only MVP)', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    delete process.env.ENABLE_CAREGIVER_SMS // default-off
    prisma.patientCaregiver.findMany.mockResolvedValue([
      emailCaregiver({ notifyChannel: 'SMS', email: null, phone: '+12025550100' }),
    ])

    await expect(service.handleAlertCreated(caregiverPayload())).resolves.toBeUndefined()
    expect(sms.sendSms).not.toHaveBeenCalled()
  })

  it('routes SMS to SmsService ONLY when ENABLE_CAREGIVER_SMS=true (post-MVP), surviving the noop throw', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    process.env.ENABLE_CAREGIVER_SMS = 'true'
    try {
      prisma.patientCaregiver.findMany.mockResolvedValue([
        emailCaregiver({ notifyChannel: 'SMS', email: null, phone: '+12025550100' }),
      ])

      // Should not throw even though sendSms rejects.
      await expect(service.handleAlertCreated(caregiverPayload())).resolves.toBeUndefined()
      expect(sms.sendSms).toHaveBeenCalledTimes(1)
      expect(sms.sendSms.mock.calls[0][0]).toBe('+12025550100')
    } finally {
      delete process.env.ENABLE_CAREGIVER_SMS
    }
  })

  it('dispatches independently per caregiver (one EMAIL + one DASHBOARD)', async () => {
    process.env.CAREGIVER_DISPATCH_ENABLED = 'true'
    prisma.patientCaregiver.findMany.mockResolvedValue([
      emailCaregiver(),
      emailCaregiver({
        id: 'cg-2',
        notifyChannel: 'DASHBOARD',
        email: null,
        caregiverUserId: 'cg-user-2',
      }),
    ])

    await service.handleAlertCreated(caregiverPayload())

    expect(email.sendEmail).toHaveBeenCalledTimes(1)
    expect(prisma.notification.create).toHaveBeenCalledTimes(1)
  })
})
