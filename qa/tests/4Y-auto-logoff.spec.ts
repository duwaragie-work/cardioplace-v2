import { test, expect, request as pwRequest } from '@playwright/test'
import { PATIENTS, DEMO_OTP } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * HIPAA auto-logoff verification (sprint 4Y). §164.312(a)(2)(iii). The stack is
 * already shipped; this spec verifies the signed-off WEB boundary end-to-end at
 * the server gate: 15 min web (Manisha 2026-06-12). Just inside the window a
 * refresh succeeds; just past it the chain is revoked (401). The full device
 * matrix (mobile 5-min, admin, heartbeat reset) lives in
 * qa/tests/32-idle-timeout.spec.ts. See
 * docs/AUTO_LOGOFF_30MIN_PATIENT_DECISION_2026_07.md.
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

async function signInWeb(email: string): Promise<{ refreshToken: string; userId: string }> {
  const deviceId = `qa-4y-${email}`
  const ctx = await pwRequest.newContext({
    baseURL: API_ROOT,
    extraHTTPHeaders: { 'x-device-id': deviceId, 'x-device-platform': 'web' },
  })
  const send = await ctx.post('/api/v2/auth/otp/send', {
    data: { email, appContext: 'patient', deviceId },
  })
  expect(send.ok(), await send.text()).toBeTruthy()
  const verify = await ctx.post('/api/v2/auth/otp/verify', {
    data: { email, otp: DEMO_OTP, appContext: 'patient', deviceId },
  })
  expect(verify.ok(), await verify.text()).toBeTruthy()
  const body = await verify.json()
  await ctx.dispose()
  return { refreshToken: body.refreshToken, userId: body.userId }
}

async function refreshStatus(refreshToken: string): Promise<number> {
  const ctx = await pwRequest.newContext({ baseURL: API_ROOT })
  const res = await ctx.post('/api/v2/auth/refresh', { data: { refreshToken } })
  const status = res.status()
  await ctx.dispose()
  return status
}

test.describe('4Y — auto-logoff (web 15-min boundary)', () => {
  test('idle 14 min → refresh succeeds; idle 16 min → session revoked (401)', async () => {
    // Inside the 15-min window — refresh must succeed.
    {
      const { refreshToken, userId } = await signInWeb(PATIENTS.aisha.email)
      const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      await tc.backdateAuthSessions(userId, 14 * 60)
      await tc.dispose()
      expect(await refreshStatus(refreshToken)).toBe(201)
    }
    // Past the 15-min window — the refresh chain is revoked.
    {
      const { refreshToken, userId } = await signInWeb(PATIENTS.charles.email)
      const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      await tc.backdateAuthSessions(userId, 16 * 60)
      await tc.dispose()
      expect(await refreshStatus(refreshToken)).toBe(401)
      // Idempotent — the session is gone, not merely stale.
      expect(await refreshStatus(refreshToken)).toBe(401)
    }
  })
})
