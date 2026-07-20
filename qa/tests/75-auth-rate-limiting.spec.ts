import { test, expect, request as pwRequest } from '@playwright/test'
import { API_BASE_URL } from '../playwright.config.js'
import { newTestControl } from '../helpers/test-control.js'

/**
 * V-03 — auth endpoint rate limiting (Humaira assessment 2026-07-14, CRITICAL).
 *
 * The finding: "Authentication endpoints have no rate limiting (throttler
 * configured but never enforced)". ThrottlerModule had been configured in
 * app.module.ts since day one, but no guard consumed it and no route named a
 * limiter — the config was inert, so a 6-digit OTP (10^6 space) could be
 * brute-forced and otp/send could be flooded to burn the mail sender's
 * reputation.
 *
 * These tests are deliberately transport-level and unauthenticated: the whole
 * point of the finding is what an attacker can do with no credentials at all.
 * Each uses a UNIQUE email — buckets are keyed ip:email, so a per-test address
 * isolates the tests from each other AND from the ~100 specs that sign in as
 * shared seed accounts on the same host.
 *
 * Unit-level cover for the tracker/skip logic lives in
 * backend/src/common/guards/auth-throttler.guard.spec.ts. This file proves the
 * guard is actually MOUNTED and the limit actually fires over HTTP — the exact
 * gap that let the original config sit dead and unnoticed.
 *
 * ⚠️ Requires the backend to run WITHOUT AUTH_THROTTLE_DISABLED. That flag is
 * the escape hatch for backend/test/auth-otp.e2e-spec.ts (which loops auth
 * endpoints on purpose); it is double-gated and ignored when
 * NODE_ENV=production. If these tests fail with everything 201, check the flag.
 */

const LIMIT = 5 // STRICT_AUTH_THROTTLE in backend/src/auth/auth.controller.ts

const uniqueEmail = (tag: string) =>
  `throttle-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@cardioplace.test`

test.describe('75 — V-03 auth rate limiting', () => {
  // The suite runs with the limiter disabled so the shared-account sign-ins in
  // other specs don't trip it. This spec is the one that must SEE it, so arm it
  // for this block only and restore afterwards. The guard reads the flag live,
  // so no restart is needed. Serialize so a parallel worker can't observe the
  // window where it's on.
  test.describe.configure({ mode: 'serial' })

  test.beforeAll(async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      await tc.setAuthThrottle(true)
    } finally {
      await tc.dispose()
    }
  })
  test.afterAll(async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    try {
      await tc.setAuthThrottle(false)
    } finally {
      await tc.dispose()
    }
  })

  test(`otp/verify: ${LIMIT} attempts allowed, the next is 429`, async () => {
    const email = uniqueEmail('verify')
    const anon = await pwRequest.newContext({ baseURL: API_BASE_URL })
    try {
      // The first LIMIT attempts must reach the handler. They fail auth on
      // their own merits (no OTP was ever sent) — that is fine and expected;
      // what matters is that the LIMITER did not reject them.
      for (let i = 0; i < LIMIT; i++) {
        const res = await anon.post('/api/v2/auth/otp/verify', {
          data: { email, otp: '000000', deviceId: 'qa-throttle' },
        })
        expect(res.status(), `attempt ${i + 1} should not be throttled`).not.toBe(429)
      }

      // The brute-force budget is now spent.
      const blocked = await anon.post('/api/v2/auth/otp/verify', {
        data: { email, otp: '000000', deviceId: 'qa-throttle' },
      })
      expect(blocked.status(), await blocked.text()).toBe(429)
    } finally {
      await anon.dispose()
    }
  })

  test(`otp/send: ${LIMIT} sends allowed, the next is 429`, async () => {
    const email = uniqueEmail('send')
    const anon = await pwRequest.newContext({ baseURL: API_BASE_URL })
    try {
      for (let i = 0; i < LIMIT; i++) {
        const res = await anon.post('/api/v2/auth/otp/send', { data: { email } })
        expect(res.status(), `send ${i + 1} should not be throttled`).not.toBe(429)
      }
      const blocked = await anon.post('/api/v2/auth/otp/send', { data: { email } })
      expect(blocked.status(), await blocked.text()).toBe(429)
    } finally {
      await anon.dispose()
    }
  })

  /**
   * The reason the guard overrides getTracker at all. Keying on IP alone would
   * mean one attacker (or one noisy test) rate-limits every other user behind
   * the same NAT — a whole clinic sharing one egress IP would lock itself out.
   * Keying ip:email scopes the bucket to "this client attacking this account".
   */
  test('a different account on the same IP is unaffected (keyed ip:email, not ip)', async () => {
    const victim = uniqueEmail('victim')
    const bystander = uniqueEmail('bystander')
    const anon = await pwRequest.newContext({ baseURL: API_BASE_URL })
    try {
      for (let i = 0; i < LIMIT + 1; i++) {
        await anon.post('/api/v2/auth/otp/verify', {
          data: { email: victim, otp: '000000', deviceId: 'qa-throttle' },
        })
      }
      // Victim's bucket is spent...
      const victimRes = await anon.post('/api/v2/auth/otp/verify', {
        data: { email: victim, otp: '000000', deviceId: 'qa-throttle' },
      })
      expect(victimRes.status()).toBe(429)

      // ...but the bystander, same IP, same instant, must still get through.
      const bystanderRes = await anon.post('/api/v2/auth/otp/verify', {
        data: { email: bystander, otp: '000000', deviceId: 'qa-throttle' },
      })
      expect(bystanderRes.status(), await bystanderRes.text()).not.toBe(429)
    } finally {
      await anon.dispose()
    }
  })

  /**
   * Case-only variants must NOT mint a fresh budget. auth.service.ts normalises
   * with email.trim().toLowerCase(), so A@x.com and a@x.com are ONE account; if
   * the tracker disagreed, an attacker would get LIMIT attempts per
   * capitalisation — 2^n budgets for an n-letter address.
   */
  test('case/whitespace variants share one bucket (no free budget per capitalisation)', async () => {
    const email = uniqueEmail('case')
    const anon = await pwRequest.newContext({ baseURL: API_BASE_URL })
    try {
      for (let i = 0; i < LIMIT; i++) {
        await anon.post('/api/v2/auth/otp/verify', {
          data: { email, otp: '000000', deviceId: 'qa-throttle' },
        })
      }
      // Same account, shouted, with padding.
      const shouted = await anon.post('/api/v2/auth/otp/verify', {
        data: { email: `  ${email.toUpperCase()} `, otp: '000000', deviceId: 'qa-throttle' },
      })
      expect(shouted.status(), await shouted.text()).toBe(429)
    } finally {
      await anon.dispose()
    }
  })
})
