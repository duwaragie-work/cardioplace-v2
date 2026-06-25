import { test, expect, type Page } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * phase/26 — /reports analytics suite + today's Tier 3 SLA policy.
 *
 * /reports is a five-tab surface (Monthly · Quarterly · SLAs · Cohorts ·
 * Adherence), gated by canViewReports = MEDICAL_DIRECTOR | HEALPLACE_OPS |
 * SUPER_ADMIN. Each phase/26 tab owns a `<kind>-*` testid namespace on its
 * panel (see helpers/selectors.ts → T.sla / T.quarterly / T.cohort / T.adherence).
 *
 * Coverage:
 *   33.1  PROVIDER (no report role) is hard-denied at /reports.
 *   33.2  All five tabs mount their panel (picker renders) when switched.
 *   33.3  SLA scorecard marks the Tier 3 row "Not acceptable" (today's change)
 *         and leaves tracked tiers untouched.
 *   33.4  SLA CSV + PDF downloads fire with the right file extensions.
 *   33.5  API — a Tier 3 alert that WOULD breach its SLA is excluded from the
 *         rollups (tiersFailing / overall acked-%), and the CSV labels it
 *         "Not acceptable". This is the deterministic proof of today's change.
 *   33.6  Quarterly — seeded readings drive a computed BP-control rate; CSV +
 *         PDF render.
 *   33.7  Cohort — a seed HFrEF patient buckets into the HFREF cohort; CSV +
 *         PDF render.
 *   33.8  Adherence — report shape + CSV section labels + download integrity
 *         (numeric adherence is unit-covered; inputs aren't test-control seedable).
 *
 * The SLA per-tier scorecard is built from ALL_TIERS (reports.service.ts
 * `ALL_TIERS.map`), so the TIER_3_INFO row is ALWAYS present even with zero
 * alerts — no seeding needed for the render/label assertions.
 */
test.describe('phase/26 — admin reporting suite + Tier 3 SLA policy', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'phase/26 admin e2e gated behind RUN_WRITE_TESTS')

  /** Open /reports as a report-capable admin (Medical Director) and switch tab. */
  async function openReports(page: Page, tabTestId?: string): Promise<void> {
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    if (tabTestId) {
      await page.locator(byTestId(tabTestId)).click()
    }
  }

  // ── 33.1 — role gate ──────────────────────────────────────────────────────
  test('33.1 — a plain PROVIDER is denied at /reports', async ({ page }) => {
    test.setTimeout(60_000)
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/reports`)
    await expect(page.locator(byTestId(T.reports.accessDenied))).toBeVisible({
      timeout: 20_000,
    })
    // None of the report tabs should have rendered for a denied role.
    await expect(page.locator(byTestId(T.reportTabs.sla))).toHaveCount(0)
  })

  // ── 33.2 — every tab mounts its panel ─────────────────────────────────────
  test('33.2 — all five report tabs mount their panel', async ({ page }) => {
    test.setTimeout(90_000)
    await openReports(page)

    // Monthly is the default tab.
    await expect(page.locator(byTestId(T.reports.monthPicker))).toBeVisible({
      timeout: 25_000,
    })

    await page.locator(byTestId(T.reportTabs.quarterly)).click()
    await expect(page.locator(byTestId(T.quarterly.quarterPicker))).toBeVisible()

    await page.locator(byTestId(T.reportTabs.sla)).click()
    await expect(page.locator(byTestId(T.sla.monthPicker))).toBeVisible()

    await page.locator(byTestId(T.reportTabs.cohorts)).click()
    await expect(page.locator(byTestId(T.cohort.monthPicker))).toBeVisible()

    await page.locator(byTestId(T.reportTabs.adherence)).click()
    await expect(page.locator(byTestId(T.adherence.windowPicker))).toBeVisible()
  })

  // ── 33.3 — Tier 3 row reads "Not acceptable" in the SLA scorecard ─────────
  test('33.3 — SLA scorecard marks Tier 3 "Not acceptable", tracked tiers unaffected', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await openReports(page, T.reportTabs.sla)

    const table = page.locator(byTestId(T.sla.table))
    await expect(table).toBeVisible({ timeout: 25_000 })

    // The TIER_3_INFO row is always rendered (ALL_TIERS.map); its label is
    // "Tier 3 — Info" (formatTierLabel). Its metric columns collapse to a
    // single "Not acceptable" span — never a Pass/Fail verdict.
    const tier3Row = table.locator('tbody tr', { hasText: 'Tier 3 — Info' })
    await expect(tier3Row).toBeVisible()
    await expect(tier3Row).toContainText('Not acceptable')
    await expect(tier3Row).not.toContainText('Pass')
    await expect(tier3Row).not.toContainText('Fail')

    // A tracked tier (BP Level 2) must NOT be relabelled — it still carries
    // real SLA cells, so "Not acceptable" must not leak onto it.
    const bpL2Row = table.locator('tbody tr', { hasText: 'BP Level 2' }).first()
    await expect(bpL2Row).not.toContainText('Not acceptable')
  })

  // ── 33.4 — SLA downloads ──────────────────────────────────────────────────
  test('33.4 — SLA CSV and PDF download with correct extensions', async ({ page }) => {
    test.setTimeout(90_000)
    await openReports(page, T.reportTabs.sla)
    await expect(page.locator(byTestId(T.sla.table))).toBeVisible({ timeout: 25_000 })

    const [csv] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(byTestId(T.sla.downloadCsv)).click(),
    ])
    expect(csv.suggestedFilename()).toMatch(/\.csv$/)

    const [pdf] = await Promise.all([
      page.waitForEvent('download'),
      page.locator(byTestId(T.sla.downloadPdf)).click(),
    ])
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/)
  })

  // ── 33.5 — API: Tier 3 excluded from SLA rollups (deterministic) ──────────
  test('33.5 — a failing Tier 3 alert is excluded from SLA totals and labelled in CSV', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    // Clean slate: wipe every *.cardioplace.test patient's alerts so the Cedar
    // Hill practice has no other alerts polluting the rollups for this month.
    await tc.resetTestPatients()
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    // Previous calendar month — the SLA report's default window. Seed mid-month
    // at noon UTC so the alert lands safely inside the practice-tz window.
    const d = new Date()
    const mid = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15, 12, 0, 0))
    const month = `${mid.getUTCFullYear()}-${String(mid.getUTCMonth() + 1).padStart(2, '0')}`
    const q = `practiceId=${encodeURIComponent(SEED_PRACTICE_ID)}&month=${month}`

    // SUPER_ADMIN can read any practice; pass practiceId explicitly since the
    // account is org-wide (multi-practice).
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')

    // Baseline — empty practice for the month.
    const before = (await (await api.get(`admin/reports/sla?${q}`)).json()).data
    const t3Before = before.byTier.find((r: { tier: string }) => r.tier === 'TIER_3_INFO')
    expect(t3Before, 'Tier 3 row is always present').toBeTruthy()
    expect(t3Before.total).toBe(0)
    expect(before.tiersFailing).toBe(0)
    expect(before.overallAckWithinPct).toBeNull()

    // Seed ONE Tier 3 alert created last month and ACKNOWLEDGED now → its mean
    // ack time (~weeks) is far past the 7-day Tier 3 target, so it WOULD count
    // as failing if Tier 3 were SLA-tracked.
    await tc.seedAlerts(aisha.id, [
      {
        tier: 'TIER_3_INFO',
        status: 'ACKNOWLEDGED',
        acknowledgedByUserId: aisha.id,
        createdAtIso: mid.toISOString(),
      },
    ])

    const after = (await (await api.get(`admin/reports/sla?${q}`)).json()).data
    const t3After = after.byTier.find((r: { tier: string }) => r.tier === 'TIER_3_INFO')
    // The alert IS in the report (total ticked up) and DID breach its target…
    expect(t3After.total).toBe(1)
    expect(t3After.ackPass).toBe(false)
    // …yet it is excluded from BOTH rollups — the whole point of today's change.
    expect(after.tiersFailing).toBe(0)
    expect(after.overallAckWithinPct).toBeNull()

    // CSV renders the literal "Not acceptable" for the Tier 3 metric cells.
    const csvRes = await api.get(`admin/reports/sla.csv?${q}`)
    expect(csvRes.ok()).toBeTruthy()
    expect(await csvRes.text()).toContain('Not acceptable')

    await tc.resetUser(aisha.id)
    await api.dispose()
    await tc.dispose()
  })

  // ── 33.6 — Quarterly Outcomes: BP-control rate + downloads ────────────────
  test('33.6 — Quarterly computes BP-control rate and renders CSV/PDF', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    await tc.resetTestPatients()
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    // Current calendar quarter; seed two well-controlled readings mid-quarter
    // (avg 122/79 ≤ default 140/90 → CONTROLLED). Readings are windowed by
    // measuredAt (quarterly.service.ts), which seedReadingsAtTime sets verbatim.
    const now = new Date()
    const qy = now.getUTCFullYear()
    const qn = Math.floor(now.getUTCMonth() / 3) + 1
    const quarter = `${qy}-Q${qn}`
    const midMonth = (qn - 1) * 3 + 1
    await tc.seedReadingsAtTime(aisha.id, [
      { measuredAt: new Date(Date.UTC(qy, midMonth, 15, 12, 0, 0)).toISOString(), systolicBP: 120, diastolicBP: 80, pulse: 70 },
      { measuredAt: new Date(Date.UTC(qy, midMonth, 15, 13, 0, 0)).toISOString(), systolicBP: 124, diastolicBP: 78, pulse: 72 },
    ])

    const q = `practiceId=${encodeURIComponent(SEED_PRACTICE_ID)}&quarter=${quarter}`
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')

    const data = (await (await api.get(`admin/reports/quarterly?${q}`)).json()).data
    expect(data.alertVolume.length, 'always 3 months in a quarter').toBe(3)
    // After the reset, aisha is the only patient with readings this quarter.
    expect(data.control.patientsWithReadings).toBe(1)
    expect(data.control.controlled).toBe(1)
    expect(data.control.controlRatePct).toBe(100)
    const row = data.byPatient.find((r: { patientId: string }) => r.patientId === aisha.id)
    expect(row?.status).toBe('CONTROLLED')

    const csv = await api.get(`admin/reports/quarterly.csv?${q}`)
    expect(csv.ok()).toBeTruthy()
    const csvText = await csv.text()
    expect(csvText).toContain('ALERT VOLUME (per month)')
    expect(csvText).toContain('BP CONTROL')
    expect(csvText).toContain('BY PATIENT')

    const pdf = await api.get(`admin/reports/quarterly.pdf?${q}`)
    expect(pdf.ok()).toBeTruthy()
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')

    await tc.resetUser(aisha.id)
    await api.dispose()
    await tc.dispose()
  })

  // ── 33.7 — Per-Condition Cohort: condition bucketing + downloads ──────────
  test('33.7 — Cohort buckets a patient by condition and renders CSV/PDF', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    await tc.resetTestPatients()
    // James is a seed-stable HFrEF persona (hasHeartFailure + heartFailureType
    // HFREF) — no profile mutation needed to exercise the HFREF cohort.
    const james = await tc.findUser(PATIENTS.james.email)

    const d = new Date()
    const mid = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 15, 12, 0, 0))
    const month = `${mid.getUTCFullYear()}-${String(mid.getUTCMonth() + 1).padStart(2, '0')}`
    await tc.seedReadingsAtTime(james.id, [
      { measuredAt: mid.toISOString(), systolicBP: 120, diastolicBP: 78, pulse: 70 },
    ])

    const q = `practiceId=${encodeURIComponent(SEED_PRACTICE_ID)}&month=${month}`
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')

    const data = (await (await api.get(`admin/reports/cohorts?${q}`)).json()).data
    const byKey = (k: string) => data.rows.find((r: { cohort: string }) => r.cohort === k)
    // ALL + HFREF cohorts present; James is the lone reader this month.
    expect(byKey('ALL'), 'ALL cohort always present').toBeTruthy()
    const hfref = byKey('HFREF')
    expect(hfref, 'HFREF cohort present (James qualifies)').toBeTruthy()
    expect(hfref.patientsWithReadings).toBe(1)
    expect(hfref.controlled, '120/78 ≤ 140/90 → controlled').toBe(1)
    expect(byKey('ALL').patientsWithReadings).toBe(1)

    const csv = await api.get(`admin/reports/cohorts.csv?${q}`)
    expect(csv.ok()).toBeTruthy()
    const csvText = await csv.text()
    expect(csvText).toContain('BY COHORT')
    expect(csvText).toContain('HFrEF')
    expect(csvText).toContain('Cohorts overlap; a patient can appear in more than one.')

    const pdf = await api.get(`admin/reports/cohorts.pdf?${q}`)
    expect(pdf.ok()).toBeTruthy()
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')

    await tc.resetUser(james.id)
    await api.dispose()
    await tc.dispose()
  })

  // ── 33.8 — 90-day Adherence: report shape + CSV labels + downloads ────────
  //
  // Adherence is driven by per-check-in medicationTaken / missedDoses on
  // JournalEntry, which no test-control endpoint can set today — so this
  // asserts the report's shape + CSV structure + download integrity rather
  // than a seeded adherence %. (The numeric math is unit-covered in
  // backend/src/reports/adherence.service.spec.ts.)
  test('33.8 — Adherence returns the documented shape and renders CSV/PDF', async ({}, testInfo) => {
    testInfo.setTimeout(60_000)
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const q = `practiceId=${encodeURIComponent(SEED_PRACTICE_ID)}`

    const data = (await (await api.get(`admin/reports/adherence?${q}`)).json()).data
    expect(data.windowDays, 'default 90-day look-back').toBe(90)
    expect(typeof data.targetPct).toBe('number')
    expect(Array.isArray(data.byPatient)).toBeTruthy()
    for (const k of [
      'patientsWithMeds',
      'patientsReporting',
      'practiceAdherencePct',
      'patientsBelowTarget',
      'patientsNoData',
      'totalDueCheckIns',
      'totalTakenCheckIns',
      'totalMissedDoses',
    ]) {
      expect(data.overall, `overall.${k}`).toHaveProperty(k)
    }

    const csv = await api.get(`admin/reports/adherence.csv?${q}`)
    expect(csv.ok()).toBeTruthy()
    const csvText = await csv.text()
    expect(csvText).toContain('SUMMARY')
    expect(csvText).toContain('BY PATIENT')
    expect(csvText).toContain('Practice adherence')

    const pdf = await api.get(`admin/reports/adherence.pdf?${q}`)
    expect(pdf.ok()).toBeTruthy()
    expect((await pdf.body()).subarray(0, 4).toString()).toBe('%PDF')

    await api.dispose()
  })
})
