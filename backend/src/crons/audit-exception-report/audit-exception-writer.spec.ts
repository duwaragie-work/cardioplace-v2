import { jest } from '@jest/globals'
import {
  AuditExceptionDetectorId,
  AuditExceptionSeverity,
  AuditExceptionStatus,
} from '../../generated/prisma/enums.js'
import { AuditExceptionWriter } from './audit-exception-writer.js'
import type { ExceptionCandidate } from './detector.types.js'

function makePrisma(existing: {
  id: string
  status: AuditExceptionStatus
} | null = null) {
  const findUnique = jest.fn<any>().mockResolvedValue(existing)
  const create = jest.fn<any>().mockResolvedValue({ id: 'created-1' })
  const update = jest.fn<any>().mockResolvedValue({ id: existing?.id ?? 'updated-1' })
  return {
    prisma: { auditException: { findUnique, create, update } } as any,
    findUnique,
    create,
    update,
  }
}

function makeCandidate(overrides: Partial<ExceptionCandidate> = {}): ExceptionCandidate {
  return {
    subjectKey: 'actor:u-1',
    summary: 'sample summary',
    evidence: { actorId: 'u-1', count: 42 },
    practiceContext: 'practice-a',
    ...overrides,
  }
}

const WINDOW_START = new Date('2026-07-10T00:00:00.000Z')
const WINDOW_END = new Date('2026-07-11T00:00:00.000Z')

describe('AuditExceptionWriter — N7', () => {
  it('builds a deterministic idempotency key from (detectorId, subjectKey, windowStart)', () => {
    const { prisma } = makePrisma()
    const w = new AuditExceptionWriter(prisma)
    const key = w.buildIdempotencyKey(
      AuditExceptionDetectorId.BULK_PHI_READ,
      'actor:u-1',
      WINDOW_START,
    )
    expect(key).toBe('BULK_PHI_READ:actor:u-1:2026-07-10T00:00:00.000Z')
  })

  it('inserts a new AuditException row when no idempotency-key match exists', async () => {
    const { prisma, findUnique, create, update } = makePrisma(null)
    const w = new AuditExceptionWriter(prisma)

    const result = await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual({ outcome: 'created', id: 'created-1' })

    const createArgs = create.mock.calls[0][0] as any
    expect(createArgs.data.detectorId).toBe('BULK_PHI_READ')
    expect(createArgs.data.severity).toBe('HIGH')
    expect(createArgs.data.idempotencyKey).toBe(
      'BULK_PHI_READ:actor:u-1:2026-07-10T00:00:00.000Z',
    )
    expect(createArgs.data.practiceContext).toBe('practice-a')
  })

  it('candidate.severityOverride wins over defaultSeverity', async () => {
    const { prisma, create } = makePrisma(null)
    const w = new AuditExceptionWriter(prisma)

    await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate({ severityOverride: AuditExceptionSeverity.CRITICAL }),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    const createArgs = create.mock.calls[0][0] as any
    expect(createArgs.data.severity).toBe('CRITICAL')
  })

  it('updates the row when an OPEN row exists for the same idempotency key', async () => {
    const { prisma, create, update } = makePrisma({
      id: 'existing-1',
      status: AuditExceptionStatus.OPEN,
    })
    const w = new AuditExceptionWriter(prisma)

    const result = await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate({ evidence: { updated: true } }),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ outcome: 'updated', id: 'existing-1' })

    const updateArgs = update.mock.calls[0][0] as any
    expect(updateArgs.where).toEqual({ id: 'existing-1' })
    expect(updateArgs.data.evidence).toEqual({ updated: true })
  })

  it('preserves status on update — reviewer ACKNOWLEDGED rows are not re-opened', async () => {
    const { prisma, update } = makePrisma({
      id: 'ack-1',
      status: AuditExceptionStatus.ACKNOWLEDGED,
    })
    const w = new AuditExceptionWriter(prisma)

    await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    // No `status` field in the update payload — the row keeps ACKNOWLEDGED.
    const updateArgs = update.mock.calls[0][0] as any
    expect(updateArgs.data).not.toHaveProperty('status')
  })

  it('skips RESOLVED rows — sticky-resolved semantics', async () => {
    const { prisma, create, update } = makePrisma({
      id: 'resolved-1',
      status: AuditExceptionStatus.RESOLVED,
    })
    const w = new AuditExceptionWriter(prisma)

    const result = await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(result).toEqual({
      outcome: 'sticky-skipped',
      id: 'resolved-1',
      status: 'RESOLVED',
    })
  })

  it('skips FALSE_POSITIVE rows — reviewer decision is durable', async () => {
    const { prisma, create, update } = makePrisma({
      id: 'fp-1',
      status: AuditExceptionStatus.FALSE_POSITIVE,
    })
    const w = new AuditExceptionWriter(prisma)

    const result = await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate(),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(result.outcome).toBe('sticky-skipped')
  })

  it('trims summary to 200 chars', async () => {
    const { prisma, create } = makePrisma(null)
    const w = new AuditExceptionWriter(prisma)
    const longSummary = 'x'.repeat(500)

    await w.upsert({
      detectorId: AuditExceptionDetectorId.BULK_PHI_READ,
      defaultSeverity: AuditExceptionSeverity.HIGH,
      candidate: makeCandidate({ summary: longSummary }),
      windowStart: WINDOW_START,
      windowEnd: WINDOW_END,
    })

    const createArgs = create.mock.calls[0][0] as any
    expect(createArgs.data.summary.length).toBe(200)
  })
})
