import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Phase 3 §L — practices CRUD (30l.1–30l.4).
 *
 * Reality (Phase 3 §B audit): canManagePractices = SUPER_ADMIN /
 * MEDICAL_DIRECTOR / HEALPLACE_OPS. PROVIDER is NOT blocked from /practices
 * — it sees the list + a read-only detail (no "Add practice", no Save).
 * So 30l.4 asserts read-only, NOT a 403/redirect (Category-A vs the doc).
 * Throwaway practices are created via the admin API so seed practices'
 * business hours stay intact (the enrollment gate checks them).
 */
test.describe('Phase 3 §L — practices CRUD', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30l.1 — /practices renders the practice list', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    await expect(page.locator(byTestId(T.admin.practiceList))).toBeVisible({ timeout: 25_000 })
    expect(
      await page.locator('[data-testid^="admin-practice-row-"]').count(),
      'at least one seeded practice',
    ).toBeGreaterThanOrEqual(1)
  })

  test('30l.2 — SUPER_ADMIN creates a practice via the UI', async ({ page }) => {
    test.setTimeout(90_000)
    const name = `QA Practice ${randomUUID().slice(0, 8)}`
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    await page.locator(byTestId(T.admin.practiceCreateButton)).first().click()
    await expect(page.locator(byTestId(T.admin.practiceCreateModal))).toBeVisible({ timeout: 15_000 })

    await page.locator(byTestId(T.admin.practiceCreateName)).fill(name)
    await page.locator(byTestId(T.admin.practiceCreateHoursStart)).fill('08:00')
    await page.locator(byTestId(T.admin.practiceCreateHoursEnd)).fill('18:00')
    await page.locator(byTestId(T.admin.practiceCreateProtocol)).fill('QA after-hours protocol')
    await page.locator(byTestId(T.admin.practiceCreateSubmit)).click()

    await expect(page.locator(byTestId(T.admin.practiceCreateModal))).toBeHidden({ timeout: 15_000 })
    // New practice is prepended to the list.
    await expect(page.locator(byTestId(T.admin.practiceList))).toContainText(name, { timeout: 20_000 })
  })

  test('30l.3 — editing business hours persists on reload', async ({ page }) => {
    test.setTimeout(90_000)
    // Create a throwaway practice via API (don't mutate seed practices —
    // the enrollment gate validates their business hours).
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const res = await api.post('admin/practices', {
      data: {
        name: `QA EditHours ${randomUUID().slice(0, 8)}`,
        businessHoursStart: '08:00',
        businessHoursEnd: '18:00',
        businessHoursTimezone: 'America/New_York',
      },
    })
    expect(res.ok(), `create practice: ${res.status()}`).toBeTruthy()
    const body = await res.json()
    const pid = body?.data?.id ?? body?.id
    expect(pid, 'created practice id').toBeTruthy()
    await api.dispose()

    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/practices/${pid}`)
    const start = page.locator(byTestId(T.admin.practiceHoursStart))
    await expect(start).toBeVisible({ timeout: 25_000 })
    await start.fill('07:00')
    await page.locator(byTestId(T.admin.practiceHoursEnd)).fill('19:00')
    await page.locator(byTestId(T.admin.practiceSave)).click()

    // Reload proves persistence.
    await page.goto(`${ADMIN_BASE_URL}/practices/${pid}`)
    await expect(page.locator(byTestId(T.admin.practiceHoursStart))).toHaveValue('07:00', { timeout: 25_000 })
    await expect(page.locator(byTestId(T.admin.practiceHoursEnd))).toHaveValue('19:00')
  })

  test('30l.4 — PROVIDER sees /practices read-only (no create, read-only detail)', async ({ page }) => {
    test.setTimeout(90_000)
    // May-2026 role-scope: PROVIDER can only OPEN a practice they're staff of
    // (findOne is scoped → 404 on out-of-scope). Use the seed practice the
    // baseline provider trio belongs to (seed-cedar-hill) for the read-only
    // detail check — a freshly-created practice would be out of their scope.
    const pid = SEED_PRACTICE_ID

    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    // List is viewable but has NO "Add practice" affordance for PROVIDER.
    await page.goto(`${ADMIN_BASE_URL}/practices`)
    await expect(page.locator(byTestId(T.admin.practiceList))).toBeVisible({ timeout: 25_000 })
    await expect(page.locator(byTestId(T.admin.practiceCreateButton))).toHaveCount(0)

    // Detail of their OWN practice is read-only — banner present, no editable
    // inputs / Save.
    await page.goto(`${ADMIN_BASE_URL}/practices/${pid}`)
    await expect(page.locator(byTestId(T.admin.practiceReadonly))).toBeVisible({ timeout: 25_000 })
    await expect(page.locator(byTestId(T.admin.practiceSave))).toHaveCount(0)
    await expect(page.locator(byTestId(T.admin.practiceNameInput))).toHaveCount(0)
  })
})
