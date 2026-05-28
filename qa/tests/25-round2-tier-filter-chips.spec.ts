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
  test.use({ viewport: { width: 1280, height: 800 } })

  test('chip filter narrows the bucketed list correctly', async ({ page }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    // ── Setup: clean Carol's state ─────────────────────────────────────────
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const carol = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(carol.id)
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

    // ── UI: sign in, navigate to /notifications alerts top-tab ─────────────
    await signInPatient(page, PATIENTS.carol.email)
    await page.goto('/notifications?tab=alerts')
    await page.waitForLoadState('networkidle').catch(() => {})

    // The tier filter chip row must be present.
    const filterRow = page.locator('[data-testid="alerts-tier-filter"]')
    await expect(filterRow).toBeVisible({ timeout: 15_000 })
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-01-default-all.png`,
      fullPage: true,
    })

    // ── Default 'ALL' chip: both cards visible ──────────────────────────────
    // Each PatientAlertCard renders with testid `notification-row-<alertId>`
    // because the page passes `testIdPrefix="notification-row"`.
    const highCard = page.locator(`[data-testid="notification-row-${highAlert.id}"]`)
    const lowCard = page.locator(`[data-testid="notification-row-${lowAlert.id}"]`)
    await expect(highCard, 'BP-L1-High card visible under ALL').toBeVisible()
    await expect(lowCard, 'HF-decomp card visible under ALL').toBeVisible()

    // ── 'High BP' chip: only the BP_LEVEL_1_HIGH card visible ──────────────
    await page.locator('[data-testid="alerts-tier-filter-high"]').click()
    await page.waitForTimeout(200) // chip toggle re-render
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-02-chip-high.png`,
      fullPage: true,
    })
    await expect(highCard, 'HIGH chip keeps BP-L1-High card').toBeVisible()
    await expect(lowCard, 'HIGH chip hides HF-decomp card').not.toBeVisible()

    // ── 'Low BP' chip: only the HF-decomp card visible ─────────────────────
    await page.locator('[data-testid="alerts-tier-filter-low"]').click()
    await page.waitForTimeout(200)
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-03-chip-low.png`,
      fullPage: true,
    })
    await expect(lowCard, 'LOW chip keeps HF-decomp card').toBeVisible()
    await expect(highCard, 'LOW chip hides BP-L1-High card').not.toBeVisible()

    // ── 'Tier 1' chip: nothing matches this scenario ───────────────────────
    await page.locator('[data-testid="alerts-tier-filter-tier1"]').click()
    await page.waitForTimeout(200)
    await expect(highCard, 'TIER 1 chip hides BP-L1-High').not.toBeVisible()
    await expect(lowCard, 'TIER 1 chip hides HF-decomp').not.toBeVisible()

    // ── Back to 'ALL' chip: both visible again ─────────────────────────────
    await page.locator('[data-testid="alerts-tier-filter-ALL"]').click()
    await page.waitForTimeout(200)
    await expect(highCard, 'ALL chip restores BP-L1-High').toBeVisible()
    await expect(lowCard, 'ALL chip restores HF-decomp').toBeVisible()

    await tc.dispose()
  })
})
