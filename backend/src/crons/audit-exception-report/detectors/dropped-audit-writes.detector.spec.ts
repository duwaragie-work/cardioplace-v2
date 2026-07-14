import { jest } from '@jest/globals'
import { DroppedAuditWritesDetector } from './dropped-audit-writes.detector.js'
import type { DetectorContext } from '../detector.types.js'

function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { auditWriteFailureTally: { findMany } } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

describe('DroppedAuditWritesDetector — N7', () => {
  it('no candidates when there are no tally rows', async () => {
    expect(await new DroppedAuditWritesDetector().scan(makeCtx([]))).toEqual([])
  })

  it('fires one candidate per kind', async () => {
    const rows = [
      { kind: 'access-log', hourBucket: new Date('2026-07-10T02:00:00Z'), count: 5, lastError: 'DB down' },
      { kind: 'access-log', hourBucket: new Date('2026-07-10T03:00:00Z'), count: 3, lastError: 'DB down' },
      { kind: 'auth-log', hourBucket: new Date('2026-07-10T04:00:00Z'), count: 2, lastError: 'timeout' },
    ]
    const candidates = await new DroppedAuditWritesDetector().scan(makeCtx(rows))
    expect(candidates).toHaveLength(2)
    const byKind = new Map(candidates.map((c) => [c.subjectKey, c]))
    expect(byKind.get('kind:access-log')?.evidence.totalCount).toBe(8)
    expect(byKind.get('kind:access-log')?.evidence.bucketCount).toBe(2)
    expect(byKind.get('kind:auth-log')?.evidence.totalCount).toBe(2)
  })

  it('practiceContext is always null (system-wide detector)', async () => {
    const rows = [
      { kind: 'access-log', hourBucket: new Date('2026-07-10T02:00:00Z'), count: 5, lastError: null },
    ]
    const candidates = await new DroppedAuditWritesDetector().scan(makeCtx(rows))
    expect(candidates[0].practiceContext).toBeNull()
  })

  it('surfaces last-error text in the hourly breakdown for triage context', async () => {
    const rows = [
      { kind: 'access-log', hourBucket: new Date('2026-07-10T02:00:00Z'), count: 5, lastError: 'ETIMEDOUT' },
    ]
    const candidates = await new DroppedAuditWritesDetector().scan(makeCtx(rows))
    const hourly = candidates[0].evidence.hourlyBreakdown as any[]
    expect(hourly[0].lastError).toBe('ETIMEDOUT')
  })
})
