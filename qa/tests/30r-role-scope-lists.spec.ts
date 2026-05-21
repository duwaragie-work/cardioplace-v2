import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * May 2026 role-scope refactor — list + dashboard + practice-visibility
 * regression net (batch 30r).
 *
 * SCOPE NOTE (read before extending): the seed assigns EVERY patient to the
 * same primaryProvider + backupProvider + medicalDirector in the single
 * seed practice (backend/prisma/seed/patients.ts). So a true negative scope
 * assertion ("PROVIDER does NOT see patient X") is impossible without a
 * second practice / unassigned patient — that needs seed expansion or a new
 * test-control endpoint. The hard scope-filter LOGIC is already covered by
 * the 32 unit cases in backend/src/common/patient-access.service.spec.ts.
 *
 * These specs therefore cover the INTEGRATION surface the unit tests can't:
 *   • the scoped list endpoint renders for every admin role (no 500/empty)
 *   • the dashboard KPI card uses the renamed "Active Patients" label
 *   • /practices CRUD affordance shows only for OPS + SUPER_ADMIN
 */

test.describe('30r — role-scoped lists + dashboard label + practice visibility', () => {
  // ── Patient list renders for each admin role ──────────────────────────────
  for (const key of ['primaryProvider', 'medicalDirector', 'ops'] as const) {
    test(`${key}: /patients renders the scoped list without error`, async ({ page }) => {
      await signInAdmin(page, ADMINS[key].email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients`)

      // Either the list (seed patients are all in every role's scope) or the
      // explicit empty state must render — never the access-denied panel and
      // never a hung/blank page. Both are valid scoped responses.
      const anyRow = page.locator('[data-testid^="admin-patient-list-row-"]')
      const empty = page.locator(byTestId(T.admin.patientListEmpty))

      await expect(anyRow.first().or(empty)).toBeVisible({ timeout: 30_000 })
      // Access-denied panel must NOT show — these roles can all read the list.
      await expect(page.locator(byTestId(T.admin.patientListAccessDenied))).toHaveCount(0)
    })
  }

  // ── Dashboard KPI card label renamed Total → Active ───────────────────────
  test('dashboard KPI card reads "Active Patients" (not "Total Patients")', async ({ page }) => {
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    // signInAdmin already lands on /dashboard; ensure the stat card mounted.
    const card = page.locator(byTestId(T.admin.dashboardStat('total-patients')))
    await expect(card).toBeVisible({ timeout: 30_000 })
    await expect(card).toContainText(/active patients/i)
    await expect(card).not.toContainText(/total patients/i)
  })

  // ── /practices CRUD affordance gated to OPS + SUPER_ADMIN ──────────────────
  test('OPS sees the "Add practice" button on /practices', async ({ page }) => {
    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    await expect(page.locator(byTestId(T.admin.practiceList)).first()).toBeVisible({ timeout: 30_000 })
    await expect(
      page.locator(byTestId(T.admin.practiceCreateButton)).first(),
    ).toBeVisible()
  })

  test('PROVIDER sees /practices read-only — no "Add practice" button', async ({ page }) => {
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    // List itself renders (PROVIDER can read their scoped practices)…
    await expect(page.locator(byTestId(T.admin.practiceList)).first()).toBeVisible({ timeout: 30_000 })
    // …but the create CTA is absent.
    await expect(page.locator(byTestId(T.admin.practiceCreateButton))).toHaveCount(0)
  })

  test('MED_DIR sees /practices read-only — no "Add practice" button', async ({ page }) => {
    // May 2026 decision: practice CRUD moved to OPS + SUPER_ADMIN only.
    // MED_DIR keeps care-team authority but no longer manages practice metadata.
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    await expect(page.locator(byTestId(T.admin.practiceList)).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.locator(byTestId(T.admin.practiceCreateButton))).toHaveCount(0)
  })
})
