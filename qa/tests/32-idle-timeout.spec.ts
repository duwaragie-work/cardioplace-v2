import { test, expect, request as pwRequest } from '@playwright/test'
import { ADMINS, PATIENTS, DEMO_OTP } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * June 2026 — idle session timeout (Manisha 2026-06-12 Doc 3 Q7).
 * 15 min for web sessions, 5 min for mobile. Enforcement lives in
 * AuthService.rotateRefreshToken — if AuthSession.lastActivityAt is
 * older than the per-device-type threshold, the next /refresh returns
 * 401 and the chain is revoked.
 *
 * Tests drive the gate via the test-control endpoint
 * `auth-session/backdate` so we don't have to sleep 5+ minutes per case.
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

async function signIn(
  email: string,
  appContext: 'patient' | 'admin',
  devicePlatform: 'web' | 'mobile' = 'web',
): Promise<{
  refreshToken: string
  userId: string
  ctxBaseUrl: string
}> {
  const deviceId = `qa-idle-${email}-${devicePlatform}`
  const ctx = await pwRequest.newContext({
    baseURL: API_ROOT,
    extraHTTPHeaders: {
      'x-device-id': deviceId,
      'x-device-platform': devicePlatform,
    },
  })
  const sendRes = await ctx.post('/api/v2/auth/otp/send', {
    data: { email, appContext, deviceId },
  })
  expect(sendRes.ok(), await sendRes.text()).toBeTruthy()
  const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
    data: { email, otp: DEMO_OTP, appContext, deviceId },
  })
  expect(verifyRes.ok(), await verifyRes.text()).toBeTruthy()
  const body = await verifyRes.json()
  await ctx.dispose()
  return {
    refreshToken: body.refreshToken,
    userId: body.userId,
    ctxBaseUrl: API_ROOT,
  }
}

async function refresh(refreshToken: string): Promise<number> {
  const ctx = await pwRequest.newContext({ baseURL: API_ROOT })
  const res = await ctx.post('/api/v2/auth/refresh', {
    data: { refreshToken },
  })
  const status = res.status()
  await ctx.dispose()
  return status
}

test.describe('32 — idle session timeout (Manisha 2026-06-12)', () => {
  test('WEB: refresh within 15-min window succeeds (14 min idle)', async () => {
    const { refreshToken, userId } = await signIn(
      PATIENTS.aisha.email,
      'patient',
      'web',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    await tc.backdateAuthSessions(userId, 14 * 60)
    await tc.dispose()
    expect(await refresh(refreshToken)).toBe(200)
  })

  test('WEB: refresh past 15-min window is rejected (16 min idle)', async () => {
    const { refreshToken, userId } = await signIn(
      PATIENTS.charles.email,
      'patient',
      'web',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    await tc.backdateAuthSessions(userId, 16 * 60)
    await tc.dispose()
    expect(await refresh(refreshToken)).toBe(401)
    // Subsequent attempts also fail — the session is gone, not just stale.
    expect(await refresh(refreshToken)).toBe(401)
  })

  test('MOBILE: refresh within 5-min window succeeds (4 min idle)', async () => {
    const { refreshToken, userId } = await signIn(
      PATIENTS.rita.email,
      'patient',
      'mobile',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    await tc.backdateAuthSessions(userId, 4 * 60)
    await tc.dispose()
    expect(await refresh(refreshToken)).toBe(200)
  })

  test('MOBILE: refresh past 5-min window is rejected (6 min idle)', async () => {
    const { refreshToken, userId } = await signIn(
      PATIENTS.james.email,
      'patient',
      'mobile',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    await tc.backdateAuthSessions(userId, 6 * 60)
    await tc.dispose()
    expect(await refresh(refreshToken)).toBe(401)
  })

  test('ADMIN web session: 15-min threshold applies (idle 20 min → 401)', async () => {
    const { refreshToken, userId } = await signIn(
      ADMINS.primaryProvider.email,
      'admin',
      'web',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    await tc.backdateAuthSessions(userId, 20 * 60)
    await tc.dispose()
    expect(await refresh(refreshToken)).toBe(401)
  })

  test('activity heartbeat: a fresh refresh inside the window resets the clock', async () => {
    const { refreshToken: token1, userId } = await signIn(
      PATIENTS.aisha.email,
      'patient',
      'web',
    )
    const tc = await newTestControl(
      API_BASE_URL,
      process.env.TEST_CONTROL_SECRET,
    )
    // 10 min idle — well inside the 15-min window. Refresh must succeed
    // AND bump lastActivityAt back to now.
    await tc.backdateAuthSessions(userId, 10 * 60)
    const ctx = await pwRequest.newContext({ baseURL: API_ROOT })
    const r1 = await ctx.post('/api/v2/auth/refresh', {
      data: { refreshToken: token1 },
    })
    expect(r1.status()).toBe(200)
    const r1Body = (await r1.json()) as { refreshToken: string }
    await ctx.dispose()
    // Now the session's lastActivityAt is fresh — a 14-min backdate
    // should still be inside the window.
    await tc.backdateAuthSessions(userId, 14 * 60)
    await tc.dispose()
    expect(await refresh(r1Body.refreshToken)).toBe(200)
  })
})
