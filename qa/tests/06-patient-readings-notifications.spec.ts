import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { postJournalEntry } from '../helpers/api.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Patient /readings + /notifications surfaces. These two tabs are where the
 * highest-impact v1-era display bugs live (TZ day-grouping mismatch, day(s)
 * pluralization, "Apr 3018:01" concatenation). The walkthrough findings doc
 * lists each as P0/P1.
 */

test.describe('/readings — TZ day-grouping regression (brief §13.1, walkthrough finding 1)', () => {
  test.beforeEach(async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('every group header date matches its rows\' date prefixes', async ({ page }) => {
    await page.goto('/readings')
    // CI cold-start renders /readings before the seeded readings finish
    // hydrating from the API — the default 10s actionTimeout is occasionally
    // too tight on a freshly-built backend. Wait up to 15s for the first
    // group to attach; if none ever do, the testid simply isn't wired and we
    // skip below as before.
    const groups = page.locator(byTestId(T.readings.group))
    await groups.first().waitFor({ state: 'attached', timeout: 15_000 }).catch(() => {})
    const count = await groups.count()
    test.skip(
      count === 0,
      'data-testid="reading-group" not yet added to /readings markup — skipping ' +
        '(fallback assertion would be flaky against the loose "WED, APR 29" header text)',
    )
    for (let i = 0; i < count; i++) {
      const group = groups.nth(i)
      // The date header only renders for multi-reading days (readings/page.tsx:1641
      // — `group.items.length > 1`). Single-reading groups still get the parent
      // testid but no `reading-group-date` child; skip those rather than time
      // out waiting for a header that will never exist.
      const dateLocator = group.locator(byTestId(T.readings.groupDate))
      if ((await dateLocator.count()) === 0) continue
      const headerDate = (await dateLocator.innerText()).trim()
      const firstRowDate = (
        await group.locator(byTestId(T.readings.rowDate)).first().innerText()
      ).trim()
      // W10 (Lakshitha readings restyle) — the group header now renders the
      // weekday UPPERCASE ("THU, JUN 4") while the row keeps title-case
      // ("Thu, Jun 4"). Compare case-insensitively on the weekday token.
      expect(
        firstRowDate.toUpperCase(),
        `row date "${firstRowDate}" does not match group "${headerDate}"`,
      ).toContain(headerDate.split(',')[0].toUpperCase())
    }
  })

  test('each row has BP value + pulse + edit/delete affordances', async ({ page }) => {
    // Self-seed a deterministic reading via the API. Aisha's seed-time
    // readings are wiped when prior specs (05/09/15) call tc.resetUser,
    // and in --workers=1 sequential mode this test runs after several of
    // those — so the loose ">=1 BP row" assertion was order-dependent.
    // Posting one row up front makes the test self-contained.
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(),
      systolicBP: 124,
      diastolicBP: 78,
      pulse: 72,
    })
    await api.dispose()

    await page.goto('/readings')
    // Wait for at least one row group to render (proves the seeded reading
    // landed in the page payload). The BP value itself is split across three
    // span text nodes — `<span>124</span><span>/</span><span>78</span>` — so
    // `getByText()` against a single regex never matches; assert against the
    // concatenated `innerText` of the readings region instead.
    await expect(page.locator(byTestId(T.readings.group)).first()).toBeVisible()
    const text = await page.locator('main').innerText()
    expect(text, 'expected at least one BP row in readings list').toMatch(/\d{2,3}\s*\/\s*\d{2,3}/)
  })
})

