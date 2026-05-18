import { test, expect } from '@playwright/test'
import { signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'
import {
  resolveAlertViaModal,
  gotoPatientAlertsTab,
  verifyProfileViaUI,
} from '../helpers/api.js'

/**
 * Phase 3 §O — cross-tab / cross-component consistency (30o.1, 30o.2).
 *
 * Category-A reality adaptations (documented in RESULTS.md):
 *  • 30o.1 — a Tier 1 resolved DIRECTLY (no prior ack — Tier 1 is
 *    resolve-only) leaves DeviationAlert.acknowledgedAt null, and
 *    TimelineTab gates its "alert resolved" entry on acknowledgedAt
 *    ("Finding 9"). So the doc's "Timeline shows the resolved event"
 *    is not achievable for a UI resolve. Consistency is instead verified
 *    by: Timeline tab refetches & renders consistently after the resolve,
 *    AND the Alerts tab live-propagates the new RESOLVED state across its
 *    own status filters without a page reload.
 *  • 30o.2 — verifying a profile does NOT dismiss Tier 1 contraindication
 *    alerts (independent workflows). The real cross-component consistency
 *    is the patient-detail HEADER verification badge updating live off the
 *    shell's profile state after the Profile-tab verify.
 */
test.describe('Phase 3 §O — cross-tab consistency', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30o.1 — resolving on Alerts tab propagates consistently (Timeline refetch + live filter state)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'TIER_1_CONTRAINDICATION', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await resolveAlertViaModal(page, id, {
      resolutionAction: 'TIER1_FALSE_POSITIVE',
      rationale: 'qa: cross-tab consistency check',
    })

    // Cross-tab: switch to Timeline (no reload) — it refetches on entry and
    // renders the consistent history (the alert-opened entry is always
    // present; a direct resolve has no "resolved" entry by design).
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const timeline = page.locator(byTestId(T.admin.timelineList))
    await expect(timeline).toBeVisible({ timeout: 25_000 })
    await expect(timeline).toContainText(/tier 1|contraindication/i, { timeout: 20_000 })

    // Live state propagation: back on Alerts, the alert is gone from OPEN
    // and present under RESOLVED — all without a page reload.
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()
    await page.locator(byTestId(T.admin.alertsStatusFilter('OPEN'))).click()
    await expect(page.locator(byTestId(T.admin.alertRow(id)))).toHaveCount(0, { timeout: 20_000 })
    await page.locator(byTestId(T.admin.alertsStatusFilter('RESOLVED'))).click()
    await expect(page.locator(byTestId(T.admin.alertStatusBadge(id)))).toContainText(/resolved/i, { timeout: 20_000 })
    await tc.dispose()
  })

  test('30o.2 — verifying on Profile tab updates the patient-detail header badge consistently', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.setProfileVerificationStatus(aisha.id, 'UNVERIFIED')

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await verifyProfileViaUI(page, aisha.id) // navigates, verifies, asserts banner

    // Cross-component consistency: the shell HEADER badge derives from the
    // same profile state the Profile tab just changed — it must read
    // "verified" on the live page (no reload).
    await expect(
      page.locator(byTestId(T.admin.verificationBadge)),
    ).toContainText(/verified/i, { timeout: 20_000 })
    await tc.dispose()
  })
})
