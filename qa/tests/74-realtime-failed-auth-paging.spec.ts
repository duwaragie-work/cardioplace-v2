import { test, expect, request as pwRequest } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Real-time repeated-failed-auth paging (HIPAA §164.308(a)(6) / §164.308(a)(5)(ii)(C)).
 *
 * Proves the memo's acceptance for Task 1: N>=5 failed logins for one identifier
 * in a short window raises a REPEATED_FAILED_AUTH AuditException in NEAR-REAL-TIME
 * — WITHOUT the 03:00 batch cron ever running. We never call the test-control
 * cron endpoint; if the exception appears, it was raised by the event-driven
 * evaluator (auth-failure Prisma extension -> AUTH_EVENTS.FAILURE -> evaluator).
 *
 * Driver: POST wrong OTPs to /api/v2/auth/otp/verify for a fresh, unique email.
 * With no OTP ever sent, each call logs an `otp_expired` failure (success:false,
 * identifier = the email) — pure, uniform failed rows with no lockout to drop
 * any. Read-back: the HEALPLACE_OPS worklist API, polled (the handler is async
 * off the request path).
 *
 * The identifier is unique per run so the row is uniquely matchable and cannot
 * collide with seed/other-test noise; we clear it afterwards by idempotency-key
 * prefix.
 */
test.describe('74 — real-time failed-auth paging', () => {
  test('>=5 failed logins -> real-time REPEATED_FAILED_AUTH exception, no cron', async () => {
    const email = `repeat-fail-${Date.now()}@cardioplace.test`
    const deviceId = `qa-${email}`

    // 1. Drive 6 failed verify attempts (>=5; 6 gives margin over the async
    //    handler + the "counts the triggering row" boundary).
    const anon = await pwRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'x-device-id': deviceId },
    })
    try {
      for (let i = 0; i < 6; i++) {
        const res = await anon.post('/api/v2/auth/otp/verify', {
          data: { email, otp: '000000', appContext: 'patient', deviceId },
        })
        // Each is expected to FAIL auth (400) — that's the point. We only assert
        // it's a client error, not a 5xx (which would mean the endpoint broke).
        expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400)
        expect(res.status()).toBeLessThan(500)
      }
    } finally {
      await anon.dispose()
    }

    // 2. Read back as HEALPLACE_OPS via the worklist API. Poll — the evaluator
    //    runs asynchronously off the auth-write path.
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')

    let matched: any = null
    await expect
      .poll(
        async () => {
          const r = await ops.get(
            'v2/admin/worklist/exceptions?detectorId=REPEATED_FAILED_AUTH&status=OPEN&limit=100',
          )
          if (!r.ok()) return false
          const { data } = await r.json()
          matched = (data as any[]).find((row) => row?.evidence?.identifier === email)
          return Boolean(matched)
        },
        {
          message: 'real-time REPEATED_FAILED_AUTH exception for the test identifier',
          timeout: 30_000,
          intervals: [500, 1000, 2000],
        },
      )
      .toBe(true)

    // 3. Assert the exception's shape.
    expect(matched.detectorId).toBe('REPEATED_FAILED_AUTH')
    expect(matched.severity).toBe('HIGH') // CRITICAL only at >=50
    expect(matched.status).toBe('OPEN')
    expect(matched.evidence.failedCount).toBeGreaterThanOrEqual(5)
    expect(matched.summary).toContain(email)

    // 4. Cleanup — remove the unique row so re-runs stay clean.
    try {
      const secret = process.env.TEST_CONTROL_SECRET
      const tc = await pwRequest.newContext({
        baseURL: API_BASE_URL,
        extraHTTPHeaders: secret ? { 'x-test-control-secret': secret } : {},
      })
      await tc.post('/api/test-control/audit/audit-exception/clear-by-prefix', {
        data: { prefix: `REPEATED_FAILED_AUTH:identifier:${email}` },
      })
      await tc.dispose()
    } catch {
      // Best-effort cleanup; a leftover unique-email row is harmless.
    }
  })

  test('>=50 failed logins (CRITICAL) -> auto-opens a system-owned SecurityIncident', async () => {
    test.slow() // 50 sequential auth calls
    const email = `repeat-crit-${Date.now()}@cardioplace.test`
    const deviceId = `qa-${email}`

    const anon = await pwRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'x-device-id': deviceId },
    })
    try {
      // 50 failures -> the aggregation stamps CRITICAL, which is the gate for
      // auto-opening a SecurityIncident (a 5-failure fat-finger must NOT).
      for (let i = 0; i < 50; i++) {
        const res = await anon.post('/api/v2/auth/otp/verify', {
          data: { email, otp: '000000', appContext: 'patient', deviceId },
        })
        expect(res.status()).toBeGreaterThanOrEqual(400)
        expect(res.status()).toBeLessThan(500)
      }
    } finally {
      await anon.dispose()
    }

    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')

    // The exception should be CRITICAL...
    let ex: any = null
    await expect
      .poll(
        async () => {
          const r = await ops.get(
            'v2/admin/worklist/exceptions?detectorId=REPEATED_FAILED_AUTH&limit=100',
          )
          if (!r.ok()) return false
          ex = (await r.json()).data.find((row: any) => row?.evidence?.identifier === email)
          return ex?.severity === 'CRITICAL'
        },
        { message: 'CRITICAL exception', timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true)
    expect(ex.evidence.failedCount).toBeGreaterThanOrEqual(50)

    // ...and a SecurityIncident must have been auto-opened BY THE SYSTEM.
    let incident: any = null
    await expect
      .poll(
        async () => {
          const r = await ops.get('v2/admin/worklist/incidents?limit=100')
          if (!r.ok()) return false
          incident = (await r.json()).data.find(
            (row: any) => typeof row?.title === 'string' && row.title.includes(email),
          )
          return Boolean(incident)
        },
        { message: 'auto-opened SecurityIncident', timeout: 30_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true)

    expect(incident.openedBySystem).toBe(true)
    expect(incident.severity).toBe('CRITICAL')
    expect(incident.sourceDetectorId).toBe('REPEATED_FAILED_AUTH')

    await ops.dispose()

    // Cleanup the exception (the incident is a distinct lifecycle row; a unique
    // leftover is harmless on the test DB).
    try {
      const secret = process.env.TEST_CONTROL_SECRET
      const tc = await pwRequest.newContext({
        baseURL: API_BASE_URL,
        extraHTTPHeaders: secret ? { 'x-test-control-secret': secret } : {},
      })
      await tc.post('/api/test-control/audit/audit-exception/clear-by-prefix', {
        data: { prefix: `REPEATED_FAILED_AUTH:identifier:${email}` },
      })
      await tc.dispose()
    } catch {
      /* best-effort */
    }
  })
})