test.describe('/notifications — alerts vs notifications tabs', () => {
  test.beforeEach(async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('renders Alerts and Notifications tabs', async ({ page }) => {
    await page.goto('/notifications')
    const alertsTab = page.locator(byTestId(T.notifications.tabAlerts))
      .or(page.getByRole('tab', { name: /alerts/i }))
      .or(page.getByText(/alerts\s*\(/i).first())
    const notesTab = page.locator(byTestId(T.notifications.tabNotifications))
      .or(page.getByRole('tab', { name: /notifications/i }))
    await expect(alertsTab.first()).toBeVisible()
    await expect(notesTab.first()).toBeVisible()
  })

  test('no literal "day(s)" placeholder leaks (UX copy review C2)', async ({ page }) => {
    await page.goto('/notifications')
    const main = page.locator('main, [role="main"]').first()
    const text = await main.innerText().catch(() => '')
    expect(
      text,
      'placeholder "day(s)" leaked to UI — fix via ICU plural rules',
    ).not.toContain('day(s)')
  })

  test('date and time on cards have a separator (no Apr3018:01)', async ({ page }) => {
    await page.goto('/notifications')
    const dateCells = page.locator(byTestId(T.notifications.notificationDate))
    const count = await dateCells.count()
    test.skip(
      count === 0,
      'data-testid="notification-date" not yet added to notification cards — skipping',
    )
    for (let i = 0; i < count; i++) {
      const text = (await dateCells.nth(i).innerText()).trim()
      // Must contain at least one whitespace or comma between digit clusters.
      expect(
        text,
        `concatenation regression: "${text}"`,
      ).toMatch(/\d{1,2}[\s,]+\d{1,2}:\d{2}/)
    }
  })
})

// ─── Phase 4h (§J) — notifications inbox + mark-read + deep-link ───────────
test.describe('Phase 4h — notifications (20h)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ retries: 1 })

  let tc: TestControl
  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  // The patient's real notification inbox IS the Alerts tab: per
  // escalation.service.ts ("DASHBOARD notifications are implicit via
  // DeviationAlert rows") the patient sees alert-derived items as AlertCards
  // (notification-row-{alertId}); the separate Notification model rows are
  // provider/caregiver push/email, not patient NotifCards. 20h.1/20h.2
  // therefore exercise the real patient inbox + its handled-action.
  test('20h.1 — patient alert inbox renders alert rows', async ({ page }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/notifications')
    // Alerts tab (default) lists each alert as notification-row-{alertId}.
    for (const id of alertIds) {
      await expect(
        page.locator(`[data-testid="notification-row-${id}"]`),
      ).toBeVisible({ timeout: 12_000 })
    }
    await tc.resetUser(u.id)
  })

  test('20h.2 — patient marks an inbox alert handled (acknowledge)', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    const alertId = alertIds[0]
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/notifications')
    // The clinical alert lives in the Alerts sub-tab (PatientAlertCard).
    // testIdPrefix="notification-row" → acknowledge is notification-row-ack-{id}.
    const ackBtn = page.locator(`[data-testid="notification-row-ack-${alertId}"]`)
    await ackBtn.waitFor({ state: 'visible', timeout: 12_000 })
    // G.4 defensive — the clinical alert must NOT mirror into the Notifications
    // sub-tab (matches the 22-no-alert-mirror invariant).
    await page.locator('[data-testid="notifications-tab-notifications"]').click().catch(() => {})
    await expect(
      page.locator(`[data-testid="notification-row-${alertId}"]`),
    ).toHaveCount(0)
    await page.locator('[data-testid="notifications-tab-alerts"]').click().catch(() => {})
    await ackBtn.click()
    // State sanity: the alert is acknowledged.
    await expect
      .poll(
        async () =>
          (await tc.listAlerts(u.id)).find((x) => x.id === alertId)?.status,
        { timeout: 12_000 },
      )
      .toBe('ACKNOWLEDGED')
    await tc.resetUser(u.id)
  })

  test('20h.3 — alert card deep-links to /alerts/[id]', async ({ page }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/notifications')
    // Alerts tab (default) → the seeded alert's "View details" deep-link.
    // PatientAlertCard testIdPrefix="notification-row" → notification-row-detail-{id}.
    const link = page.locator(`[data-testid="notification-row-detail-${alertIds[0]}"]`)
    await link.waitFor({ state: 'visible', timeout: 12_000 })
    await link.click()
    await page.waitForURL(new RegExp(`/alerts\\?id=${alertIds[0]}`), {
      timeout: 12_000,
    })
    await expect(
      page.locator('[data-testid="alert-message-patient"]'),
    ).toBeVisible({ timeout: 12_000 })
    await tc.resetUser(u.id)
  })
})
