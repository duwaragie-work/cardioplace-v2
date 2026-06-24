import { jest } from '@jest/globals'
import { ConflictException } from '@nestjs/common'
import { Test, type TestingModule } from '@nestjs/testing'
import { DisplayIdClass } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  computeCheckDigit,
  DisplayIdService,
  formatForDisplay,
  isValidCheckDigit,
  isWellFormed,
  normalize,
} from './display-id.service.js'

describe('DisplayIdService — pure helpers', () => {
  describe('normalize', () => {
    it('strips hyphens and uppercases', () => {
      expect(normalize('cp-pat-k8m2r4n-7')).toBe('CPPATK8M2R4N7')
    })

    it('strips internal whitespace', () => {
      expect(normalize(' CP-PAT-K8M2 R4N-7 ')).toBe('CPPATK8M2R4N7')
    })

    it('maps Crockford-ambiguous I/L to 1', () => {
      // "CP-STF-1L1I0KN-7" — the L, I should both become 1.
      // Body 1L1I0KN (7 chars) → 11110KN. Plus brand CP + class STF + check 7.
      expect(normalize('CP-STF-1L1I0KN-7')).toBe('CPSTF11110KN7')
    })

    it('maps Crockford-ambiguous O to 0', () => {
      expect(normalize('CP-PAT-OOOOOOO-0')).toBe('CPPAT00000000')
    })

    it('rejects U as illegal (Crockford excludes U)', () => {
      expect(() => normalize('CP-PAT-UUUUUUU-0')).toThrow(/U/)
    })

    it('rejects illegal chars outside Crockford alphabet', () => {
      expect(() => normalize('CP-PAT-#######-0')).toThrow()
    })

    it('rejects empty input after stripping', () => {
      expect(() => normalize('---')).toThrow()
    })
  })

  describe('formatForDisplay', () => {
    it('inserts hyphens at the 2-3-7-1 boundaries', () => {
      expect(formatForDisplay('CPPATK8M2R4N7')).toBe('CP-PAT-K8M2R4N-7')
    })

    it('rejects wrong length', () => {
      expect(() => formatForDisplay('CPPAT123')).toThrow(/length/)
    })
  })

  describe('isWellFormed', () => {
    it('accepts a valid canonical patient ID structure', () => {
      expect(isWellFormed('CPPATK8M2R4N7')).toBe(true)
    })

    it('accepts a valid canonical staff ID structure', () => {
      expect(isWellFormed('CPSTF9F2K8MRJ')).toBe(true)
    })

    it('rejects wrong brand', () => {
      expect(isWellFormed('XXPATK8M2R4N7')).toBe(false)
    })

    it('rejects unknown class prefix', () => {
      expect(isWellFormed('CPXXXK8M2R4N7')).toBe(false)
    })

    it('rejects non-Crockford char in body', () => {
      expect(isWellFormed('CPPATIO8M2R4N7'.slice(0, 13))).toBe(false)
    })
  })

  describe('computeCheckDigit + isValidCheckDigit (Luhn-mod-32)', () => {
    it('round-trips: a generated check digit validates as correct', () => {
      const bodies = ['K8M2R4N', '9F2K8MR', 'XQH5T9P', '3J7H2QY', '0000000']
      for (const body of bodies) {
        const check = computeCheckDigit(body)
        const canonical = `CPPAT${body}${check}`
        expect(isValidCheckDigit(canonical)).toBe(true)
      }
    })

    it('single-digit error detected (changing one body char invalidates)', () => {
      const body = 'K8M2R4N'
      const check = computeCheckDigit(body)
      const original = `CPPAT${body}${check}`
      expect(isValidCheckDigit(original)).toBe(true)
      // Flip one body char.
      const flipped =
        original.slice(0, 7) + (original[7] === '0' ? '1' : '0') + original.slice(8)
      expect(isValidCheckDigit(flipped)).toBe(false)
    })

    it('adjacent-transposition detected for most pairs', () => {
      // Standard Luhn family: detects all adjacent transpositions where the
      // two chars differ. Pick a body with adjacent differing chars.
      const body = 'K8M2R4N'
      const check = computeCheckDigit(body)
      // Sanity: original is valid before the swap.
      expect(isValidCheckDigit(`CPPAT${body}${check}`)).toBe(true)
      // Swap body[0] and body[1]: K8 -> 8K
      const swapped = `CPPAT8KM2R4N${check}`
      expect(isValidCheckDigit(swapped)).toBe(false)
    })

    it('rejects an obviously wrong check digit', () => {
      // Use a body whose check is NOT '0' so '0' is wrong.
      const body = 'K8M2R4N'
      const check = computeCheckDigit(body)
      const wrongCheck = check === '0' ? '1' : '0'
      const wrong = `CPPAT${body}${wrongCheck}`
      expect(isValidCheckDigit(wrong)).toBe(false)
    })
  })

  describe('classFromRoles', () => {
    it('returns PATIENT when PATIENT is present', () => {
      expect(DisplayIdService.classFromRoles(['PATIENT'])).toBe(
        DisplayIdClass.PATIENT,
      )
    })

    it('returns PATIENT for a multi-role user that includes PATIENT', () => {
      expect(
        DisplayIdService.classFromRoles(['PATIENT', 'PROVIDER']),
      ).toBe(DisplayIdClass.PATIENT)
    })

    it('returns STAFF when PATIENT is absent', () => {
      expect(DisplayIdService.classFromRoles(['PROVIDER'])).toBe(
        DisplayIdClass.STAFF,
      )
      expect(
        DisplayIdService.classFromRoles(['COORDINATOR', 'MEDICAL_DIRECTOR']),
      ).toBe(DisplayIdClass.STAFF)
    })
  })
})

