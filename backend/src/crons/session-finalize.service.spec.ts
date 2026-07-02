import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing'
import { ClsService } from 'nestjs-cls'
import { SINGLE_READING_FINALIZE_MS } from '@cardioplace/shared'
import { PrismaService } from '../prisma/prisma.service.js'
import { DailyJournalService } from '../daily_journal/daily_journal.service.js'
import { SessionFinalizeService } from './session-finalize.service.js'

// runAsCronActor wraps scheduledRun in cls.run — a pass-through stub is enough
// for the unit tests, which call runScan directly.
const clsStub = {
  run: (fn: () => unknown) => fn(),
  set: () => undefined,
  get: () => null,
} as unknown as ClsService

const mockPrisma = {
  journalEntry: { findMany: jest.fn() },
} as any
const mockDailyJournal = {
  shouldFinalizeAsSingleReading: jest.fn(),
  finalizeSingleReadingSession: jest.fn(),
} as any

const NOW = new Date('2026-05-22T10:00:00Z')

function candidate(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'e1',
    userId: over.userId ?? 'u1',
    sessionId: over.sessionId ?? null,
    measuredAt: over.measuredAt ?? new Date(NOW.getTime() - SINGLE_READING_FINALIZE_MS - 60_000),
  }
}

describe('SessionFinalizeService', () => {
  let service: SessionFinalizeService

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionFinalizeService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DailyJournalService, useValue: mockDailyJournal },
        { provide: ClsService, useValue: clsStub },
      ],
    }).compile()
    service = module.get<SessionFinalizeService>(SessionFinalizeService)
  })

  it('finalizes a lone expired reading the predicate accepts', async () => {
    mockPrisma.journalEntry.findMany.mockResolvedValueOnce([candidate({ id: 'e1' })])
    mockDailyJournal.shouldFinalizeAsSingleReading.mockResolvedValueOnce(true)
    mockDailyJournal.finalizeSingleReadingSession.mockResolvedValueOnce({ statusCode: 202 })

    const count = await service.runScan(NOW)
    expect(count).toBe(1)
    expect(mockDailyJournal.finalizeSingleReadingSession).toHaveBeenCalledWith('u1', 'e1')
  })

  it('skips entries the predicate rejects (sibling / AFib / pre-Day-3)', async () => {
    mockPrisma.journalEntry.findMany.mockResolvedValueOnce([candidate({ id: 'e1' })])
    mockDailyJournal.shouldFinalizeAsSingleReading.mockResolvedValueOnce(false)

    const count = await service.runScan(NOW)
    expect(count).toBe(0)
    expect(mockDailyJournal.finalizeSingleReadingSession).not.toHaveBeenCalled()
  })

  it('finalizes only the accepted entries in a mixed batch', async () => {
    mockPrisma.journalEntry.findMany.mockResolvedValueOnce([
      candidate({ id: 'e1' }),
      candidate({ id: 'e2' }),
      candidate({ id: 'e3' }),
    ])
    mockDailyJournal.shouldFinalizeAsSingleReading
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mockDailyJournal.finalizeSingleReadingSession.mockResolvedValue({ statusCode: 202 })

    const count = await service.runScan(NOW)
    expect(count).toBe(2)
    expect(mockDailyJournal.finalizeSingleReadingSession).toHaveBeenCalledTimes(2)
  })

  it('returns 0 and queries with the right filters when there are no candidates', async () => {
    mockPrisma.journalEntry.findMany.mockResolvedValueOnce([])

    const count = await service.runScan(NOW)
    expect(count).toBe(0)

    const where = mockPrisma.journalEntry.findMany.mock.calls[0][0].where
    expect(where.singleReadingFinalized).toBe(false)
    expect(where.measuredAt.lte).toEqual(new Date(NOW.getTime() - SINGLE_READING_FINALIZE_MS))
    expect(where.measuredAt.gte).toEqual(new Date(NOW.getTime() - 24 * 60 * 60 * 1000))
    // Weight-only entries excluded — must have a BP or pulse value.
    expect(where.OR).toEqual([{ systolicBP: { not: null } }, { pulse: { not: null } }])
  })

  it('continues past a finalize failure without aborting the batch', async () => {
    mockPrisma.journalEntry.findMany.mockResolvedValueOnce([
      candidate({ id: 'e1' }),
      candidate({ id: 'e2' }),
    ])
    mockDailyJournal.shouldFinalizeAsSingleReading.mockResolvedValue(true)
    mockDailyJournal.finalizeSingleReadingSession
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ statusCode: 202 })

    const count = await service.runScan(NOW)
    expect(count).toBe(1)
    expect(mockDailyJournal.finalizeSingleReadingSession).toHaveBeenCalledTimes(2)
  })
})
