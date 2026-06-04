import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import { UnprocessableEntityException } from '@nestjs/common';
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
  rejectedReadingLog: { create: jest.fn() },
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

    it('#91 — stale sessionId (newest member older than window) → fresh session, never null', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      // gate
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      // resolveCreateSessionId → newest member of the supplied session is way
      // older than the window (stale).
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        measuredAt: new Date('2026-05-22T09:00:00Z'), // 60 min earlier > 30 min window
      })
      // …then the open-in-window lookup finds no open session → mint a UUID.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry('s-new'))
      // shouldFinalizeAsSingleReading
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0) // siblings
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20) // lifetime

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80, sessionId: 's-stale' } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      // #91 — never null; and never the stale id.
      expect(createArg.data.sessionId).toEqual(expect.any(String))
      expect(createArg.data.sessionId).not.toBeNull()
      expect(createArg.data.sessionId).not.toBe('s-stale')
    })

    it('#91 — no sessionId but an open in-window session exists → joins it (averaging preserved)', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      // No supplied id → skips the stale-check branch; open-in-window lookup
      // finds a live session → reuse it so the readings average together.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ sessionId: 's-open' })
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry('s-open'))
      mockPrisma.journalEntry.count.mockResolvedValueOnce(1)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80 } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.sessionId).toBe('s-open')
    })

    it('#91 — no sessionId and no open session → mints a fresh UUID, never null', async () => {
      const measuredAt = '2026-05-22T10:00:00Z'
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no open session
      mockPrisma.journalEntry.create.mockResolvedValueOnce(builtEntry('s-minted'))
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80 } as any)

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.sessionId).toEqual(expect.any(String))
      expect(createArg.data.sessionId).not.toBeNull()
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

  describe('create — DBP>=SBP reject + narrow-PP artifact (Manisha 5/24 Q1)', () => {
    const measuredAt = '2026-05-22T10:00:00Z'

    it('rejects a physiologically-impossible reading (DBP >= SBP), logs it, does not persist', async () => {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' }) // gate
      mockPrisma.rejectedReadingLog.create.mockResolvedValueOnce({})

      await expect(
        service.create('u1', { measuredAt, systolicBP: 120, diastolicBP: 140 } as any),
      ).rejects.toThrow(UnprocessableEntityException)

      const logArg = mockPrisma.rejectedReadingLog.create.mock.calls[0][0]
      expect(logArg.data).toMatchObject({ userId: 'u1', systolicBP: 120, diastolicBP: 140, reason: 'diastolic-ge-systolic' })
      expect(mockPrisma.journalEntry.create).not.toHaveBeenCalled()
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
    })

    it('flags narrowPpArtifact when 0 < SBP-DBP < 15', async () => {
      mockPrisma.patientProfile.findUnique
        .mockResolvedValueOnce({ userId: 'u1' }) // gate
        .mockResolvedValueOnce({ hasAFib: false }) // pending-second-reading
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      mockPrisma.journalEntry.create.mockResolvedValueOnce({
        id: 'e1', userId: 'u1', measuredAt: new Date(measuredAt), systolicBP: 118, diastolicBP: 108,
        sessionId: null, otherSymptoms: [], teachBackAnswer: null, teachBackCorrect: null,
        notes: null, source: EntrySource.MANUAL, sourceMetadata: null, createdAt: new Date(), updatedAt: new Date(),
      })
      mockPrisma.journalEntry.count.mockResolvedValue(0)

      await service.create('u1', { measuredAt, systolicBP: 118, diastolicBP: 108 } as any)
      expect(mockPrisma.journalEntry.create.mock.calls[0][0].data.narrowPpArtifact).toBe(true)
    })

    it('does NOT flag narrowPpArtifact for a normal pulse pressure', async () => {
      mockPrisma.patientProfile.findUnique
        .mockResolvedValueOnce({ userId: 'u1' })
        .mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      mockPrisma.journalEntry.create.mockResolvedValueOnce({
        id: 'e1', userId: 'u1', measuredAt: new Date(measuredAt), systolicBP: 120, diastolicBP: 80,
        sessionId: null, otherSymptoms: [], teachBackAnswer: null, teachBackCorrect: null,
        notes: null, source: EntrySource.MANUAL, sourceMetadata: null, createdAt: new Date(), updatedAt: new Date(),
      })
      mockPrisma.journalEntry.count.mockResolvedValue(0)

      await service.create('u1', { measuredAt, systolicBP: 120, diastolicBP: 80 } as any)
      expect(mockPrisma.journalEntry.create.mock.calls[0][0].data.narrowPpArtifact).toBe(false)
    })
  })

  // Manual-test round 2 — Group C: hide Tier-3 caregiver/physician-only alerts
  // (empty patientMessage) from the patient surface entirely. Admin endpoint
  // unchanged.
  describe('getAlerts — Tier-3 caregiver-only suppression (Round 2 Group C)', () => {
    function row(over: Partial<any> = {}): any {
      return {
        id: over.id ?? 'a1',
        userId: 'u1',
        tier: over.tier ?? 'BP_LEVEL_1_HIGH',
        ruleId: over.ruleId ?? 'RULE_STANDARD_L1_HIGH',
        patientMessage: over.patientMessage ?? 'BP is elevated.',
        caregiverMessage: null,
        physicianMessage: null,
        magnitude: null,
        baselineValue: null,
        actualValue: null,
        createdAt: new Date(),
        journalEntry: null,
        ...over,
      }
    }

    it('hides Tier-3 alerts with empty/null patientMessage from the patient list', async () => {
      mockPrisma.deviationAlert.findMany.mockResolvedValueOnce([
        row({ id: 'bp', tier: 'BP_LEVEL_1_HIGH', patientMessage: 'BP elevated' }),
        row({ id: 't3-empty', tier: 'TIER_3_INFO', patientMessage: null, ruleId: 'RULE_HF_CAREGIVER_EDEMA' }),
        row({ id: 't3-blank', tier: 'TIER_3_INFO', patientMessage: '   ', ruleId: 'RULE_HCM_VASODILATOR' }),
      ])
      const out = await service.getAlerts('u1')
      const ids = (out.data as Array<{ id: string }>).map((a) => a.id)
      expect(ids).toEqual(['bp'])
    })

    it('keeps Tier-3 alerts that DO carry a patient message (e.g. first-month adherence nudge)', async () => {
      mockPrisma.deviationAlert.findMany.mockResolvedValueOnce([
        row({
          id: 'nudge',
          tier: 'TIER_3_INFO',
          ruleId: 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',
          patientMessage: 'Just a gentle reminder…',
        }),
      ])
      const out = await service.getAlerts('u1')
      const ids = (out.data as Array<{ id: string }>).map((a) => a.id)
      expect(ids).toEqual(['nudge'])
    })
  })
});
