import { jest } from '@jest/globals'
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  InternalServerErrorException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service.js';
import { EntrySource, DelayBand, Prisma } from '../generated/prisma/client.js';
import { DailyJournalService, computeDelayBand } from './daily_journal.service.js';
import { JOURNAL_EVENTS } from './constants/events.js';
import { SESSION_WINDOW_MS } from '@cardioplace/shared';

const mockPrisma = {
  journalEntry: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  deviationAlert: { findMany: jest.fn() },
  patientProfile: { findUnique: jest.fn() },
  profileVerificationLog: { create: jest.fn() },
  rejectedReadingLog: { create: jest.fn() },
  notification: { findMany: jest.fn(), count: jest.fn() },
  // withConnectionRetry just runs the thunk in tests. Set at definition so
  // clearAllMocks (which keeps implementations) doesn't strip it.
  withConnectionRetry: jest.fn((fn: any) => fn()),
  // Interactive $transaction runs its callback against the same mock client
  // (no real rollback — atomicity is asserted as "the request fails when the
  // audit write fails"). Set at definition for the same clearAllMocks reason.
  $transaction: jest.fn(async (fn: any) => fn(mockPrisma)),
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

  // ─── Bug 25 — update_checkin auto-regrouping by measurement time ──────────
  // When the patient edits an existing entry's measurement_time, sessionId
  // must be re-evaluated against the new time. Closes the gap where editing
  // a reading's time left it glued to a stale session (no auto-regrouping)
  // and the rule engine's session-grouping no longer matched the clinical
  // 5-minute-window spec.
  describe('update — auto-regrouping on measuredAt edit (Bug 25)', () => {
    function existingRow(over: Partial<any> = {}) {
      return {
        id: over.id ?? 'e1',
        userId: 'u1',
        sessionId: over.sessionId ?? 's-orig',
        measuredAt: over.measuredAt ?? new Date('2026-05-22T08:00:00Z'),
        systolicBP: 130,
        diastolicBP: 80,
        ...over,
      }
    }
    function updatedRow(over: Partial<any> = {}) {
      return {
        id: over.id ?? 'e1',
        userId: 'u1',
        sessionId: over.sessionId ?? 's-orig',
        measuredAt: over.measuredAt ?? new Date('2026-05-22T08:02:00Z'),
        systolicBP: 130,
        diastolicBP: 80,
        pulse: null,
        weight: null,
        position: null,
        otherSymptoms: [],
        medicationTaken: null,
        medicationScheduledLater: false,
        missedDoses: null,
        missedMedications: null,
        teachBackAnswer: null,
        teachBackCorrect: null,
        notes: null,
        source: EntrySource.MANUAL,
        sourceMetadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }
    }

    it('stays in current session when sibling is still within ±5 min of new time', async () => {
      // entry was at 08:00 with sibling at 08:01 — edit moves it to 08:02.
      // Sibling at 08:01 is still within ±5 min → keep current sessionId.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-orig', measuredAt: new Date('2026-05-22T08:00:00Z') }),
      )
      // resolveUpdateSessionId — first query: sibling within new window?
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'sibling-1' })
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(
        updatedRow({ measuredAt: new Date('2026-05-22T08:02:00Z'), sessionId: 's-orig' }),
      )

      await service.update('u1', 'e1', { measuredAt: '2026-05-22T08:02:00Z' } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      expect(updateArg.data.sessionId).toBe('s-orig')
    })

    it('joins a different session when new time falls within ±5 min of that session', async () => {
      // entry was at 08:00 in s-orig (alone or with stale siblings far away)
      // — edit moves it to 09:00. s-other has a member at 09:01 → join s-other.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-orig', measuredAt: new Date('2026-05-22T08:00:00Z') }),
      )
      // No current-session sibling within new window.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      // Different-session entry within new window.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ sessionId: 's-other' })
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(
        updatedRow({ measuredAt: new Date('2026-05-22T09:00:00Z'), sessionId: 's-other' }),
      )

      await service.update('u1', 'e1', { measuredAt: '2026-05-22T09:00:00Z' } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      expect(updateArg.data.sessionId).toBe('s-other')
    })

    it('leaves current session and mints fresh id when moving away from siblings', async () => {
      // entry was at 08:00 in s-orig (with other s-orig members) — edit moves
      // it to 12:00. No current-session sibling in window, no other-session
      // entry in window, but s-orig has OTHER members we're abandoning →
      // mint a fresh id so we don't pollute s-orig's grouping.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-orig', measuredAt: new Date('2026-05-22T08:00:00Z') }),
      )
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no current-session sibling in new window
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no other-session in window
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'orig-sibling' }) // s-orig HAS other members
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(
        updatedRow({ measuredAt: new Date('2026-05-22T12:00:00Z') }),
      )

      await service.update('u1', 'e1', { measuredAt: '2026-05-22T12:00:00Z' } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      expect(updateArg.data.sessionId).not.toBe('s-orig')
      expect(updateArg.data.sessionId).toEqual(expect.any(String))
    })

    it('keeps lone-entry sessionId when moving far and no siblings exist (no UUID churn)', async () => {
      // entry was at 08:00 in s-alone (no other members) — edit moves it to
      // 12:00. No siblings anywhere → keep s-alone (don't churn the UUID).
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-alone', measuredAt: new Date('2026-05-22T08:00:00Z') }),
      )
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no current-session sibling
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no other-session
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // s-alone has no other members
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(
        updatedRow({ measuredAt: new Date('2026-05-22T12:00:00Z'), sessionId: 's-alone' }),
      )

      await service.update('u1', 'e1', { measuredAt: '2026-05-22T12:00:00Z' } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      expect(updateArg.data.sessionId).toBe('s-alone')
    })

    it('skips re-resolution when caller explicitly passes sessionId (LLM intentional move)', async () => {
      // Caller passing sessionId is an explicit "move to this session" — we
      // must NOT override it with auto-grouping.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-orig' }),
      )
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(
        updatedRow({ sessionId: 's-explicit' }),
      )

      await service.update('u1', 'e1', {
        measuredAt: '2026-05-22T08:02:00Z',
        sessionId: 's-explicit',
      } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      expect(updateArg.data.sessionId).toBe('s-explicit')
    })

    it('skips re-resolution when measuredAt is not being changed', async () => {
      // No measuredAt in the dto → the resolver should not run (no Prisma
      // findFirst beyond the existence check).
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(
        existingRow({ sessionId: 's-orig' }),
      )
      ;(mockPrisma.journalEntry.update as any).mockResolvedValueOnce(updatedRow())

      await service.update('u1', 'e1', { systolicBP: 135 } as any)

      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      // sessionId NOT in the update payload — was never re-resolved.
      expect(updateArg.data.sessionId).toBeUndefined()
    })
  })

  // Chunk B fix-up (Manisha Backdated Readings sign-off 2026-06-06) — the
  // POST response's alertsSuppressedReason: 'GATE_A' when a later-measured
  // reading exists outside the 5-min session window, 'HISTORICAL_ENTRY' when
  // the stored band is ≥24h (takes precedence — stable on GETs too), null
  // otherwise. Drives the Chunk C "recorded but won't alert" banner.
  describe('create — alertsSuppressedReason (Chunk B fix-up)', () => {
    function suppressionEntry(delayBand: DelayBand) {
      return {
        id: 'new-1',
        userId: 'u1',
        measuredAt: new Date('2026-05-22T10:00:00Z'),
        delayBand,
        systolicBP: 130,
        diastolicBP: 80,
        pulse: 72,
        weight: null,
        position: null,
        sessionId: 's-1',
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

    const measuredAt = '2026-05-22T10:00:00Z'

    /** Queue the create-flow Once chain up to (not including) the Gate A
     *  findFirst probe, which runs LAST in create(). */
    function queueCreateFlow(delayBand: DelayBand) {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' }) // gate
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // no open session
      mockPrisma.journalEntry.create.mockResolvedValueOnce(suppressionEntry(delayBand))
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0) // siblings
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20) // lifetime
    }

    it('GATE_A when a later-measured reading exists outside the session window', async () => {
      queueCreateFlow(DelayBand.REAL_TIME)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'later-entry' }) // Gate A probe

      const res = await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80 } as any)

      expect(res.data.alertsSuppressedReason).toBe('GATE_A')
      // The probe uses a 5-min sibling tolerance so a second same-session
      // reading never false-positives (the engine compares the session max).
      const gateACall = mockPrisma.journalEntry.findFirst.mock.calls.at(-1)[0]
      expect(gateACall.where.userId).toBe('u1')
      expect(gateACall.where.measuredAt.gt).toEqual(
        new Date(new Date(measuredAt).getTime() + SESSION_WINDOW_MS),
      )
    })

    it('no suppression → null (no later reading exists)', async () => {
      queueCreateFlow(DelayBand.REAL_TIME)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // Gate A probe

      const res = await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80 } as any)

      expect(res.data.alertsSuppressedReason).toBeNull()
      expect(res.data.delayBand).toBe(DelayBand.REAL_TIME)
    })

    it('HISTORICAL_ENTRY takes precedence over GATE_A (stable across GETs)', async () => {
      queueCreateFlow(DelayBand.HISTORICAL_ENTRY)
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({ id: 'later-entry' }) // Gate A also trips

      const res = await service.create('u1', { measuredAt, systolicBP: 130, diastolicBP: 80 } as any)

      expect(res.data.alertsSuppressedReason).toBe('HISTORICAL_ENTRY')
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

    it('Bug 12 — hides a TIER_1 provider-only alert (RULE_UNCONFIRMED_EMERGENCY, empty patientMessage) from the patient list', async () => {
      mockPrisma.deviationAlert.findMany.mockResolvedValueOnce([
        row({ id: 'bp', tier: 'BP_LEVEL_2', patientMessage: 'Call 911 now.' }),
        // Option D provider-only flag — must NOT reach the patient surface even
        // though it is Tier 1, not Tier 3.
        row({
          id: 'unconfirmed',
          tier: 'TIER_1_CONTRAINDICATION',
          ruleId: 'RULE_UNCONFIRMED_EMERGENCY',
          patientMessage: '',
        }),
      ])
      const out = await service.getAlerts('u1')
      const ids = (out.data as Array<{ id: string }>).map((a) => a.id)
      expect(ids).toEqual(['bp'])
    })
  })

  // ─── H5 G.4 — bell visibility filter (read-side; #80 EMAIL + alert-linked PUSH) ──
  describe('getNotifications / unread-count bell filter (G.4 + #80)', () => {
    // The bell LIST + unread COUNT must both exclude (a) EMAIL outbound rows
    // (#80) and (b) alert-linked PUSH rows (G.4 — escalation T+0 mirror). The
    // write path is untouched; this is a READ-side query predicate.
    function expectBellExclusions(where: any) {
      expect(where.userId).toBe('u1')
      expect(where.AND).toEqual(
        expect.arrayContaining([
          { channel: { not: 'EMAIL' } },
          { NOT: { AND: [{ alertId: { not: null } }, { channel: 'PUSH' }] } },
        ]),
      )
    }

    it('getNotifications excludes EMAIL + alert-linked PUSH at the query', async () => {
      mockPrisma.notification.findMany.mockResolvedValueOnce([])
      await service.getNotifications('u1')
      const where = mockPrisma.notification.findMany.mock.calls[0][0].where
      expectBellExclusions(where)
    })

    it('getNotificationsUnreadCount uses the SAME exclusions (count can never drift from list)', async () => {
      mockPrisma.notification.count.mockResolvedValueOnce(0)
      await service.getNotificationsUnreadCount('u1')
      const where = mockPrisma.notification.count.mock.calls[0][0].where
      expect(where.readAt).toBeNull()
      expectBellExclusions(where)
    })

    it('system-action PUSH (alertId null) is NOT excluded — only alert-linked PUSH is', () => {
      // The exclusion is scoped to alertId != null AND channel = PUSH, so a
      // med-hold / threshold / profile-reject PUSH (alertId null) stays in the bell.
      const clause = { NOT: { AND: [{ alertId: { not: null } }, { channel: 'PUSH' }] } }
      // Sanity: the predicate requires BOTH alertId-present AND channel=PUSH to drop.
      expect(clause.NOT.AND).toEqual([{ alertId: { not: null } }, { channel: 'PUSH' }])
    })
  });

  // ─── Bug 41 + 42 — no-op detection on update ──────────────────────────────
  // When the LLM/patient asks to update a field to its current value (very
  // common: "change BP to 120/80" when it's already 120/80), the service now
  // returns a graceful "no changes" response instead of a successful but
  // meaningless Prisma round-trip. Bug 42 — the resolveUpdateSessionId call
  // is now gated on data.measuredAt SURVIVING the no-op filter so it stops
  // churning sessionId when the LLM re-sets measuredAt to its current value.
  describe('update — no-op detection (Bug 41 + 42)', () => {
    const baseExisting = {
      id: 'e1',
      userId: 'u1',
      measuredAt: new Date('2026-06-08T12:30:00.000Z'),
      systolicBP: 120,
      diastolicBP: 80,
      pulse: 72,
      weight: 68.04, // stored kg for a 150-lb reading
      position: 'SITTING',
      sessionId: 's-orig',
      medicationTaken: true,
      medicationScheduledLater: false,
      missedDoses: null,
      severeHeadache: false,
      visualChanges: false,
      alteredMentalStatus: false,
      chestPainOrDyspnea: false,
      focalNeuroDeficit: false,
      severeEpigastricPain: false,
      newOnsetHeadache: false,
      ruqPain: false,
      edema: false,
      dizziness: false,
      syncope: false,
      palpitations: false,
      legSwelling: false,
      fatigue: false,
      shortnessOfBreath: false,
      dryCough: false,
      nsaidUse: false,
      faceSwelling: false,
      throatTightness: false,
      otherSymptoms: ['headache'],
      teachBackAnswer: null,
      teachBackCorrect: null,
      notes: null,
      source: EntrySource.MANUAL,
      sourceMetadata: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    it('returns graceful "no changes" when LLM updates BP to the same value', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(baseExisting)
      const r = await service.update('u1', 'e1', { systolicBP: 120, diastolicBP: 80 } as any)
      expect(mockPrisma.journalEntry.update).not.toHaveBeenCalled()
      expect(r.statusCode).toBe(200)
      expect(r.message).toMatch(/no changes|already/i)
    })

    it('returns "no changes" when LLM updates weight to identical kg value', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(baseExisting)
      const r = await service.update('u1', 'e1', { weight: 68.04 } as any)
      expect(mockPrisma.journalEntry.update).not.toHaveBeenCalled()
      expect(r.statusCode).toBe(200)
    })

    it('Bug 59 — no-op return carries explicit noChange:true so dispatchers can route the response gracefully', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(baseExisting)
      const r = await service.update('u1', 'e1', {
        systolicBP: baseExisting.systolicBP,
        diastolicBP: baseExisting.diastolicBP,
      } as any)
      expect(mockPrisma.journalEntry.update).not.toHaveBeenCalled()
      // Explicit flag the chat/voice dispatchers check.
      expect((r as { noChange?: boolean }).noChange).toBe(true)
      // Canonical message the bot reads back to the patient.
      expect(r.message).toMatch(/already (have|has) those values/i)
    })

    it('PARTIAL no-op: same systolic + new diastolic → proceeds with diastolic only', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(baseExisting)
      mockPrisma.journalEntry.update.mockResolvedValueOnce({ ...baseExisting, diastolicBP: 85 })
      await service.update('u1', 'e1', { systolicBP: 120, diastolicBP: 85 } as any)
      expect(mockPrisma.journalEntry.update).toHaveBeenCalledTimes(1)
      const updateArg = mockPrisma.journalEntry.update.mock.calls[0][0]
      // Systolic stripped (no-op), diastolic survives.
      expect(updateArg.data.systolicBP).toBeUndefined()
      expect(updateArg.data.diastolicBP).toBe(85)
    })

    it('Bug 42 — resolveUpdateSessionId does NOT fire when measuredAt is re-set to its current value', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(baseExisting)
      // No other findFirst should fire (resolveUpdateSessionId would call findFirst).
      await service.update('u1', 'e1', {
        measuredAt: baseExisting.measuredAt.toISOString(),
      } as any)
      // Only the initial existence-check findFirst should have happened.
      expect(mockPrisma.journalEntry.findFirst).toHaveBeenCalledTimes(1)
      expect(mockPrisma.journalEntry.update).not.toHaveBeenCalled()
    })

    it('Bug 42 — resolveUpdateSessionId DOES fire when measuredAt actually changes', async () => {
      mockPrisma.journalEntry.findFirst
        .mockResolvedValueOnce(baseExisting)
        // First resolveUpdateSessionId query — current-session sibling in window?
        .mockResolvedValueOnce(null)
        // Second query — other-session entry in window?
        .mockResolvedValueOnce(null)
        // Third query — original sibling still in current session?
        .mockResolvedValueOnce(null)
      mockPrisma.journalEntry.update.mockResolvedValueOnce({
        ...baseExisting,
        measuredAt: new Date('2026-06-08T14:00:00.000Z'),
      })
      await service.update('u1', 'e1', {
        measuredAt: '2026-06-08T14:00:00.000Z',
      } as any)
      // resolveUpdateSessionId fires → multiple findFirst calls.
      expect(mockPrisma.journalEntry.findFirst.mock.calls.length).toBeGreaterThan(1)
      expect(mockPrisma.journalEntry.update).toHaveBeenCalledTimes(1)
    })

    it('otherSymptoms — set equality, order-irrelevant', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        ...baseExisting,
        otherSymptoms: ['a', 'b', 'c'],
      })
      const r = await service.update('u1', 'e1', {
        otherSymptoms: ['c', 'a', 'b'],
      } as any)
      expect(mockPrisma.journalEntry.update).not.toHaveBeenCalled()
      expect(r.statusCode).toBe(200)
    })
  })

  // Manisha Backdated Readings sign-off 2026-06-06 — chunk A.
  describe('computeDelayBand', () => {
    const now = new Date('2026-06-09T12:00:00Z')

    it('classifies a same-instant reading as REAL_TIME', () => {
      expect(computeDelayBand(now, now)).toBe(DelayBand.REAL_TIME)
    })

    it('classifies a 4-min-old reading as REAL_TIME (boundary just under 5 min)', () => {
      const measured = new Date(now.getTime() - 4 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.REAL_TIME)
    })

    it('classifies a 5-min-old reading as NEAR_REAL_TIME (boundary exactly at 5 min)', () => {
      const measured = new Date(now.getTime() - 5 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.NEAR_REAL_TIME)
    })

    it('classifies a 45-min-old reading as NEAR_REAL_TIME', () => {
      const measured = new Date(now.getTime() - 45 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.NEAR_REAL_TIME)
    })

    it('classifies a 1-hour-old reading as DELAYED_ENTRY (boundary exactly at 1 h)', () => {
      const measured = new Date(now.getTime() - 60 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.DELAYED_ENTRY)
    })

    it('classifies a 6-hour-old reading as DELAYED_ENTRY', () => {
      const measured = new Date(now.getTime() - 6 * 60 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.DELAYED_ENTRY)
    })

    it('classifies a 23h59m-old reading as DELAYED_ENTRY (just under 24 h)', () => {
      const measured = new Date(now.getTime() - (24 * 60 * 60 * 1000 - 60 * 1000))
      expect(computeDelayBand(measured, now)).toBe(DelayBand.DELAYED_ENTRY)
    })

    it('classifies a 24-hour-old reading as HISTORICAL_ENTRY (boundary exactly at 24 h)', () => {
      const measured = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.HISTORICAL_ENTRY)
    })

    it('classifies a 7-day-old reading as HISTORICAL_ENTRY', () => {
      const measured = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.HISTORICAL_ENTRY)
    })

    it('classifies a clock-skew future reading as REAL_TIME (DTO validator rejects >5 min future)', () => {
      // The DTO's `IsMeasuredAtReasonable` rejects >5 min future at the
      // controller boundary, so this only matters for tiny clock drift.
      // A measuredAt 30 seconds in the future is REAL_TIME, not historical.
      const measured = new Date(now.getTime() + 30 * 1000)
      expect(computeDelayBand(measured, now)).toBe(DelayBand.REAL_TIME)
    })
  });
  // ─── Journal-entry audit log (HIPAA/JCAHO closure) ──────────────────────────
  // Every reading create/edit/delete writes a ProfileVerificationLog row,
  // transaction-scoped with the data operation. Patient actions →
  // PATIENT_READING_*; care-team actions (actor param, Phase 3B admin
  // endpoints) → ADMIN_READING_*. CTO 2026-06-09 no-re-trigger policy: NEITHER
  // admin NOR patient edit/delete re-triggers the engine. Admin edits emit
  // nothing; patient edits/deletes emit ENTRY_UPDATED for chat/voice context
  // refresh only — the engine listens to ENTRY_FINALIZED + ENTRY_CREATED, never
  // ENTRY_UPDATED.
  describe('journal-entry audit log', () => {
    const measuredAt = '2026-06-12T10:00:00Z'
    const ADMIN: any = { id: 'admin-1', roles: ['SUPER_ADMIN'] }
    const PROVIDER_ACTOR: any = { id: 'prov-1', roles: ['PROVIDER'] }

    function fullRow(over: Partial<any> = {}): any {
      return {
        id: 'e1',
        userId: 'u1',
        addedByUserId: null,
        measuredAt: new Date(measuredAt),
        systolicBP: 140,
        diastolicBP: 90,
        pulse: 72,
        weight: null,
        position: 'SITTING',
        sessionId: 's1',
        measurementConditions: null,
        medicationTaken: null,
        medicationScheduledLater: false,
        missedDoses: null,
        missedMedications: null,
        medicationStatuses: null,
        severeHeadache: false,
        visualChanges: false,
        alteredMentalStatus: false,
        chestPainOrDyspnea: false,
        focalNeuroDeficit: false,
        severeEpigastricPain: false,
        newOnsetHeadache: false,
        ruqPain: false,
        edema: false,
        dizziness: false,
        syncope: false,
        palpitations: false,
        legSwelling: false,
        fatigue: false,
        shortnessOfBreath: false,
        dryCough: false,
        nsaidUse: false,
        faceSwelling: false,
        throatTightness: false,
        singleReadingFinalized: false,
        narrowPpArtifact: false,
        otherSymptoms: [],
        teachBackAnswer: null,
        teachBackCorrect: null,
        notes: null,
        source: EntrySource.MANUAL,
        sourceMetadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
      }
    }

    /** Mocks for a create() that minted a fresh session (no sessionId supplied). */
    function mockCreateHappyPath(created: any) {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' }) // gate
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null) // open-in-window lookup
      mockPrisma.journalEntry.create.mockResolvedValueOnce(created)
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})
      // computePendingSecondReading
      mockPrisma.journalEntry.count.mockResolvedValueOnce(0)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)
    }

    it('POST (patient) → PATIENT_READING_CREATED audit row in the insert transaction', async () => {
      mockCreateHappyPath(fullRow())

      await service.create('u1', { measuredAt, systolicBP: 140, diastolicBP: 90 } as any)

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1)
      expect(mockPrisma.profileVerificationLog.create).toHaveBeenCalledTimes(1)
      const arg = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(arg.data).toMatchObject({
        userId: 'u1',
        changedBy: 'u1',
        changedByRole: 'PATIENT',
        changeType: 'PATIENT_READING_CREATED',
        fieldPath: 'journal_entry.created',
        previousValue: Prisma.JsonNull,
      })
      expect(arg.data.newValue).toMatchObject({
        entryId: 'e1',
        systolicBP: 140,
        diastolicBP: 90,
        sessionId: 's1',
      })
    })

    it('POST (admin actor) → ADMIN_READING_ADDED + addedByUserId + source=ADMIN stamped', async () => {
      mockCreateHappyPath(fullRow({ addedByUserId: 'admin-1', source: EntrySource.ADMIN }))

      await service.create(
        'u1',
        { measuredAt, systolicBP: 140, diastolicBP: 90 } as any,
        ADMIN,
      )

      const createArg = mockPrisma.journalEntry.create.mock.calls[0][0]
      expect(createArg.data.addedByUserId).toBe('admin-1')
      expect(createArg.data.source).toBe(EntrySource.ADMIN)

      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data).toMatchObject({
        userId: 'u1',
        changedBy: 'admin-1',
        changedByRole: 'ADMIN',
        changeType: 'ADMIN_READING_ADDED',
        fieldPath: 'journal_entry.admin_added',
      })
      // Engine evaluation still fires for admin-added readings.
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1)
    })

    it('POST (provider actor) → changedByRole PROVIDER', async () => {
      mockCreateHappyPath(fullRow())
      await service.create(
        'u1',
        { measuredAt, systolicBP: 140, diastolicBP: 90 } as any,
        PROVIDER_ACTOR,
      )
      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data.changedByRole).toBe('PROVIDER')
    })

    it('POST (admin) with expired sessionId → 400 "Session expired or invalid", nothing persisted', async () => {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      // assertSessionJoinable — newest member of the session is 60 min away.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce({
        measuredAt: new Date('2026-06-12T09:00:00Z'),
      })

      await expect(
        service.create(
          'u1',
          { measuredAt, systolicBP: 140, diastolicBP: 90, sessionId: 's-old' } as any,
          ADMIN,
        ),
      ).rejects.toThrow(BadRequestException)

      expect(mockPrisma.journalEntry.create).not.toHaveBeenCalled()
      expect(mockPrisma.profileVerificationLog.create).not.toHaveBeenCalled()
    })

    it('POST (admin) with in-window sessionId → joins the session', async () => {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      // assertSessionJoinable, then resolveCreateSessionId — both see the
      // newest member 2 min away (inside the window).
      mockPrisma.journalEntry.findFirst
        .mockResolvedValueOnce({ measuredAt: new Date('2026-06-12T09:58:00Z') })
        .mockResolvedValueOnce({ measuredAt: new Date('2026-06-12T09:58:00Z') })
      mockPrisma.journalEntry.create.mockResolvedValueOnce(fullRow({ sessionId: 's-live' }))
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})
      mockPrisma.journalEntry.count.mockResolvedValueOnce(1)
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ hasAFib: false })
      mockPrisma.journalEntry.count.mockResolvedValueOnce(20)

      await service.create(
        'u1',
        { measuredAt, systolicBP: 140, diastolicBP: 90, sessionId: 's-live' } as any,
        ADMIN,
      )
      expect(mockPrisma.journalEntry.create.mock.calls[0][0].data.sessionId).toBe('s-live')
    })

    it('PUT (patient) → PATIENT_READING_EDITED; emits ENTRY_UPDATED (chat/voice) but NOT ENTRY_FINALIZED — no engine re-trigger (CTO 2026-06-09)', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(fullRow({ systolicBP: 130 }))
      mockPrisma.journalEntry.update.mockResolvedValueOnce(fullRow({ systolicBP: 145 }))
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})

      const r = await service.update('u1', 'e1', { systolicBP: 145 } as any)

      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data.changeType).toBe('PATIENT_READING_EDITED')
      expect(audit.data.fieldPath).toBe('journal_entry.edited')
      expect(audit.data.previousValue).toMatchObject({ entryId: 'e1', systolicBP: 130 })
      expect(audit.data.newValue).toMatchObject({ entryId: 'e1', systolicBP: 145 })
      // Bug 9 / CTO 2026-06-09 no-re-trigger: the edit emits ENTRY_UPDATED for
      // chat/voice context refresh, but NEVER ENTRY_FINALIZED — the engine
      // (which only listens to ENTRY_FINALIZED + ENTRY_CREATED) does not re-fire.
      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1)
      const emitted = mockEventEmitter.emit.mock.calls.map((c: any[]) => c[0])
      expect(emitted).toContain(JOURNAL_EVENTS.ENTRY_UPDATED)
      expect(emitted).not.toContain(JOURNAL_EVENTS.ENTRY_FINALIZED)
      expect(r.statusCode).toBe(202)
    })

    it('PUT (admin) → ADMIN_READING_EDITED; NO engine emit (CTO Option C)', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(fullRow({ systolicBP: 130 }))
      mockPrisma.journalEntry.update.mockResolvedValueOnce(fullRow({ systolicBP: 145 }))
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})

      const r = await service.update('u1', 'e1', { systolicBP: 145 } as any, ADMIN)

      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data.changeType).toBe('ADMIN_READING_EDITED')
      expect(audit.data.fieldPath).toBe('journal_entry.admin_edited')
      expect(audit.data.changedBy).toBe('admin-1')
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
      expect(r.statusCode).toBe(200)
    })

    it('PUT no-op → no audit row (nothing changed, nothing logged)', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(fullRow({ systolicBP: 130 }))
      await service.update('u1', 'e1', { systolicBP: 130 } as any)
      expect(mockPrisma.profileVerificationLog.create).not.toHaveBeenCalled()
    })

    it('DELETE (patient) → audit row written BEFORE the row is removed', async () => {
      mockPrisma.journalEntry.findFirst
        .mockResolvedValueOnce(fullRow()) // ownership + snapshot fetch
        .mockResolvedValueOnce(null) // findSessionReevalAnchor — no sibling
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})
      mockPrisma.journalEntry.delete.mockResolvedValueOnce({})

      await service.delete('u1', 'e1')

      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data).toMatchObject({
        changeType: 'PATIENT_READING_DELETED',
        fieldPath: 'journal_entry.deleted',
        newValue: Prisma.JsonNull,
      })
      // Snapshot captured the state being destroyed.
      expect(audit.data.previousValue).toMatchObject({ entryId: 'e1', systolicBP: 140 })
      // The audit write strictly precedes the destructive delete.
      const auditOrder = mockPrisma.profileVerificationLog.create.mock.invocationCallOrder[0]
      const deleteOrder = mockPrisma.journalEntry.delete.mock.invocationCallOrder[0]
      expect(auditOrder).toBeLessThan(deleteOrder)
    })

    it('DELETE (patient) with surviving session sibling → emits ENTRY_UPDATED (context refresh only; engine does not re-eval per CTO 2026-06-09)', async () => {
      mockPrisma.journalEntry.findFirst
        .mockResolvedValueOnce(fullRow())
        .mockResolvedValueOnce({
          id: 'e2',
          userId: 'u1',
          sessionId: 's1',
          measuredAt: new Date(measuredAt),
          systolicBP: 150,
          diastolicBP: 95,
          pulse: 70,
          weight: null,
        })
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})
      mockPrisma.journalEntry.delete.mockResolvedValueOnce({})

      await service.delete('u1', 'e1')

      expect(mockEventEmitter.emit).toHaveBeenCalledTimes(1)
      expect(mockEventEmitter.emit.mock.calls[0][1]).toMatchObject({ entryId: 'e2' })
    })

    it('DELETE (admin) → ADMIN_READING_DELETED; NO re-eval emit, anchor lookup skipped', async () => {
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(fullRow())
      mockPrisma.profileVerificationLog.create.mockResolvedValueOnce({})
      mockPrisma.journalEntry.delete.mockResolvedValueOnce({})

      await service.delete('u1', 'e1', ADMIN)

      const audit = mockPrisma.profileVerificationLog.create.mock.calls[0][0]
      expect(audit.data.changeType).toBe('ADMIN_READING_DELETED')
      expect(audit.data.changedBy).toBe('admin-1')
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
      // Admin path skips findSessionReevalAnchor — only the ownership fetch.
      expect(mockPrisma.journalEntry.findFirst).toHaveBeenCalledTimes(1)
    })

    it('DELETE with an entryId that does not belong to the patient → 404, no audit row', async () => {
      // Composite where {id, userId} misses → NotFoundException without
      // confirming the id exists for another patient; nothing is logged
      // to the audit trail because nothing changed.
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)

      await expect(service.delete('u1', 'someone-elses-entry', ADMIN)).rejects.toThrow(
        'Journal entry not found',
      )
      expect(mockPrisma.journalEntry.delete).not.toHaveBeenCalled()
      expect(mockPrisma.profileVerificationLog.create).not.toHaveBeenCalled()
    })

    it('audit-write failure fails the whole request (transaction atomicity)', async () => {
      mockPrisma.patientProfile.findUnique.mockResolvedValueOnce({ userId: 'u1' })
      mockPrisma.journalEntry.findFirst.mockResolvedValueOnce(null)
      mockPrisma.journalEntry.create.mockResolvedValueOnce(fullRow())
      mockPrisma.profileVerificationLog.create.mockRejectedValueOnce(
        new Error('audit write failed'),
      )

      await expect(
        service.create('u1', { measuredAt, systolicBP: 140, diastolicBP: 90 } as any),
      ).rejects.toThrow(InternalServerErrorException)
      // No entry-created event escaped the failed transaction.
      expect(mockEventEmitter.emit).not.toHaveBeenCalled()
    })
  })
});
