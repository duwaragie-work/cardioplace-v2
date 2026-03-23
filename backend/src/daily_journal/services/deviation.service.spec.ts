import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { DeviationService } from './deviation.service.js'
import type {
  BaselineComputedEvent,
  BaselineUnavailableEvent,
} from '../interfaces/events.interface.js'

describe('DeviationService', () => {
  let service: DeviationService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }

  beforeEach(async () => {
    prisma = {
      deviationAlert: {
        upsert: jest.fn().mockResolvedValue({ id: 'alert-1', escalated: false }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      journalEntry: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    }
    eventEmitter = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DeviationService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile()

    service = module.get<DeviationService>(DeviationService)
  })

  const basePayload: BaselineComputedEvent = {
    userId: 'user-1',
    entryId: 'entry-1',
    entryDate: new Date('2026-03-20'),
    snapshotId: 'snapshot-1',
    baselineSystolic: 128,
    baselineDiastolic: 83,
    baselineWeight: null,
    systolicBP: 130,
    diastolicBP: 85,
  }

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('handleBaselineComputed', () => {
    it('no deviation when BP is within normal range', async () => {
      await service.handleBaselineComputed(basePayload)

      expect(prisma.deviationAlert.upsert).not.toHaveBeenCalled()
      // Should resolve open alerts when no deviations
      expect(prisma.deviationAlert.findMany).toHaveBeenCalled()
    })

    it('detects SYSTOLIC_BP MEDIUM when systolic > 160', async () => {
      await service.handleBaselineComputed({
        ...basePayload,
        systolicBP: 165,
        baselineSystolic: 140,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'SYSTOLIC_BP',
            severity: 'MEDIUM',
          }),
        }),
      )
    })

    it('detects SYSTOLIC_BP HIGH when systolic > 180', async () => {
      await service.handleBaselineComputed({
        ...basePayload,
        systolicBP: 185,
        baselineSystolic: 140,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'SYSTOLIC_BP',
            severity: 'HIGH',
          }),
        }),
      )
    })

    it('detects SYSTOLIC_BP via relative trigger when systolic > baseline + 20', async () => {
      // systolic=155, baseline=130 → 155 > 130+20=150 triggers relative
      // but 155 <= 160 so absolute alone wouldn't fire
      await service.handleBaselineComputed({
        ...basePayload,
        systolicBP: 155,
        baselineSystolic: 130,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'SYSTOLIC_BP',
            severity: 'MEDIUM',
          }),
        }),
      )
    })

    it('detects DIASTOLIC_BP MEDIUM when diastolic > 100', async () => {
      await service.handleBaselineComputed({
        ...basePayload,
        diastolicBP: 105,
        baselineDiastolic: 85,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'DIASTOLIC_BP',
            severity: 'MEDIUM',
          }),
        }),
      )
    })

    it('detects DIASTOLIC_BP HIGH when diastolic > 110', async () => {
      await service.handleBaselineComputed({
        ...basePayload,
        diastolicBP: 115,
        baselineDiastolic: 85,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'DIASTOLIC_BP',
            severity: 'HIGH',
          }),
        }),
      )
    })

    it('detects MEDICATION_ADHERENCE when medicationTaken is false', async () => {
      await service.handleBaselineComputed({
        ...basePayload,
        medicationTaken: false,
      })

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'MEDICATION_ADHERENCE',
            severity: 'MEDIUM',
          }),
        }),
      )
    })

    it('resolves open alerts when no deviations detected', async () => {
      prisma.deviationAlert.findMany.mockResolvedValue([
        { id: 'old-alert-1', status: 'OPEN' },
      ])

      await service.handleBaselineComputed(basePayload)

      expect(prisma.deviationAlert.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
        },
        data: { status: 'RESOLVED' },
      })
    })

    it('emits ANOMALY_TRACKED with correct occurrence count', async () => {
      // Trigger a deviation
      await service.handleBaselineComputed({
        ...basePayload,
        systolicBP: 165,
        baselineSystolic: 140,
      })

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.ANOMALY_TRACKED,
        expect.objectContaining({
          userId: 'user-1',
          alertId: 'alert-1',
          type: 'SYSTOLIC_BP',
          severity: 'MEDIUM',
          occurrencesInLast3Days: expect.any(Number),
          escalated: false,
        }),
      )
    })
  })

  describe('handleBaselineUnavailable', () => {
    const unavailablePayload: BaselineUnavailableEvent = {
      userId: 'user-1',
      entryId: 'entry-1',
      entryDate: new Date('2026-03-20'),
      systolicBP: 165,
      diastolicBP: 85,
      reason: 'Only 2 entries in last 7 days (need 3) — baseline set to zero',
    }

    it('uses absolute thresholds only — triggers when systolic > 160', async () => {
      await service.handleBaselineUnavailable(unavailablePayload)

      expect(prisma.deviationAlert.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            type: 'SYSTOLIC_BP',
            severity: 'MEDIUM',
          }),
        }),
      )
    })

    it('does not trigger relative threshold without baseline — systolic 155 passes', async () => {
      await service.handleBaselineUnavailable({
        ...unavailablePayload,
        systolicBP: 155,
      })

      // 155 <= 160 absolute threshold, no baseline for relative check
      expect(prisma.deviationAlert.upsert).not.toHaveBeenCalled()
    })
  })
})
