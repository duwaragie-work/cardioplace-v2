import { test, expect, request as pwRequest } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { ADMINS, PATIENTS, DEMO_OTP } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * June 2026 — concurrent-session cap (Manisha 2026-06-12 Doc 2 Q1).
 * Backend caps PATIENT users at 1 active session and admin/provider users
 * at 3; the 4th admin login evicts the most-idle session ordered by
 * AuthSession.lastActivityAt. This spec drives the cap end-to-end via
 * the OTP + refresh endpoints, with one APIRequestContext per "device"
 * so each session has its own cookie jar + refresh token.
 *
 * Eviction surfaces as a 401 on the evicted session's next refresh —
 * fetchWithAuth's existing 401→sign-in path takes over from there.
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

type Session = {
  ctx: APIRequestContext
  accessToken: string
  refreshToken: string
  deviceId: string
}

/**
 * Sign in via OTP, accepting an explicit deviceId so the same email can
 * authenticate from N "different devices" inside one test run. Returns
 * the raw access + refresh tokens (refresh is read from the response body —
 * cookies are also set, but the API path is enough for what we assert).
 */
async function signInWithDevice(
  email: string,
  deviceId: string,
  appContext: 'patient' | 'admin',
): Promise<Session> {
  const ctx = await pwRequest.newContext({
    baseURL: API_ROOT,
    extraHTTPHeaders: {
      'x-device-id': deviceId,
      'x-device-platform': 'web',
    },
  })
  const sendRes = await ctx.post('/api/v2/auth/otp/send', {
    data: { email, appContext, deviceId },
  })
  expect(
    sendRes.ok(),
    `OTP send failed (${deviceId}): ${sendRes.status()} ${await sendRes.text()}`,
  ).toBeTruthy()

  const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
    data: { email, otp: DEMO_OTP, appContext, deviceId },
  })
  expect(
    verifyRes.ok(),
    `OTP verify failed (${deviceId}): ${verifyRes.status()} ${await verifyRes.text()}`,
  ).toBeTruthy()
  const body = await verifyRes.json()
  return {
    ctx,
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
    deviceId,
  }
}

/**
 * Attempt to rotate the session's refresh token. Returns the response
 * status — 201 (NestJS @Post success) means the session is still alive; 401 means it was evicted
 * (either by the session-cap or by an idle-timeout, the latter is Phase 2).
 */
async function tryRefresh(session: Session): Promise<number> {
  // Build a clean ctx (no stale cookies from sign-in) and post the raw
  // refresh token in the body — backend reads body if no cookie present.
  const ctx = await pwRequest.newContext({ baseURL: API_ROOT })
  const res = await ctx.post('/api/v2/auth/refresh', {
    data: { refreshToken: session.refreshToken },
  })
  const status = res.status()
  await ctx.dispose()
  return status
}

test.describe('33 — concurrent session cap (Manisha 2026-06-12)', () => {
  test('PATIENT: second device login revokes the first session', async () => {
    const email = PATIENTS.aisha.email
    const a = await signInWithDevice(email, 'qa-conc-patient-A', 'patient')
    const b = await signInWithDevice(email, 'qa-conc-patient-B', 'patient')

    // Cap=1 — signing in as B must have evicted A. A's refresh now 401s.
    expect(await tryRefresh(a)).toBe(401)
    // B is the live session.
    expect(await tryRefresh(b)).toBe(201)

    await a.ctx.dispose()
    await b.ctx.dispose()
  })

  test('ADMIN: 3 concurrent sessions allowed; 4th evicts the oldest (by lastActivityAt)', async () => {
    const email = ADMINS.primaryProvider.email
    // Sign in on four "devices" in order. Each sign-in stamps
    // AuthSession.lastActivityAt = now() (via @updatedAt). No refreshes
    // in between — so the lastActivityAt order is strictly A < B < C < D
    // and A is the most-idle when D's enforceSessionLimit runs.
    const a = await signInWithDevice(email, 'qa-conc-admin-A', 'admin')
    const b = await signInWithDevice(email, 'qa-conc-admin-B', 'admin')
    const c = await signInWithDevice(email, 'qa-conc-admin-C', 'admin')
    const d = await signInWithDevice(email, 'qa-conc-admin-D', 'admin')

    // A is the eviction target — its refresh token is now revoked.
    expect(await tryRefresh(a)).toBe(401)
    // B/C/D remain live.
    expect(await tryRefresh(b)).toBe(201)
    expect(await tryRefresh(c)).toBe(201)
    expect(await tryRefresh(d)).toBe(201)

    await a.ctx.dispose()
    await b.ctx.dispose()
    await c.ctx.dispose()
    await d.ctx.dispose()
  })

  test('ADMIN: activity heartbeat protects an active session from eviction', async () => {
    const email = ADMINS.backupProvider.email
    const a = await signInWithDevice(email, 'qa-conc-admin-act-A', 'admin')
    const b = await signInWithDevice(email, 'qa-conc-admin-act-B', 'admin')
    const c = await signInWithDevice(email, 'qa-conc-admin-act-C', 'admin')

    // Refresh A — bumps its lastActivityAt past B's. So B is now the
    // most-idle of the three. The refresh returns a NEW refresh token;
    // we don't reuse the old one.
    const aRefreshRes = await pwRequest
      .newContext({ baseURL: API_ROOT })
      .then(async (ctx) => {
        const res = await ctx.post('/api/v2/auth/refresh', {
          data: { refreshToken: a.refreshToken },
        })
        await ctx.dispose()
        return res
      })
    expect(aRefreshRes.status()).toBe(201)
    const aNew = (await aRefreshRes.json()) as { refreshToken: string }
    a.refreshToken = aNew.refreshToken

    // 4th sign-in — B should be the eviction target (oldest by activity).
    const d = await signInWithDevice(email, 'qa-conc-admin-act-D', 'admin')

    expect(await tryRefresh(b)).toBe(401)
    expect(await tryRefresh(a)).toBe(201)
    expect(await tryRefresh(c)).toBe(201)
    expect(await tryRefresh(d)).toBe(201)

    await a.ctx.dispose()
    await b.ctx.dispose()
    await c.ctx.dispose()
    await d.ctx.dispose()
  })
})
