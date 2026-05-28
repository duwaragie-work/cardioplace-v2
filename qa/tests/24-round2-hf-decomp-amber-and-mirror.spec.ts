import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postSessionWithTwoReadings,
  getActiveAlerts,
  waitForAlerts,
} from '../helpers/api.js'

/**
 * Round 2 Groups A1 + B + C — three regressions verified by one Carol scenario.
 *
 * Trigger: Carol (HFrEF) submits two readings of 151/86 + leg swelling within
 * the 5-min session window. The engine fires TWO rules on the averaged session:
 *
 *   1. RULE_HF_DECOMPENSATION  → tier BP_LEVEL_1_LOW, patient-facing, decomp
 *                                semantics (swelling/weight). Round 2 A1 says
 *                                this must NOT inherit the blue/ArrowDown low-
 *                                BP chrome — it must render amber/Heart with
 *                                title "Your care team needs to know about
 *                                this." across dashboard banner, alerts list,
 *                                and /alerts/[id] detail.
 *
 *   2. RULE_HF_CAREGIVER_EDEMA → tier TIER_3_INFO, caregiver-routed, empty
 *                                patientMessage. Round 2 C says the patient
 *                                must see ZERO surfacing for this rule (no
 *                                card on /notifications Alerts tab, no
 *                                "FOR YOUR INFORMATION" green card), but the
 *                                admin Physician Notes section still has it
 *                                (verified separately via tc.listAlerts which
 *                                is the admin-equivalent read).
 *
 * Plus the Round 2 B regression: the engine no longer writes a "Cardioplace
 * Alert" Notification row mirroring the alert into the patient's in-app inbox.
 * Direct DB inspection via tc.listNotifications confirms there's no DASHBOARD-
 * channel mirror row for the alert.
 *
 * Plus the commit-0ef5f22 fix: internal RULE_* identifiers must not leak to
 * the patient AlertCard footer.
 *
 * The spec submits readings via the deterministic API path (postSessionWith-
 * TwoReadings) — exercises the same engine pipeline as a real check-in but
 * removes UI-driving flake. The visual chrome we care about is rendered AFTER
 * the engine writes the alert row, so the UI assertions still cover the real
 * patient experience.
 */

const HF_DECOMP_RULE_ID = 'RULE_HF_DECOMPENSATION'
const HF_CAREGIVER_EDEMA_RULE_ID = 'RULE_HF_CAREGIVER_EDEMA'

