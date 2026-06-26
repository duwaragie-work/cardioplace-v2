import { test, expect, request as pwRequest } from '@playwright/test'
import { ADMINS, DEMO_OTP } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { extractTotpSecret, totpCode } from '../helpers/mfa.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase/practice-identity + MFA ordering (Manisha 2026-06-12 §1 + §6).
 *
 * The sign-in flow authenticates the PERSON fully (second factor) BEFORE they
 * pick a practice context:
 *   OTP → MFA challenge → practice select → tokens.
 *
 * This spec proves the order at the API level for an ENROLLED multi-practice
 * provider — the one path that actually exercises the reorder. (A NON-enrolled
 * multi-practice provider still goes straight to the selector, covered by spec
 * 35; an org-wide admin like manisha resolves to a null practice and never sees
 * the selector, covered by spec 66.)
 *
 * Gated on SEED_TEST_FIXTURES (multi-practice provider fixture) + RUN_WRITE_TESTS
 * (enrolls + mutates MFA). Cleans up its MFA enrollment so specs that assume a
 * non-enrolled provider (35 / 40) still see PRACTICE_SELECT_REQUIRED.
 */

const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
const SEED_FIXTURES_ENABLED = process.env.SEED_TEST_FIXTURES === 'true'

test.describe('Phase/practice-identity — MFA precedes practice selection', () => {
  test.skip(
    !SEED_FIXTURES_ENABLED,
    'requires SEED_TEST_FIXTURES=true for multi-practice provider fixture',
  )
  test.skip(!process.env.RUN_WRITE_TESTS, 'enrolls + mutates MFA state')

  test('enrolled multi-practice provider: OTP → MFA challenge → practice select → tokens', async () => {
    const email = ADMINS.multiPracticeProvider.email
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const user = await tc.findUser(email)
    await tc.resetUserMfa(user.id)

    const ctx = await pwRequest.newContext({
      baseURL: API_ROOT,
      extraHTTPHeaders: {
        'x-device-id': 'spec41-order',
        'x-device-platform': 'web',
        // Admin-scoped cookies (deriveCookieScope) so select-practice issues
        // the admin refresh token, mirroring spec 35.
        origin: 'http://localhost:3001',
      },
    })
    try {
      // ── Bootstrap a session to enroll TOTP. Not yet enrolled, so the first
      //    sign-in goes straight to the practice selector (the pre-MFA case).
      await ctx.post('/api/v2/auth/otp/send', {
        data: { email, appContext: 'admin' },
      })
      const v1 = await ctx.post('/api/v2/auth/otp/verify', {
        data: { email, otp: DEMO_OTP, deviceId: 'spec41-order', appContext: 'admin' },
      })
      const v1b = await v1.json()
      expect(v1b.status, 'not-yet-enrolled → straight to practice select').toBe(
        'PRACTICE_SELECT_REQUIRED',
      )
      const sel1 = await ctx.post('/api/v2/auth/select-practice', {
        data: { challengeToken: v1b.challengeToken, practiceId: 'seed-cedar-hill' },
      })
      const sel1b = await sel1.json()
      expect(sel1b.accessToken, 'bootstrap session issued').toBeTruthy()

      // Enroll TOTP with that session.
      const start = await ctx.post('/api/v2/auth/mfa/enroll/start', {
        data: {},
        headers: { Authorization: `Bearer ${sel1b.accessToken}` },
      })
      const { provisioningUri, enrollmentToken } = (await start.json()) as {
        provisioningUri: string
        enrollmentToken: string
      }
      const secret = extractTotpSecret(provisioningUri)
      const complete = await ctx.post('/api/v2/auth/mfa/enroll/complete', {
        data: { enrollmentToken, code: totpCode(secret) },
        headers: { Authorization: `Bearer ${sel1b.accessToken}` },
      })
      expect(
        complete.ok(),
        `enroll/complete failed: ${complete.status()} ${await complete.text()}`,
      ).toBeTruthy()

      // ── THE REORDER. A fresh sign-in now returns the MFA challenge BEFORE the
      //    practice selector — not PRACTICE_SELECT_REQUIRED.
      await ctx.post('/api/v2/auth/otp/send', {
        data: { email, appContext: 'admin' },
      })
      const v2 = await ctx.post('/api/v2/auth/otp/verify', {
        data: { email, otp: DEMO_OTP, deviceId: 'spec41-order', appContext: 'admin' },
      })
      const v2b = await v2.json()
      expect(v2b.status, 'enrolled → MFA challenge precedes practice select').toBe(
        'MFA_REQUIRED',
      )
      expect(v2b.challengeToken).toBeTruthy()

      // Clearing the second factor hands back the practice selector, NOT tokens.
      const chal = await ctx.post('/api/v2/auth/mfa/challenge', {
        data: { challengeToken: v2b.challengeToken, code: totpCode(secret) },
      })
      const chalb = await chal.json()
      expect(
        chalb.status,
        `after MFA the multi-practice provider picks a practice: ${JSON.stringify(chalb)}`,
      ).toBe('PRACTICE_SELECT_REQUIRED')
      expect(chalb.accessToken, 'no tokens until a practice is chosen').toBeFalsy()
      expect(chalb.practices?.length ?? 0).toBeGreaterThan(1)

      // Picking a practice finally issues the real, practice-scoped tokens.
      const sel2 = await ctx.post('/api/v2/auth/select-practice', {
        data: { challengeToken: chalb.challengeToken, practiceId: 'seed-cedar-hill' },
      })
      expect(sel2.status()).toBe(201)
      const sel2b = await sel2.json()
      expect(sel2b.accessToken).toBeTruthy()
      expect(sel2b.activePracticeId).toBe('seed-cedar-hill')
    } finally {
      await ctx.dispose()
      // Restore the non-enrolled baseline so specs 35 / 40 still see the
      // straight-to-selector flow.
      await tc.resetUserMfa(user.id)
      await tc.dispose()
    }
  })
})
