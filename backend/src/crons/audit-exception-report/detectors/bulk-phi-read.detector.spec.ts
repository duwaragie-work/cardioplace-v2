import { jest } from '@jest/globals'
import { AuditExceptionSeverity } from '../../../generated/prisma/enums.js'
import { BulkPhiReadDetector } from './bulk-phi-read.detector.js'
import type { DetectorContext } from '../detector.types.js'

// Fake Prisma factory — only the AccessLog.findMany surface the detector uses.
function makeCtx(rows: any[]): DetectorContext {
  const findMany = jest.fn<any>().mockResolvedValue(rows)
  return {
    prisma: { accessLog: { findMany } } as any,
    now: new Date('2026-07-10T12:00:00Z'),
    windowStart: new Date('2026-07-09T12:00:00Z'),
    windowEnd: new Date('2026-07-10T12:00:00Z'),
  }
}

function row(actorId: string, minutesAgo: number, modelName = 'User', recordId = 'p-1') {
  return {
    actorId,
    modelName,
    recordId,
    createdAt: new Date(Date.parse('2026-07-10T12:00:00Z') - minutesAgo * 60_000),
  }
}

describe('BulkPhiReadDetector — N7', () => {
  it('returns no candidates when there are no reads', async () => {
    const detector = new BulkPhiReadDetector()
    const candidates = await detector.scan(makeCtx([]))
    expect(candidates).toEqual([])
  })

  it('does NOT fire below the 100/hour threshold', async () => {
    const detector = new BulkPhiReadDetector()
    const rows = Array.from({ length: 80 }, (_, i) => row('u-a', 30 - i * 0.1))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toEqual([])
  })

  it('fires with HIGH severity when an actor crosses 100 reads/hour', async () => {
    const detector = new BulkPhiReadDetector()
    // 150 reads within a 60-min window (all within 40 minutes)
    const rows = Array.from({ length: 150 }, (_, i) => row('u-a', 40 - i * 0.25))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toHaveLength(1)
    const c = candidates[0]
    expect(c.subjectKey).toBe('actor:u-a')
    expect(c.severityOverride).toBeUndefined() // HIGH default, no override
    expect(c.evidence.peakHourlyCount).toBeGreaterThan(100)
  })

  it('bumps to CRITICAL at 10× threshold (1000+ reads/hour)', async () => {
    const detector = new BulkPhiReadDetector()
    // 1050 reads within a 55-minute window
    const rows = Array.from({ length: 1050 }, (_, i) => row('u-a', 55 - i * 0.05))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates).toHaveLength(1)
    expect(candidates[0].severityOverride).toBe(AuditExceptionSeverity.CRITICAL)
  })

  it('groups per-actor — one candidate per actor over threshold', async () => {
    const detector = new BulkPhiReadDetector()
    const rowsA = Array.from({ length: 150 }, (_, i) => row('u-a', 40 - i * 0.25))
    const rowsB = Array.from({ length: 150 }, (_, i) => row('u-b', 40 - i * 0.25))
    const candidates = await detector.scan(makeCtx([...rowsA, ...rowsB]))
    expect(candidates).toHaveLength(2)
    const keys = candidates.map((c) => c.subjectKey).sort()
    expect(keys).toEqual(['actor:u-a', 'actor:u-b'])
  })

  it('practiceContext is null — reviewer resolves actor→practice in UI', async () => {
    const detector = new BulkPhiReadDetector()
    const rows = Array.from({ length: 150 }, (_, i) => row('u-a', 40 - i * 0.25))
    const candidates = await detector.scan(makeCtx(rows))
    expect(candidates[0].practiceContext).toBeNull()
  })
})
