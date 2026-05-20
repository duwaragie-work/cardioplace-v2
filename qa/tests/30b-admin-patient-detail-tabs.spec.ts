import { test, expect, type Locator } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'
import { postJournalEntry, setMedActionViaUI } from '../helpers/api.js'

/**
 * Phase 3 §E (part 2) — patient-detail tabs UI: Readings, Care team,
 * Medications, Alerts, Timeline. (Profile + Thresholds live in spec 11.)
 *
 * Reality deltas (Phase 3 §B audit) applied here:
 *   • Readings tab = ReadingCards, NOT a table (admin-readings-card-{id}).
 *   • Care-team is an inline 4-<select> editor (practice+primary+backup+md);
 *     Save is disabled until ALL 4 are set → 30e.4 is a FULL assignment,
 *     not a single-field reassign. Editor renders only for
 *     SUPER_ADMIN/MED_DIR/OPS; PROVIDER sees a read-only summary.
 *   • Medication HOLD rationale is a window.prompt (page.on('dialog'));
 *     REJECT uses MedicationRejectModal; VERIFY is a 1-click toggle.
 *   • James is baseline-assigned to primaryProvider — used for the
 *     PROVIDER-scoped read-only check so the detail page loads (≠403).
 *   • tc.seedAlerts → { created, alertIds }.
 */

/** Select a clinician <option> by visible label. The clinician pool loads
 *  async (listClinicians) and ProviderSlot disables the <select> until it
 *  arrives — so wait for the select to be enabled AND the target <option>
 *  to be attached, then select by its resolved value (id). Deterministic;
 *  immune to the React re-render race the try/catch+evaluate hit. */
async function selectClinician(select: Locator, label: string): Promise<void> {
  await expect(select).toBeEnabled({ timeout: 25_000 })
  const option = select.locator('option', { hasText: label }).first()
  await option.waitFor({ state: 'attached', timeout: 25_000 })
  const value = await option.getAttribute('value')
  if (value) {
    await select.selectOption(value)
  } else {
    await select.selectOption({ label })
  }
}

