import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { EventEmitter2 } from '@nestjs/event-emitter'
import { Prisma } from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { JOURNAL_EVENTS } from '../constants/events.js'
import { BaselineService } from './baseline.service.js'
import type {
  JournalEntryCreatedEvent,
  JournalEntryUpdatedEvent,
} from '../interfaces/events.interface.js'

describe('BaselineService', () => {
  let service: BaselineService
  let prisma: Record<string, any>
  let eventEmitter: { emit: jest.Mock }

  beforeEach(async () => {
    prisma = {
      journalEntry: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      baselineSnapshot: {
        upsert: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
      },
    }
    eventEmitter = { emit: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BaselineService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: eventEmitter },
      ],
    }).compile()

    service = module.get<BaselineService>(BaselineService)
  })

  it('should be defined', () => {
    expect(service).toBeDefined()
  })

  describe('handleEntryCreated', () => {
    const basePayload: JournalEntryCreatedEvent = {
      userId: 'user-1',
      entryId: 'entry-1',
      entryDate: new Date('2026-03-20'),
      systolicBP: 130,
      diastolicBP: 85,
      weight: 80,
    }

    it('skips when systolicBP is null', async () => {
      await service.handleEntryCreated({ ...basePayload, systolicBP: null })

      expect(prisma.journalEntry.findMany).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('skips when diastolicBP is null', async () => {
      await service.handleEntryCreated({ ...basePayload, diastolicBP: null })

      expect(prisma.journalEntry.findMany).not.toHaveBeenCalled()
      expect(eventEmitter.emit).not.toHaveBeenCalled()
    })

    it('emits BASELINE_UNAVAILABLE when < 3 entries in 7-day window', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        { systolicBP: 128, diastolicBP: 82, weight: 79 },
        { systolicBP: 132, diastolicBP: 88, weight: 81 },
      ])

      await service.handleEntryCreated(basePayload)

      expect(prisma.baselineSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            baselineSystolic: new Prisma.Decimal('0.00'),
            baselineDiastolic: new Prisma.Decimal('0.00'),
            sampleSize: 2,
          }),
        }),
      )

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.BASELINE_UNAVAILABLE,
        expect.objectContaining({
          userId: 'user-1',
          entryId: 'entry-1',
          systolicBP: 130,
          diastolicBP: 85,
        }),
      )
    })

    it('computes averages and emits BASELINE_COMPUTED when >= 3 entries', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        { systolicBP: 120, diastolicBP: 80, weight: null },
        { systolicBP: 130, diastolicBP: 85, weight: null },
        { systolicBP: 140, diastolicBP: 90, weight: null },
      ])

      await service.handleEntryCreated(basePayload)

      // avg systolic = (120+130+140)/3 = 130, avg diastolic = (80+85+90)/3 = 85
      expect(prisma.baselineSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            baselineSystolic: new Prisma.Decimal('130.00'),
            baselineDiastolic: new Prisma.Decimal('85.00'),
            baselineWeight: null,
            sampleSize: 3,
          }),
        }),
      )

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.BASELINE_COMPUTED,
        expect.objectContaining({
          userId: 'user-1',
          entryId: 'entry-1',
          snapshotId: 'snapshot-1',
          baselineSystolic: 130,
          baselineDiastolic: 85,
          baselineWeight: null,
          systolicBP: 130,
          diastolicBP: 85,
        }),
      )
    })

    it('includes avgWeight when weight data is present', async () => {
      prisma.journalEntry.findMany.mockResolvedValue([
        { systolicBP: 120, diastolicBP: 80, weight: 78 },
        { systolicBP: 130, diastolicBP: 85, weight: 80 },
        { systolicBP: 140, diastolicBP: 90, weight: 82 },
      ])

      await service.handleEntryCreated(basePayload)

      // avg weight = (78+80+82)/3 = 80
      expect(prisma.baselineSnapshot.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            baselineWeight: new Prisma.Decimal('80.00'),
          }),
        }),
      )

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.BASELINE_COMPUTED,
        expect.objectContaining({
          baselineWeight: 80,
        }),
      )
    })
  })

  describe('handleEntryUpdated', () => {
    it('delegates to computeBaseline (same path as handleEntryCreated)', async () => {
      const payload: JournalEntryUpdatedEvent = {
        userId: 'user-1',
        entryId: 'entry-1',
        entryDate: new Date('2026-03-20'),
        systolicBP: 130,
        diastolicBP: 85,
        weight: 80,
      }

      prisma.journalEntry.findMany.mockResolvedValue([
        { systolicBP: 120, diastolicBP: 80, weight: null },
        { systolicBP: 130, diastolicBP: 85, weight: null },
        { systolicBP: 140, diastolicBP: 90, weight: null },
      ])

      await service.handleEntryUpdated(payload)

      expect(prisma.baselineSnapshot.upsert).toHaveBeenCalled()
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        JOURNAL_EVENTS.BASELINE_COMPUTED,
        expect.anything(),
      )
    })
  })
})
