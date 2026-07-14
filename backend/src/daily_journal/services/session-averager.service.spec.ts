import { jest } from '@jest/globals'
import { SESSION_WINDOW_MS } from '@cardioplace/shared'
import { SessionAveragerService } from './session-averager.service.js'

function entry(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'e1',
    userId: 'user-1',
    measuredAt: over.measuredAt ?? new Date('2026-04-22T08:00:00Z'),
    systolicBP: 130,
    diastolicBP: 80,
    pulse: 72,
    weight: null,
    measurementConditions: null,
    sessionId: over.sessionId ?? null,
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
    otherSymptoms: [] as string[],
    ...over,
  }
}

describe('SessionAveragerService.aggregate (C.1 session averaging)', () => {
  it('single reading → processed as-is', () => {
    const anchor = entry({ id: 'e1', systolicBP: 160, diastolicBP: 95, pulse: 80 })
    const r = SessionAveragerService.aggregate(anchor, [anchor])
    expect(r?.systolicBP).toBe(160)
    expect(r?.diastolicBP).toBe(95)
    expect(r?.pulse).toBe(80)
    expect(r?.readingCount).toBe(1)
  })

  it('two readings in same session → mean rounded', () => {
    const a = entry({
      id: 'a',
      systolicBP: 160,
      diastolicBP: 90,
      pulse: 70,
      sessionId: 's1',
    })
    const b = entry({
      id: 'b',
      systolicBP: 140,
      diastolicBP: 80,
      pulse: 80,
      sessionId: 's1',
      measuredAt: new Date('2026-04-22T08:10:00Z'),
    })
    const r = SessionAveragerService.aggregate(a, [a, b])
    expect(r?.systolicBP).toBe(150)
    expect(r?.diastolicBP).toBe(85)
    expect(r?.pulse).toBe(75)
    expect(r?.readingCount).toBe(2)
  })

  it('≥3 readings mean uses all, not just first 2', () => {
    const a = entry({ id: 'a', systolicBP: 160, sessionId: 's1' })
    const b = entry({ id: 'b', systolicBP: 170, sessionId: 's1', measuredAt: new Date('2026-04-22T08:05:00Z') })
    const c = entry({ id: 'c', systolicBP: 180, sessionId: 's1', measuredAt: new Date('2026-04-22T08:10:00Z') })
    const r = SessionAveragerService.aggregate(a, [a, b, c])
    expect(r?.systolicBP).toBe(170)
    expect(r?.readingCount).toBe(3)
  })

  it('OR-reduces symptoms across readings', () => {
    const a = entry({ id: 'a', sessionId: 's1', severeHeadache: true })
    const b = entry({
      id: 'b',
      sessionId: 's1',
      measuredAt: new Date('2026-04-22T08:05:00Z'),
      chestPainOrDyspnea: true,
    })
    const r = SessionAveragerService.aggregate(a, [a, b])
    expect(r?.symptoms.severeHeadache).toBe(true)
    expect(r?.symptoms.chestPainOrDyspnea).toBe(true)
    expect(r?.symptoms.visualChanges).toBe(false)
  })

  it('any false item on any reading → suboptimalMeasurement=true', () => {
    const a = entry({
      id: 'a',
      sessionId: 's1',
      measurementConditions: { noCaffeine: true, seatedRest: false },
    })
    const r = SessionAveragerService.aggregate(a, [a])
    expect(r?.suboptimalMeasurement).toBe(true)
  })

  it('all items true → suboptimalMeasurement=false', () => {
    const a = entry({
      id: 'a',
      sessionId: 's1',
      measurementConditions: { noCaffeine: true },
    })
    const r = SessionAveragerService.aggregate(a, [a])
    expect(r?.suboptimalMeasurement).toBe(false)
  })

  // Bug #5 (confirmed live 2026-05-13) — the check-in form ALWAYS sends all
  // 8 checklist keys, each defaulting to `false` when the box is unchecked.
  // A patient who skips the optional pre-measurement checklist therefore
  // sends an all-`false` object. That must NOT be flagged suboptimal: it
  // means "checklist not completed", not "measured badly".
  it('bug #5 — all-false 8-key checklist (patient skipped it) → suboptimalMeasurement=false', () => {
    const a = entry({
      id: 'a',
      sessionId: 's1',
      measurementConditions: {
        noCaffeine: false,
        noSmoking: false,
        noExercise: false,
        bladderEmpty: false,
        seatedQuietly: false,
        posturalSupport: false,
        notTalking: false,
        cuffOnBareArm: false,
      },
    })
    const r = SessionAveragerService.aggregate(a, [a])
    expect(r?.suboptimalMeasurement).toBe(false)
  })

  it('bug #5 — engaged checklist with ≥1 unmet item still → suboptimalMeasurement=true', () => {
    const a = entry({
      id: 'a',
      sessionId: 's1',
      measurementConditions: { noCaffeine: true, noSmoking: true, seatedQuietly: false },
    })
    const r = SessionAveragerService.aggregate(a, [a])
    expect(r?.suboptimalMeasurement).toBe(true)
  })

  it('empty siblings → null', () => {
    const a = entry({ id: 'a' })
    expect(SessionAveragerService.aggregate(a, [])).toBeNull()
  })

  it('dedups otherSymptoms across readings', () => {
    const a = entry({ id: 'a', sessionId: 's1', otherSymptoms: ['dizzy'] })
    const b = entry({
      id: 'b',
      sessionId: 's1',
      measuredAt: new Date('2026-04-22T08:05:00Z'),
      otherSymptoms: ['dizzy', 'nausea'],
    })
    const r = SessionAveragerService.aggregate(a, [a, b])
    expect(r?.symptoms.otherSymptoms.sort()).toEqual(['dizzy', 'nausea'])
  })

  // Option D (Manisha 2026-06-12 Q2) — BP1 robustness. A slow retake can push
  // the held first-of-pair outside the averaging window, so it won't be a
  // sibling. averageForEntry fetches it directly by confirmsEntryId and passes
  // it as explicitOptionDFirst; aggregate must use that for BP1 (not "?/?").
  it('CONFIRMATORY anchor uses explicitOptionDFirst for BP1 even when the first reading is NOT a sibling', () => {
    const anchor = entry({
      id: 'second',
      systolicBP: 135,
      diastolicBP: 85,
      sessionId: 's1',
      emergencyConfirmation: 'CONFIRMATORY',
      confirmsEntryId: 'first-out-of-window',
    })
    // Only the anchor is in the sibling set (the first reading drifted out of
    // the window). Without the explicit param, BP1 would be null.
    const r = SessionAveragerService.aggregate(anchor, [anchor], {
      systolicBP: 195,
      diastolicBP: 120,
    })
    expect(r?.optionDInitialSystolicBP).toBe(195)
    expect(r?.optionDInitialDiastolicBP).toBe(120)
    expect(r?.emergencyConfirmation).toBe('CONFIRMATORY')
    // BP2 (the confirmatory anchor) is the submitted reading, not the average.
    expect(r?.submittedSystolicBP).toBe(135)
  })

  it('falls back to the sibling lookup for BP1 when no explicit first-of-pair is passed', () => {
    const first = entry({ id: 'first', systolicBP: 188, diastolicBP: 121, sessionId: 's1' })
    const anchor = entry({
      id: 'second',
      systolicBP: 140,
      diastolicBP: 88,
      sessionId: 's1',
      measuredAt: new Date('2026-04-22T08:02:00Z'),
      emergencyConfirmation: 'CONFIRMATORY',
      confirmsEntryId: 'first',
    })
    const r = SessionAveragerService.aggregate(anchor, [first, anchor])
    expect(r?.optionDInitialSystolicBP).toBe(188)
    expect(r?.optionDInitialDiastolicBP).toBe(121)
  })
})

