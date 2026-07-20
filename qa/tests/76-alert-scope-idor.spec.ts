import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * V-01 + V-04 — cross-tenant IDOR on the alert endpoints (Humaira assessment
 * 2026-07-14). Both handlers were guarded only by a class-level @Roles and did
 * NO per-patient scope check:
 *   • V-01 CRITICAL — GET  /admin/alerts/:id/audit returned any patient's full
 *     15-field escalation audit payload (BP, messages, rationale) to any staff
 *     account in the role set.
 *   • V-04 HIGH     — PATCH /provider/alerts/:id/acknowledge let any provider
 *     acknowledge another practice's alert, spoofing the actor in the trail and
 *     making an unaddressed safety alert look handled.
 *
 * The scope LOGIC (who may see whom) is exhaustively unit-tested — 39 tests in
 * alert-resolution.service.spec.ts + provider.controller.spec.ts, each proven
 * by removal (delete the gate → those tests fail). What a unit test CANNOT show
 * is that the gate is actually wired into the live HTTP route. That is exactly
 * the gap that let the endpoints ship unguarded, so this spec asserts it over
 * real HTTP.
 *
 * Boundary under test, using seeded roles:
 *   • HEALPLACE_OPS       → isUnscoped() → allowed on any alert (200)
 *   • out-of-scope PROVIDER → scoped; refused on an alert outside their scope (403)
 * The two roles hit the SAME alert id, so the only variable is the scope gate.
 * A 403-vs-200 split on one id is the whole finding.
 *
 * ⚠️ Actor choice matters. The seed's primary/backup/multi-practice providers
 * are all linked to Cedar Hill via PracticeProvider (backend/prisma/seed/
 * patients.ts staffLinks) and are therefore IN-scope for every seeded alert —
 * a 200 from any of them is correct behaviour of the gate, not a leak. This
 * spec uses `outOfScopeProvider` (Dr. Ines Vega), whose single PracticeProvider
 * row points at `seed-idor-harness` — a purpose-built practice that holds zero
 * patients. Auth sign-in auto-resolves against that one membership (satisfies
 * auth.service.ts's "No practice membership" guard); PatientAccessService's
 * inActiveScope() then trips the 403 branch for every Cedar Hill alert. See
 * backend/src/common/patient-access.service.ts:77-88 and
 * backend/prisma/seed/practices.ts (harness practice definition).
 */
test.describe('76 — alert endpoint scope (V-01 / V-04 IDOR)', () => {
  // Sign in ONCE per role and reuse across both tests. Each apiSignIn spends an
  // otp/send + otp/verify on that account's ip:email bucket; V-03 caps those at
  // 5/60s. Re-signing the same two seed accounts per test would risk tripping
  // the limiter on the suite's own auth — so share the contexts. (The many
  // other specs that sign in as shared seed accounts are why CI runs the
  // backend with AUTH_THROTTLE_DISABLED=1; specs 75/76 are the exception that
  // must see the limiter, and 75 re-arms it explicitly.)
  let ops: import('@playwright/test').APIRequestContext
  let provider: import('@playwright/test').APIRequestContext

  test.beforeAll(async () => {
    ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    provider = await authedApi(API_BASE_URL, ADMINS.outOfScopeProvider.email, 'admin')
  })
  test.afterAll(async () => {
    await ops?.dispose()
    await provider?.dispose()
  })

  // Resolve a real alert id from the ops (unscoped) worklist, so the test does
  // not hard-code a fixture id that a reseed could invalidate.
  async function anyAlertId(ops: import('@playwright/test').APIRequestContext): Promise<string> {
    // provider/alerts is the alert-queue route (ops is unscoped, so it returns
    // the full set). Verified against the running backend, 2026-07-17.
    const r = await ops.get('provider/alerts?limit=1')
    const body = r.ok() ? await r.json().catch(() => null) : null
    const list = body?.data ?? (Array.isArray(body) ? body : [])
    const id = list?.[0]?.id ?? list?.[0]?.alertId
    test.skip(!id, 'no alert in the seed to exercise scope against')
    return id as string
  }

  test('V-01 — audit endpoint: OPS reads (200), scoped PROVIDER is refused (403)', async () => {
    const alertId = await anyAlertId(ops)

    const opsRes = await ops.get(`admin/alerts/${alertId}/audit`)
    expect(opsRes.status(), 'HEALPLACE_OPS is unscoped and must read the audit').toBe(200)

    const provRes = await provider.get(`admin/alerts/${alertId}/audit`)
    // The pre-fix bug was this returning 200 with the full PHI payload. The
    // gate turns it into a Forbidden for a provider outside the alert's scope.
    expect(provRes.status(), await provRes.text()).toBe(403)
  })

  test('V-04 — acknowledge endpoint: scoped PROVIDER refused, alert not mutated', async () => {
    const alertId = await anyAlertId(ops)

    // Snapshot the alert's status via the ops audit view before the attempt.
    const before = await ops.get(`admin/alerts/${alertId}/audit`)
    expect(before.status()).toBe(200)
    const beforeBody = await before.json().catch(() => ({}))

    const ack = await provider.patch(`provider/alerts/${alertId}/acknowledge`)
    // 403 (scope) is the pass. 404 is also acceptable — some deploys mount this
    // under a router that 404s an out-of-scope id — but 200 is the bug.
    expect(ack.status(), await ack.text()).not.toBe(200)
    expect([403, 404]).toContain(ack.status())

    // Integrity: the acknowledge must not have landed. Compare the ops view.
    const after = await ops.get(`admin/alerts/${alertId}/audit`)
    const afterBody = await after.json().catch(() => ({}))
    // acknowledgedBy / acknowledgedAt must be unchanged by the refused write.
    expect(afterBody?.acknowledgedBy ?? null).toBe(beforeBody?.acknowledgedBy ?? null)
  })
})
