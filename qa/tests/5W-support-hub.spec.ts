import { test, expect, request as pwRequest } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL, PATIENT_BASE_URL } from '../playwright.config.js'

/**
 * Support System — the adaptive `/support` hub and the public contact endpoint.
 *
 * Two guarantees this spec exists to protect:
 *   1. `/support` adapts to auth state — signed-out gets the public subset,
 *      signed-in gets the authenticated one — and `/support/my-tickets` stays
 *      GATED even though its parent route is public (proxy.ts PUBLIC_ROUTES is
 *      prefix-matched, so this is easy to regress silently).
 *   2. The public contact endpoint creates a REAL, trackable ticket — the whole
 *      reason it replaced the old fire-and-forget /api/contact email.
 *
 * RATE-LIMIT NOTE: public-contact intentionally shares the anonymous per-IP
 * budget with the locked-out form (5/IP/hour) — one IP must not get double the
 * anonymous-ticket allowance just because there are two public doors. That means
 * this spec spends budget 5Y also needs, and on a local re-run inside the hour
 * one of them will legitimately 429. On CI (fresh DB/IP window) it is
 * deterministic. The authenticated test below uses its own patient fixture to
 * avoid the separate 3-per-user-per-5-minute cap that 5X/5Z consume.
 */
const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

test.describe('5W — support hub + public contact', () => {
  test('the hub renders its public subset when signed out', async ({ page }) => {
    await page.goto(`${PATIENT_BASE_URL}/support`)
    // Reachable at all — i.e. not bounced to /sign-in by the proxy.
    await expect(page).toHaveURL(/\/support$/)
    await expect(page.getByTestId('support-hub-public')).toBeVisible()
    // Public affordances.
    await expect(page.getByTestId('support-hub-locked-out')).toBeVisible()
    await expect(page.getByTestId('public-contact-form')).toBeVisible()
    // The emergency carve-out is never gated behind auth.
    await expect(page.getByTestId('support-emergency-banner')).toBeVisible()
    // Authenticated-only affordances must NOT be teased to a signed-out visitor.
    await expect(page.getByTestId('support-hub-authed')).toHaveCount(0)
    await expect(page.getByTestId('support-hub-my-tickets')).toHaveCount(0)
  })

  test('/support/my-tickets stays gated even though /support is public', async ({
    page,
  }) => {
    // PUBLIC_ROUTES is prefix-matched — without the PRIVATE_ROUTE_EXCEPTIONS
    // guard, allow-listing `/support` would drag this child public with it and
    // expose a patient's own support threads.
    await page.goto(`${PATIENT_BASE_URL}/support/my-tickets`)
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('public contact creates a real trackable ticket', async () => {
    const ctx = await pwRequest.newContext({ baseURL: `${API_ROOT}/api/` })
    try {
      const subject = `Public contact ${Date.now()}`
      const res = await ctx.post('v2/support/public-contact', {
        data: {
          email: 'public-visitor@example.com',
          subject,
          message: 'How do I get started?',
        },
      })
      expect(res.status(), await res.text()).toBe(201)
      const { ticketNumber } = (await res.json()) as { ticketNumber: string }
      // A real ticket number — not the old fire-and-forget email.
      expect(ticketNumber).toMatch(/^CP-SUP-/)
    } finally {
      await ctx.dispose()
    }
  })

  test('the patient reply endpoint flips the derived awaitingParty to OPS', async () => {
    // Guards the derived hint end-to-end: it is computed from the last reply's
    // author, so a patient reply must move the ball to ops with no status change.
    //
    // Deliberately NOT aisha: the authenticated intake is rate-limited to 3
    // tickets per user per 5 minutes, and 5X + 5Z already spend aisha's budget.
    // Sharing her here made all three specs 429 each other on a full run.
    const patient = await authedApi(API_BASE_URL, PATIENTS.carol.email, 'patient')
    try {
      const subject = `Awaiting-party probe ${Date.now()}`
      const created = await patient.post('v2/support/contact', {
        data: { subject, body: 'checking the derived hint', category: 'ACCOUNT' },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const { ticketNumber } = (await created.json()) as { ticketNumber: string }

      const mine = await (await patient.get('v2/support/tickets/mine')).json()
      const row = (
        mine.data as Array<{
          ticketNumber: string
          id: string
          awaitingParty: string | null
        }>
      ).find((t) => t.ticketNumber === ticketNumber)
      // Brand-new ticket, no replies yet → nobody's "turn".
      expect(row?.awaitingParty).toBeNull()

      const reply = await patient.post(`v2/support/tickets/${row!.id}/reply`, {
        data: { body: 'adding more detail' },
      })
      expect(reply.ok(), await reply.text()).toBeTruthy()

      const after = await (await patient.get('v2/support/tickets/mine')).json()
      const updated = (
        after.data as Array<{ id: string; status: string; awaitingParty: string | null }>
      ).find((t) => t.id === row!.id)
      expect(updated?.status).toBe('IN_PROGRESS')
      expect(updated?.awaitingParty).toBe('OPS')
    } finally {
      await patient.dispose()
    }
  })
})
