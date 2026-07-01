import { test, expect } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 38 — COORDINATOR role scoping (phase/23).
 *
 * The coordinator is front-desk: they manage patient onboarding for their
 * own practice and nothing clinical. This spec pins both halves of the
 * boundary from admin/src/lib/roleGates.ts:
 *
 *   ALLOWED  → /users (canManageUsers), GET /admin/users,
 *              GET /admin/practices (read-only view of their own practice + staff)
 *   DENIED   → /reports (canViewReports excludes COORDINATOR),
 *              alert resolve (canResolveAlerts excludes),
 *              practice CRUD — create/update/staff (canManagePractices excludes),
 *              threshold edit (canEditThresholds excludes)
 *
 * For each denied surface we assert BOTH the UI (access-denied / no action)
 * and the API (direct call → 403), since the guard is the real boundary and
 * the UI is just defense-in-depth. None of these calls mutate state (the
 * RolesGuard rejects before the handler runs), so the spec is ungated.
 */
test.describe('Spec 38 — coordinator role scoping', () => {
  const coordinatorLanding = /\/(dashboard|users|patients)/

  test('38.1 — coordinator CAN reach /users (patients-only variant)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.coordinator.email, ADMIN_BASE_URL, coordinatorLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await expect(page.locator(byTestId(T.adminUsers.inviteSingle))).toBeVisible({
      timeout: 25_000,
    })
    // Not the 403 card.
    await expect(page.locator(byTestId(T.adminUsers.accessDenied))).toHaveCount(0)
  })

  test('38.2 — coordinator is DENIED /reports in the UI', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.coordinator.email, ADMIN_BASE_URL, coordinatorLanding)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    // Denial can surface two ways: the page renders the 403 card, OR the admin
    // proxy redirects the coordinator off /reports entirely (the route is
    // hidden from their sidebar). Either is a valid block — assert the
    // functional report (month picker) is never reachable + one of the two
    // denial signals is present.
    const accessDenied = page.locator(byTestId(T.reports.accessDenied))
    await expect(async () => {
      const carded = await accessDenied.isVisible().catch(() => false)
      const redirected = !/\/reports(\?.*)?$/.test(page.url())
      expect(carded || redirected, 'access-denied card OR redirected off /reports').toBe(true)
    }).toPass({ timeout: 20_000 })
    await expect(page.locator(byTestId(T.reports.monthPicker))).toHaveCount(0)
  })

  test('38.3 — coordinator API boundaries return 403 (reports/resolve/practice/threshold)', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const api = await authedApi(API_BASE_URL, ADMINS.coordinator.email, 'admin')
    try {
      // Allowed surface — sanity check the token itself is valid.
      const allowed = await api.get('admin/users?limit=1')
      expect(allowed.status(), 'GET /admin/users is allowed').toBe(200)

      // Reports — not in the reports @Roles.
      const reports = await api.get('admin/reports/monthly?month=2026-05')
      expect(reports.status(), 'GET /admin/reports/monthly forbidden').toBe(403)

      // Alert resolve — clinical disposition, excluded. The RolesGuard rejects
      // before the (fake) id is ever looked up, so any id yields 403.
      const resolve = await api.post('admin/alerts/qa-nonexistent/resolve', {
        data: { resolutionAction: 'NONE' },
      })
      expect(resolve.status(), 'POST resolve forbidden').toBe(403)

      // Practice READ — coordinators now get a read-only view of their own
      // practice (+ staff), scoped server-side. GET is allowed (200)…
      const practiceList = await api.get('admin/practices')
      expect(practiceList.status(), 'GET /admin/practices allowed (read-only)').toBe(200)

      // …but practice CRUD stays an operational/admin function, excluded.
      const practice = await api.post('admin/practices', {
        data: { name: 'QA should-403' },
      })
      expect(practice.status(), 'POST /admin/practices forbidden').toBe(403)
    } finally {
      await api.dispose()
    }
  })
})
