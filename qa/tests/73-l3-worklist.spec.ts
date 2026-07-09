import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * L3 — reviewer worklist endpoints (HIPAA §164.312(b) act + §164.308(a)(6)).
 * API-level e2e, mirroring spec 64 (L2): deterministic without seeding — the
 * worklist UI is verified by tsc and wires to exactly these endpoints. Asserts:
 *   • an org-wide role (HEALPLACE_OPS) can read exceptions + incidents, paginated;
 *   • filters narrow results (status);
 *   • a non-org role (PROVIDER) is 403'd on every worklist route (RolesGuard);
 *   • triage/lifecycle writes are equally gated (PROVIDER cannot POST).
 *
 * The escalate → SecurityIncident lifecycle (acknowledge / mark-benign /
 * escalate) needs a deterministically-seeded AuditException — best driven via
 * the N7 test-control cron endpoint. Tracked as a follow-up; here we assert the
 * contract shape + RBAC, which don't depend on N7 having flagged any rows.
 */
test.describe('73 — L3 worklist endpoints + RBAC', () => {
  test('OPS reads exceptions + incidents (paginated, filtered); PROVIDER is forbidden', async () => {
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    const provider = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    try {
      // OPS — exceptions, first page.
      const exRes = await ops.get('v2/admin/worklist/exceptions?limit=5')
      expect(exRes.ok(), await exRes.text()).toBeTruthy()
      const ex = await exRes.json()
      expect(Array.isArray(ex.data)).toBe(true)
      expect(ex).toMatchObject({ page: 1, limit: 5 })
      expect(typeof ex.total).toBe('number')

      // OPS — exceptions filtered by status; every returned row matches.
      const openRes = await ops.get('v2/admin/worklist/exceptions?status=OPEN&limit=10')
      expect(openRes.ok()).toBeTruthy()
      for (const row of (await openRes.json()).data) {
        expect(row.status).toBe('OPEN')
      }

      // OPS — incidents list.
      const incRes = await ops.get('v2/admin/worklist/incidents?limit=5')
      expect(incRes.ok(), await incRes.text()).toBeTruthy()
      const inc = await incRes.json()
      expect(Array.isArray(inc.data)).toBe(true)
      expect(inc).toMatchObject({ page: 1, limit: 5 })

      // OPS — a missing exception is 404 (not 500).
      const missing = await ops.get('v2/admin/worklist/exceptions/does-not-exist')
      expect(missing.status()).toBe(404)

      // PROVIDER (non-org role) — every worklist route is 403 (RolesGuard).
      expect((await provider.get('v2/admin/worklist/exceptions')).status()).toBe(403)
      expect((await provider.get('v2/admin/worklist/incidents')).status()).toBe(403)
      const pAck = await provider.post('v2/admin/worklist/exceptions/x/acknowledge', {})
      expect(pAck.status()).toBe(403)
    } finally {
      await ops.dispose()
      await provider.dispose()
    }
  })
})
