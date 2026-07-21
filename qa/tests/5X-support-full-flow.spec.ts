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

  // The full extended lifecycle on the agreed FOUR-state model (Duwaragie,
  // 2026-07-21): two-way in-thread messaging where whose-turn-it-is is DERIVED
  // (`awaitingParty`) rather than stored, ops assignment + priority re-triage,
  // resolve, then patient reopen back to IN_PROGRESS.
  test('two-way thread → assign → priority → resolve → patient reopen', async () => {
    // Two sign-ins plus ~a dozen round-trips to a remote managed Postgres —
    // comfortably more than the default 30s budget allows.
    test.slow()
    const patient = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      // 1. Patient raises a ticket.
      const subject = `Extended lifecycle ${Date.now()}`
      const contactRes = await patient.post('v2/support/contact', {
        data: { subject, body: 'walk me through the steps please', category: 'ACCOUNT' },
      })
      expect(contactRes.ok(), await contactRes.text()).toBeTruthy()
      const { ticketNumber } = (await contactRes.json()) as { ticketNumber: string }
      const id = await findTicketId(ops, ticketNumber)
      expect(id).toBeTruthy()

      // 2. Ops reply activates the ticket and puts the ball in the patient's
      //    court — status IN_PROGRESS, and the DERIVED hint says PATIENT.
      const opsReply = await ops.post(`v2/admin/support/tickets/${id}/reply`, {
        data: { body: 'Happy to help — can you confirm your device?' },
      })
      expect(opsReply.ok(), await opsReply.text()).toBeTruthy()
      await expectMine(patient, id!, 'IN_PROGRESS', 'PATIENT', 'ops replied last')

      // 3. Patient in-thread reply hands the ball back to ops. Status is
      //    unchanged (still IN_PROGRESS) — only the derived hint flips.
      const patientReply = await patient.post(`v2/support/tickets/${id}/reply`, {
        data: { body: 'It is an Android phone.' },
      })
      expect(patientReply.ok(), await patientReply.text()).toBeTruthy()
      await expectMine(patient, id!, 'IN_PROGRESS', 'OPS', 'patient replied last')

      // 4. Ops picks it up (assign-to-me) and re-triages the priority.
      const assign = await ops.post(`v2/admin/support/tickets/${id}/assign`, { data: {} })
      expect(assign.ok(), await assign.text()).toBeTruthy()
      const prio = await ops.post(`v2/admin/support/tickets/${id}/priority`, {
        data: { priority: 'LOW' },
      })
      expect(prio.ok(), await prio.text()).toBeTruthy()

      const detail = await getTicket(ops, id!)
      expect(detail.assignedToOpsId).toBeTruthy()
      expect(detail.priority).toBe('LOW')
      expect(detail.replies.some((r) => r.authorType === 'USER')).toBe(true)
      expect(detail.actions.some((a) => a.actionType === 'ASSIGNED')).toBe(true)
      expect(detail.actions.some((a) => a.actionType === 'PRIORITY_CHANGED')).toBe(true)

      // 5. Ops resolves → RESOLVED (patient sees it).
      const resolve = await ops.post(`v2/admin/support/tickets/${id}/resolve`, {
        data: { resolutionNotes: 'Guided through the steps.' },
      })
      expect(resolve.ok(), await resolve.text()).toBeTruthy()
      // A resolved ticket is waiting on nobody.
      await expectMine(patient, id!, 'RESOLVED', null, 'resolved')

      // 6. A resolved ticket cannot take an in-thread reply — must reopen first.
      const lateReply = await patient.post(`v2/support/tickets/${id}/reply`, {
        data: { body: 'actually one more thing' },
      })
      expect(lateReply.status(), 'reply on resolved is refused').toBe(400)

      // 7. Patient reopens within the 7-day window → back to IN_PROGRESS.
      //    There is no REOPENED state; reopenedAt records that it happened.
      const reopen = await patient.post(`v2/support/tickets/${id}/reopen`)
      expect(reopen.ok(), await reopen.text()).toBeTruthy()
      expect(await mineStatus(patient, id!)).toBe('IN_PROGRESS')
    } finally {
      await patient.dispose()
      await ops.dispose()
    }
  })
})

async function mineRow(patient: APIRequestContext, id: string) {
  const res = await patient.get('v2/support/tickets/mine')
  expect(res.ok(), await res.text()).toBeTruthy()
  const { data } = (await res.json()) as {
    data: Array<{ id: string; status: string; awaitingParty: string | null }>
  }
  return data.find((t) => t.id === id)
}

async function mineStatus(patient: APIRequestContext, id: string): Promise<string> {
  return (await mineRow(patient, id))?.status ?? 'NOT_FOUND'
}

/**
 * Assert status + the derived "whose turn is it" hint in ONE round-trip.
 * Each of these specs talks to a remote managed Postgres, so a checkpoint that
 * fetched the list twice (once per field) was enough to blow the test timeout.
 */
async function expectMine(
  patient: APIRequestContext,
  id: string,
  status: string,
  awaitingParty: string | null,
  label: string,
): Promise<void> {
  const row = await mineRow(patient, id)
  expect(row?.status, `${label}: status`).toBe(status)
  expect(row?.awaitingParty ?? null, `${label}: awaitingParty`).toBe(awaitingParty)
}

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
    priority: string
    assignedToOpsId: string | null
    replies: Array<{ authorType: string; body: string }>
    actions: Array<{ actionType: string }>
  }
}
