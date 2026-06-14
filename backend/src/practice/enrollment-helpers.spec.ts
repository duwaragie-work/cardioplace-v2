import { jest } from '@jest/globals'
import { wasEverEnrolled } from './enrollment-helpers.js'
import type { PrismaService } from '../prisma/prisma.service.js'

// Manisha 2026-06-12 — was-ever-enrolled predicate that powers the escalation
// dispatch bypass + the admin "threshold pending" badge. The DB enforces the
// real semantics (a previousValue=ENROLLED revert row matches the OR clause);
// here we prove (a) the query is shaped to catch BOTH directions and (b) the
// boolean mapping (row → true, null → false). The live Playwright flow exercises
// the real Postgres match for a seeded, auto-un-enrolled patient.

function makePrisma(result: { id: string } | null) {
  const findFirst = jest.fn() as jest.Mock<any>
  findFirst.mockResolvedValue(result)
  return {
    prisma: { profileVerificationLog: { findFirst } } as unknown as PrismaService,
    findFirst,
  }
}

describe('wasEverEnrolled', () => {
  it('returns false when no enrollment-audit row exists (never enrolled)', async () => {
    const { prisma } = makePrisma(null)
    expect(await wasEverEnrolled(prisma, 'p1')).toBe(false)
  })

  it('returns true when a matching audit row exists (enrolled or auto-un-enrolled)', async () => {
    const { prisma } = makePrisma({ id: 'log-1' })
    expect(await wasEverEnrolled(prisma, 'p1')).toBe(true)
  })

  it('queries with the defensive OR predicate covering both directions', async () => {
    const { prisma, findFirst } = makePrisma(null)
    await wasEverEnrolled(prisma, 'p1')
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'p1',
        fieldPath: 'user.enrollmentStatus',
        OR: [
          { newValue: { equals: 'ENROLLED' } },
          { previousValue: { equals: 'ENROLLED' } },
        ],
      },
      select: { id: true },
    })
  })
})
