import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { UnauthorizedException } from '@nestjs/common'
import { JwtStrategy } from './jwt.strategy.js'

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1) — when the
 * access token carries an activePracticeId claim, JwtStrategy.validate()
 * must accept membership from EITHER PracticeProvider (PROVIDER / MED_DIR)
 * OR PracticeCoordinator (COORDINATOR, 1:1 by userId).
 *
 * Regression context: the prior implementation only checked
 * PracticeProvider, which silently 401'd every authenticated COORDINATOR
 * request — the admin shell would mount + spin forever because /me + every
 * /admin/* endpoint came back 401 with errorCode PRACTICE_MEMBERSHIP_REVOKED.
 * Playwright surfacing: 35.4 / 35.5 / 37.1 / 37.3 / 37.4 / 38.1 / 38.2
 * (UI 30s timeouts) and 38.3 (API checks returning 401 instead of 200/403).
 */
describe('JwtStrategy.validate — practice membership probe', () => {
  function buildStrategy(prismaMock: any) {
    const config = { get: () => 'test-secret' } as unknown as ConfigService
    return new JwtStrategy(config, prismaMock as any)
  }

  it('no activePracticeId → never queries either relation, returns user verbatim', async () => {
    const prisma = {
      practiceProvider: { findUnique: jest.fn() },
      practiceCoordinator: { findUnique: jest.fn() },
    }
    const strat = buildStrategy(prisma)
    const result = await strat.validate({
      sub: 'u1',
      email: 'org@admin.test',
      roles: ['SUPER_ADMIN'] as any,
    })
    expect(result).toEqual({
      id: 'u1',
      email: 'org@admin.test',
      roles: ['SUPER_ADMIN'],
      activePracticeId: null,
    })
    expect(prisma.practiceProvider.findUnique).not.toHaveBeenCalled()
    expect(prisma.practiceCoordinator.findUnique).not.toHaveBeenCalled()
  })

  it('PROVIDER membership in PracticeProvider for the active practice → allowed', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pp-1' } as any),
      },
      practiceCoordinator: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
    }
    const strat = buildStrategy(prisma)
    const result = await strat.validate({
      sub: 'u2',
      email: 'prov@admin.test',
      roles: ['PROVIDER'] as any,
      activePracticeId: 'p-cedar',
    })
    expect(result.activePracticeId).toBe('p-cedar')
    expect(prisma.practiceProvider.findUnique).toHaveBeenCalledWith({
      where: { practiceId_userId: { practiceId: 'p-cedar', userId: 'u2' } },
      select: { id: true },
    })
  })

  // Regression — this is the COORDINATOR path that was previously 401'd.
  it('COORDINATOR — no PracticeProvider row, PracticeCoordinator points at the active practice → allowed', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
      practiceCoordinator: {
        findUnique: jest.fn().mockResolvedValue({ practiceId: 'p-cedar' } as any),
      },
    }
    const strat = buildStrategy(prisma)
    const result = await strat.validate({
      sub: 'coord-1',
      email: 'coord@admin.test',
      roles: ['COORDINATOR'] as any,
      activePracticeId: 'p-cedar',
    })
    expect(result).toEqual({
      id: 'coord-1',
      email: 'coord@admin.test',
      roles: ['COORDINATOR'],
      activePracticeId: 'p-cedar',
    })
    expect(prisma.practiceCoordinator.findUnique).toHaveBeenCalledWith({
      where: { userId: 'coord-1' },
      select: { practiceId: true },
    })
  })

  it('COORDINATOR — PracticeCoordinator points at a DIFFERENT practice → PRACTICE_MEMBERSHIP_REVOKED', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
      practiceCoordinator: {
        findUnique: jest.fn().mockResolvedValue({ practiceId: 'p-bridge' } as any),
      },
    }
    const strat = buildStrategy(prisma)
    await expect(
      strat.validate({
        sub: 'coord-2',
        email: 'c@admin.test',
        roles: ['COORDINATOR'] as any,
        activePracticeId: 'p-cedar',
      }),
    ).rejects.toThrow(UnauthorizedException)
  })

  it('no membership in EITHER relation → PRACTICE_MEMBERSHIP_REVOKED', async () => {
    const prisma = {
      practiceProvider: { findUnique: jest.fn().mockResolvedValue(null as any) },
      practiceCoordinator: { findUnique: jest.fn().mockResolvedValue(null as any) },
    }
    const strat = buildStrategy(prisma)
    let thrown: unknown
    try {
      await strat.validate({
        sub: 'u3',
        email: 'orphan@admin.test',
        roles: ['PROVIDER'] as any,
        activePracticeId: 'p-cedar',
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException)
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      errorCode: 'PRACTICE_MEMBERSHIP_REVOKED',
    })
  })
})