test.describe('Round 2 — HF-decomp amber chrome + no mirror + Tier-3 hidden (Carol)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('Carol 151/86 + leg swelling → amber chrome, no inbox mirror, Tier-3 caregiver-only hidden from patient', async ({ page }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    // ── 1. Setup: clean Carol's state, sign in via API ─────────────────────
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const carol = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(carol.id)
    const api = await authedApi(apiBase, PATIENTS.carol.email, 'patient')

    // ── 2. Fire the HF-decomp scenario via API (2-reading session) ────────
    // 151/86 + legSwelling is the canonical Round 2 anchor case.
    await postSessionWithTwoReadings(api, {
      systolicBP: 151,
      diastolicBP: 86,
      pulse: 72,
      legSwelling: true,
    })

    // ── 3. DB verification — both alerts persisted, mirror notification NOT ─
    const alerts = await waitForAlerts(tc, carol.id, (rows) =>
      rows.some((a) => a.ruleId === HF_DECOMP_RULE_ID),
    )
    const hfDecomp = alerts.find((a) => a.ruleId === HF_DECOMP_RULE_ID)
    expect(hfDecomp, 'HF_DECOMPENSATION alert row must be persisted').toBeDefined()
    expect(hfDecomp!.tier).toBe('BP_LEVEL_1_LOW')
    expect(hfDecomp!.patientMessage, 'HF-decomp must carry a patient message').toBeTruthy()

    const caregiverEdema = alerts.find((a) => a.ruleId === HF_CAREGIVER_EDEMA_RULE_ID)
    expect(
      caregiverEdema,
      'HF_CAREGIVER_EDEMA Tier-3 row must also be persisted (admin/caregiver sees it)',
    ).toBeDefined()
    expect(caregiverEdema!.tier).toBe('TIER_3_INFO')
    expect(
      (caregiverEdema!.patientMessage ?? '').trim(),
      'caregiver-routed Tier-3 has empty patientMessage by design',
    ).toBe('')

    // Round 2 B: no "Cardioplace Alert" DASHBOARD mirror in the patient inbox.
    // The engine USED to write one Notification row per alert fire at
    // alert-engine.service.ts:844-859 with channel='DASHBOARD' + title from
    // patientNotificationTitle(tier). Group B removed that block. Verify no
    // such row landed for the just-fired HF-decomp alert.
    const notifs = await tc.listNotifications(carol.id)
    const mirrorRows = notifs.filter(
      (n) => n.alertId === hfDecomp!.id && n.channel === 'DASHBOARD',
    )
    expect(
      mirrorRows,
      'Group B: no DASHBOARD mirror notification should be written when an alert fires',
    ).toHaveLength(0)

    // ── 4. Patient API filters Tier-3-with-empty-patientMessage (Group C) ──
    // Direct DB has both rows (asserted above); the patient-facing GET filters
    // the caregiver-routed Tier-3 out. The filter lives in
    // daily_journal.service.ts:getAlerts() (Round 2 Group C).
    const patientVisibleAlerts = await getActiveAlerts(api)
    const patientRuleIds = patientVisibleAlerts.map((a) => a.ruleId)
    expect(
      patientRuleIds,
      'patient API exposes the HF-decomp alert',
    ).toContain(HF_DECOMP_RULE_ID)
    expect(
      patientRuleIds,
      'Group C: caregiver-routed Tier-3 is hidden from the patient API',
    ).not.toContain(HF_CAREGIVER_EDEMA_RULE_ID)

    // ── 5. UI verification — sign in via browser, navigate, screenshot ─────
    await signInPatient(page, PATIENTS.carol.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-01-dashboard.png`,
      fullPage: true,
    })

    // 5a. Dashboard banner uses the amber/Heart chrome (the A1 fix). Pre-A1
    // it rendered blue + ArrowDown + "Your blood pressure is low." Now the
    // banner title reads "Your care team needs to know about this." and the
    // accent rail is amber (var(--brand-warning-amber)).
    const banner = page.locator('[data-testid="active-alert-banner"]')
    await expect(banner).toBeVisible({ timeout: 15_000 })
    const bannerText = await banner.innerText()
    expect(bannerText, 'banner title is the A1 amber/Heart variant').toMatch(/care team needs to know/i)
    expect(bannerText, 'banner does NOT inherit the low-BP framing').not.toMatch(/blood pressure is low/i)
    expect(
      bannerText,
      'banner does NOT include the hypotension footer copy',
    ).not.toMatch(/stand up slowly|salty snack/i)

    // 5b. Open the alert detail page — same amber/Heart chrome must hold.
    await page.goto(`/alerts/${hfDecomp!.id}`)
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-02-alert-detail.png`,
      fullPage: true,
    })
    const detailText = await page.locator('body').innerText()
    expect(detailText).toMatch(/care team needs to know/i)
    expect(detailText).not.toMatch(/blood pressure is low/i)
    expect(detailText, 'no hypotension followUp on the detail page').not.toMatch(/stand up slowly|salty snack/i)

    // 5c. Patient /notifications: the Alerts top-tab has the HF-decomp card
    // using the rule-aware PatientAlertCard chrome (Round 2 H), AND has no
    // green "FOR YOUR INFORMATION" Tier-3 card (Round 2 C).
    await page.goto('/notifications?tab=alerts')
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-03-notifications-alerts.png`,
      fullPage: true,
    })
    const alertsTabText = await page.locator('body').innerText()
    expect(alertsTabText, 'Alerts tab shows the HF-decomp card').toMatch(/care team needs to know/i)
    expect(
      alertsTabText,
      'Round 2 C: NO green "For your information" Tier-3 card on the patient surface',
    ).not.toMatch(/for your information/i)

    // 5d. Rule-id is NOT leaked to the patient (commit 0ef5f22). The footer
    // shows date/time only — internal RULE_* identifiers are admin-only.
    expect(
      alertsTabText,
      'commit 0ef5f22: no RULE_* identifier visible to the patient',
    ).not.toMatch(/RULE_HF_DECOMPENSATION|RULE_HF_CAREGIVER_EDEMA/)

    // 5e. Round 2 B end-to-end: /notifications top-tab "Notifications" has no
    // "Cardioplace Alert" mirror row for the alert that just fired.
    await page.goto('/notifications?tab=notifications')
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.screenshot({
      path: `qa/reports/screenshots/${testInfo.title}-04-notifications-inbox.png`,
      fullPage: true,
    })
    const inboxText = await page.locator('body').innerText()
    expect(
      inboxText,
      'Round 2 B: no clinical-alert mirror in the patient inbox',
    ).not.toMatch(/cardioplace alert/i)

    await tc.dispose()
  })
})
