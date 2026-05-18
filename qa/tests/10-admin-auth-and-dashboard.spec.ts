import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { ADMIN_BASE_URL, API_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'

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

test.describe('Admin app — a11y h1 hierarchy (bug §H Problem B)', () => {
  // The persistent AdminTopBar rendered its title as <h1>, and every routed
  // page also renders its own content <h1> — so every admin page had TWO
  // <h1>s. AdminTopBar's was demoted to a styled <div>; each page must now
  // expose exactly one <h1> (its content heading).
  test('dashboard has exactly one <h1> after the top-bar demotion', async ({ page }) => {
    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), {
      timeout: 30_000,
    })
    await expect(page.locator('h1')).toHaveCount(1, { timeout: 20_000 })
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

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §C — admin auth + dashboard triage surface (30a.1–30a.5)
//
// REALITY (Phase 3 §B audit): AdminDashboard is NOT a 3-layer
// red/yellow/green panel. It is 5 stat cards + tier-filter chips
// (ALL/BP_L2/TIER_1/TIER_2/BP_L1) + a flat alert queue + a BP-trend
// column. Tier 3 is EXCLUDED from the dashboard queue by design
// (CLINICAL_SPEC V2-C Layer 1). The doc's idealised
// admin-dashboard-layer-{red,yellow,green} selectors do not exist —
// these tests assert the real triage surface instead (Category A).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §C — admin dashboard triage', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30a.1 — SUPER_ADMIN signs in via OTP and lands on /dashboard', async ({ page }) => {
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await expect(page).toHaveURL(new RegExp(`${ADMIN_BASE_URL}/dashboard`), { timeout: 30_000 })
    // Triage surface renders — total-patients stat card is always present.
    await expect(
      page.locator(byTestId(T.admin.dashboardStat('total-patients'))),
    ).toBeVisible({ timeout: 20_000 })
  })

  test('30a.2 — dashboard renders the triage surface (stat cards + tier chips); BP L2 / Tier 1 queue, Tier 3 excluded', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const mike = await tc.findUser(PATIENTS.mike.email)
    const kate = await tc.findUser(PATIENTS.kate.email)
    await tc.resetUser(aisha.id)
    await tc.resetUser(mike.id)
    await tc.resetUser(kate.id)
    const red = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_2', status: 'OPEN' }])
    const yellow = await tc.seedAlerts(mike.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const green = await tc.seedAlerts(kate.id, [{ tier: 'TIER_3_INFO', status: 'OPEN' }])

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })

    // 5 stat cards
    for (const k of ['total-patients', 'bp-l2', 'tier-1', 'tier-2', 'attention'] as const) {
      await expect(
        page.locator(byTestId(T.admin.dashboardStat(k))),
        `stat card ${k}`,
      ).toBeVisible({ timeout: 20_000 })
    }
    // tier filter chips
    for (const k of ['ALL', 'BP_L2', 'TIER_1', 'TIER_2', 'BP_L1'] as const) {
      await expect(
        page.locator(byTestId(T.admin.dashboardTierFilter(k))),
        `tier filter ${k}`,
      ).toBeVisible()
    }
    // BP L2 + Tier 1 surface in the queue; Tier 3 is excluded by design.
    await expect(
      page.locator(byTestId(T.admin.dashboardAlertRow(red.alertIds[0]))),
    ).toBeVisible({ timeout: 20_000 })
    await expect(
      page.locator(byTestId(T.admin.dashboardAlertRow(yellow.alertIds[0]))),
    ).toBeVisible()
    await expect(
      page.locator(byTestId(T.admin.dashboardAlertRow(green.alertIds[0]))),
      'Tier 3 must NOT appear in the dashboard queue (CLINICAL_SPEC V2-C Layer 1)',
    ).toHaveCount(0)
  })

  test('30a.3 — clicking an alert avatar navigates to the patient detail page', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const seeded = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_2', status: 'OPEN' }])
    const alertId = seeded.alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator(byTestId(T.admin.dashboardAlertOpen(alertId))).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${aisha.id}`), { timeout: 20_000 })
  })

  test('30a.4 — tier filter + search narrow the queue', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const mike = await tc.findUser(PATIENTS.mike.email)
    await tc.resetUser(aisha.id)
    await tc.resetUser(mike.id)
    const red = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_2', status: 'OPEN' }])
    const yellow = await tc.seedAlerts(mike.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await expect(page.locator(byTestId(T.admin.dashboardAlertRow(red.alertIds[0])))).toBeVisible({ timeout: 20_000 })

    // Filter to BP L2 only → Tier 1 row drops out.
    await page.locator(byTestId(T.admin.dashboardTierFilter('BP_L2'))).click()
    await expect(page.locator(byTestId(T.admin.dashboardAlertRow(red.alertIds[0])))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.dashboardAlertRow(yellow.alertIds[0])))).toHaveCount(0)

    // Back to ALL, then search by patient name → only Mike's row.
    await page.locator(byTestId(T.admin.dashboardTierFilter('ALL'))).click()
    await page.locator(byTestId(T.admin.dashboardSearch)).fill('Mike')
    await expect(page.locator(byTestId(T.admin.dashboardAlertRow(yellow.alertIds[0])))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.dashboardAlertRow(red.alertIds[0])))).toHaveCount(0)
  })

  test('30a.5 — PROVIDER dashboard is role-scoped (subset of an unscoped admin)', async ({ page }) => {
    test.setTimeout(120_000) // two full UI sign-ins (MD then PROVIDER)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const mike = await tc.findUser(PATIENTS.mike.email)
    const kate = await tc.findUser(PATIENTS.kate.email)
    for (const u of [aisha, mike, kate]) await tc.resetUser(u.id)
    await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_2', status: 'OPEN' }])
    await tc.seedAlerts(mike.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    await tc.seedAlerts(kate.id, [{ tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' }])

    const rowCount = async () =>
      page.locator('[data-testid^="admin-dashboard-alert-row-"]').count()

    // Unscoped admin (HEALPLACE_OPS) sees everything.
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator(byTestId(T.admin.dashboardStat('total-patients'))).waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(1500)
    const adminRows = await rowCount()
    expect(adminRows, 'unscoped admin should see the seeded alerts').toBeGreaterThanOrEqual(1)

    // PROVIDER-only sees an assigned-scoped subset (never MORE than the
    // unscoped admin). Backend force-scopes ?scope=assigned.
    await page.context().clearCookies()
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator(byTestId(T.admin.dashboardStat('total-patients'))).waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(1500)
    const providerRows = await rowCount()
    expect(
      providerRows,
      `PROVIDER queue (${providerRows}) must be a subset of unscoped admin (${adminRows})`,
    ).toBeLessThanOrEqual(adminRows)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §D — patient list (30d.1–30d.4)
//
// REALITY: the list has a risk-tier <select> + an "Awaiting verification"
// toggle + name/email search — NOT the doc's idealised
// ENROLLED/NOT_ENROLLED/SUSPENDED status filter (enrollment state lives in
// the Onboarding column). 30d.2 is adapted to the real verification
// filter (Category A).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §D — patient list', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30d.1 — HEALPLACE_OPS sees the full patient list (all seed archetypes)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await expect(
      page.locator(byTestId(T.admin.patientListRow(aisha.id))),
    ).toBeVisible({ timeout: 20_000 })
    for (const p of [PATIENTS.aisha, PATIENTS.mike, PATIENTS.kate]) {
      await expect(page.getByText(p.name).first(), `expected ${p.name}`).toBeVisible({ timeout: 15_000 })
    }
  })

  test('30d.2 — "Awaiting verification" toggle narrows to non-verified patients (adapted from doc status filter)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const mike = await tc.findUser(PATIENTS.mike.email)
    await tc.setProfileVerificationStatus(aisha.id, 'VERIFIED')
    await tc.setProfileVerificationStatus(mike.id, 'UNVERIFIED')

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await expect(page.locator(byTestId(T.admin.patientListRow(aisha.id)))).toBeVisible({ timeout: 20_000 })

    await page.locator(byTestId(T.admin.patientAwaitingFilter)).click()
    await expect(
      page.locator(byTestId(T.admin.patientListRow(aisha.id))),
      'verified patient should be filtered out',
    ).toHaveCount(0)
    await expect(
      page.locator(byTestId(T.admin.patientListRow(mike.id))),
      'unverified patient should remain',
    ).toBeVisible()
  })

  test('30d.3 — search by name narrows the list', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const mike = await tc.findUser(PATIENTS.mike.email)
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.locator(byTestId(T.admin.patientListSearch)).fill('Aisha')
    await expect(page.locator(byTestId(T.admin.patientListRow(aisha.id)))).toBeVisible({ timeout: 15_000 })
    await expect(page.locator(byTestId(T.admin.patientListRow(mike.id)))).toHaveCount(0)
  })

  test('30d.4 — PROVIDER list is role-scoped (subset of an unscoped admin)', async ({ page }) => {
    test.setTimeout(120_000) // two full UI sign-ins (MD then PROVIDER)
    const countRows = async () =>
      page.locator('[data-testid^="admin-patient-list-row-"]').count()

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.locator('[data-testid^="admin-patient-list-row-"]').first().waitFor({ state: 'visible', timeout: 20_000 })
    const adminCount = await countRows()

    await page.context().clearCookies()
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    await page.waitForTimeout(1500)
    const providerCount = await countRows()
    expect(
      providerCount,
      `PROVIDER list (${providerCount}) must be ≤ unscoped admin (${adminCount})`,
    ).toBeLessThanOrEqual(adminCount)
  })
})
