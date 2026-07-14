import { test, expect, request as pwRequest } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, DEMO_OTP } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Spec 69 — system-principal registry (audit, HIPAA §164.312(b), Humaira
 * Activity 1 item 3). The 8 reserved cron/engine accounts (accountStatus
 * SYSTEM) must:
 *   69.1  never be able to sign in — an audit principal is not a login.
 *   69.2  never appear in the human admin user roster.
 *
 * API-level (no UI) so it's deterministic. Assumes the seed has run (the
 * principals seed unconditionally). If they aren't seeded, both assertions
 * still hold trivially — the security property is what's under test.
 */
const SYSTEM_EMAIL = 'system-daily-reminder@internal.cardioplace.test'

test.describe('Spec 69 — system principals', () => {
  test('69.1 — a system-principal email cannot obtain a session', async () => {
    const root = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')
    const ctx = await pwRequest.newContext({
      baseURL: root,
      extraHTTPHeaders: { 'x-device-id': 'qa-system-principal' },
    })
    try {
      // Send is info-disclosure-safe: it returns the generic success shape but
      // mints no OTP for a SYSTEM account. We don't assert the body (it must
      // NOT reveal the account exists) — only that a follow-up verify fails.
      await ctx.post('/api/v2/auth/otp/send', {
        data: { email: SYSTEM_EMAIL, appContext: 'patient', deviceId: 'qa-system-principal' },
      })

      // The demo perma-OTP only works for real seed personas; a SYSTEM row has
      // none, so verify must issue NO token / session.
      const verify = await ctx.post('/api/v2/auth/otp/verify', {
        data: {
          email: SYSTEM_EMAIL,
          otp: DEMO_OTP,
          appContext: 'patient',
          deviceId: 'qa-system-principal',
        },
      })
      expect(verify.ok(), 'a system principal must never verify').toBeFalsy()
      const body = await verify.json().catch(() => ({}))
      expect(body?.accessToken ?? body?.access_token, 'no access token').toBeFalsy()
    } finally {
      await ctx.dispose()
    }
  })

  test('69.2 — system principals are hidden from the admin user roster', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    try {
      const res = await api.get('admin/users?limit=200')
      expect(res.ok(), `list users: ${res.status()}`).toBeTruthy()
      const body = (await res.json()) as { data?: Array<{ email?: string; accountStatus?: string }> }
      const rows = body.data ?? []
      const leaked = rows.filter(
        (u) =>
          (u.email ?? '').includes('@internal.cardioplace.test') ||
          u.accountStatus === 'SYSTEM',
      )
      expect(leaked, 'no system principals may appear in the roster').toHaveLength(0)
    } finally {
      await api.dispose()
    }
  })
})
