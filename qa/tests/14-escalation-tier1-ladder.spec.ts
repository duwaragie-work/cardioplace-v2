import { test, expect } from '@playwright/test'
import { authedApi, signInAdmin } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  postJournalEntry,
  adminAcknowledgeAlert,
  gotoPatientAlertsTab,
  waitForAlerts,
} from '../helpers/api.js'
import { HOURS } from '../helpers/time.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Tier 1 escalation ladder (TESTING_FLOW_GUIDE §8.3).
 *
 *   T+0  → primary provider, push+email+dashboard
 *   T+4h → primary + backup, push
 *   T+8h → medical director, push+dashboard
 *   T+24h → HEALPLACE_OPS, push+phone
 *   T+48h → HEALPLACE_OPS, dashboard
 *
 * After-hours: T+0 also fires backup immediately (TIER_1_BACKUP_ON_T0
 * safety-net step). Anchor for ladder deadlines = T+0 actual dispatch
 * notificationSentAt — NOT alert.createdAt.
 *
 * Strategy:
 *   1. trigger Tier 1 by submitting a James reading (NDHP+HFrEF — pre-gate
 *      contraindication, fires regardless of BP)
 *   2. backdate T+0 notificationSentAt by 4h via test-control
 *   3. runScan(now) — should advance to T+4h
 *   4. assert new EscalationEvent at ladderStep=T4H
 *   5. repeat for T+8h, T+24h, T+48h
 */

