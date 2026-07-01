import { test, expect, type APIRequestContext } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Support System — full triage flow (sprint 5X). Exercises the real endpoints
 * end-to-end (the same ones the admin queue + detail UI call):
 *   patient submits in-app contact → ops sees it in the queue → ops replies →
 *   ops resolves → the action timeline records the chain.
 *
 * API-level e2e (deterministic; no cross-app UI timing). The UIs are verified
 * by tsc and wire to these endpoints.
 */
test.describe('5X — support full flow', () => {
  test('patient contact → ops queue → reply → resolve → audit chain', async () => {
    const patient = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      // 1. Patient raises a ticket from the in-app form.
      const subject = `Cannot open my readings ${Date.now()}`
      const contactRes = await patient.post('v2/support/contact', {
        data: { subject, body: 'The readings tab is blank for me.', category: 'BUG' },
      })
      expect(contactRes.ok(), await contactRes.text()).toBeTruthy()
      const { ticketNumber } = (await contactRes.json()) as { ticketNumber: string }
      expect(ticketNumber).toMatch(/^CP-SUP-/)

      // 2. Ops sees it in the queue (search by ticket number).
      const id = await findTicketId(ops, ticketNumber)
      expect(id).toBeTruthy()

      // 3. Signed-in contact lands identity-verified, and ops replies.
      const detail1 = await getTicket(ops, id!)
      expect(detail1.identityVerified).toBe(true)
      expect(detail1.subject).toBe(subject)

      const replyRes = await ops.post(`v2/admin/support/tickets/${id}/reply`, {
        data: { body: 'Thanks — we are looking into it and will follow up.' },
      })
      expect(replyRes.ok(), await replyRes.text()).toBeTruthy()

      // 4. Ops resolves the ticket.
      const resolveRes = await ops.post(`v2/admin/support/tickets/${id}/resolve`, {
        data: { resolutionNotes: 'Advised cache clear; confirmed fixed.' },
      })
      expect(resolveRes.ok(), await resolveRes.text()).toBeTruthy()

      // 5. The detail now shows the OPS reply + a RESOLVED action + status.
      const detail2 = await getTicket(ops, id!)
      expect(detail2.status).toBe('RESOLVED')
      expect(detail2.replies.some((r) => r.authorType === 'OPS')).toBe(true)
      expect(detail2.actions.some((a) => a.actionType === 'RESOLVED')).toBe(true)
    } finally {
      await patient.dispose()
      await ops.dispose()
    }
  })
})

async function findTicketId(
  ops: APIRequestContext,
  ticketNumber: string,
): Promise<string | undefined> {
  const res = await ops.get(
    `v2/admin/support/tickets?search=${encodeURIComponent(ticketNumber)}`,
  )
  expect(res.ok(), await res.text()).toBeTruthy()
  const { data } = (await res.json()) as { data: Array<{ id: string; ticketNumber: string }> }
  return data.find((t) => t.ticketNumber === ticketNumber)?.id
}

async function getTicket(ops: APIRequestContext, id: string) {
  const res = await ops.get(`v2/admin/support/tickets/${id}`)
  expect(res.ok(), await res.text()).toBeTruthy()
  return (await res.json()) as {
    status: string
    subject: string
    identityVerified: boolean
    replies: Array<{ authorType: string; body: string }>
    actions: Array<{ actionType: string }>
  }
}
