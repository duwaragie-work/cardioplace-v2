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
 * Support System roadmap — Phase 3 (clinical-vs-operational split) + Phase 4
 * (Help Center / FAQ). API-level e2e.
 *
 *   1. The hard healthcare rule: a CLINICAL support request is REFUSED at the
 *      API (422 + a machine-readable CLINICAL_DEFLECTED code) and never becomes
 *      a ticket in the ops queue.
 *   2. The public Help Center reads published FAQ content with no auth, filtered
 *      to contentType=FAQ.
 */
const API_ROOT = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

test.describe('5Z — clinical deflect + FAQ', () => {
  test('a CLINICAL request is deflected (422) and never enters the ops queue', async () => {
    const patient = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      const subject = `Clinical probe ${Date.now()}`
      const res = await patient.post('v2/support/contact', {
        data: { subject, body: 'my chest hurts and I feel dizzy', category: 'CLINICAL' },
      })
      // Refused with the machine-readable code the UI keys on for the
      // care-team redirect + 911 carve-out.
      expect(res.status(), await res.text()).toBe(422)
      const body = (await res.json()) as { code?: string }
      expect(body.code).toBe('CLINICAL_DEFLECTED')

      // The rule that matters: it is NOT sitting in the ops queue.
      const listRes = await ops.get(
        `v2/admin/support/tickets?search=${encodeURIComponent(subject)}`,
      )
      expect(listRes.ok(), await listRes.text()).toBeTruthy()
      const { data } = (await listRes.json()) as { data: Array<{ subject: string }> }
      expect(data.find((t) => t.subject === subject)).toBeFalsy()
    } finally {
      await patient.dispose()
      await ops.dispose()
    }
  })

  test('the public Help Center returns published FAQ content (no auth)', async () => {
    const ctx: APIRequestContext = await pwRequest.newContext({
      baseURL: `${API_ROOT}/api/`,
    })
    try {
      const res = await ctx.get('v2/content?type=FAQ&limit=50')
      expect(res.ok(), await res.text()).toBeTruthy()
      const { items } = (await res.json()) as {
        items: Array<{ contentType: string; status: string; humanId: string }>
      }
      // Seeded starter set present, and the filter is honoured (FAQ only).
      expect(items.length).toBeGreaterThan(0)
      expect(items.every((i) => i.contentType === 'FAQ')).toBe(true)
      expect(items.every((i) => i.status === 'PUBLISHED')).toBe(true)
      expect(items.some((i) => i.humanId === 'FAQ-RESET-MFA')).toBe(true)
    } finally {
      await ctx.dispose()
    }
  })
})
