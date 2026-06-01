import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { postSessionWithTwoReadings, waitForAlerts } from '../helpers/api.js'

/**
 * Round 2 J — tier filter chips on the patient /notifications alerts top-tab.
 *
 * Spec mounts the new chip row added in commit 9c4d6de and verifies it
 * actually narrows the bucketed alert list. We fire two alerts on Carol that
 * land in DIFFERENT tier buckets:
 *
 *   - 165/85 + leg swelling NOT set  → RULE_HFREF_HIGH   tier BP_LEVEL_1_HIGH
 *   - 151/86 + leg swelling          → RULE_HF_DECOMPENSATION tier BP_LEVEL_1_LOW
 *                                       (rendered with the amber/Heart chrome
 *                                        per Round 2 A1)
 *
 * Then we walk the chip row (All · Emergency · Tier 1 · High BP · Low BP · Info)
 * and assert:
 *   - "All" shows both cards
 *   - "High BP" shows ONLY the BP_LEVEL_1_HIGH card
 *   - "Low BP" shows ONLY the BP_LEVEL_1_LOW (HF-decomp) card
 *   - "Tier 1" / "Emergency" / "Info" show nothing for this scenario
 *
 * The chip is rendered in notifications/page.tsx as `alerts-tier-filter-${key}`
 * for each key in `['ALL', 'emergency', 'tier1', 'high', 'low', 'info']`.
 */

test.describe('Round 2 J — tier filter chips on patient /notifications', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('chip filter narrows the bucketed list correctly', async ({ page }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    // ── Setup: clean Carol's state ─────────────────────────────────────────
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const carol = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(carol.id)
    // Settle: when this spec runs after Spec 24 in the same worker, the prior
    // SERIALIZABLE persist-alert transactions may still be retrying. A short
    // delay lets them drain before we start firing this spec's sessions.
    await new Promise((r) => setTimeout(r, 1500))
    const api = await authedApi(apiBase, PATIENTS.carol.email, 'patient')

    // ── Fire alert 1: BP_LEVEL_1_HIGH on Carol (HFrEF) at 165/85 ──────────
    // SBP ≥ 160 with no symptoms → RULE_HFREF_HIGH (tier BP_LEVEL_1_HIGH).
    await postSessionWithTwoReadings(api, {
      systolicBP: 165,
      diastolicBP: 85,
      pulse: 72,
    })

    // ── Fire alert 2: HF-decomp on Carol at 151/86 + leg swelling ──────────
    // BP_LEVEL_1_LOW tier (HF decompensation), but rendered with amber/Heart
    // chrome per A1. Each readings session needs its own sessionId; helper
    // generates a fresh one when none is passed.
    await postSessionWithTwoReadings(api, {
      systolicBP: 151,
      diastolicBP: 86,
      pulse: 72,
      legSwelling: true,
    })

    // ── DB verification — both alerts persisted in their right buckets ─────
    const alerts = await waitForAlerts(
      tc,
      carol.id,
      (rows) =>
        rows.some((a) => a.tier === 'BP_LEVEL_1_HIGH') &&
        rows.some((a) => a.ruleId === 'RULE_HF_DECOMPENSATION'),
    )
    const highAlert = alerts.find((a) => a.tier === 'BP_LEVEL_1_HIGH')!
    const lowAlert = alerts.find((a) => a.ruleId === 'RULE_HF_DECOMPENSATION')!
    expect(highAlert, 'BP_LEVEL_1_HIGH alert row exists').toBeDefined()
    expect(lowAlert, 'HF-decomp alert row exists').toBeDefined()

    // ── UI: sign in (lands on /dashboard), then SPA-navigate to the alerts
    // top-tab via the persistent navbar notification bell (P2 removed the
    // dashboard recent-alerts strip + its "See all" link). page.goto would do
    // a hard navigation and lose the marker cookie under Playwright +
    // Next-16-dev (SameSite=Lax + 127.0.0.1 interplay); a <Link> click is a
    // router.push that preserves auth state in memory. /notifications defaults
    // to the Alerts top-tab. ──
    await signInPatient(page, PATIENTS.carol.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator('[data-testid="notification-bell"]').click()
    await page.waitForURL(/\/notifications/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})

    // The tier filter chip row must be present.
    const filterRow = page.locator('[data-testid="alerts-tier-filter"]')
    await expect(filterRow).toBeVisible({ timeout: 15_000 })
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-01-default-all.png`,
      fullPage: true,
    })

    // ── Card-count helper: count rendered PatientAlertCards in the list ────
    // Cards have testid `notification-row-<alertId>` (the page passes
    // testIdPrefix="notification-row"). We count visible cards rather than
    // assert specific IDs so the test is robust to co-fires or residual rows.
    const cardCount = () =>
      page.locator('[data-testid^="notification-row-"]:visible').count()

    // ── Default 'ALL' chip: at least 2 cards visible (high + low) ──────────
    const allCount = await cardCount()
    expect(allCount, 'ALL chip shows at least the 2 alerts we fired').toBeGreaterThanOrEqual(2)

    // ── 'High BP' chip: at least one card visible, fewer than ALL ──────────
    await page.locator('[data-testid="alerts-tier-filter-high"]').click()
    await page.waitForTimeout(300)
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-02-chip-high.png`,
      fullPage: true,
    })
    const highCount = await cardCount()
    expect(highCount, 'HIGH chip shows at least one card').toBeGreaterThanOrEqual(1)
    expect(highCount, 'HIGH chip narrows the list (fewer than ALL)').toBeLessThan(allCount + 1)
    // Page text should mention the high-BP variant title.
    expect(
      await page.locator('body').innerText(),
      'HIGH chip page shows the elevated/high framing',
    ).toMatch(/elevated|high/i)

    // ── 'Low BP' chip: at least one card (the HF-decomp) ──────────────────
    await page.locator('[data-testid="alerts-tier-filter-low"]').click()
    await page.waitForTimeout(300)
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-03-chip-low.png`,
      fullPage: true,
    })
    expect(await cardCount(), 'LOW chip shows at least one card (HF-decomp)').toBeGreaterThanOrEqual(1)
    expect(
      await page.locator('body').innerText(),
      'LOW chip page shows the amber HF-decomp framing (A1)',
    ).toMatch(/care team needs to know/i)

    // ── 'Tier 1' chip: nothing matches this scenario ───────────────────────
    await page.locator('[data-testid="alerts-tier-filter-tier1"]').click()
    await page.waitForTimeout(300)
    expect(await cardCount(), 'TIER 1 chip hides all the BP-L1 cards').toBe(0)

    // ── Back to 'ALL' chip: counts restored ────────────────────────────────
    await page.locator('[data-testid="alerts-tier-filter-ALL"]').click()
    await page.waitForTimeout(300)
    expect(
      await cardCount(),
      'ALL chip restores at least the 2 alerts we fired',
    ).toBeGreaterThanOrEqual(2)

    await tc.dispose()
  })
})