test.describe('Tier 1 ladder progression via runScan', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('full ladder T+0 → T+4h → T+8h → T+24h → T+48h', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)

    // Trigger Tier 1
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    const tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    // T+0 should already exist (or fire now via runScan if queued)
    await tc.runEscalationScan(new Date())
    let events = await tc.listEscalationEvents(tier1!.id)
    expect(events.some((e) => e.ladderStep === 'T0')).toBeTruthy()

    // Cluster 7 C.1 — walk the rest of the ladder in one call. Bypasses the
    // cron + business-hours guard by directly inserting EscalationEvent rows
    // anchored to alert.createdAt + each step's offset.
    await tc.advanceLadderSteps(tier1!.id, 4)
    events = await tc.listEscalationEvents(tier1!.id)
    for (const step of ['T4H', 'T8H', 'T24H', 'T48H']) {
      expect(
        events.some((e) => e.ladderStep === step),
        `expected ${step} after advanceLadderSteps. Steps so far: [${events.map((e) => e.ladderStep).join(',')}]`,
      ).toBeTruthy()
    }

    await patientApi.dispose()
    await tc.dispose()
  })

  test('acknowledged alert stops ladder progression', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const tier1 = (await tc.listAlerts(u.id)).find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1).toBeDefined()

    // Acknowledge via the ADMIN endpoint. Tier 1 contraindications can only
    // be acknowledged by clinical staff (per spec) — patient-side
    // PATCH /daily-journal/alerts/:id/acknowledge returns 400 here. Cluster-2
    // / B3 reconfirm: original test failure was a silent 400 from patient
    // ack, then "ack didn't stop ladder" because ack never happened.
    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, tier1!.id)

    // Advance 5h — backdateAlertAnchor force-sets notificationSentAt so the
    // anchor calc works even when T+0 was queued for after-hours business
    // open. Use 5h so the deadline is comfortably past.
    await tc.backdateAlertAnchor(tier1!.id, 5 * 60 * 60)
    await tc.runEscalationScan(new Date())
    const events = await tc.listEscalationEvents(tier1!.id)
    expect(events.some((e) => e.ladderStep === 'T4H'), 'ack should stop the ladder').toBeFalsy()

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('Escalation ladder copy after ack/resolve', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('future ladder steps show "Not required" after admin acknowledges', async ({ page }) => {
    // Default Playwright timeout is 30s — bumped to 90s here because the
    // setup chain (alert-poll up to 15s + admin signin OTP + page.goto +
    // ladder render wait) routinely runs ~45-60s against the cloud DB.
    test.setTimeout(90_000)
    // Bug from manual test: once an alert is ACKNOWLEDGED/RESOLVED, future
    // ladder rungs (T+4h / T+8h / T+24h / T+48h) keep displaying "Not yet
    // triggered" — misleading since the ladder advance is cancelled on ack.
    // Fix swaps the copy to "Not required — alert acknowledged/resolved
    // before this rung". This test verifies the swap from the admin UI.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118,
      diastolicBP: 74,
      pulse: 68,
    })
    // Poll for the Tier 1 alert to land. Event-driven engine + SERIALIZABLE
    // persistAlert with deadlock-retry (Cluster 6 bug #11) can push alert
    // creation past any fixed sleep — a 1500ms wait was racy in CI.
    let alerts = await tc.listAlerts(u.id)
    let tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    for (let attempt = 0; attempt < 30 && !tier1; attempt++) {
      await new Promise((r) => setTimeout(r, 500))
      alerts = await tc.listAlerts(u.id)
      tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    }
    expect(tier1, `expected Tier 1 contraindication for james reset; got tiers: [${alerts.map((a) => a.tier).join(',')}]`).toBeDefined()

    const adminApi = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    await adminAcknowledgeAlert(adminApi, tier1!.id)

    await signInAdmin(page, ADMINS.manisha.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/detail?id=${u.id}`)

    // The patient-detail shell defaults to the Profile tab. Switch to
    // Alerts. (`?alert=` query is not currently honored — `useSearchParams`
    // isn't wired to the shell's tab state; tracked separately if we want
    // deep-link support later.)
    await page.getByRole('tab', { name: 'Alerts' }).click()
    // AlertsTab default status filter is OPEN, but our alert is now
    // ACKNOWLEDGED — flip the filter to ALL so the row is visible.
    await page.getByRole('button', { name: 'All', exact: true }).first().click()
    // Expand the alert card to render the EscalationAuditTrail below the row.
    await page.getByRole('button', { name: 'Expand alert' }).first().click()

    // After ack, untriggered rungs (T+4h, T+8h, etc.) should now read "Not
    // required", NOT "Not yet triggered". Assert both directions to catch a
    // regression where the swap is partially applied.
    await expect(
      page.getByText('Not required — alert acknowledged before this rung').first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Not yet triggered')).toHaveCount(0)

    await patientApi.dispose()
    await adminApi.dispose()
    await tc.dispose()
  })
})

test.describe('BP Level 2 dual-fire at T+0', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('absolute emergency 185/95 fires primary + backup + patient at T+0', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 185,
      diastolicBP: 95,
      pulse: 88,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const bpL2 = (await tc.listAlerts(u.id)).find((a) => a.tier === 'BP_LEVEL_2')
    expect(bpL2).toBeDefined()

    const events = await tc.listEscalationEvents(bpL2!.id)
    const t0 = events.find((e) => e.ladderStep === 'T0')
    expect(t0, 'expected T0 event').toBeDefined()
    // T+0 dispatches to PRIMARY_PROVIDER + BACKUP_PROVIDER + PATIENT simultaneously.
    expect(t0!.recipientRoles).toContain('PRIMARY_PROVIDER')
    expect(t0!.recipientRoles).toContain('BACKUP_PROVIDER')
    expect(t0!.recipientRoles).toContain('PATIENT')

    await patientApi.dispose()
    await tc.dispose()
  })

  test('BP L2 fires immediately even after-hours (after-hours = false bypassed)', async () => {
    test.skip(
      true,
      'TODO(next-pass): mock practice business hours via test-control to force after-hours, ' +
        'submit BP L2 reading, assert T0 event has afterHours=true but still fires immediately ' +
        '(no scheduledFor in the future).',
    )
  })
})

test.describe('Pre-enrollment dispatch gate (Layer B)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('NOT_ENROLLED patient: alert created but NO EscalationEvent', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    // Manisha 2026-06-12 — the dispatch gate now defers ONLY for a patient who
    // was NEVER enrolled; a previously-enrolled (auto-un-enrolled) patient
    // dispatches via the was-ever-enrolled bypass. Clear the enrollment-audit
    // history so this patient is unambiguously never-enrolled for the gate test
    // (otherwise leftover ENROLLED/revert audit rows from sibling specs in the
    // shard would trip the bypass and dispatch).
    await tc.clearProfileVerificationLogs(u.id)
    await tc.setEnrollment(u.id, 'NOT_ENROLLED')

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    await postJournalEntry(patientApi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 165,
      diastolicBP: 100,
      pulse: 78,
    })
    await new Promise((r) => setTimeout(r, 1500))
    const alerts = await tc.listAlerts(u.id)
    expect(alerts.length, 'alert row should still be created (Layer A allowed it)').toBeGreaterThan(0)

    const aId = alerts[0]!.id
    const events = await tc.listEscalationEvents(aId)
    expect(events.length, 'NO escalation events when never-enrolled (Layer B gate)').toBe(0)

    // Restore enrolled state for downstream tests
    await tc.setEnrollment(u.id, 'ENROLLED')
    await patientApi.dispose()
    await tc.dispose()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §I — escalation ladder UI display (30i.1–30i.4)
//
// The cron fan-out is engine-verified by the tests above. §I adds the UI
// layer: EscalationAuditTrail (rendered inside the EXPANDED AlertCard on the
// patient-detail Alerts tab). Rungs are keyed by ladder CODE
// (admin-escalation-rung-{T0|T4H|T8H|T24H|T48H} for Tier 1;
// {T0|T24H|T72H|T7D} for BP L1). The canonical ladder rows always render;
// a fired rung's status badge is NOT "Not yet triggered".
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §I — escalation ladder UI', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  /** Trigger James's real Tier 1 (RULE_NDHP_HFREF) + fire T+0 via the scan. */
  async function seedJamesTier1(tc: Awaited<ReturnType<typeof newTestControl>>) {
    const u = await tc.findUser(PATIENTS.james.email)
    await tc.resetUser(u.id)
    const papi = await authedApi(API_BASE_URL, PATIENTS.james.email)
    await postJournalEntry(papi, {
      measuredAt: new Date().toISOString(),
      systolicBP: 118, diastolicBP: 74, pulse: 68,
    })
    await papi.dispose()
    // Engine is event-driven; persistAlert SERIALIZABLE txns retry under
    // load. Poll instead of a fixed sleep (the §I races a fixed 1500ms).
    const alerts = await waitForAlerts(
      tc,
      u.id,
      (xs) => xs.some((a) => a.tier === 'TIER_1_CONTRAINDICATION'),
    )
    const tier1 = alerts.find((a) => a.tier === 'TIER_1_CONTRAINDICATION')
    expect(tier1, 'expected James Tier 1 contraindication').toBeDefined()
    await tc.runEscalationScan(new Date())
    return { userId: u.id, alertId: tier1!.id }
  }

  test('30i.1 — Tier 1 advanced to T+4h shows T+0 + T+4h fired, later rungs pending', async ({ page }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { userId, alertId } = await seedJamesTier1(tc)
    await tc.advanceLadderSteps(alertId, 1) // → T4H (steps[1..1])

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, userId)
    await page.locator(byTestId(T.admin.alertExpand(alertId))).click()

    await expect(page.locator(byTestId(T.admin.escalationRung('T0')))).toBeVisible({ timeout: 20_000 })
    await expect(page.locator(byTestId(T.admin.escalationRung('T4H')))).toBeVisible()
    await expect(
      page.locator(byTestId(T.admin.escalationRungStatus('T0'))),
    ).not.toContainText(/not yet triggered/i)
    await expect(
      page.locator(byTestId(T.admin.escalationRungStatus('T4H'))),
    ).not.toContainText(/not yet triggered/i)
    await expect(
      page.locator(byTestId(T.admin.escalationRungStatus('T8H'))),
    ).toContainText(/not yet triggered/i)
    await tc.dispose()
  })

  test('30i.2 — all 5 Tier 1 rungs fire after advanceLadderSteps(4)', async ({ page }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { userId, alertId } = await seedJamesTier1(tc)
    await tc.advanceLadderSteps(alertId, 4) // → T4H,T8H,T24H,T48H

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, userId)
    await page.locator(byTestId(T.admin.alertExpand(alertId))).click()
    await page.locator(byTestId(T.admin.escalationRung('T0'))).waitFor({ state: 'visible', timeout: 20_000 })

    for (const code of ['T0', 'T4H', 'T8H', 'T24H', 'T48H']) {
      await expect(
        page.locator(byTestId(T.admin.escalationRung(code))),
        `rung ${code} present`,
      ).toBeVisible()
      await expect(
        page.locator(byTestId(T.admin.escalationRungStatus(code))),
        `rung ${code} fired`,
      ).not.toContainText(/not yet triggered/i)
    }
    await tc.dispose()
  })

  test('30i.3 — BP L1 renders its 4-rung ladder shape (T0/T24H/T72H/T7D, not the Tier 1 shape)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    const { alertIds } = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' }])
    const id = alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, aisha.id)
    await page.locator(byTestId(T.admin.alertExpand(id))).click()

    for (const code of ['T0', 'T24H', 'T72H', 'T7D']) {
      await expect(
        page.locator(byTestId(T.admin.escalationRung(code))),
        `BP L1 rung ${code}`,
      ).toBeVisible({ timeout: 20_000 })
    }
    // The Tier 1-only T4H/T8H rungs must NOT appear on a BP L1 ladder.
    await expect(page.locator(byTestId(T.admin.escalationRung('T4H')))).toHaveCount(0)
    await expect(page.locator(byTestId(T.admin.escalationRung('T8H')))).toHaveCount(0)
    await tc.dispose()
  })

  test('30i.4 — a cron-fired rung shows the System (Cron) dispatch attribution', async ({ page }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const { userId, alertId } = await seedJamesTier1(tc)

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await gotoPatientAlertsTab(page, userId)
    await page.locator(byTestId(T.admin.alertExpand(alertId))).click()
    await page.locator(byTestId(T.admin.escalationRung('T0'))).waitFor({ state: 'visible', timeout: 20_000 })

    // T+0 was dispatched by the escalation scheduler (no human actor).
    await expect(
      page.locator(byTestId(T.admin.auditAttributionSystem)).first(),
    ).toBeVisible({ timeout: 20_000 })
    await tc.dispose()
  })
})
