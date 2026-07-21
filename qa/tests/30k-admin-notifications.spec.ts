import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Phase 3 §K — admin NotificationBell + /notifications inbox (30k.1–30k.3).
 *
 * Reality (Phase 3 §B audit):
 *   • NotificationBell badge counts UNREAD notifications (deduplicated by
 *     escalationEventId, EMAIL channel excluded) — same source the dropdown
 *     renders. testids: admin-notification-bell + admin-notification-bell-count.
 *   • /notifications is a two-tab inbox: "Alerts" (default — shared AlertCard,
 *     row click → /patients/{id}) and "Notifications" (personal inbox,
 *     admin-notifications-list + admin-notification-row-{id}). ?tab=notifications
 *     deep-links the personal tab.
 *   • Dedup makes an exact badge count fragile, so 30k.1 asserts presence +
 *     a numeric badge; the inbox list is the un-deduped source of truth.
 */
test.describe('Phase 3 §K — admin notifications', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30k.1 — NotificationBell badge reflects unread notifications', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await tc.resetUser(md.id)
    await tc.seedNotifications(md.id, 3, 'DASHBOARD')

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), { timeout: 30_000 })

    const bell = page.locator(byTestId(T.admin.notificationBell))
    await expect(bell).toBeVisible({ timeout: 20_000 })
    const countBadge = page.locator(byTestId(T.admin.notificationBellCount))
    await expect(countBadge).toBeVisible({ timeout: 15_000 })
    const txt = (await countBadge.innerText()).trim()
    expect(parseInt(txt, 10), `badge count "${txt}" should be numeric ≥1`).toBeGreaterThanOrEqual(1)
    await tc.dispose()
  })

  test('30k.2 — /notifications inbox renders the admin\'s notification rows', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await tc.resetUser(md.id)
    await tc.seedNotifications(md.id, 4, 'DASHBOARD')

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/notifications?tab=notifications`)
    await expect(page.locator(byTestId(T.admin.notificationsList))).toBeVisible({ timeout: 25_000 })
    const rows = page.locator('[data-testid^="admin-notification-row-"]')
    expect(await rows.count(), 'seeded notification rows').toBeGreaterThanOrEqual(4)
    await tc.dispose()
  })

  test('30k.3 — clicking an alert on /notifications navigates to the patient detail', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    // Default tab is "Alerts" — the shared AlertCard row click navigates to
    // the patient detail (NotificationsScreen passes onRowClick = navigate).
    await page.goto(`${ADMIN_BASE_URL}/notifications`)
    const row = page.locator(byTestId(T.admin.alertRow(id)))
    await expect(row).toBeVisible({ timeout: 25_000 })
    await row.click()
    await expect(page).toHaveURL(new RegExp(`/patients/detail\\?id=${aisha.id}`), { timeout: 20_000 })
    await tc.dispose()
  })
})
