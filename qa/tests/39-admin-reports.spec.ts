import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 39 — admin monthly reports (/reports, phase/24).
 *
 * Gate (roleGates.canViewReports): SUPER_ADMIN / HEALPLACE_OPS /
 * MEDICAL_DIRECTOR. PROVIDER + COORDINATOR are denied (coordinator covered in
 * spec 38; provider here).
 *
 * The page auto-loads the current month for the resolved practice. With a
 * single seed practice (Cedar Hill) the practice is locked (no picker). Report
 * reads are a read-through cache (a snapshot may be computed + stored), so
 * these are treated as read-only and run ungated.
 */
test.describe('Spec 39 — admin reports', () => {
  // Wait for the report to settle: either the cache badge (loaded) or, on a
  // cold practice/month, the no-practices empty card.
  async function waitForReport(page: import('@playwright/test').Page) {
    await expect(
      page
        .locator(byTestId(T.reports.cacheBadge))
        .or(page.locator(byTestId(T.reports.noPractices)))
        .or(page.locator(byTestId(T.reports.error))),
    ).toBeVisible({ timeout: 30_000 })
  }

  test('39.1 — SUPER_ADMIN opens the monthly report', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.monthPicker))).toBeVisible({
      timeout: 25_000,
    })
    // Single seed practice → locked pill (no picker).
    await expect(
      page
        .locator(byTestId(T.reports.practiceLocked))
        .or(page.locator(byTestId(T.reports.practicePicker))),
    ).toBeVisible({ timeout: 15_000 })
    await waitForReport(page)
    // Not the error state.
    await expect(page.locator(byTestId(T.reports.error))).toHaveCount(0)
  })

  test('39.2 — changing the month refetches without error', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    const month = page.locator(byTestId(T.reports.monthPicker))
    await expect(month).toBeVisible({ timeout: 25_000 })
    await month.fill('2026-05')
    await waitForReport(page)
    await expect(page.locator(byTestId(T.reports.error))).toHaveCount(0)
  })

  test('39.3 — CSV export triggers a download', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.cacheBadge))).toBeVisible({
      timeout: 30_000,
    })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator(byTestId(T.reports.downloadCsv)).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.csv$/)
  })

  test('39.4 — PDF export triggers a download', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.cacheBadge))).toBeVisible({
      timeout: 30_000,
    })
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.locator(byTestId(T.reports.downloadPdf)).click(),
    ])
    expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  })

  test('39.5 — MEDICAL_DIRECTOR can view; PROVIDER is denied', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // MED_DIR is entitled (scoped to their own practice server-side).
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.monthPicker))).toBeVisible({
      timeout: 25_000,
    })

    // PROVIDER is not in canViewReports → 403 card. Clear the MED_DIR session
    // first, else /sign-in redirects straight to /dashboard (already authed)
    // and the sign-in form never renders.
    await page.context().clearCookies()
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.accessDenied))).toBeVisible({
      timeout: 25_000,
    })
  })
})
