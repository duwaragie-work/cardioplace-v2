import { jest } from '@jest/globals'
import type { ClsService } from 'nestjs-cls'
import {
  computeAccessLogData,
  auditAndReturn,
  PHI_MODELS,
} from './access-log.extension.js'

/**
 * Humaira N8 / 164.312-T7 — PHI access audit trail. The extension writes one
 * AccessLog row per query on a PHI model (query intent, not per-record), with
 * actor attribution from CLS. These cover the operation→action/recordId matrix,
 * the PHI/non-PHI gate (incl. no-recursion on AccessLog), the no-CLS-actor
 * fallback, and the fire-and-forget/no-throw guarantee.
 */

// A CLS stub backed by a plain map. `undefined` values model an unset context.
function clsWith(values: Record<string, unknown>): ClsService {
  return {
    get: (key: string) => values[key],
  } as unknown as ClsService
}

const USER_CLS = clsWith({
  actorId: 'prov-1',
  ip: '203.0.113.7',
  userAgent: 'jest-agent',
})
const EMPTY_CLS = clsWith({})

describe('computeAccessLogData — operation → audit row', () => {
  it('findUnique on JournalEntry with where.id → READ, recordId = where.id', () => {
    const data = computeAccessLogData(
      'JournalEntry',
      'findUnique',
      { where: { id: 'j-1' } },
      { id: 'j-1' },
      USER_CLS,
    )
    expect(data).toMatchObject({
      action: 'READ',
      modelName: 'JournalEntry',
      recordId: 'j-1',
      actorId: 'prov-1',
      actorType: 'USER',
      ip: '203.0.113.7',
      userAgent: 'jest-agent',
    })
  })

  it('findMany on JournalEntry → READ, recordId = null (query intent, not per-record)', () => {
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [{ id: 'a' }, { id: 'b' }], USER_CLS)
    expect(data).toMatchObject({ action: 'READ', modelName: 'JournalEntry', recordId: null })
  })

  it.each(['count', 'aggregate', 'groupBy'])(
    '%s on PatientProfile → READ, recordId = null',
    (op) => {
      const data = computeAccessLogData('PatientProfile', op, {}, 5, USER_CLS)
      expect(data).toMatchObject({ action: 'READ', recordId: null })
    },
  )

  it('create on Notification → WRITE, recordId = result.id', () => {
    const data = computeAccessLogData(
      'Notification',
      'create',
      { data: { title: 'x' } },
      { id: 'n-99' },
      USER_CLS,
    )
    expect(data).toMatchObject({ action: 'WRITE', modelName: 'Notification', recordId: 'n-99' })
  })

  it('createMany on Notification → WRITE, recordId = null', () => {
    const data = computeAccessLogData('Notification', 'createMany', { data: [] }, { count: 3 }, USER_CLS)
    expect(data).toMatchObject({ action: 'WRITE', recordId: null })
  })

  it('update on PatientProfile with where.id → WRITE, recordId = where.id', () => {
    const data = computeAccessLogData(
      'PatientProfile',
      'update',
      { where: { id: 'p-1' }, data: {} },
      { id: 'p-1' },
      USER_CLS,
    )
    expect(data).toMatchObject({ action: 'WRITE', modelName: 'PatientProfile', recordId: 'p-1' })
  })

  it('upsert with where.id → WRITE, recordId = where.id', () => {
    const data = computeAccessLogData(
      'PatientThreshold',
      'upsert',
      { where: { id: 't-1' }, create: {}, update: {} },
      { id: 't-1' },
      USER_CLS,
    )
    expect(data).toMatchObject({ action: 'WRITE', recordId: 't-1' })
  })

  it('updateMany → WRITE, recordId = null', () => {
    const data = computeAccessLogData('PatientMedication', 'updateMany', { where: {}, data: {} }, { count: 2 }, USER_CLS)
    expect(data).toMatchObject({ action: 'WRITE', recordId: null })
  })

  it('delete on PatientMedication with where.id → DELETE, recordId = where.id', () => {
    const data = computeAccessLogData(
      'PatientMedication',
      'delete',
      { where: { id: 'm-1' } },
      { id: 'm-1' },
      USER_CLS,
    )
    expect(data).toMatchObject({ action: 'DELETE', modelName: 'PatientMedication', recordId: 'm-1' })
  })

  it('deleteMany → DELETE, recordId = null', () => {
    const data = computeAccessLogData('DeviationAlert', 'deleteMany', { where: {} }, { count: 4 }, USER_CLS)
    expect(data).toMatchObject({ action: 'DELETE', recordId: null })
  })

  it('single-record op without where.id → recordId = null', () => {
    const data = computeAccessLogData('User', 'findFirst', { where: { email: 'x@y.z' } }, { id: 'u-1' }, USER_CLS)
    expect(data).toMatchObject({ action: 'READ', recordId: null })
  })
})

