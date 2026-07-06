import { jest } from '@jest/globals'
import type { ClsService } from 'nestjs-cls'
import {
  computeAccessLogData,
  auditAndReturn,
  stampInlineAudit,
  stampNotificationActor,
  PHI_MODELS,
  AUDIT_STAMP_MODELS,
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
// A cron that identified itself via runAsCronActor: no actorId, a label set.
const CRON_CLS = clsWith({ systemActorLabel: 'cron-gap-alert' })

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

  it('PHI_MODELS matches the current audited set (updated when N4 extends it)', () => {
    // The canonical inventory lives in docs/EPHI_INVENTORY.md and is enforced
    // by phi-inventory.ts + the conformance suite (N3). This snapshot mirrors
    // the runtime set on this branch: 7 original + 3 Support (already on dev).
    // N4 extends both this test and PHI_MODELS to the full 20-model set.
    expect([...PHI_MODELS].sort()).toEqual(
      [
        'DeviationAlert',
        'JournalEntry',
        'Notification',
        'PatientMedication',
        'PatientProfile',
        'PatientThreshold',
        'SupportTicket',
        'SupportTicketAction',
        'SupportTicketReply',
        'User',
      ].sort(),
    )
  })
})

describe('computeAccessLogData — actor attribution', () => {
  it('no CLS actor → actorType SYSTEM_ACTOR, actorId null', () => {
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], EMPTY_CLS)
    expect(data).toMatchObject({ actorType: 'SYSTEM_ACTOR', actorId: null, ip: null, userAgent: null })
  })

  it('unlabelled system write → systemActorLabel null', () => {
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], EMPTY_CLS)
    expect(data).toMatchObject({ actorType: 'SYSTEM_ACTOR', systemActorLabel: null })
  })

  it('labelled cron write → SYSTEM_ACTOR + the systemActorLabel from CLS', () => {
    const data = computeAccessLogData('Notification', 'create', { data: {} }, { id: 'n-1' }, CRON_CLS)
    expect(data).toMatchObject({
      actorType: 'SYSTEM_ACTOR',
      actorId: null,
      systemActorLabel: 'cron-gap-alert',
    })
  })

  it('USER write is never a cron → systemActorLabel null even if one were set', () => {
    // A real user is not a background process; the label is suppressed.
    const userWithStrayLabel = clsWith({ actorId: 'prov-1', systemActorLabel: 'cron-x' })
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], userWithStrayLabel)
    expect(data).toMatchObject({ actorType: 'USER', actorId: 'prov-1', systemActorLabel: null })
  })
})

describe('computeAccessLogData — N2 runId correlation', () => {
  // N2: runId is set by runAsCronActor (cron path) or the CLS interceptor
  // (HTTP path) — one per invocation. Distinct runs write distinct AccessLog
  // rows, so N7's exception-report cron can count per-run rather than per-day.

  it('HTTP request with runId in CLS → runId flows through to the audit row', () => {
    const cls = clsWith({
      actorId: 'prov-1',
      runId: 'req-a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    })
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], cls)
    expect(data).toMatchObject({
      actorType: 'USER',
      runId: 'req-a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    })
  })

  it('cron run with runId in CLS → runId flows through, systemActorLabel unaffected', () => {
    const cls = clsWith({
      systemActorLabel: 'cron-gap-alert',
      runId: 'cron-run-abc-def-123',
    })
    const data = computeAccessLogData('Notification', 'create', { data: {} }, { id: 'n-1' }, cls)
    expect(data).toMatchObject({
      actorType: 'SYSTEM_ACTOR',
      systemActorLabel: 'cron-gap-alert',
      runId: 'cron-run-abc-def-123',
    })
  })

  it('no runId in CLS → runId null (pre-N2 fallback)', () => {
    // EMPTY_CLS has no runId key — matches the pre-2026-07-07 code path.
    const data = computeAccessLogData('JournalEntry', 'findMany', {}, [], EMPTY_CLS)
    expect(data).toMatchObject({ runId: null })
  })

  it('two distinct runIds → two distinct audit rows (correlation isolation)', () => {
    // Simulates two independent runs (or two HTTP requests) writing to the same
    // PHI model. The audit rows carry different runIds so N7's per-run
    // aggregation can distinguish them even under identical actor + model.
    const clsA = clsWith({ actorId: 'prov-1', runId: 'run-A' })
    const clsB = clsWith({ actorId: 'prov-1', runId: 'run-B' })
    const dataA = computeAccessLogData('JournalEntry', 'findMany', {}, [], clsA)
    const dataB = computeAccessLogData('JournalEntry', 'findMany', {}, [], clsB)
    expect(dataA?.runId).toBe('run-A')
    expect(dataB?.runId).toBe('run-B')
    expect(dataA?.runId).not.toBe(dataB?.runId)
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
    // Every attempt fails so writeAuditWithRetry (3 attempts) exhausts and
    // reports the failure. auditAndReturn must still resolve the query result.
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
    // Wait for the fire-and-forget retry loop (3 attempts with 100ms + 500ms
    // backoff = ~600ms). writeAuditWithRetry never rejects — we assert the
    // final structured error was emitted.
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(errSpy).toHaveBeenCalledTimes(1)
    const emitted = JSON.parse(errSpy.mock.calls[0]?.[0] as string) as Record<string, unknown>
    expect(emitted).toMatchObject({
      audit_write_failed: true,
      kind: 'access-log',
      error_message: 'db down',
      'audit.model': 'JournalEntry',
      'audit.action': 'READ',
    })
    expect(create).toHaveBeenCalledTimes(3)
    errSpy.mockRestore()
  })

  it('cron write → AccessLog payload carries the systemActorLabel (Task 1.4b)', async () => {
    const create = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'al-1' })
    const basePrisma = { accessLog: { create } } as any

    await auditAndReturn(
      {
        model: 'Notification',
        operation: 'create',
        args: { data: { title: 'x' } },
        query: jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'n-1' }),
      },
      CRON_CLS,
      basePrisma,
    )

    expect(create.mock.calls[0][0]).toEqual({
      data: expect.objectContaining({
        actorType: 'SYSTEM_ACTOR',
        actorId: null,
        systemActorLabel: 'cron-gap-alert',
      }),
    })
  })

  it('stamps inline audit fields on the query args before the write runs (Task 2.3)', async () => {
    const create = jest.fn<(args: any) => Promise<any>>().mockResolvedValue({ id: 'al-1' })
    const basePrisma = { accessLog: { create } } as any
    // Capture the args the underlying query actually received.
    const query = jest
      .fn<(args: any) => Promise<any>>()
      .mockImplementation(async (a) => ({ id: 't-1', ...(a.data ?? {}) }))

    await auditAndReturn(
      { model: 'PatientThreshold', operation: 'create', args: { data: { sbpUpperTarget: 140 } }, query },
      USER_CLS,
      basePrisma,
    )

    expect(query.mock.calls[0][0]).toEqual({
      data: { sbpUpperTarget: 140, createdByActorId: 'prov-1', updatedByActorId: 'prov-1' },
    })
  })
})

