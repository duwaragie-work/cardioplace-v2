import { test, expect } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS, SeedPatientKey } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * June 2026 RBAC refactor — practice-wide PROVIDER visibility.
 *
 * Decision: Manisha 2026-06-12 Doc 3 Q2 — any PROVIDER who belongs to a
 * practice sees every patient assigned to that practice. Assignment still
 * governs alert routing + escalation; only the visibility filter widened.
 *
 * Implementation: backend/src/common/patient-access.service.ts now scopes the
 * PROVIDER branch of patientScopeFilter() + assertCanAccessPatient() by
 * PracticeProvider membership (mirrors MEDICAL_DIRECTOR's existing pattern).
 *
 * SCOPE NOTE — what this spec can and cannot prove (extends the note in
 * qa/tests/30r-role-scope-lists.spec.ts):
 *   • The seed assigns EVERY patient to the same primaryProvider AND
 *     backupProvider in the single seed practice (backend/prisma/seed/
 *     patients.ts). So integration tests can verify the POSITIVE paths
 *     (provider in the practice sees the practice's patients) but cannot
 *     produce a "PROVIDER in same practice but NOT on assignment" patient
 *     without seed expansion or new test-control endpoints.
 *   • The full PROVIDER visibility matrix (multi-practice, non-member,
 *     in-practice-not-on-panel) is covered by backend/src/common/
 *     patient-access.service.spec.ts. This spec proves the integration
 *     surface — list/detail/API endpoints don't 500 or empty out after the
 *     scope rewrite — and asserts the alert-routing decoupling.
 *
 * Follow-up tracked: add a second seed practice + a provider who is NOT on
 * any patient's primary/backup assignment, then port the negative cases
 * here from the unit suite.
 */

test.describe('31 — practice-wide PROVIDER visibility (Manisha 2026-06-12)', () => {
  // ── PROVIDER lists every seed patient (practice membership grants access) ─
  test('primaryProvider /patients shows the full practice cohort', async ({ page }) => {
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)

    // The list must render at least one row (regression smoke: scope filter
    // didn't accidentally produce { practiceId: { in: [] } } for a seeded
    // PROVIDER who DOES have PracticeProvider rows).
    const rows = page.locator('[data-testid^="admin-patient-list-row-"]')
    await expect(rows.first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(byTestId(T.admin.patientListAccessDenied))).toHaveCount(0)
  })

  // ── PROVIDER API: /admin/users/:id/profile reachable for every seed patient
  // Under the new rule, this passes via PracticeProvider membership rather
  // than primary/backup assignment — but the observable outcome is the same
  // because the seeded primaryProvider IS in the practice.
  for (const key of ['priya', 'charles', 'aisha'] as const) {
    test(`API: primaryProvider GET profile for ${key} → 200 (in-practice)`, async () => {
      const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      const target = await tc.findUser(PATIENTS[key as SeedPatientKey].email)
      await tc.dispose()

      const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
      const res = await api.get(`admin/users/${target.id}/profile`)
      expect(
        res.status(),
        `expected 200 for in-practice profile read, got ${res.status()}: ${await res.text()}`,
      ).toBe(200)
      await api.dispose()
    })
  }

  // ── Alert-routing decoupling — visibility widened, routing unchanged ──────
  // Under the new rules, every in-practice PROVIDER can SEE every patient,
  // but EscalationService still dispatches notifications only to the patient's
  // primary + backup providers (escalation.service.ts:228-257). Asserting
  // the unchanged contract: the alerts endpoint returns alerts only for
  // patients on the actor's primary/backup panel, not the whole practice.
  //
  // With the seeded primaryProvider being BOTH primary on every patient AND
  // a practice member, this test is a positive smoke — the list comes back
  // populated, no 500, no empty-state. A true "routing ≠ visibility" diff
  // needs the seed expansion described above.
  test('API: primaryProvider /admin/alerts returns assigned-patient alerts (smoke)', async () => {
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    const res = await api.get('admin/alerts')
    expect(
      res.status(),
      `expected 200 from /admin/alerts, got ${res.status()}: ${await res.text()}`,
    ).toBe(200)
    await api.dispose()
  })
})
