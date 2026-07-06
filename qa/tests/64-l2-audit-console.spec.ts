import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * L2 — audit-review console read endpoints (HIPAA §164.312(b), the "examine"
 * half) + the L1 training-ack round-trip. API-level e2e — deterministic; the
 * console UI is verified by tsc and wires to exactly these endpoints. Asserts:
 *   • an org-wide role (HEALPLACE_OPS) can read AccessLog + AuthLog, paginated;
 *   • filters narrow results (action / event);
 *   • a non-org role (PROVIDER) is 403'd — the audit trail is OPS/SUPER only;
 *   • L1: a reviewer can acknowledge the Rules of Behavior and read it back.
 */
test.describe('64 — L2 audit endpoints + L1 training-ack', () => {
  test('OPS reads access-log + auth-log (paginated, filtered); PROVIDER is forbidden', async () => {
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    const provider = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    try {
      // OPS — access log, first page.
      const accessRes = await ops.get('v2/admin/audit/access-log?limit=5')
      expect(accessRes.ok(), await accessRes.text()).toBeTruthy()
      const access = await accessRes.json()
      expect(Array.isArray(access.data)).toBe(true)
      expect(access).toMatchObject({ page: 1, limit: 5 })
      expect(typeof access.total).toBe('number')

      // OPS — access log filtered by action; every returned row matches.
      const delRes = await ops.get('v2/admin/audit/access-log?action=DELETE&limit=10')
      expect(delRes.ok()).toBeTruthy()
      for (const row of (await delRes.json()).data) {
        expect(row.action).toBe('DELETE')
      }

      // OPS — auth log filtered by event; every returned row matches.
      const authRes = await ops.get('v2/admin/audit/auth-log?event=login&limit=5')
      expect(authRes.ok(), await authRes.text()).toBeTruthy()
      const auth = await authRes.json()
      expect(Array.isArray(auth.data)).toBe(true)
      for (const row of auth.data) {
        expect(row.event).toBe('login')
      }

      // PROVIDER (non-org role) — both endpoints are 403 (RolesGuard).
      const pAccess = await provider.get('v2/admin/audit/access-log')
      expect(pAccess.status()).toBe(403)
      const pAuth = await provider.get('v2/admin/audit/auth-log')
      expect(pAuth.status()).toBe(403)
    } finally {
      await ops.dispose()
      await provider.dispose()
    }
  })

  test('L1 — reviewer acknowledges the Rules of Behavior and reads it back', async () => {
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    try {
      const ackRes = await ops.post('v2/auth/training-ack')
      expect(ackRes.ok(), await ackRes.text()).toBeTruthy()
      const ack = await ackRes.json()
      expect(ack.recorded).toBe(true)

      const statusRes = await ops.get('v2/auth/training-ack')
      expect(statusRes.ok()).toBeTruthy()
      const status = await statusRes.json()
      expect(status.acknowledged).toBe(true)
      expect(status.version).toBe(ack.version)
      expect(status.ackedAt).toBeTruthy()
    } finally {
      await ops.dispose()
    }
  })
})