describe('SessionAveragerService.loadSessionSiblings (window bound)', () => {
  const anchorAt = new Date('2026-05-22T10:00:00Z')

  function makeService() {
    const findUnique = jest.fn() as jest.Mock<any>
    const findMany = jest.fn() as jest.Mock<any>
    const prisma = { journalEntry: { findUnique, findMany } } as any
    return { service: new SessionAveragerService(prisma), findUnique, findMany }
  }

  it('bounds the non-null sessionId query by ±SESSION_WINDOW_MS (stale reuse can not average across hours)', async () => {
    const { service, findUnique, findMany } = makeService()
    findUnique.mockResolvedValueOnce({
      id: 'e1',
      userId: 'u1',
      sessionId: 's1',
      measuredAt: anchorAt,
    })
    findMany.mockResolvedValueOnce([])

    await service.averageForEntry('e1')

    const where = (findMany.mock.calls[0][0] as any).where
    expect(where.sessionId).toBe('s1')
    expect(where.measuredAt.gte).toEqual(new Date(anchorAt.getTime() - SESSION_WINDOW_MS))
    expect(where.measuredAt.lte).toEqual(new Date(anchorAt.getTime() + SESSION_WINDOW_MS))
  })

  it('bounds the null-session query by the same window', async () => {
    const { service, findUnique, findMany } = makeService()
    findUnique.mockResolvedValueOnce({
      id: 'e1',
      userId: 'u1',
      sessionId: null,
      measuredAt: anchorAt,
    })
    findMany.mockResolvedValueOnce([])

    await service.averageForEntry('e1')

    const where = (findMany.mock.calls[0][0] as any).where
    expect(where.sessionId).toBeNull()
    expect(where.measuredAt.gte).toEqual(new Date(anchorAt.getTime() - SESSION_WINDOW_MS))
    expect(where.measuredAt.lte).toEqual(new Date(anchorAt.getTime() + SESSION_WINDOW_MS))
  })
})
