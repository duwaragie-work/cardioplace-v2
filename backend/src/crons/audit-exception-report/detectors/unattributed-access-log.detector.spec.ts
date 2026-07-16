import { jest } from '@jest/globals'
import { UnattributedAccessLogDetector } from './unattributed-access-log.detector.js'
import type { DetectorContext } from '../detector.types.js'

// N-3 — sibling to unattributed-system-disclosure.detector.spec.ts. Same
// grouping semantics (collapse a mis-wired surface to one candidate),
// different table (AccessLog) and different key (modelName+action).

function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { accessLog: { findMany } } as any,
    now: new Date('2026-07-16T12:00:00Z'),
    windowStart: new Date('2026-07-15T12:00:00Z'),
    windowEnd: new Date('2026-07-16T12:00:00Z'),
  }
}

function row(
  modelName: string,
  action: 'READ' | 'WRITE' | 'DELETE',
  id: string,
  minutesAgo = 0,
) {
  return {
    id,
    modelName,
    action,
    recordId: `rec-${id}`,
    ip: '127.0.0.1',
    userAgent: 'jest',
    createdAt: new Date(
      Date.parse('2026-07-16T12:00:00Z') - minutesAgo * 60_000,
    ),
  }
}

describe('UnattributedAccessLogDetector — N-3', () => {
  it('no candidates when there are no unattributed rows', async () => {
    const detector = new UnattributedAccessLogDetector()
    expect(await detector.scan(makeCtx([]))).toEqual([])
  })

  it('groups by (modelName, action) — one candidate per surface', async () => {
    const rows = [
      row('User', 'READ', 'a-1', 60),
      row('User', 'READ', 'a-2', 30),
      row('JournalEntry', 'READ', 'a-3', 20),
      row('JournalEntry', 'WRITE', 'a-4', 15),
    ]
    const candidates = await new UnattributedAccessLogDetector().scan(makeCtx(rows))
    expect(candidates).toHaveLength(3)
    const surfaces = candidates.map((c) => c.subjectKey).sort()
    expect(surfaces).toEqual([
      'surface:JournalEntry:READ',
      'surface:JournalEntry:WRITE',
      'surface:User:READ',
    ])
  })

  it('collapses a large mis-wired surface (thousands of rows) into ONE finding', async () => {
    // The pre-N-3 jwt.strategy scenario — one query fires on every request,
    // producing thousands of `User:READ` rows. The reviewer should see one
    // exception, not thousands.
    const rows = Array.from({ length: 2500 }, (_, i) =>
      row('User', 'READ', `a-${i}`, i % 60),
    )
    const candidates = await new UnattributedAccessLogDetector().scan(makeCtx(rows))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].evidence.totalCount).toBe(2500)
    const sample = candidates[0].evidence.sample as any[]
    expect(sample.length).toBe(5) // capped at 5
  })

  it('evidence carries modelName + action + first/last timestamps', async () => {
    const rows = [
      row('User', 'READ', 'a-1', 60),
      row('User', 'READ', 'a-2', 10),
    ]
    const candidates = await new UnattributedAccessLogDetector().scan(makeCtx(rows))
    expect(candidates[0].evidence.modelName).toBe('User')
    expect(candidates[0].evidence.action).toBe('READ')
    expect(typeof candidates[0].evidence.firstCreatedAt).toBe('string')
    expect(typeof candidates[0].evidence.lastCreatedAt).toBe('string')
  })

  it('practiceContext is null (attribution failed at source)', async () => {
    const rows = [row('User', 'READ', 'a-1')]
    const candidates = await new UnattributedAccessLogDetector().scan(makeCtx(rows))
    expect(candidates[0].practiceContext).toBeNull()
  })

  it('queries the exact "system: unknown" shape (actorType=SYSTEM_ACTOR + actorId=null + systemActorLabel=null)', async () => {
    const findMany = jest.fn<any>().mockResolvedValue([])
    const ctx: DetectorContext = {
      prisma: { accessLog: { findMany } } as any,
      now: new Date('2026-07-16T12:00:00Z'),
      windowStart: new Date('2026-07-15T12:00:00Z'),
      windowEnd: new Date('2026-07-16T12:00:00Z'),
    }
    await new UnattributedAccessLogDetector().scan(ctx)
    expect(findMany).toHaveBeenCalledTimes(1)
    const where = findMany.mock.calls[0][0].where
    expect(where.actorType).toBe('SYSTEM_ACTOR')
    expect(where.actorId).toBeNull()
    expect(where.systemActorLabel).toBeNull()
  })
})
