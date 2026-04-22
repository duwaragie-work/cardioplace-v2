import { SessionAveragerService } from './session-averager.service.js'

function entry(over: Partial<any> = {}) {
  return {
    id: over.id ?? 'e1',
    userId: 'user-1',
    measuredAt: over.measuredAt ?? new Date('2026-04-22T08:00:00Z'),
    systolicBP: 130,
    diastolicBP: 80,
    pulse: 72,
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
})
