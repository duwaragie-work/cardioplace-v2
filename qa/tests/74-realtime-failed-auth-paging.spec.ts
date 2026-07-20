import { test, expect, request as pwRequest } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'
import { newTestControl } from '../helpers/test-control.js'

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

    // 1. Drive exactly 5 failed verify attempts over real HTTP.
    //
    // Was 6, "for margin" — but V-03 (2026-07-17) caps /otp/verify at 5 per 60s
    // per ip:email, so the 6th is now rejected with 429 BEFORE reaching
    // verifyOtp and logs nothing. The margin was silently gone: 6 attempts
    // yielded 5 rows, exactly the detector's threshold, and the loop's
    // `>=400 && <500` assertion accepted the 429 without noticing.
    //
    // 5 is the honest number here, and the coupling is deliberate: the throttle
    // ceiling (5/60s) and the detector floor (FAILURE_THRESHOLD=5) are the same
    // value, so a single client can produce exactly enough failures to be
    // detected and not one more. Assert each attempt is a genuine auth failure
    // and NOT a 429 — if the limiter ever tightens below 5, this fails loudly
    // here rather than silently starving the detector.
    const anon = await pwRequest.newContext({
      baseURL: API_BASE_URL,
      extraHTTPHeaders: { 'x-device-id': deviceId },
    })
    try {
      for (let i = 0; i < 5; i++) {
        const res = await anon.post('/api/v2/auth/otp/verify', {
          data: { email, otp: '000000', appContext: 'patient', deviceId },
        })
        // Expected to FAIL auth — that's the point. Not a 5xx (endpoint broke),
        // and not a 429 (the limiter ate the row the detector needs).
        expect(res.status(), await res.text()).not.toBe(429)
        expect(res.status()).toBeGreaterThanOrEqual(400)
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

  /**
   * Rewritten 2026-07-17 (V-03). This drove the CRITICAL tier by POSTing 50
   * wrong OTPs from one context. That can no longer reach 50: the V-03 rate
   * limiter caps /otp/verify at 5 per 60s per ip:email, so attempts 6..50 were
   * rejected with 429 before ever reaching verifyOtp — no AuthLog row, no
   * evaluator, no incident. The test still "passed" its own status assertion
   * (429 is 4xx, which `>=400 && <500` accepts) and then failed at the poll.
   *
   * That is the limiter working, not a bug: preventing 50 rapid failed logins
   * for one account from one client is exactly V-03's job. The CRITICAL tier
   * exists for the case the limiter does NOT stop — a DISTRIBUTED burst (50 IPs
   * × 1 attempt each). A single test host cannot synthesise that over HTTP,
   * because req.ip is the socket peer unless TRUST_PROXY_HOPS is set, and
   * making it spoofable is the failure mode main.ts deliberately avoids.
   *
   * So drive the evaluator at its real trigger instead of through the transport:
   * seedFailedAuth writes the rows via the same authLog.create that
   * authFailureExtension wraps, so AUTH_EVENTS.FAILURE fires exactly as in
   * production, with varied IPs. Only the HTTP hop — the part V-03 blocks — is
   * skipped. The ≥5 test above still drives real HTTP, so the transport path
   * keeps its coverage.
   */
  test('>=50 failed logins (CRITICAL) -> auto-opens a system-owned SecurityIncident', async () => {
    const email = `repeat-crit-${Date.now()}@cardioplace.test`

    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      const { seeded } = await tc.seedFailedAuth(email, 50)
      expect(seeded).toBe(50)
    } finally {
      await tc.dispose()
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