test.describe('Phase 3 §E — patient-detail tabs (Readings/CareTeam/Meds/Alerts/Timeline)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30e.3 — Readings tab renders BP cards newest-first', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)

    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000).toISOString()
    await postJournalEntry(api, {
      measuredAt: threeDaysAgo, systolicBP: 120, diastolicBP: 78, pulse: 70,
    })
    await postJournalEntry(api, {
      measuredAt: new Date().toISOString(), systolicBP: 145, diastolicBP: 92, pulse: 74,
    })
    await api.dispose()

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('readings'))).click()
    await expect(page.locator(byTestId(T.admin.readingsList))).toBeVisible({ timeout: 25_000 })

    const cards = page.locator('[data-testid^="admin-readings-card-"]')
    await expect(cards).toHaveCount(2, { timeout: 20_000 })
    // Newest (145/92, today) must be the first card.
    await expect(cards.first()).toContainText('145')
  })

  test('30e.4 — MEDICAL_DIRECTOR assigns a full care team via the inline editor', async ({ page }) => {
    test.setTimeout(150_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)

    // CareTeamTab.refresh() pulls the clinician pool via listClinicians; the
    // shared Prisma Cloud DB occasionally returns it empty under combined
    // load (v3.1 lesson) → ProviderSlot disables the empty <select>. Reload
    // the tab until the pool actually arrives (primary select enabled).
    const primary = page.locator(byTestId(T.admin.careTeamPrimarySelect))
    const md = page.locator(byTestId(T.admin.careTeamMdSelect))
    let ready = false
    for (let attempt = 0; attempt < 6 && !ready; attempt++) {
      await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
      await page.locator(byTestId(T.admin.detailTab('careteam'))).click()
      await page
        .locator(byTestId(T.admin.careTeamPracticeSelect))
        .waitFor({ state: 'visible', timeout: 25_000 })
      // refresh() awaits listPractices + listClinicians('PROVIDER') +
      // listClinicians('MEDICAL_DIRECTOR') together. The PROVIDER and MD
      // pools are SEPARATE queries — either can flake empty under combined
      // load (v3.1 shared-DB lesson) → ProviderSlot disables that <select>.
      // Reload until BOTH the primary (provider pool) and MD (md pool)
      // selects are enabled.
      ready =
        (await primary.isEnabled().catch(() => false)) &&
        (await md.isEnabled().catch(() => false))
      if (!ready) await page.waitForTimeout(1500)
    }
    expect(ready, 'clinician pools never loaded (listClinicians empty under load)').toBe(true)

    const practice = page.locator(byTestId(T.admin.careTeamPracticeSelect))
    const backupSel = page.locator(byTestId(T.admin.careTeamBackupSelect))
    await practice.selectOption({ index: 1 }) // first real practice (idx 0 = placeholder)
    await selectClinician(page.locator(byTestId(T.admin.careTeamPrimarySelect)), ADMINS.primaryProvider.name)
    // Save is gated on `dirty` — re-selecting an identical assignment (after a
    // prior run) is a no-op → Save stays disabled. Alternate the backup
    // provider so at least one slot always changes (idempotent across runs).
    const curBackup = await backupSel
      .evaluate((el) => {
        const s = el as HTMLSelectElement
        return s.options[s.selectedIndex]?.textContent?.trim() ?? ''
      })
      .catch(() => '')
    // Alternate between two BASELINE-seeded clinicians (always present
    // without SEED_TEST_FIXTURES — CI on dev has no fixtures cohort, so
    // "Dr. Sarah Smith" et al. don't exist there). Both are in the
    // provider pool; neither is the primary (Okonkwo) or MD (Raman) slot.
    const backupName = curBackup.includes('Reyes')
      ? ADMINS.manisha.name // Dr. Manisha Patel (PROVIDER, baseline)
      : ADMINS.backupProvider.name // Dr. Elena Reyes (PROVIDER, baseline)
    await selectClinician(backupSel, backupName)
    await selectClinician(page.locator(byTestId(T.admin.careTeamMdSelect)), ADMINS.medicalDirector.name)

    const save = page.locator(byTestId(T.admin.careTeamSave))
    await expect(save).toBeEnabled({ timeout: 15_000 })
    await save.click()

    // Summary renders the resolved primary clinician's name.
    await expect(
      page.locator(byTestId(T.admin.careTeamCurrent('primary'))),
    ).toContainText('Okonkwo', { timeout: 20_000 })
  })

  test('30e.5 — PROVIDER sees the care-team tab read-only (no editor)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const james = await tc.findUser(PATIENTS.james.email) // assigned to primaryProvider

    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${james.id}`)
    await page.locator(byTestId(T.admin.detailTab('careteam'))).click()

    await expect(
      page.locator(byTestId(T.admin.careTeamStatus)),
    ).toBeVisible({ timeout: 25_000 })
    await expect(page.locator(byTestId(T.admin.careTeamPracticeSelect))).toHaveCount(0)
    await expect(page.locator(byTestId(T.admin.careTeamSave))).toHaveCount(0)
  })

  test('30e.6 — admin verifies a patient-reported medication (UNVERIFIED → VERIFIED)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.setUserMedication(aisha.id, {
      drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY', verificationStatus: 'UNVERIFIED',
    })

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await setMedActionViaUI(page, aisha.id, 'Lisinopril', 'VERIFY')

    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('medications'))).click()
    const card = page
      .locator('[data-testid^="admin-med-card-"]')
      .filter({ hasText: 'Lisinopril' })
      .first()
    await expect(card).toContainText(/verified/i, { timeout: 20_000 })
  })

  test('30e.7 — admin HOLDs a medication (window.prompt rationale) → patient notification dispatched', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.setUserMedication(aisha.id, {
      drugName: 'HydroQA', drugClass: 'THIAZIDE',
      frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED',
    })

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await setMedActionViaUI(page, aisha.id, 'HydroQA', 'HOLD', 'qa: side effect — pause and reassess')

    const card = page
      .locator('[data-testid^="admin-med-card-"]')
      .filter({ hasText: 'HydroQA' })
      .first()
    await expect(card).toContainText(/hold/i, { timeout: 20_000 })

    // Patient notification is event-driven — poll briefly.
    let hit = false
    for (let i = 0; i < 15 && !hit; i++) {
      const notifs = await tc.listNotifications(aisha.id)
      hit = notifs.some(
        (n) => /hold|paused|pause/i.test(n.title) || /hold|paused|pause/i.test(n.body),
      )
      if (!hit) await page.waitForTimeout(800)
    }
    expect(hit, 'expected a patient notification about the medication hold').toBe(true)
  })

  test('30e.8 — admin rejects a medication via MedicationRejectModal', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    // Per-run-unique name: avoids cross-run pollution, and a rejected med is
    // dropped from the active meds list (so a stale prior 'MetopQA' would
    // mask the result). The reject is verified via the Timeline audit row —
    // the reliable persisted signal regardless of meds-list rendering.
    const drug = `MetopQA${Date.now() % 100000}`
    await tc.setUserMedication(aisha.id, {
      drugName: drug, drugClass: 'BETA_BLOCKER',
      frequency: 'TWICE_DAILY', verificationStatus: 'UNVERIFIED',
    })

    const rationale = `qa-reject-${Date.now() % 100000}`
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await setMedActionViaUI(page, aisha.id, drug, 'REJECT', rationale)

    // The reject writes a ProfileVerificationLog (verb "marked rejected by
    // admin", body = the rationale). The Timeline renders it — the unique
    // rationale ties the entry to THIS action, independent of whether the
    // meds list still shows the (now-rejected) drug.
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const timeline = page.locator(byTestId(T.admin.timelineList))
    await expect(timeline).toBeVisible({ timeout: 25_000 })
    await expect(timeline).toContainText(/reject/i, { timeout: 20_000 })
    await expect(timeline).toContainText(rationale)
  })

  test('30e.11 — Alerts tab status filter (OPEN / RESOLVED / ALL)', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await tc.resetUser(aisha.id)
    const open = await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' }])
    const resolved = await tc.seedAlerts(aisha.id, [{
      tier: 'TIER_1_CONTRAINDICATION', status: 'RESOLVED',
      resolvedBy: md.id, resolutionAction: 'TIER1_FALSE_POSITIVE',
      resolutionRationale: 'qa: reviewed — no concern',
    }])
    const openId = open.alertIds[0]
    const resolvedId = resolved.alertIds[0]

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('alerts'))).click()

    // Default filter = OPEN.
    await expect(page.locator(byTestId(T.admin.alertRow(openId)))).toBeVisible({ timeout: 25_000 })
    await expect(page.locator(byTestId(T.admin.alertRow(resolvedId)))).toHaveCount(0)

    await page.locator(byTestId(T.admin.alertsStatusFilter('RESOLVED'))).click()
    await expect(page.locator(byTestId(T.admin.alertRow(resolvedId)))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.alertRow(openId)))).toHaveCount(0)

    await page.locator(byTestId(T.admin.alertsStatusFilter('ALL'))).click()
    await expect(page.locator(byTestId(T.admin.alertRow(openId)))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.alertRow(resolvedId)))).toBeVisible()
  })

  test('30e.12 — Timeline tab renders chronological events', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    await tc.seedAlerts(aisha.id, [{ tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' }])

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${aisha.id}`)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()

    await expect(page.locator(byTestId(T.admin.timelineList))).toBeVisible({ timeout: 25_000 })
    const entries = page.locator('[data-testid^="admin-timeline-entry-"]')
    await expect(entries.first()).toBeVisible({ timeout: 20_000 })
    expect(await entries.count()).toBeGreaterThanOrEqual(1)
    // The seeded alert produces an "… alert opened" timeline entry.
    await expect(page.locator(byTestId(T.admin.timelineList))).toContainText(/alert/i)
  })
})
