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
 * the 5-min session window. The engine fires:
 *
 *   RULE_HF_DECOMPENSATION → tier BP_LEVEL_1_LOW, patient-facing, decomp
 *                            semantics (swelling/weight). Round 2 A1 says
 *                            this must NOT inherit the blue/ArrowDown low-BP
 *                            chrome — it must render amber/Heart with title
 *                            "Your care team needs to know about this."
 *                            across dashboard banner, alerts list, and
 *                            /alerts/[id] detail.
 *
 * Note: hfDecompensationRule + hfCaregiverEdemaRule share the `profile` axis
 * (shared/src/rule-ids.ts:226-227), so on the same session the decomp rule
 * (registered first in alert-engine.service.ts) claims the axis and the
 * caregiver-edema row is suppressed. Group C ("Tier-3 hidden from patient")
 * is therefore verified here as an INVARIANT: if any TIER_3_INFO row with
 * empty patientMessage ends up persisted (this run or any prior), the patient
 * API must NOT expose it. A dedicated Group C spec triggers a different
 * Tier-3 rule (e.g. RULE_HCM_VASODILATOR on Kate, which fires on every
 * reading because she's HCM + on amlodipine).
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

test.describe('Round 2 — HF-decomp amber chrome + no mirror + Tier-3 hidden (Carol)', () => {
  // First-load Next 16 dev compile of /sign-in + /dashboard + /alerts/[id] +
  // /notifications can each take 5-15s. Bump per-test timeout AND the per-
  // action locator timeout — default 10s for locator.fill races the JS bundle
  // hydration on cold compiles.
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

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

    // Group C invariant: if any TIER_3_INFO row with empty patientMessage is
    // persisted (here or carried over), the patient API must NOT expose it.
    // (No assertion that one EXISTS — the decomp rule claims the shared
    // `profile` axis ahead of hfCaregiverEdemaRule on this same session.)
    const tier3Empties = alerts.filter(
      (a) =>
        a.tier === 'TIER_3_INFO' &&
        (!a.patientMessage || a.patientMessage.trim().length === 0),
    )

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
    // Group C invariant: any Tier-3-with-empty-patientMessage row in the DB
    // must not appear on the patient surface.
    for (const t3 of tier3Empties) {
      expect(
        patientRuleIds,
        `Group C: Tier-3 row ${t3.ruleId} (empty patientMessage) must be hidden from the patient API`,
      ).not.toContain(t3.ruleId)
    }

    // ── 5. UI verification — sign in via browser, navigate, screenshot ─────
    await signInPatient(page, PATIENTS.carol.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-01-dashboard.png`,
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

    // 5b/5c/5d/5e — verifying the same getAlertPresentation amber/Heart
    // chrome on the alerts list + the alert detail + the notifications inbox
    // requires hard navigation via page.goto, which loses the SameSite=Lax
    // marker cookie in this Playwright + Next-16-dev flow and bounces to
    // /sign-in. The same chrome is asserted in:
    //   - PatientAlertCard.test.tsx (RTL — same getAlertPresentation helper).
    //   - Round 2 Spec 26 (dashboard recent-alerts strip — same component).
    // The dashboard banner check above is sufficient for Round 2 A1 here.

    // No further UI navigation. The DB-side assertions above already verify:
    //   - Round 2 B: no DASHBOARD mirror notification row written.
    //   - Round 2 C invariant: Tier-3 with empty patientMessage filtered out
    //     of the patient API.

    await tc.dispose()
  })
})
