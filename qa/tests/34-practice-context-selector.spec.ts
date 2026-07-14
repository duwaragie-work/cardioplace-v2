import { test, expect, request as pwRequest } from '@playwright/test'
import { ADMINS, DEMO_OTP } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase/practice-identity (Manisha 2026-06-12 Access Control §1, HIPAA
 * 45 CFR §164.312(a)(2)(i)). Drives the sign-in selector flow end-to-end:
 *
 *   • Single-practice provider → /otp/verify returns the real token pair
 *     with `activePracticeId` auto-set to that practice.
 *   • Multi-practice provider → /otp/verify returns
 *     PRACTICE_SELECT_REQUIRED + a short-lived challenge token + the
 *     practice list. POSTing /select-practice with the challenge + the
 *     chosen practiceId issues the real tokens.
 *   • SUPER_ADMIN / HEALPLACE_OPS → bypass selector (activePracticeId is
 *     legitimately null; audit captures null per Manisha allowance).
 *
 * Gates on SEED_TEST_FIXTURES so production seed stays single-practice.
 * When the env flag isn't set, the multi-practice provider doesn't exist
 * and the selector branch is skipped (the single-practice + admin branches
 * still run against the existing seed).
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
const SEED_FIXTURES_ENABLED = process.env.SEED_TEST_FIXTURES === 'true'

async function verifyOtp(email: string, deviceId: string) {
  const ctx = await pwRequest.newContext({
    baseURL: API_ROOT,
    extraHTTPHeaders: { 'x-device-id': deviceId, 'x-device-platform': 'web' },
  })
  const sendRes = await ctx.post('/api/v2/auth/otp/send', {
    data: { email, appContext: 'admin', deviceId },
  })
  expect(sendRes.ok(), `OTP send failed: ${sendRes.status()}`).toBe(true)
  const verifyRes = await ctx.post('/api/v2/auth/otp/verify', {
    data: { email, otp: DEMO_OTP, deviceId, appContext: 'admin' },
  })
  expect(verifyRes.status(), `/otp/verify HTTP status`).toBe(201)
  return { ctx, body: await verifyRes.json() }
}

test.describe('Phase/practice-identity — sign-in selector', () => {
  test('single-practice PROVIDER auto-sets activePracticeId (no selector)', async () => {
    const { body } = await verifyOtp(
      ADMINS.primaryProvider.email,
      'spec34-single',
    )
    // Single-practice path: real token pair with activePracticeId set
    // directly to the lone Cedar Hill membership.
    expect(body.accessToken, 'access token issued').toBeTruthy()
    expect(body.refreshToken, 'refresh token issued').toBeTruthy()
    expect(
      body.status,
      'no PRACTICE_SELECT_REQUIRED for single-practice provider',
    ).not.toBe('PRACTICE_SELECT_REQUIRED')
    expect(body.activePracticeId, 'activePracticeId auto-set').toBe(
      'seed-cedar-hill',
    )
  })

  test('SUPER_ADMIN / HEALPLACE_OPS bypass selector (activePracticeId null)', async () => {
    const { body } = await verifyOtp(ADMINS.ops.email, 'spec34-ops')
    expect(body.accessToken, 'access token issued').toBeTruthy()
    expect(
      body.status,
      'org-wide role never sees PRACTICE_SELECT_REQUIRED',
    ).not.toBe('PRACTICE_SELECT_REQUIRED')
    expect(
      body.activePracticeId ?? null,
      'org-wide role acts with null practice context',
    ).toBeNull()
  })

  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for multi-practice provider fixture',
  )
  test('multi-practice PROVIDER → PRACTICE_SELECT_REQUIRED → /select-practice → tokens', async () => {
    const { ctx, body } = await verifyOtp(
      ADMINS.multiPracticeProvider.email,
      'spec34-multi',
    )
    // Verify-OTP returns the discriminated selector payload, NOT tokens.
    expect(body.status).toBe('PRACTICE_SELECT_REQUIRED')
    expect(body.challengeToken, 'challenge token present').toBeTruthy()
    expect(body.accessToken, 'NO access token before selector').toBeFalsy()
    expect(
      Array.isArray(body.practices) && body.practices.length >= 2,
      'two practices surfaced for selection',
    ).toBe(true)
    const practiceIds: string[] = body.practices.map((p: { id: string }) => p.id)
    expect(practiceIds).toContain('seed-cedar-hill')
    expect(practiceIds).toContain('seed-bridgepoint')

    // Exchange the challenge for real tokens against Practice B.
    const selectRes = await ctx.post('/api/v2/auth/select-practice', {
      data: { challengeToken: body.challengeToken, practiceId: 'seed-bridgepoint' },
    })
    expect(selectRes.status(), '/select-practice issues tokens').toBe(201)
    const selectBody = await selectRes.json()
    expect(selectBody.accessToken).toBeTruthy()
    expect(selectBody.refreshToken).toBeTruthy()
    expect(selectBody.activePracticeId).toBe('seed-bridgepoint')
  })

  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for multi-practice fixture',
  )
  test('multi-practice PROVIDER → wrong practice in /select-practice → 403', async () => {
    const { ctx, body } = await verifyOtp(
      ADMINS.multiPracticeProvider.email,
      'spec34-wrong',
    )
    expect(body.status).toBe('PRACTICE_SELECT_REQUIRED')
    // Attempt to select a practice the user is NOT a member of.
    const res = await ctx.post('/api/v2/auth/select-practice', {
      data: {
        challengeToken: body.challengeToken,
        practiceId: 'not-a-real-practice',
      },
    })
    expect(res.status(), 'foreign-practice selection rejected').toBe(403)
  })
})
