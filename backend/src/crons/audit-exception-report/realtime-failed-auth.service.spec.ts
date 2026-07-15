import { jest } from '@jest/globals'
import { RealtimeFailedAuthService } from './realtime-failed-auth.service.js'
import type { AuthFailureEvent } from '../../auth/auth.events.js'
import {
  setSystemPrincipalRegistry,
} from '../../common/cls/system-principals.js'

/**
 * Unit spec for the real-time repeated-failed-auth evaluator. Mirrors the batch
 * detector spec's row factory; covers the decision matrix the memo's acceptance
 * hinges on, plus the two things unique to the real-time path: hour-bucketed
 * idempotency and the cold-principal-registry guard.
 */

const NOW = new Date('2026-07-15T12:34:56Z')

function row(minutesAgo: number, extra: Partial<{ ipAddress: string; userId: string }> = {}) {
  return {
    identifier: 'bad@example.com',
    userId: extra.userId ?? null,
    ipAddress: extra.ipAddress ?? '10.0.0.1',
    event: 'otp_failed',
    errorCode: null,
    practiceContext: null,
    createdAt: new Date(NOW.getTime() - minutesAgo * 60_000),
  }
}

function evt(identifier: string | null): AuthFailureEvent {
  return {
    authLogId: 'al-1',
    identifier,
    userId: null,
    ipAddress: '10.0.0.1',
    event: 'otp_failed',
    practiceContext: null,
    createdAt: NOW,
  }
}

interface Harness {
  svc: RealtimeFailedAuthService
  authFindMany: jest.Mock
  upsert: jest.Mock
  notificationCreate: jest.Mock
  incidentCreate: jest.Mock
  incidentActionCreate: jest.Mock
  sendEmail: jest.Mock
}

function makeHarness(opts: {
  rows: ReturnType<typeof row>[]
  upsertOutcome?: 'created' | 'sticky-skipped'
  opsUsers?: { id: string }[]
  securityEmail?: string | undefined
}): Harness {
  const authFindMany = jest.fn<any>().mockResolvedValue(opts.rows)
  const userFindMany = jest
    .fn<any>()
    .mockResolvedValue(opts.opsUsers ?? [{ id: 'ops-1' }, { id: 'ops-2' }])
  const notificationCreate = jest.fn<any>().mockResolvedValue({ id: 'n-1' })
  const incidentCreate = jest.fn<any>().mockResolvedValue({ id: 'inc-1' })
  const incidentActionCreate = jest.fn<any>().mockResolvedValue({ id: 'ia-1' })

  const prisma = {
    authLog: { findMany: authFindMany },
    user: { findMany: userFindMany },
    notification: { create: notificationCreate },
    $transaction: async (cb: any) =>
      cb({
        securityIncident: { create: incidentCreate },
        securityIncidentAction: { create: incidentActionCreate },
      }),
  } as any

  const upsert = jest
    .fn<any>()
    .mockResolvedValue({ outcome: opts.upsertOutcome ?? 'created', id: 'ae-1' })
  const writer = { upsert } as any

  const sendEmail = jest.fn<any>().mockResolvedValue(undefined)
  const email = { sendEmail } as any

  const config = {
    get: (k: string) =>
      k === 'SECURITY_ALERT_EMAIL'
        ? opts.securityEmail
        : k === 'ADMIN_BASE_URL'
          ? 'https://admin.test'
          : undefined,
  } as any

  // runAsCronActor calls cls.run(cb) then cls.set(...); a pass-through mock is
  // enough — the evaluator never reads CLS itself (actor stamping lives in the
  // Prisma extension, which is mocked away here).
  const cls = { run: async (cb: any) => cb(), set: () => undefined, get: () => null } as any

  const svc = new RealtimeFailedAuthService(prisma, writer, email, config, cls)
  return { svc, authFindMany, upsert, notificationCreate, incidentCreate, incidentActionCreate, sendEmail }
}

beforeEach(() => {
  // Warm registry by default; the cold-registry test overrides to null.
  setSystemPrincipalRegistry(new Map([['audit-exception-report', 'sys-1']]))
})
afterAll(() => setSystemPrincipalRegistry(null))

