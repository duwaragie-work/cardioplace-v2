import {
  test,
  expect,
  request as pwRequest,
  type APIRequestContext,
} from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
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

  // The terminal state and the sweep that produces it were Jest-only until now —
  // never proven against a real DB. `autoCloseResolvedTickets` takes an
  // injectable `now`, so we drive the sweep with a future timestamp instead of
  // backdating rows or waiting 14 days.
  test('resolve → auto-close sweep at +15d → CLOSED', async () => {
    test.slow()
    const patient = await authedApi(API_BASE_URL, PATIENTS.mike.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    const ctl = await testControl()
    try {
      const subject = `Auto-close probe ${Date.now()}`
      const created = await patient.post('v2/support/contact', {
        data: { subject, body: 'probe', category: 'ACCOUNT' },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const { ticketNumber } = (await created.json()) as { ticketNumber: string }
      const id = await findMyTicketId(patient, ticketNumber)

      const resolved = await ops.post(`v2/admin/support/tickets/${id}/resolve`, {
        data: { resolutionNotes: 'done' },
      })
      expect(resolved.ok(), await resolved.text()).toBeTruthy()
      expect(await myStatus(patient, id)).toBe('RESOLVED')

      // 15 days > the 14-day auto-close delay.
      const future = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
      const swept = await ctl.post('test-control/cron/support-auto-close/run', {
        data: { now: future },
      })
      expect(swept.ok(), await swept.text()).toBeTruthy()
      expect(await myStatus(patient, id)).toBe('CLOSED')
    } finally {
      await patient.dispose()
      await ops.dispose()
      await ctl.dispose()
    }
  })

  // The nudge is the one change here that EMAILS PATIENTS, so it gets end-to-end
  // proof rather than unit coverage alone: it must fire when ops replied and the
  // thread went quiet, and must NOT fire again for that same silence.
  test('ops reply → 4d silence → nudge fires once, not twice', async () => {
    test.slow()
    const patient = await authedApi(API_BASE_URL, PATIENTS.james.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    const ctl = await testControl()
    try {
      const subject = `Nudge probe ${Date.now()}`
      const created = await patient.post('v2/support/contact', {
        data: { subject, body: 'probe', category: 'ACCOUNT' },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const { ticketNumber } = (await created.json()) as { ticketNumber: string }
      const id = await findMyTicketId(patient, ticketNumber)

      // Ops replies → the ball is with the patient.
      const replied = await ops.post(`v2/admin/support/tickets/${id}/reply`, {
        data: { body: 'Could you confirm your device?' },
      })
      expect(replied.ok(), await replied.text()).toBeTruthy()

      // Nothing yet — the silence window has not elapsed.
      const early = await ctl.post('test-control/cron/support-nudge/run', {
        data: { now: new Date().toISOString() },
      })
      expect(early.ok(), await early.text()).toBeTruthy()
      expect((await early.json()).nudged, 'no nudge before the window').toBe(0)

      // 4 days later (> the 3-day window) it fires.
      const future = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString()
      const first = await ctl.post('test-control/cron/support-nudge/run', {
        data: { now: future },
      })
      expect(first.ok(), await first.text()).toBeTruthy()
      expect((await first.json()).nudged, 'nudged after the window').toBeGreaterThanOrEqual(1)

      // Running again must NOT re-nudge the same silence — the dedupe is
      // anchored on the last reply, so a daily cron can't turn into a daily nag.
      const second = await ctl.post('test-control/cron/support-nudge/run', {
        data: { now: future },
      })
      expect(second.ok(), await second.text()).toBeTruthy()
      expect((await second.json()).nudged, 'no repeat nudge for the same silence').toBe(0)
    } finally {
      await patient.dispose()
      await ops.dispose()
      await ctl.dispose()
    }
  })

  // The legal shells must resolve but stay out of the index while the copy is
  // still placeholder — a discoverable, unfinished HIPAA notice is worse than none.
  test('legal route shells resolve and are noindex', async () => {
    const ctx = await pwRequest.newContext({ baseURL: PATIENT_BASE_URL })
    try {
      for (const route of [
        '/hipaa-notice',
        '/cookies',
        '/accessibility',
        '/nondiscrimination',
        '/telehealth-consent',
      ]) {
        const res = await ctx.get(route)
        expect(res.status(), `${route} resolves`).toBe(200)
        // PolicyShell is a client component and Next cannot export metadata from
        // one — each route needs a server wrapper, so assert the tag really emits.
        expect(await res.text(), `${route} is noindex`).toContain('noindex');
      }
    } finally {
      await ctx.dispose()
    }
  })

  // "Closed ... or on user confirm" — the patient-driven route to CLOSED.
  test('resolve → patient confirms → CLOSED immediately', async () => {
    test.slow()
    const patient = await authedApi(API_BASE_URL, PATIENTS.olive.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      const subject = `User-close probe ${Date.now()}`
      const created = await patient.post('v2/support/contact', {
        data: { subject, body: 'probe', category: 'ACCOUNT' },
      })
      expect(created.ok(), await created.text()).toBeTruthy()
      const { ticketNumber } = (await created.json()) as { ticketNumber: string }
      const id = await findMyTicketId(patient, ticketNumber)

      // Closing an ACTIVE ticket is refused — confirm means confirm a resolution.
      const tooEarly = await patient.post(`v2/support/tickets/${id}/close`)
      expect(tooEarly.status(), 'close before resolve is refused').toBe(400)

      const resolved = await ops.post(`v2/admin/support/tickets/${id}/resolve`, {
        data: { resolutionNotes: 'done' },
      })
      expect(resolved.ok(), await resolved.text()).toBeTruthy()

      const closed = await patient.post(`v2/support/tickets/${id}/close`)
      expect(closed.ok(), await closed.text()).toBeTruthy()
      expect(await myStatus(patient, id)).toBe('CLOSED')
    } finally {
      await patient.dispose()
      await ops.dispose()
    }
  })
})

/** Authorised test-control context (gated by ENABLE_TEST_CONTROL + secret). */
async function testControl(): Promise<APIRequestContext> {
  const secret = process.env.TEST_CONTROL_SECRET
  return pwRequest.newContext({
    baseURL: `${API_ROOT}/api/`,
    extraHTTPHeaders: secret ? { 'X-Test-Control-Secret': secret } : {},
  })
}

async function findMyTicketId(
  patient: APIRequestContext,
  ticketNumber: string,
): Promise<string> {
  const res = await patient.get('v2/support/tickets/mine')
  expect(res.ok(), await res.text()).toBeTruthy()
  const { data } = (await res.json()) as {
    data: Array<{ id: string; ticketNumber: string }>
  }
  const row = data.find((t) => t.ticketNumber === ticketNumber)
  expect(row, `ticket ${ticketNumber} in /tickets/mine`).toBeTruthy()
  return row!.id
}

async function myStatus(
  patient: APIRequestContext,
  id: string,
): Promise<string> {
  const res = await patient.get('v2/support/tickets/mine')
  const { data } = (await res.json()) as {
    data: Array<{ id: string; status: string }>
  }
  return data.find((t) => t.id === id)?.status ?? 'NOT_FOUND'
}
