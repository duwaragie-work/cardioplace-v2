import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EscalationLevel } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { EscalationService } from './escalation.service.js'
import type { AlertCreatedEvent } from '../interfaces/events.interface.js'

describe('EscalationService', () => {
  let service: EscalationService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }

  beforeEach(async () => {
    prisma = {
      escalationEvent: {
        findFirst: (jest.fn() as jest.Mock<any>).mockResolvedValue(null),
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'esc-1' }),
      },
      deviationAlert: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          id: 'alert-1',
          journalEntry: {
            measuredAt: new Date('2026-03-20T08:30:00.000Z'),
            systolicBP: 170,
            diastolicBP: 105,
            otherSymptoms: ['Severe Headache'],
            medicationTaken: true,
          },
          user: { name: 'Test Patient' },
        }),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
        count: (jest.fn() as jest.Mock<any>).mockResolvedValue(1),
      },
      journalEntry: {
        findMany: (jest.fn() as jest.Mock<any>).mockResolvedValue([
          { medicationTaken: true },
          { medicationTaken: true },
          { medicationTaken: false },
        ]),
      },
    }
    eventEmitter = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscalationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile()

    service = module.get<EscalationService>(EscalationService)
  })

  const basePayload: AlertCreatedEvent = {
    userId: 'user-1',
    alertId: 'alert-1',
    type: 'SYSTOLIC_BP',
    severity: 'MEDIUM',
    escalated: false,
    tier: 'BP_LEVEL_1_HIGH',
    ruleId: 'RULE_STANDARD_L1_HIGH',
  }

  // Helper to mock streak of N consecutive days (centered)
  function mockStreak(n: number) {
    // 5-day window: [D-2, D-1, D, D+1, D+2]
    // For streak=3: [0, 1, 1, 1, 0]
    const pattern = [false, false, true, false, false]
    const half = Math.floor(n / 2)
    for (let i = 2 - half; i <= 2 + (n - 1 - half); i++) {
      if (i >= 0 && i < 5) pattern[i] = true
    }
    for (const has of pattern) {
      prisma.deviationAlert.count.mockResolvedValueOnce(has ? 1 : 0)
    }
  }

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('handleAnomalyTracked', () => {
    it('skips if alert already has an escalation (idempotency)', async () => {
      prisma.escalationEvent.findFirst.mockResolvedValue({ id: 'existing-esc' })

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('skips if consecutive days < 3', async () => {
      mockStreak(1)
      await service.handleAnomalyTracked(basePayload)
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })

    it('skips if consecutive days = 2', async () => {
      mockStreak(2)
      await service.handleAnomalyTracked(basePayload)
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
    })

    it('LEVEL_2: symptoms + medication compliant (meds not working)', async () => {
      mockStreak(3)
      // Default mock: symptoms=['Severe Headache'], medicationTaken=true
      // journalEntry.findMany returns 2 taken + 1 not → 66% compliance → compliant
      prisma.journalEntry.findMany.mockResolvedValue([
        { medicationTaken: true },
        { medicationTaken: true },
        { medicationTaken: false },
      ])

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).toHaveBeenCalled()
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          escalationLevel: EscalationLevel.LEVEL_2,
          patientMessage: expect.stringContaining('despite taking medication'),
          careTeamMessage: expect.stringContaining('Medication review required'),
        }),
      )
    })

    it('LEVEL_1: symptoms + medication non-compliant', async () => {
      mockStreak(3)
      // Override: medication not taken on most days
      prisma.journalEntry.findMany.mockResolvedValue([
        { medicationTaken: false },
        { medicationTaken: false },
        { medicationTaken: true },
      ])

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).toHaveBeenCalled()
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          escalationLevel: EscalationLevel.LEVEL_1,
          patientMessage: expect.stringContaining('take your medication regularly'),
          careTeamMessage: expect.stringContaining('non-adherence'),
        }),
      )
    })

    it('LOW: no symptoms (mild alert)', async () => {
      mockStreak(3)
      // Override: no symptoms
      prisma.deviationAlert.findUnique.mockResolvedValue({
        id: 'alert-1',
        journalEntry: {
          measuredAt: new Date('2026-03-20T08:30:00.000Z'),
          systolicBP: 170,
          diastolicBP: 105,
          otherSymptoms: [],
          medicationTaken: true,
        },
        user: { name: 'Test Patient' },
      })

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).toHaveBeenCalled()
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          escalationLevel: EscalationLevel.LEVEL_1, // LOW maps to LEVEL_1 in DB
          patientMessage: expect.stringContaining('Continue monitoring'),
          careTeamMessage: expect.stringContaining('No symptoms reported'),
          reason: expect.stringContaining('without symptoms'),
        }),
      )
    })

    it('marks alert as escalated after creating escalation', async () => {
      mockStreak(3)

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { escalated: true },
      })
    })

    it('includes personalized reading + date in messages', async () => {
      mockStreak(3)

      await service.handleAnomalyTracked(basePayload)

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          patientMessage: expect.stringContaining('170/105 mmHg'),
          careTeamMessage: expect.stringContaining('Test Patient'),
        }),
      )
    })
  })
})
