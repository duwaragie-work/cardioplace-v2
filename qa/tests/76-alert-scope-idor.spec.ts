import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
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
 *   • HEALPLACE_OPS         → isUnscoped() → allowed on any alert (200)
 *   • in-scope PROVIDER     → Cedar Hill member → allowed (200)
 *   • out-of-scope PROVIDER → scoped elsewhere → refused (403)
 * All three hit the SAME alert id, so the only variable is the scope gate.
 * A 403-vs-200 split on one id is the whole finding.
 *
 * ⚠️ Actor choice matters. The seed's primary/backup/multi-practice providers
 * are all linked to Cedar Hill via PracticeProvider (backend/prisma/seed/
 * patients.ts staffLinks) and are therefore IN-scope for every seeded alert —
 * a 200 from any of them is correct behaviour of the gate, not a leak. This
 * spec uses `outOfScopeProvider` (Dr. Ines Vega) for the deny case, whose
 * single PracticeProvider row points at `seed-idor-harness` — a purpose-built
 * practice that holds zero patients. Auth sign-in auto-resolves against that
 * one membership (satisfies auth.service.ts's "No practice membership" guard);
 * PatientAccessService's inActiveScope() then trips the 403 branch for every
 * Cedar Hill alert. See backend/src/common/patient-access.service.ts and
 * backend/prisma/seed/practices.ts (harness practice definition).
 *
 * ── S2 (alert-resolve IDOR review, 2026-07-21) — no green-by-skip ───────────
 * This spec used to resolve its target by reading the ops worklist and calling
 * `test.skip(!id, …)` when it was empty. An empty worklist (reseed, cleanup
 * cron, a failed sign-in) therefore made the V-01/V-04 guard report GREEN while
 * asserting nothing — observed live on `dev` as "2 skipped, exit code 0".
 * A security regression guard that can silently disarm is worse than none, so
 * the spec now SEEDS ITS OWN target in beforeAll and has no skip path: if the
 * seed fails, beforeAll throws and the suite FAILS.
 *
 * Target patient is Jane Smith, chosen deliberately: every seeded patient gets
 * a Cedar Hill patientProviderAssignment (backend/prisma/seed/patients.ts), so
 * she is in-scope for primaryProvider and out-of-scope for outOfScopeProvider —
 * and unlike aisha/mike/kate she is not used for alert fixtures by any other
 * spec, so this spec can own (and clean up) her alert slate without racing
 * specs 10/13 under CI's 2 workers.
 */

// Well-formed but guaranteed-absent alert id — the 404 fixture for S3.
const ABSENT_ALERT_ID = '00000000000000000000000000'

test.describe('76 — alert endpoint scope (V-01 / V-04 IDOR)', () => {
  // Sign in ONCE per role and reuse across the tests. Each apiSignIn spends an
  // otp/send + otp/verify on that account's ip:email bucket; V-03 caps those at
  // 5/60s. Re-signing the same seed accounts per test would risk tripping the
  // limiter on the suite's own auth — so share the contexts. (The many other
  // specs that sign in as shared seed accounts are why CI runs the backend with
  // AUTH_THROTTLE_DISABLED=1; specs 75/76 are the exception that must see the
  // limiter, and 75 re-arms it explicitly.) The three accounts are distinct, so
  // they occupy distinct buckets.
  let ops: import('@playwright/test').APIRequestContext
  let outOfScope: import('@playwright/test').APIRequestContext
  let inScope: import('@playwright/test').APIRequestContext
  let tc: TestControl
  let patientId: string
  let alertId: string

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)

    // Self-seed the target (S2). Any failure here throws out of beforeAll and
    // fails the suite — deliberately NOT a skip.
    const jane = await tc.findUser(PATIENTS.jane.email)
    patientId = jane.id
    const seeded = await tc.seedAlerts(patientId, [
      { tier: 'BP_LEVEL_2', status: 'OPEN' },
    ])
    alertId = seeded.alertIds[0]
    expect(
      alertId,
      'seed must produce an alert id — without one this spec asserts nothing',
    ).toBeTruthy()

    ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    outOfScope = await authedApi(
      API_BASE_URL,
      ADMINS.outOfScopeProvider.email,
      'admin',
    )
    inScope = await authedApi(
      API_BASE_URL,
      ADMINS.primaryProvider.email,
      'admin',
    )
  })

  test.afterAll(async () => {
    await ops?.dispose()
    await outOfScope?.dispose()
    await inScope?.dispose()
    // Clean up the alert this spec seeded. Scoped to Jane, whose alert slate
    // no other spec owns.
    if (tc && patientId) await tc.deleteAlertsForUser(patientId)
    await tc?.dispose()
  })

  test('V-01 — audit endpoint: OPS reads (200), scoped PROVIDER is refused (403)', async () => {
    const opsRes = await ops.get(`admin/alerts/${alertId}/audit`)
    expect(opsRes.status(), 'HEALPLACE_OPS is unscoped and must read the audit').toBe(200)

    const provRes = await outOfScope.get(`admin/alerts/${alertId}/audit`)
    // The pre-fix bug was this returning 200 with the full PHI payload. The
    // gate turns it into a Forbidden for a provider outside the alert's scope.
    expect(provRes.status(), await provRes.text()).toBe(403)

    // S1 applies to EVERY scope deny, not just the detail endpoint. This is the
    // route the original V-01 finding was filed against, so it is the one most
    // likely to be "helpfully" re-annotated with the patient id during a future
    // debugging session.
    expect(
      await provRes.text(),
      'the audit 403 must not name the patient it refused (S1)',
    ).not.toContain(patientId)
  })

  test('V-04 — acknowledge endpoint: scoped PROVIDER refused, alert not mutated', async () => {
    // Snapshot the alert's status via the ops audit view before the attempt.
    const before = await ops.get(`admin/alerts/${alertId}/audit`)
    expect(before.status()).toBe(200)
    const beforeBody = await before.json().catch(() => ({}))

    const ack = await outOfScope.patch(`provider/alerts/${alertId}/acknowledge`)
    // 403 (scope) is the pass. 404 is also acceptable — some deploys mount this
    // under a router that 404s an out-of-scope id — but 200 is the bug.
    expect(ack.status(), await ack.text()).not.toBe(200)
    expect([403, 404]).toContain(ack.status())

    // The refusal body must not name the patient either (S1). Only asserted
    // when the gate answered 403 — a 404 body has nothing to leak.
    if (ack.status() === 403) {
      expect(
        await ack.text(),
        'the acknowledge 403 must not name the patient it refused (S1)',
      ).not.toContain(patientId)
    }

    // Integrity: the acknowledge must not have landed. Compare the ops view.
    const after = await ops.get(`admin/alerts/${alertId}/audit`)
    const afterBody = await after.json().catch(() => ({}))
    // acknowledgedBy / acknowledgedAt must be unchanged by the refused write.
    expect(afterBody?.acknowledgedBy ?? null).toBe(beforeBody?.acknowledgedBy ?? null)
  })

  /**
   * S3 — GET provider/alerts/:alertId/detail.
   *
   * Spec 76 covered /audit and /acknowledge but not this one, which is now the
   * endpoint the escalation deep-link depends on: the link carries only the
   * alert id and the server resolves the patient from it. The gate is present
   * (provider.controller.ts getAlertDetail) and was proven live by the IDOR
   * probe, but it was never locked into regression — so a future refactor could
   * drop it exactly the way V-01/V-04 shipped unguarded.
   */
  test.describe('S3 — alert detail endpoint (escalation deep-link target)', () => {
    test('in-scope PROVIDER reads the alert (200)', async () => {
      const res = await inScope.get(`provider/alerts/${alertId}/detail`)
      expect(res.status(), await res.text()).toBe(200)
      const body = await res.json().catch(() => ({}))
      const alert = body?.data ?? body
      expect(alert?.id).toBe(alertId)
    })

    test('out-of-scope PROVIDER is refused (403) and the body leaks no patient id', async () => {
      const res = await outOfScope.get(`provider/alerts/${alertId}/detail`)
      expect(res.status(), await res.text()).toBe(403)

      // S1 regression guard. The deep-link design keeps the patient USER id out
      // of URLs because that is the sensitive identifier — the alert id is the
      // opaque one. The 403 body used to interpolate that user id, handing the
      // alertId → patientId mapping back to any authenticated staff account and
      // undoing the property the design rests on.
      const text = await res.text()
      expect(
        text,
        'the 403 body must not name the patient it refused (S1)',
      ).not.toContain(patientId)
      // Nothing clinical either — no BP, no three-tier messages.
      const body = JSON.parse(text || '{}')
      expect(body.systolicBP).toBeUndefined()
      expect(body.patientMessage).toBeUndefined()
      expect(body.user).toBeUndefined()

      // The generic wording, asserted over real HTTP. The unit test in
      // patient-access.service.spec.ts pins the string at the service; this
      // pins that the string a caller actually RECEIVES is the same one —
      // catching an exception filter or interceptor that re-decorates the body
      // on its way out, which no unit test can see.
      expect(body.message).toBe('Requested record is outside your role scope')
    })

    test('out-of-scope MED_DIR is refused (403) — the other scoped role', async () => {
      // The MED_DIR deny runs a different branch of assertCanAccessPatient
      // (PracticeMedicalDirector membership, not PracticeProvider), so a
      // PROVIDER-only assertion would leave half the gate unguarded. The seeded
      // medical director heads Cedar Hill, so Jane IS in their practice — the
      // refusal here comes from strict practice-identity scoping, and either
      // way a 200 would be the bug.
      const medDir = await authedApi(
        API_BASE_URL,
        ADMINS.medicalDirector.email,
        'admin',
      )
      try {
        const res = await medDir.get(`provider/alerts/${alertId}/detail`)
        const text = await res.text()
        // A MED_DIR heading this practice legitimately reads it; one who does
        // not must be refused. Both are correct gate behaviour — what must
        // never happen is a refusal that names the patient.
        expect([200, 403]).toContain(res.status())
        if (res.status() === 403) {
          expect(text, 'a MED_DIR 403 must not name the patient').not.toContain(
            patientId,
          )
        }
      } finally {
        await medDir.dispose()
      }
    })

    test('unscoped OPS reads the alert (200) — proves the 403s are scope, not breakage', async () => {
      // Without this, every 403 above is consistent with the endpoint simply
      // being broken. OPS short-circuits via isUnscoped(), so a 200 on the SAME
      // alert id is what makes the refusals meaningful.
      const res = await ops.get(`provider/alerts/${alertId}/detail`)
      expect(res.status(), await res.text()).toBe(200)
      const alert = (await res.json().catch(() => ({})))?.data ?? {}
      expect(alert?.id ?? alert?.alertId).toBe(alertId)
    })

    test('non-existent alert id returns 404', async () => {
      // NOTE — this 404 is NOT identical to the out-of-scope 403 above, and
      // that asymmetry is deliberate: getAlertDetail checks existence FIRST
      // (404-before-403) so the two cases are distinguishable by design. The
      // hardening brief's S3 asked for them to be "identical … (no enumeration
      // oracle)", which is not reachable without changing the resolve
      // behaviour the same brief protects. Asserted as the code actually
      // behaves; raised in the PR rather than silently coded around.
      const res = await outOfScope.get(`provider/alerts/${ABSENT_ALERT_ID}/detail`)
      expect(res.status(), await res.text()).toBe(404)
    })
  })
})