describe('stampInlineAudit — inline audit-actor stamping (Task 2)', () => {
  it('the stamp set is exactly the three chosen tables (PatientMedication excluded — see #92)', () => {
    expect([...AUDIT_STAMP_MODELS].sort()).toEqual(
      ['DeviationAlert', 'PatientProviderAssignment', 'PatientThreshold'].sort(),
    )
    expect(AUDIT_STAMP_MODELS.has('PatientMedication')).toBe(false)
  })

  it('create on PatientThreshold with USER actor → both created + updated stamped', () => {
    const out = stampInlineAudit(
      'PatientThreshold',
      'create',
      { data: { sbpUpperTarget: 140 } },
      USER_CLS,
    ) as any
    expect(out.data).toEqual({
      sbpUpperTarget: 140,
      createdByActorId: 'prov-1',
      updatedByActorId: 'prov-1',
    })
  })

  it('update on PatientThreshold → only updatedByActorId stamped (createdByActorId untouched)', () => {
    const out = stampInlineAudit(
      'PatientThreshold',
      'update',
      { where: { id: 't-1' }, data: { notes: 'edited' } },
      USER_CLS,
    ) as any
    expect(out.data).toEqual({ notes: 'edited', updatedByActorId: 'prov-1' })
    expect(out.data).not.toHaveProperty('createdByActorId')
    expect(out.where).toEqual({ id: 't-1' }) // where is left alone
  })

  it('createMany on DeviationAlert → every row stamped', () => {
    const out = stampInlineAudit(
      'DeviationAlert',
      'createMany',
      { data: [{ userId: 'u1' }, { userId: 'u2' }] },
      USER_CLS,
    ) as any
    expect(out.data).toEqual([
      { userId: 'u1', createdByActorId: 'prov-1', updatedByActorId: 'prov-1' },
      { userId: 'u2', createdByActorId: 'prov-1', updatedByActorId: 'prov-1' },
    ])
  })

  it('upsert on PatientProviderAssignment → create path both, update path only updated', () => {
    const out = stampInlineAudit(
      'PatientProviderAssignment',
      'upsert',
      { where: { userId: 'u1' }, create: { userId: 'u1' }, update: { primaryProviderId: 'p2' } },
      USER_CLS,
    ) as any
    expect(out.create).toEqual({
      userId: 'u1',
      createdByActorId: 'prov-1',
      updatedByActorId: 'prov-1',
    })
    expect(out.update).toEqual({ primaryProviderId: 'p2', updatedByActorId: 'prov-1' })
  })

  it('SYSTEM_ACTOR / cron write (no actorId) → args unchanged, fields stay null', () => {
    const args = { data: { sbpUpperTarget: 140 } }
    const out = stampInlineAudit('PatientThreshold', 'create', args, CRON_CLS)
    expect(out).toBe(args) // same reference — no stamping attempted
  })

  it('CLS actor wins over a caller-supplied createdByActorId (impersonation guard)', () => {
    const out = stampInlineAudit(
      'PatientThreshold',
      'create',
      { data: { createdByActorId: 'attacker', sbpUpperTarget: 140 } },
      USER_CLS,
    ) as any
    expect(out.data.createdByActorId).toBe('prov-1')
  })

  it('PatientMedication is NOT stamped — #92 addedBy/lastEditedBy already cover it', () => {
    // Guards against a future accidental re-inclusion in AUDIT_STAMP_MODELS.
    const createArgs = { data: { drugName: 'Losartan' } }
    const updateArgs = { where: { id: 'm-1' }, data: { notes: 'x' } }
    expect(stampInlineAudit('PatientMedication', 'create', createArgs, USER_CLS)).toBe(createArgs)
    expect(stampInlineAudit('PatientMedication', 'update', updateArgs, USER_CLS)).toBe(updateArgs)
  })

  it('non-stamp PHI model (User) → args unchanged', () => {
    const args = { data: { email: 'x@y.z' } }
    expect(stampInlineAudit('User', 'create', args, USER_CLS)).toBe(args)
  })

  it('reads/deletes on a stamp model → args unchanged (no audit-actor payload)', () => {
    const findArgs = { where: { id: 't-1' } }
    const delArgs = { where: { id: 't-1' } }
    expect(stampInlineAudit('PatientThreshold', 'findUnique', findArgs, USER_CLS)).toBe(findArgs)
    expect(stampInlineAudit('PatientThreshold', 'delete', delArgs, USER_CLS)).toBe(delArgs)
  })
})

