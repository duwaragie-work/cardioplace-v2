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
    update: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
  deviationAlert: { findMany: jest.fn() },
  patientProfile: { findUnique: jest.fn() },
  rejectedReadingLog: { create: jest.fn() },
  notification: { findMany: jest.fn(), count: jest.fn() },
  // withConnectionRetry just runs the thunk in tests. Set at definition so
  // clearAllMocks (which keeps implementations) doesn't strip it.
  withConnectionRetry: jest.fn((fn: any) => fn()),
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
});
