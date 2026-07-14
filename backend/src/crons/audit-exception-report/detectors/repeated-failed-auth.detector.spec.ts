import { jest } from '@jest/globals'
import { AuditExceptionSeverity } from '../../../generated/prisma/enums.js'
import { RepeatedFailedAuthDetector } from './repeated-failed-auth.detector.js'
import type { DetectorContext } from '../detector.types.js'

function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { authLog: { findMany } } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

function row(
  identifier: string,
  minutesAgo: number,
  extra: Partial<{ ipAddress: string; userId: string; event: string; practiceContext: string }> = {},
) {
  return {
    identifier,
    userId: extra.userId ?? null,
    ipAddress: extra.ipAddress ?? '10.0.0.1',
    event: extra.event ?? 'otp_failed',
    errorCode: null,
    practiceContext: extra.practiceContext ?? null,
    createdAt: new Date(Date.parse('2026-07-10T12:00:00Z') - minutesAgo * 60_000),
  }
}

describe('RepeatedFailedAuthDetector — N7', () => {
  it('no candidates when there are no failed rows', async () => {
    const detector = new RepeatedFailedAuthDetector()
    expect(await detector.scan(makeCtx([]))).toEqual([])
  })

  it('does NOT fire below the 5-attempt threshold', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rows = Array.from({ length: 4 }, (_, i) => row('bad@example.com', i))
    expect(await detector.scan(makeCtx(rows))).toEqual([])
  })

  it('fires HIGH at ≥5 failed attempts', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rows = Array.from({ length: 6 }, (_, i) => row('bad@example.com', i))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].subjectKey).toBe('identifier:bad@example.com')
    expect(candidates[0].severityOverride).toBeUndefined()
    expect(candidates[0].evidence.failedCount).toBe(6)
  })

  it('bumps to CRITICAL at ≥50 failed attempts', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rows = Array.from({ length: 55 }, (_, i) => row('bad@example.com', i * 0.1))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates[0].severityOverride).toBe(AuditExceptionSeverity.CRITICAL)
  })

  it('groups per-identifier — one candidate per unique identifier over threshold', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rowsA = Array.from({ length: 6 }, (_, i) => row('a@example.com', i))
    const rowsB = Array.from({ length: 6 }, (_, i) => row('b@example.com', i))
    const candidates = await detector.scan(makeCtx([...rowsA, ...rowsB]))
    expect(candidates).toHaveLength(2)
  })

  it('tracks distinct IPs in evidence', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rows = [
      ...Array.from({ length: 3 }, () => row('bad@example.com', 1, { ipAddress: '10.0.0.1' })),
      ...Array.from({ length: 3 }, () => row('bad@example.com', 1, { ipAddress: '10.0.0.2' })),
    ]
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates[0].evidence.distinctIpCount).toBe(2)
  })

  it('populates practiceContext with the most-common value across the failed rows', async () => {
    const detector = new RepeatedFailedAuthDetector()
    const rows = [
      ...Array.from({ length: 4 }, () =>
        row('bad@example.com', 1, { practiceContext: 'practice-a' }),
      ),
      ...Array.from({ length: 2 }, () =>
        row('bad@example.com', 1, { practiceContext: 'practice-b' }),
      ),
    ]
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates[0].practiceContext).toBe('practice-a')
  })
})
