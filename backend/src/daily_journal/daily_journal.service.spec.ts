import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntrySource } from '../generated/prisma/client.js';
import { DailyJournalService } from './daily_journal.service.js';
import { SESSION_WINDOW_MS } from '@cardioplace/shared';

const mockPrisma = {
  journalEntry: {
    create: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  deviationAlert: { findMany: jest.fn() },
  patientProfile: { findUnique: jest.fn() },
} as any
const mockEventEmitter = { emit: jest.fn() }

describe('DailyJournalService', () => {
  let service: DailyJournalService;

  beforeEach(async () => {
    jest.clearAllMocks()
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DailyJournalService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: EventEmitter2, useValue: mockEventEmitter },
      ],
    }).compile();

    service = module.get<DailyJournalService>(DailyJournalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getActiveSession', () => {
    const now = new Date('2026-05-22T10:00:00Z')

    it('returns null when the patient has no readings', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      expect(await service.getActiveSession('u1', now)).toBeNull()
    })

    it('returns null when the latest reading is older than the session window (expired)', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e1',
        sessionId: 's1',
        measuredAt: new Date(now.getTime() - SESSION_WINDOW_MS - 60_000),
        singleReadingFinalized: false,
      })
      expect(await service.getActiveSession('u1', now)).toBeNull()
    })

    it('returns null when the latest reading is already finalized as single-reading (closed)', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e1',
        sessionId: 's1',
        measuredAt: new Date(now.getTime() - 60_000),
        singleReadingFinalized: true,
      })
      expect(await service.getActiveSession('u1', now)).toBeNull()
    })

    it('returns the open session; non-AFib with 2 readings → requiresMoreReadings=false', async () => {
      const last = new Date(now.getTime() - 2 * 60_000)
      const first = new Date(now.getTime() - 8 * 60_000)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e2',
        sessionId: 's1',
        measuredAt: last,
        singleReadingFinalized: false,
      })
      mockPrisma.journalEntry.findMany.mockResolvedValueOnce([
        { measuredAt: first },
        { measuredAt: last },
      ])
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20) // lifetime, post-Day-3

      const res = await service.getActiveSession('u1', now)
      expect(res).toEqual({
        sessionId: 's1',
        openedAt: first.toISOString(),
        lastReadingAt: last.toISOString(),
        readingCount: 2,
        expiresAt: new Date(last.getTime() + SESSION_WINDOW_MS).toISOString(),
        requiresMoreReadings: false,
      })
    })

    it('non-AFib post-Day-3 with 1 reading → requiresMoreReadings=true', async () => {
      const last = new Date(now.getTime() - 60_000)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e1',
        sessionId: 's1',
        measuredAt: last,
        singleReadingFinalized: false,
      })
      mockPrisma.journalEntry.findMany.mockResolvedValueOnce([{ measuredAt: last }])
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      const res = await service.getActiveSession('u1', now)
      expect(res?.readingCount).toBe(1)
      expect(res?.requiresMoreReadings).toBe(true)
    })

    it('AFib with 2 readings → requiresMoreReadings=true (needs 3)', async () => {
      const last = new Date(now.getTime() - 60_000)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e2',
        sessionId: 's1',
        measuredAt: last,
        singleReadingFinalized: false,
      })
      mockPrisma.journalEntry.findMany.mockResolvedValueOnce([
        { measuredAt: new Date(now.getTime() - 5 * 60_000) },
        { measuredAt: last },
      ])
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: true })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      const res = await service.getActiveSession('u1', now)
      expect(res?.requiresMoreReadings).toBe(true)
    })

    it('Pre-Day-3 (lifetime < 7) with 1 reading → requiresMoreReadings=false (fires on single)', async () => {
      const last = new Date(now.getTime() - 60_000)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        id: 'e1',
        sessionId: 's1',
        measuredAt: last,
        singleReadingFinalized: false,
      })
      mockPrisma.journalEntry.findMany.mockResolvedValueOnce([{ measuredAt: last }])
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(3) // pre-Day-3

      const res = await service.getActiveSession('u1', now)
      expect(res?.requiresMoreReadings).toBe(false)
    })
  })

  describe('create — stale sessionId handling', () => {
    function builtEntry(sessionId: string | null) {
      return {
        id: 'new-1',
        userId: 'u1',
        measuredAt: new Date('2026-05-22T10:00:00Z'),
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 72,
        weight: null,
        position: null,
        sessionId,
        medicationTaken: null,
        medicationScheduledLater: false,
        missedDoses: null,
        missedMedications: null,
        otherSymptoms: [],
        teachBackAnswer: null,
        teachBackCorrect: null,
        notes: null,
        source: EntrySource.MANUAL,
        sourceMetadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
    }

    it('drops a stale sessionId (newest member older than the window) to null', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      // gate
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      // resolveCreateSessionId → newest member is way older than the window
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        measuredAt: new Date('2026-05-22T09:00:00Z'), // 60 min earlier > 30 min window
      })
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry(null))
      // shouldFinalizeAsSingleReading
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0) // siblings
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20) // lifetime

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80, sessionId: 's-stale' } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.sessionId).toBeNull()
    })

    it('keeps a fresh sessionId (no existing members) so the reading establishes the session', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // fresh session
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry('s-fresh'))
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80, sessionId: 's-fresh' } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.sessionId).toBe('s-fresh')
    })

    it('keeps a sessionId whose newest member is within the window', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        measuredAt: new Date('2026-05-22T09:58:00Z'), // 2 min earlier, within the 5-min window
      })
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry('s-active'))
      mockPrisma.journalEntry.count.mockResolvedValueOnce(1)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80, sessionId: 's-active' } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.sessionId).toBe('s-active')
    })
  })
});
