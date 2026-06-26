import { test, expect, request as pwRequest } from '@playwright/test'
import { ADMINS, DEMO_OTP } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1) — mid-
 * session practice switch. The multi-practice provider signs in, picks
 * Practice A, then POSTs /switch-practice to flip to Practice B. Backend:
 *   • Verifies membership.
 *   • Updates AuthSession.activePracticeId on the row matching the
 *     refresh-token cookie (so the audit trail is bound to this device).
 *   • Mints a fresh access token carrying the new activePracticeId JWT
 *     claim so the next request sees the new context immediately.
 *   • Writes a practice_switched AuthLog row with practiceContext = B.
 *
 * Gated on SEED_TEST_FIXTURES — needs the seeded multi-practice provider.
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
const SEED_FIXTURES_ENABLED = process.env.SEED_TEST_FIXTURES === 'true'

test.describe('Phase/practice-identity — mid-session switcher', () => {
  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for multi-practice provider fixture',
  )

  test('multi-practice provider can switch + mint a fresh access token', async () => {
    const ctx = await pwRequest.newContext({
      baseURL: API_ROOT,
      extraHTTPHeaders: {
        'x-device-id': 'spec35-switch',
        'x-device-platform': 'web',
        // Multi-practice provider is an admin role → backend's
        // deriveCookieScope() must resolve to 'admin' so /select-practice
        // sets `cp_admin_refresh_token` and /switch-practice finds it.
        // Without this Origin it falls back to 'patient' scope and the
        // switch fails with "No active session".
        origin: 'http://localhost:3001',
      },
    })

    // Sign in + select Practice A.
    await ctx.post('/api/v2/auth/otp/send', {
      data: { email: ADMINS.multiPracticeProvider.email, appContext: 'admin' },
    })
    const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
      data: {
        email: ADMINS.multiPracticeProvider.email,
        otp: DEMO_OTP,
        deviceId: 'spec35-switch',
        appContext: 'admin',
      },
    })
    const verifyBody = await verifyRes.json()
    expect(verifyBody.status).toBe('PRACTICE_SELECT_REQUIRED')

    const selectA = await ctx.post('/api/v2/auth/select-practice', {
      data: {
        challengeToken: verifyBody.challengeToken,
        practiceId: 'seed-cedar-hill',
      },
    })
    expect(selectA.status()).toBe(201)
    const selectABody = await selectA.json()
    expect(selectABody.activePracticeId).toBe('seed-cedar-hill')

    // Switch to Practice B. The HttpOnly refresh-token cookie was set on
    // the context by the selectA response; the controller reads it from
    // the cookie and resolves the AuthSession to flip.
    const switchRes = await ctx.post('/api/v2/auth/switch-practice', {
      data: { practiceId: 'seed-bridgepoint' },
      headers: { Authorization: `Bearer ${selectABody.accessToken}` },
    })
    expect(
      switchRes.status(),
      `/switch-practice returns 200/201: body ${await switchRes.text().catch(() => '')}`,
    ).toBeLessThan(300)
    const switchBody = await switchRes.json()
    expect(switchBody.activePracticeId).toBe('seed-bridgepoint')
    // Fresh access token MUST be returned so the FE picks up the new
    // claim immediately. Same refresh token stays (session continues).
    expect(switchBody.accessToken).toBeTruthy()
    expect(switchBody.accessToken).not.toBe(selectABody.accessToken)
  })

  test('switch to a non-member practice → 403', async () => {
    test.skip(
      !SEED_FIXTURES_ENABLED,
      'requires SEED_TEST_FIXTURES=true for multi-practice provider fixture',
    )
    const ctx = await pwRequest.newContext({
      baseURL: API_ROOT,
      extraHTTPHeaders: {
        'x-device-id': 'spec35-forbid',
        'x-device-platform': 'web',
        origin: 'http://localhost:3001',
      },
    })
    await ctx.post('/api/v2/auth/otp/send', {
      data: { email: ADMINS.multiPracticeProvider.email, appContext: 'admin' },
    })
    const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
      data: {
        email: ADMINS.multiPracticeProvider.email,
        otp: DEMO_OTP,
        deviceId: 'spec35-forbid',
        appContext: 'admin',
      },
    })
    const { challengeToken } = await verifyRes.json()
    const selectA = await ctx.post('/api/v2/auth/select-practice', {
      data: { challengeToken, practiceId: 'seed-cedar-hill' },
    })
    const { accessToken } = await selectA.json()

    const res = await ctx.post('/api/v2/auth/switch-practice', {
      data: { practiceId: 'not-a-real-practice' },
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    expect(res.status()).toBe(403)
  })
})
