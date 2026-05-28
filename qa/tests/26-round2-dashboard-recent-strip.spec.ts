import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postSessionWithTwoReadings,
  waitForAlerts,
  patchPatientAcknowledgeAlert,
} from '../helpers/api.js'

/**
 * Round 2 J — patient dashboard recent-alerts strip.
 *
 * The strip lives below the headline ACTIVE ALERT banner on /dashboard.
 * Wired in Dashboard.tsx (commit 9c4d6de): top 3 by recency, Open/All chip
 * filter, and a "See all alerts →" link to /notifications?tab=alerts.
 *
 * Scenario: fire 3 alerts on Carol (mix of HFREF_HIGH + HF_DECOMP), then
 * acknowledge one of them via the patient API to create a non-OPEN row.
 *
 *   - Default 'Open' chip:  the ACK'd row is hidden; strip shows the 2 OPEN rows.
 *   - 'All' chip:           the strip shows all 3 rows (still capped at 3 by recency).
 *   - "See all alerts →":   routes to /notifications?tab=alerts.
 *
 * The strip itself uses the PatientAlertCard compact variant; cards address
 * by testid `dashboard-recent-alert-<alertId>` (Dashboard.tsx passes the
 * testIdPrefix override).
 */

test.describe('Round 2 J — dashboard recent-alerts strip', () => {
  test.use({
    viewport: { width: 1280, height: 900 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('strip filters by Open/All and the See-all link navigates correctly', async ({
    page,
  }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    // ── Setup: clean Carol's state, sign in via API ────────────────────────
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const carol = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(carol.id)
    // Settle: when this spec runs after Round 2 Spec 24/25 in the same
    // worker, the prior test's SERIALIZABLE persist-alert transactions can
    // still be retrying in the background. A short delay lets them drain
    // before we begin firing this spec's sessions.
    await new Promise((r) => setTimeout(r, 1500))
    const api = await authedApi(apiBase, PATIENTS.carol.email, 'patient')

    // ── Fire 3 alerts in distinct sessions ─────────────────────────────────
    // 1) BP_LEVEL_1_HIGH on HFrEF at 165/85
    await postSessionWithTwoReadings(api, {
      systolicBP: 165,
      diastolicBP: 85,
      pulse: 72,
    })
    // 2) BP_LEVEL_1_HIGH at 168/86 (older same-tier alert)
    await postSessionWithTwoReadings(api, {
      systolicBP: 168,
      diastolicBP: 86,
      pulse: 74,
    })
    // 3) HF-decomp at 151/86 + leg swelling (most recent)
    await postSessionWithTwoReadings(api, {
      systolicBP: 151,
      diastolicBP: 86,
      pulse: 72,
      legSwelling: true,
    })

    // Wait for all 3 alerts (3 fire HFREF_HIGH or HF_DECOMP — Tier-3 caregiver-
    // edema sibling rows for HF-decomp may also be persisted but are filtered
    // out of the patient API by Group C, so they don't show on the dashboard
    // strip either).
    const alerts = await waitForAlerts(
      tc,
      carol.id,
      (rows) =>
        rows.filter(
          (a) =>
            a.tier === 'BP_LEVEL_1_HIGH' ||
            a.ruleId === 'RULE_HF_DECOMPENSATION',
        ).length >= 3,
    )
    const patientVisibleAlerts = alerts
      .filter(
        (a) =>
          a.tier === 'BP_LEVEL_1_HIGH' ||
          a.ruleId === 'RULE_HF_DECOMPENSATION',
      )
      .sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      )
    expect(patientVisibleAlerts.length, '3+ patient-visible alerts fired').toBeGreaterThanOrEqual(3)

    // ── Acknowledge the OLDEST one via the patient API so Open ≠ All ───────
    const oldest = patientVisibleAlerts[patientVisibleAlerts.length - 1]
    // Tier 1 + BP_LEVEL_2 are non-dismissable; BP_LEVEL_1_HIGH IS dismissable,
    // so picking the oldest BP-L1-High row is safe to ack.
    if (oldest.dismissible !== false) {
      await patchPatientAcknowledgeAlert(api, oldest.id)
    }

    // ── UI: sign in via browser, land on dashboard ─────────────────────────
    await signInPatient(page, PATIENTS.carol.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-01-default-open.png`,
      fullPage: true,
    })

    // ── Strip is rendered + Open chip is the default ───────────────────────
    const strip = page.locator('[data-testid="dashboard-recent-alerts"]')
    await expect(strip, 'recent-alerts strip is rendered when alerts exist').toBeVisible({
      timeout: 15_000,
    })

    const openChip = page.locator('[data-testid="dashboard-recent-alerts-filter-OPEN"]')
    const allChip = page.locator('[data-testid="dashboard-recent-alerts-filter-ALL"]')
    await expect(openChip, 'Open chip rendered').toBeVisible()
    await expect(allChip, 'All chip rendered').toBeVisible()
    expect(
      await openChip.getAttribute('aria-selected'),
      'Open is the default selection',
    ).toBe('true')

    // ── Default Open: 2 OPEN cards rendered (the ack'd row is hidden) ──────
    const stripCards = strip.locator('[data-testid^="dashboard-recent-alert-"]')
    const openCount = await stripCards.count()
    expect(openCount, 'Open chip shows OPEN-only cards (ack\'d row hidden)').toBeGreaterThanOrEqual(2)
    // The ack'd alert MUST NOT appear under Open.
    if (oldest.dismissible !== false) {
      await expect(
        strip.locator(`[data-testid="dashboard-recent-alert-${oldest.id}"]`),
        'ack\'d alert is hidden under Open chip',
      ).not.toBeVisible()
    }

    // ── 'All' chip: includes the ack'd row too (cap still 3 by recency) ────
    await allChip.click()
    await page.waitForTimeout(200)
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-02-chip-all.png`,
      fullPage: true,
    })
    expect(
      await allChip.getAttribute('aria-selected'),
      'All is now selected',
    ).toBe('true')
    const allCount = await stripCards.count()
    expect(allCount, 'All chip shows up to 3 most-recent cards').toBeGreaterThanOrEqual(
      Math.min(3, patientVisibleAlerts.length),
    )

    // ── 'See all alerts →' link routes to /notifications?tab=alerts ────────
    const seeAll = page.locator('[data-testid="dashboard-recent-alerts-see-all"]')
    await expect(seeAll).toBeVisible()
    await seeAll.click()
    await page.waitForURL(/\/notifications\?tab=alerts/, { timeout: 15_000 })
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-03-see-all-clicked.png`,
      fullPage: true,
    })
    // The tier filter chip row from Spec 25 lives on this page.
    await expect(
      page.locator('[data-testid="alerts-tier-filter"]'),
      'see-all lands on /notifications?tab=alerts (chip row present)',
    ).toBeVisible({ timeout: 15_000 })

    await tc.dispose()
  })
})
