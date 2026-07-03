import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Support System — locked-out flow (sprint 5Y). Two guarantees:
 *   1. Identity-verification gate — a locked-out ticket lands unverified, and
 *      the sensitive reset actions are BLOCKED (403) until ops verifies the
 *      requester; verifying flips the ticket and opens the gate.
 *   2. Rate limiting — the public endpoint is capped at 5/IP/hour (6th → 429).
 *
 * NOTE: the rate-limit is a per-IP, 1-hour window. On CI (fresh DB) this is
 * deterministic; a local re-run inside the hour shares the window.
 */
const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

async function publicPost(data: unknown) {
  const ctx = await pwRequest.newContext({ baseURL: `${API_ROOT}/api/` })
  const res = await ctx.post('v2/support/locked-out', { data })
  const status = res.status()
  const body = res.ok() ? await res.json() : null
  await ctx.dispose()
  return { status, body }
}

test.describe('5Y — locked-out flow', () => {
  test('identity-verify gate blocks resets until ops verifies', async () => {
    // Public submission linked (by email) to a real account.
    const submit = await publicPost({
      email: PATIENTS.aisha.email,
      description: 'Lost my authenticator and recovery codes.',
      contactPhone: '555-0100',
    })
    expect(submit.status, 'locked-out submit').toBe(201)
    const ticketNumber = (submit.body as { ticketNumber: string }).ticketNumber
    expect(ticketNumber).toMatch(/^CP-SUP-/)

    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      // Ops finds it — unverified on arrival.
      const listRes = await ops.get(
        `v2/admin/support/tickets?search=${encodeURIComponent(ticketNumber)}`,
      )
      const { data } = (await listRes.json()) as {
        data: Array<{ id: string; ticketNumber: string; identityVerified: boolean }>
      }
      const row = data.find((t) => t.ticketNumber === ticketNumber)
      expect(row?.identityVerified).toBe(false)
      const id = row!.id

      // Sensitive action is BLOCKED before identity is verified.
      const blocked = await ops.post(`v2/admin/support/tickets/${id}/actions/mfa-reset`, {
        data: {},
      })
      expect(blocked.status(), 'mfa-reset before verify').toBe(403)

      // Ops verifies identity out-of-band.
      const verify = await ops.post(
        `v2/admin/support/tickets/${id}/verify-identity`,
        { data: { rationale: 'Confirmed DOB + last 4 via reply email' } },
      )
      expect(verify.ok(), await verify.text()).toBeTruthy()

      // The gate is now open (the ticket is verified; the action no longer 403s).
      const detail = await getVerified(ops, id)
      expect(detail).toBe(true)
      const afterVerify = await ops.post(
        `v2/admin/support/tickets/${id}/actions/mfa-reset`,
        { data: {} },
      )
      expect(afterVerify.status(), 'mfa-reset after verify is no longer gated').not.toBe(403)
    } finally {
      await ops.dispose()
    }
  })

  test('public locked-out endpoint is rate-limited (6th → 429)', async () => {
    let last = 0
    for (let i = 0; i < 6; i++) {
      const r = await publicPost({
        email: `rl-${i}@example.com`,
        description: 'rate-limit probe',
      })
      last = r.status
    }
    // Once ≥5 exist in the IP window, further submissions are refused.
    expect(last).toBe(429)
  })
})

async function getVerified(ops: APIRequestContext, id: string): Promise<boolean> {
  const res = await ops.get(`v2/admin/support/tickets/${id}`)
  const t = (await res.json()) as { identityVerified: boolean }
  return t.identityVerified
}