describe('RealtimeFailedAuthService', () => {
  it('does NOTHING below the 5-attempt threshold', async () => {
    const h = makeHarness({ rows: Array.from({ length: 4 }, (_, i) => row(i)) })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    expect(h.upsert).not.toHaveBeenCalled()
    expect(h.notificationCreate).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('at 5 → raises a HIGH exception, pages ops, emails — but NO incident', async () => {
    const h = makeHarness({
      rows: Array.from({ length: 5 }, (_, i) => row(i)),
      securityEmail: 'sec@healplace.com',
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))

    expect(h.upsert).toHaveBeenCalledTimes(1)
    // one PUSH notification per ops user (bell + browser push)
    expect(h.notificationCreate).toHaveBeenCalledTimes(2)
    expect(h.notificationCreate.mock.calls[0][0].data).toMatchObject({
      channel: 'PUSH',
      dispatchTrigger: 'SECURITY_EXCEPTION',
    })
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    expect(h.incidentCreate).not.toHaveBeenCalled()
  })

  it('the email is a security_alert disclosure with patientUserId null (no PHI)', async () => {
    const h = makeHarness({
      rows: Array.from({ length: 5 }, (_, i) => row(i)),
      securityEmail: 'sec@healplace.com',
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    const [, , , disclosure] = h.sendEmail.mock.calls[0] as any[]
    expect(disclosure).toMatchObject({ template: 'security_alert', patientUserId: null })
  })

  it('at 50 → CRITICAL, and auto-opens a system-owned incident', async () => {
    const h = makeHarness({
      rows: Array.from({ length: 50 }, (_, i) => row(i)),
      securityEmail: 'sec@healplace.com',
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))

    expect(h.incidentCreate).toHaveBeenCalledTimes(1)
    expect(h.incidentCreate.mock.calls[0][0].data).toMatchObject({
      severity: 'CRITICAL',
      openedBySystem: true,
      openedByOpsId: 'sys-1',
    })
    expect(h.incidentActionCreate).toHaveBeenCalledTimes(1)
  })

  it('counts the triggering failure (query uses lte:now, not lt) — no off-by-one', async () => {
    // The extension emits AFTER the row persists, so `now` is that row's own
    // createdAt. It must be INCLUDED, or the count lags one behind and the
    // exception fires on the 6th failure instead of the 5th.
    const h = makeHarness({ rows: Array.from({ length: 5 }, (_, i) => row(i)) })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    const where = h.authFindMany.mock.calls[0][0].where
    expect(where.createdAt.lte).toEqual(NOW)
    expect(where.createdAt.lt).toBeUndefined()
    expect(where.identifier).toBe('bad@example.com')
  })

  it('hour-buckets windowStart so the burst produces one row per hour', async () => {
    const h = makeHarness({ rows: Array.from({ length: 6 }, (_, i) => row(i)) })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    const { windowStart } = h.upsert.mock.calls[0][0] as any
    // 12:34:56 → bucketed to 12:00:00
    expect(windowStart.toISOString()).toBe('2026-07-15T12:00:00.000Z')
  })

  it('does NOT re-page when the writer sticky-skips (reviewer already dispositioned)', async () => {
    const h = makeHarness({
      rows: Array.from({ length: 5 }, (_, i) => row(i)),
      upsertOutcome: 'sticky-skipped',
      securityEmail: 'sec@healplace.com',
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    expect(h.upsert).toHaveBeenCalledTimes(1)
    expect(h.notificationCreate).not.toHaveBeenCalled()
    expect(h.sendEmail).not.toHaveBeenCalled()
    expect(h.incidentCreate).not.toHaveBeenCalled()
  })

  it('COLD registry at CRITICAL → email + page still fire, incident skipped', async () => {
    setSystemPrincipalRegistry(null) // principal not warmed
    const h = makeHarness({
      rows: Array.from({ length: 50 }, (_, i) => row(i)),
      securityEmail: 'sec@healplace.com',
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))

    // The page must survive an unattributable incident.
    expect(h.notificationCreate).toHaveBeenCalledTimes(2)
    expect(h.sendEmail).toHaveBeenCalledTimes(1)
    // Incident is the only casualty.
    expect(h.incidentCreate).not.toHaveBeenCalled()
  })

  it('skips the email leg when SECURITY_ALERT_EMAIL is unset, but still pages', async () => {
    const h = makeHarness({
      rows: Array.from({ length: 5 }, (_, i) => row(i)),
      securityEmail: undefined,
    })
    await h.svc.onAuthFailure(evt('bad@example.com'))
    expect(h.notificationCreate).toHaveBeenCalledTimes(2)
    expect(h.sendEmail).not.toHaveBeenCalled()
  })

  it('ignores the dev perma-OTP identifier (666666)', async () => {
    const h = makeHarness({ rows: Array.from({ length: 10 }, (_, i) => row(i)) })
    await h.svc.onAuthFailure(evt('666666'))
    expect(h.authFindMany).not.toHaveBeenCalled()
    expect(h.upsert).not.toHaveBeenCalled()
  })

  it('ignores a null identifier', async () => {
    const h = makeHarness({ rows: [] })
    await h.svc.onAuthFailure(evt(null))
    expect(h.authFindMany).not.toHaveBeenCalled()
  })
})