describe('computeAccessLogData — PHI gate', () => {
  it('non-PHI model (Practice) → null (not logged)', () => {
    expect(computeAccessLogData('Practice', 'findMany', {}, [], USER_CLS)).toBeNull()
  })

  it('AccessLog itself → null (no recursion; also not in PHI set)', () => {
    expect(computeAccessLogData('AccessLog', 'create', { data: {} }, { id: 'al-1' }, USER_CLS)).toBeNull()
  })

  it('undefined model → null', () => {
    expect(computeAccessLogData(undefined, 'findMany', {}, [], USER_CLS)).toBeNull()
  })

  it('unrecognised operation on a PHI model → null', () => {
    expect(computeAccessLogData('User', 'someExoticOp', {}, null, USER_CLS)).toBeNull()
  })

  it('the seven PHI models are exactly the audited set', () => {
    expect([...PHI_MODELS].sort()).toEqual(
      ['DeviationAlert', 'JournalEntry', 'Notification', 'PatientMedication', 'PatientProfile', 'PatientThreshold', 'User'].sort(),
    )
  })
})

describe('computeAccessLogData — actor attribution', () => {
  it('no CLS actor → actorType SYSTEM_ACTOR, actorId null', () => {
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], EMPTY_CLS)
    expect(data).toMatchObject({ actorType: 'SYSTEM_ACTOR', actorId: null, ip: null, userAgent: null })
  })
})

describe('auditAndReturn — fire-and-forget write', () => {
  it('writes to basePrisma.accessLog.create with the computed row, returns the query result', async () => {
    const create = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'al-1' })
    const basePrisma = { accessLog: { create } } as any

    const query = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'j-1' })
    const result = await auditAndReturn(
      { model: 'JournalEntry', operation: 'findUnique', args: { where: { id: 'j-1' } }, query },
      USER_CLS,
      basePrisma,
    )

    expect(result).toEqual({ id: 'j-1' }) // query result flows through untouched
    expect(query).toHaveBeenCalledWith({ where: { id: 'j-1' } })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0]).toEqual({
      data: expect.objectContaining({
        action: 'READ',
        modelName: 'JournalEntry',
        recordId: 'j-1',
        actorId: 'prov-1',
        actorType: 'USER',
      }),
    })
  })

  it('non-PHI model → no audit write', async () => {
    const create = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({})
    const basePrisma = { accessLog: { create } } as any

    await auditAndReturn(
      {
        model: 'Practice',
        operation: 'findMany',
        args: {},
        query: jest.fn<(args: any) => Promise<any>>().mockResolvedValue([]),
      },
      USER_CLS,
      basePrisma,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('AccessLog model → no audit write (no recursion)', async () => {
    const create = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({})
    const basePrisma = { accessLog: { create } } as any

    await auditAndReturn(
      {
        model: 'AccessLog',
        operation: 'create',
        args: { data: {} },
        query: jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'al-1' }),
      },
      USER_CLS,
      basePrisma,
    )
    expect(create).not.toHaveBeenCalled()
  })

  it('failed audit write is swallowed — query result still returned, no throw', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    const create = jest.fn<(args: any) => Promise<any>>().mockRejectedValue(new Error('db down'))
    const basePrisma = { accessLog: { create } } as any

    const result = await auditAndReturn(
      {
        model: 'JournalEntry',
        operation: 'findMany',
        args: {},
        query: jest.fn<(args: any) => Promise<any>>().mockResolvedValue([{ id: 'a' }]),
      },
      USER_CLS,
      basePrisma,
    )

    expect(result).toEqual([{ id: 'a' }])
    // Let the rejected create's .catch() microtask run.
    await Promise.resolve()
    await Promise.resolve()
    expect(errSpy).toHaveBeenCalledWith('[AccessLog] write failed', expect.any(Error))
    errSpy.mockRestore()
  })
})