// A cron that carries a real system-principal actorId (post-2026-07-03,
// runAsCronActor + registry): actorId set, actorType explicitly SYSTEM_ACTOR.
const CRON_WITH_ID_CLS = clsWith({
  actorId: 'sys-escalation',
  actorType: 'SYSTEM_ACTOR',
  systemActorLabel: 'cron-escalation-ladder',
})

describe('computeAccessLogData — cron carrying a principal actorId', () => {
  it('keeps SYSTEM_ACTOR + label even though actorId is set (reads actorType from CLS, not actorId presence)', () => {
    const data = computeAccessLogData(
      'DeviationAlert',
      'create',
      { data: {} },
      { id: 'a-1' },
      CRON_WITH_ID_CLS,
    )
    expect(data).toMatchObject({
      actorType: 'SYSTEM_ACTOR',
      actorId: 'sys-escalation',
      systemActorLabel: 'cron-escalation-ladder',
    })
  })
})

describe('stampInlineAudit — cron with principal actorId stays null inline', () => {
  it('does NOT stamp createdBy/updatedBy for a SYSTEM_ACTOR write (human edits only)', () => {
    const args = { data: { sbpUpperTarget: 140 } }
    // actorId is present, but actorType is SYSTEM_ACTOR → no inline stamp.
    expect(stampInlineAudit('PatientThreshold', 'create', args, CRON_WITH_ID_CLS)).toBe(args)
  })
})

describe('stampNotificationActor — inline who-sent-it on Notification', () => {
  it('stamps a USER dispatch with the user id + USER type', () => {
    const out = stampNotificationActor(
      'Notification',
      'create',
      { data: { userId: 'p-1', title: 't', dispatchTrigger: 'ALERT_RESOLVED' } },
      USER_CLS,
    ) as any
    expect(out.data).toMatchObject({
      sentByActorId: 'prov-1',
      sentByActorType: 'USER',
      dispatchTrigger: 'ALERT_RESOLVED', // caller value preserved
    })
  })

  it('stamps a cron dispatch with the system principal id + SYSTEM_ACTOR type', () => {
    const out = stampNotificationActor(
      'Notification',
      'create',
      { data: { userId: 'p-1', title: 't', dispatchTrigger: 'SYSTEM_CRON' } },
      CRON_WITH_ID_CLS,
    ) as any
    expect(out.data).toMatchObject({
      sentByActorId: 'sys-escalation',
      sentByActorType: 'SYSTEM_ACTOR',
    })
  })

  it('a caller-supplied sentByActorId wins over the CLS stamp', () => {
    const out = stampNotificationActor(
      'Notification',
      'create',
      { data: { userId: 'p-1', sentByActorId: 'explicit', sentByActorType: 'USER' } },
      CRON_WITH_ID_CLS,
    ) as any
    expect(out.data.sentByActorId).toBe('explicit')
  })

  it('stamps each row of a createMany', () => {
    const out = stampNotificationActor(
      'Notification',
      'createMany',
      { data: [{ userId: 'p-1' }, { userId: 'p-2' }] },
      USER_CLS,
    ) as any
    expect(out.data).toEqual([
      { userId: 'p-1', sentByActorId: 'prov-1', sentByActorType: 'USER' },
      { userId: 'p-2', sentByActorId: 'prov-1', sentByActorType: 'USER' },
    ])
  })

  it('non-Notification model → args unchanged', () => {
    const args = { data: { email: 'x@y.z' } }
    expect(stampNotificationActor('User', 'create', args, USER_CLS)).toBe(args)
  })

  it('reads on Notification → args unchanged', () => {
    const args = { where: { id: 'n-1' } }
    expect(stampNotificationActor('Notification', 'findUnique', args, USER_CLS)).toBe(args)
  })
})
