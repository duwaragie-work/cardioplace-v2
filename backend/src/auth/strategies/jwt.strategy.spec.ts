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
    // phase/28 — validate() now always reads the account's tokenVersion +
    // accountStatus first (the session kill-switch). Default every mock to an
    // ACTIVE, version-0 account so the pre-existing practice-membership tests
    // exercise only their intended path; the kill-switch cases set their own.
    if (!prismaMock.user) {
      prismaMock.user = {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tokenVersion: 0, accountStatus: 'ACTIVE' } as any),
      }
    }
    const config = {
      get: () => 'test-secret',
      getOrThrow: () => 'test-secret',
    } as unknown as ConfigService
    return new JwtStrategy(config, prismaMock as any)
  }

  it('no activePracticeId → never queries either relation, returns user verbatim', async () => {
    const prisma = {
      practiceProvider: { findUnique: jest.fn() },
      practiceMedicalDirector: { findUnique: jest.fn() },
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
    expect(prisma.practiceMedicalDirector.findUnique).not.toHaveBeenCalled()
    expect(prisma.practiceCoordinator.findUnique).not.toHaveBeenCalled()
  })

  it('PROVIDER membership in PracticeProvider for the active practice → allowed', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pp-1' } as any),
      },
      practiceMedicalDirector: {
        findUnique: jest.fn().mockResolvedValue(null as any),
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

  // PR #90 regression — a MED_DIR heads a practice via PracticeMedicalDirector,
  // NOT PracticeProvider. Omitting that relation bounced every medicalDirector
  // to /sign-in/select-practice?reason=membership-changed right after sign-in.
  it('MEDICAL_DIRECTOR — no PracticeProvider row, PracticeMedicalDirector for the active practice → allowed', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
      practiceMedicalDirector: {
        findUnique: jest.fn().mockResolvedValue({ id: 'pmd-1' } as any),
      },
      practiceCoordinator: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
    }
    const strat = buildStrategy(prisma)
    const result = await strat.validate({
      sub: 'md-1',
      email: 'md@admin.test',
      roles: ['MEDICAL_DIRECTOR'] as any,
      activePracticeId: 'p-cedar',
    })
    expect(result.activePracticeId).toBe('p-cedar')
    expect(prisma.practiceMedicalDirector.findUnique).toHaveBeenCalledWith({
      where: { practiceId_userId: { practiceId: 'p-cedar', userId: 'md-1' } },
      select: { id: true },
    })
  })

  // Regression — this is the COORDINATOR path that was previously 401'd.
  it('COORDINATOR — no PracticeProvider row, PracticeCoordinator points at the active practice → allowed', async () => {
    const prisma = {
      practiceProvider: {
        findUnique: jest.fn().mockResolvedValue(null as any),
      },
      practiceMedicalDirector: {
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
      practiceMedicalDirector: {
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

  // ── phase/28 session kill-switch ────────────────────────────────────────

  it('stale tokenVersion (payload < account) → TOKEN_REVOKED', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tokenVersion: 2, accountStatus: 'ACTIVE' } as any),
      },
    }
    const strat = buildStrategy(prisma)
    let thrown: unknown
    try {
      await strat.validate({
        sub: 'u9',
        email: 'stale@test',
        roles: ['PATIENT'] as any,
        tokenVersion: 1,
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException)
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      errorCode: 'TOKEN_REVOKED',
    })
  })

  it('legacy token (no tokenVersion claim) still passes when account is at 0', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ tokenVersion: 0, accountStatus: 'ACTIVE' } as any),
      },
    }
    const strat = buildStrategy(prisma)
    const result = await strat.validate({
      sub: 'u10',
      email: 'legacy@test',
      roles: ['PATIENT'] as any,
    })
    expect(result.id).toBe('u10')
  })

  it('non-ACTIVE account (deactivated) → ACCOUNT_INACTIVE', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue({
          tokenVersion: 0,
          accountStatus: 'DEACTIVATED',
        } as any),
      },
    }
    const strat = buildStrategy(prisma)
    let thrown: unknown
    try {
      await strat.validate({
        sub: 'u11',
        email: 'off@test',
        roles: ['PATIENT'] as any,
        tokenVersion: 0,
      })
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(UnauthorizedException)
    expect((thrown as UnauthorizedException).getResponse()).toMatchObject({
      errorCode: 'ACCOUNT_INACTIVE',
    })
  })

  it('account no longer exists → 401', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue(null as any) },
    }
    const strat = buildStrategy(prisma)
    await expect(
      strat.validate({
        sub: 'ghost',
        email: 'ghost@test',
        roles: ['PATIENT'] as any,
      }),
    ).rejects.toThrow(UnauthorizedException)
  })

  // Humaira N4 — fail closed on a missing signing secret. With the old
  // config.get(..., 'fallback-secret') default, an unset JWT_ACCESS_SECRET
  // silently signed/verified tokens with the known constant 'fallback-secret',
  // letting anyone who's read the source forge access tokens. getOrThrow makes
  // the strategy constructor throw at boot, so the process never comes up in
  // that state.
  it('missing JWT_ACCESS_SECRET → constructor throws (fail closed, no fallback)', () => {
    const prisma = {
      practiceProvider: { findUnique: jest.fn() },
      practiceMedicalDirector: { findUnique: jest.fn() },
      practiceCoordinator: { findUnique: jest.fn() },
    }
    // Mirror ConfigService.getOrThrow's real behaviour when the key is absent.
    const config = {
      get: () => undefined,
      getOrThrow: (key: string) => {
        throw new Error(`Configuration key "${key}" does not exist`)
      },
    } as unknown as ConfigService
    expect(() => new JwtStrategy(config, prisma as any)).toThrow(
      /JWT_ACCESS_SECRET/,
    )
  })

  it('no membership in ANY of the three relations → PRACTICE_MEMBERSHIP_REVOKED', async () => {
    const prisma = {
      practiceProvider: { findUnique: jest.fn().mockResolvedValue(null as any) },
      practiceMedicalDirector: { findUnique: jest.fn().mockResolvedValue(null as any) },
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
