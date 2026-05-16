import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Admin app sign-in + dashboard. The admin app is OTP-only (no magic link).
 * Per-role smoke confirms each of the five admin roles can land on
 * /dashboard. PROVIDER restrictions are exercised in the verification specs.
 */

test.describe('Admin app — per-role sign-in', () => {
  for (const [key, account] of Object.entries(ADMINS)) {
    test(`${key} (${account.roles.join(',')}) signs in and lands on /dashboard`, async ({ page }) => {
      await signInAdmin(page, account.email, ADMIN_BASE_URL)
      await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), { timeout: 30_000 })
      // Dashboard always renders the user's name somewhere (greeting / nav)
      await expect(page.locator('body')).toContainText(account.name.split(' ').slice(-1)[0], {
        timeout: 10_000,
      })
    })
  }
})

test.describe('Admin app — NotificationBell (bug #1)', () => {
  // Bug #1: the badge counted open clinical alerts + unread notifications,
  // but the dropdown only renders notifications. Open alerts with no unread
  // notification row inflated the badge ("9+") while the dropdown opened
  // empty. Post-fix the badge counts unread notifications from the SAME
  // source the dropdown renders, so badge and dropdown can never disagree.
  test('badge count is consistent with the dropdown it opens', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), {
      timeout: 30_000,
    })

    const bell = page.getByRole('button', { name: /^Notifications —/ })
    await expect(bell).toBeVisible({ timeout: 15_000 })

    // The bell's aria-label is the badge's source of truth:
    // "Notifications — N unread" / "Notifications — none unread".
    const label = (await bell.getAttribute('aria-label')) ?? ''
    const m = label.match(/Notifications — (\d+) unread/)
    const badgeCount = m ? parseInt(m[1], 10) : 0

    await bell.click()
    const dropdown = page.getByRole('dialog', { name: 'Notifications' })
    await expect(dropdown).toBeVisible()

    // Unread rows each expose a "Mark as read" affordance.
    const renderedUnread = await dropdown
      .getByRole('button', { name: 'Mark as read' })
      .count()
    const emptyState = await dropdown.getByText('No notifications yet').count()

    if (badgeCount === 0) {
      // Clean state: no badge ⇒ no phantom unread rows in the dropdown.
      expect(
        renderedUnread,
        'badge is 0 but dropdown still shows unread rows',
      ).toBe(0)
      return
    }

    // Core bug-#1 regression guard: a non-zero badge must NEVER open an
    // empty dropdown.
    expect(
      emptyState,
      `badge shows ${badgeCount} unread but dropdown rendered the empty state (bug #1)`,
    ).toBe(0)
    // The badge surfaces real unread notifications, not phantom alert count.
    expect(
      renderedUnread,
      `badge ${badgeCount} but zero unread rows rendered (bug #1)`,
    ).toBeGreaterThan(0)
    // Badge counts ALL unread; the dropdown is capped at 10 most-recent —
    // so the rows it shows can never exceed the badge. (Pre-fix this could
    // be violated because the badge double-counted non-notification alerts.)
    expect(
      renderedUnread,
      `dropdown shows ${renderedUnread} unread rows but badge is only ${badgeCount}`,
    ).toBeLessThanOrEqual(badgeCount)
  })
})

test.describe('Admin app — patient list', () => {
  test('manisha sees the patient list with seeded archetypes', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    // The 5 seed patients should all surface
    for (const p of Object.values(PATIENTS)) {
      await expect(
        page.getByText(p.name),
        `expected ${p.name} in patient list`,
      ).toBeVisible({ timeout: 15_000 })
    }
  })
})
