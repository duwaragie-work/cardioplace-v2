import { jest } from '@jest/globals'
import {
  isOffHours,
  OffHoursPhiAccessDetector,
} from './off-hours-phi-access.detector.js'
import type { DetectorContext } from '../detector.types.js'

function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { accessLog: { findMany } } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

function row(actorId: string, at: Date, modelName = 'User') {
  return { actorId, modelName, createdAt: at }
}

describe('isOffHours — N7 helper', () => {
  it('flags weekend UTC times as off-hours (any hour)', () => {
    // 2026-07-11 is a Saturday. 15:00 UTC = 11:00 ET — daytime, but weekend.
    expect(isOffHours(new Date('2026-07-11T15:00:00Z'))).toBe(true)
  })

  it('flags pre-06:00 ET weekday as off-hours', () => {
    // Monday 2026-07-13 09:00 UTC = 05:00 ET (before 06:00 → off-hours)
    expect(isOffHours(new Date('2026-07-13T09:00:00Z'))).toBe(true)
  })

  it('flags post-22:00 ET weekday as off-hours', () => {
    // Monday 2026-07-13 03:00 UTC = 2026-07-12 23:00 ET (after 22:00 → off-hours)
    expect(isOffHours(new Date('2026-07-13T03:00:00Z'))).toBe(true)
  })

  it('does NOT flag mid-day ET weekday', () => {
    // Monday 2026-07-13 17:00 UTC = 13:00 ET → in-hours
    expect(isOffHours(new Date('2026-07-13T17:00:00Z'))).toBe(false)
  })
})

describe('OffHoursPhiAccessDetector — N7', () => {
  it('no candidates when the actor has ≤5 off-hours reads', async () => {
    const detector = new OffHoursPhiAccessDetector()
    // 5 weekend reads by the same actor — exactly at threshold, does NOT fire.
    const rows = Array.from({ length: 5 }, (_, i) =>
      row('u-a', new Date('2026-07-11T15:00:00Z')),
    )
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toEqual([])
  })

  it('fires when actor exceeds 5 off-hours reads', async () => {
    const detector = new OffHoursPhiAccessDetector()
    // 6 weekend reads → 1 candidate.
    const rows = Array.from({ length: 6 }, (_, i) =>
      row('u-a', new Date('2026-07-11T15:00:00Z')),
    )
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].subjectKey).toBe('actor:u-a')
    expect(candidates[0].evidence.offHoursReadCount).toBe(6)
  })

  it('mid-day-ET weekday reads are excluded from the off-hours count', async () => {
    const detector = new OffHoursPhiAccessDetector()
    // 10 in-hours (Mon 13:00 ET) + 2 off-hours → 2 not enough, no candidate.
    const inHours = Array.from({ length: 10 }, () =>
      row('u-a', new Date('2026-07-13T17:00:00Z')),
    )
    const offHours = Array.from({ length: 2 }, () =>
      row('u-a', new Date('2026-07-13T03:00:00Z')),
    )
    const candidates = await detector.scan(makeCtx([...inHours, ...offHours]))
    expect(candidates).toEqual([])
  })
})
