import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { EscalationLevel } from '../../generated/prisma/enums.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { EscalationService } from './escalation.service.js'
import type { AnomalyTrackedEvent } from '../interfaces/events.interface.js'

describe('EscalationService', () => {
  let service: EscalationService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        findUnique: (jest.fn() as jest.Mock<any>).mockResolvedValue({
          journalEntry: {
            systolicBP: 170,
            diastolicBP: 105,
            symptoms: [],
          },
        }),
        update: (jest.fn() as jest.Mock<any>).mockResolvedValue({}),
      },
      escalationEvent: {
        create: (jest.fn() as jest.Mock<any>).mockResolvedValue({ id: 'esc-1' }),
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

  const basePayload: AnomalyTrackedEvent = {
    userId: 'user-1',
    alertId: 'alert-1',
    type: 'SYSTOLIC_BP',
    severity: 'MEDIUM',
    occurrencesInLast3Days: 3,
    escalated: false,
  }

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('handleAnomalyTracked', () => {
    it('skips when occurrencesInLast3Days < 3', async () => {
      await service.handleAnomalyTracked({
        ...basePayload,
        occurrencesInLast3Days: 2,
      })

      expect(prisma.deviationAlert.findUnique).not.toHaveBeenCalled()
      expect(prisma.escalationEvent.create).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('creates LEVEL_1 escalation for MEDIUM severity, no emergency symptoms', async () => {
      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          alertId: 'alert-1',
          userId: 'user-1',
          escalationLevel: EscalationLevel.LEVEL_1,
        }),
      })
    })

    it('creates LEVEL_2 escalation for HIGH severity', async () => {
      await service.handleAnomalyTracked({
        ...basePayload,
        severity: 'HIGH',
      })

      expect(prisma.escalationEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          escalationLevel: EscalationLevel.LEVEL_2,
        }),
      })
    })

    it('creates LEVEL_2 when emergency symptoms present', async () => {
      prisma.deviationAlert.findUnique.mockResolvedValue({
        journalEntry: {
          systolicBP: 170,
          diastolicBP: 105,
          symptoms: ['chest pain'],
        },
      })

      await service.handleAnomalyTracked(basePayload)

      expect(prisma.escalationEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          escalationLevel: EscalationLevel.LEVEL_2,
        }),
      })
    })

    it('sets correct patient message for LEVEL_1', async () => {
      await service.handleAnomalyTracked(basePayload)

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          patientMessage: expect.stringContaining(
            'Your care team has been notified',
          ),
        }),
      )
    })

    it('sets correct patient message for LEVEL_2', async () => {
      await service.handleAnomalyTracked({
        ...basePayload,
        severity: 'HIGH',
      })

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          patientMessage: expect.stringContaining('Call 911'),
        }),
      )
    })

    it('marks alert as escalated', async () => {
      await service.handleAnomalyTracked(basePayload)

      expect(prisma.deviationAlert.update).toHaveBeenCalledWith({
        where: { id: 'alert-1' },
        data: { escalated: true },
      })
    })

    it('emits ESCALATION_CREATED with full payload', async () => {
      await service.handleAnomalyTracked(basePayload)

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ESCALATION_CREATED,
        expect.objectContaining({
          userId: 'user-1',
          escalationEventId: 'esc-1',
          alertId: 'alert-1',
          escalationLevel: EscalationLevel.LEVEL_1,
          deviationType: 'SYSTOLIC_BP',
          reason: expect.stringContaining('3 consecutive day(s)'),
          symptoms: [],
          patientMessage: expect.any(String),
          careTeamMessage: expect.any(String),
        }),
      )
    })
  })
})