describe('DisplayIdService — issue() with mocked Prisma', () => {
  let service: DisplayIdService

  // Minimal mock for the .displayId.create + .displayIdCollisionLog.create
  // path. We don't depend on the broader TransactionClient surface.
  function makeTx(behaviours: {
    createImpl: () => Promise<unknown>
    collisionLogCreate?: () => Promise<unknown>
  }) {
    return {
      displayId: { create: jest.fn(behaviours.createImpl) },
      displayIdCollisionLog: {
        create: jest.fn(behaviours.collisionLogCreate ?? (async () => ({}))),
      },
    } as unknown as Parameters<DisplayIdService['issue']>[0]
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisplayIdService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile()
    service = module.get(DisplayIdService)
  })

  it('succeeds on first attempt — no collision log written', async () => {
    const tx = makeTx({
      createImpl: async () => ({}),
    })
    const result = await service.issue(tx, 'user_123', DisplayIdClass.PATIENT, 'otp')
    expect(result.value).toMatch(/^CPPAT[0-9A-Z]{8}$/)
    expect(result.display).toMatch(/^CP-PAT-[0-9A-Z]{7}-[0-9A-Z]$/)
    expect(isValidCheckDigit(result.value)).toBe(true)
    expect(tx.displayId.create).toHaveBeenCalledTimes(1)
    expect(tx.displayIdCollisionLog.create).not.toHaveBeenCalled()
  })

  it('retries on P2002 unique-violation and logs the collision', async () => {
    let calls = 0
    const tx = makeTx({
      createImpl: async () => {
        calls++
        if (calls === 1) {
          const err = new Error('Unique constraint failed') as Error & {
            code: string
          }
          err.code = 'P2002'
          throw err
        }
        return {}
      },
    })
    const result = await service.issue(tx, 'user_456', DisplayIdClass.STAFF, 'invite_accept')
    expect(result.value).toMatch(/^CPSTF/)
    expect(tx.displayId.create).toHaveBeenCalledTimes(2)
    expect(tx.displayIdCollisionLog.create).toHaveBeenCalledTimes(1)
  })

  it('throws ConflictException after 3 consecutive collisions', async () => {
    const tx = makeTx({
      createImpl: async () => {
        const err = new Error('Unique constraint failed') as Error & {
          code: string
        }
        err.code = 'P2002'
        throw err
      },
    })
    await expect(
      service.issue(tx, 'user_789', DisplayIdClass.PATIENT, 'backfill'),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(tx.displayId.create).toHaveBeenCalledTimes(3)
  })

  it('propagates non-P2002 errors immediately', async () => {
    const tx = makeTx({
      createImpl: async () => {
        throw new Error('connection lost')
      },
    })
    await expect(
      service.issue(tx, 'user_x', DisplayIdClass.PATIENT, 'otp'),
    ).rejects.toThrow('connection lost')
    expect(tx.displayId.create).toHaveBeenCalledTimes(1)
  })

  it('emits the correct prefix for each class', async () => {
    const tx = makeTx({ createImpl: async () => ({}) })
    const p = await service.issue(tx, 'p1', DisplayIdClass.PATIENT, 'otp')
    const s = await service.issue(tx, 's1', DisplayIdClass.STAFF, 'invite_accept')
    expect(p.value.slice(0, 5)).toBe('CPPAT')
    expect(s.value.slice(0, 5)).toBe('CPSTF')
  })
})
