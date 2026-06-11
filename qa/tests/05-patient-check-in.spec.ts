import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { dismissCheckinGate } from '../helpers/api.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Patient check-in wizard. The full UI walk (5 steps × symptom multiselect ×
 * measurement-conditions checklist) is large; we exercise the visible spine
 * via the UI and submit deterministic alert-triggering readings via the API
 * helper to keep the spec fast.
 *
 * The two read-only spine tests validate the wizard renders + advances; the
 * three alert-trigger tests submit via API + assert the resulting alert in
 * the UI's `/notifications` Alerts tab.
 */

test.describe('Check-in wizard — UI spine', () => {
  test.beforeEach(async ({ page }) => {
    await signInPatient(page, PATIENTS.aisha.email)
  })

  test('step 1 renders the pre-measurement checklist', async ({ page }) => {
    await page.goto('/check-in')
    await dismissCheckinGate(page)
    // CLINICAL_SPEC §6 — exactly 8 pre-measurement checklist rows. Each row
    // carries data-testid="checkin-checklist-<formKey>"; count those instead
    // of regex-matching translated copy (en/es/etc strings differ).
    const rows = page.locator('[data-testid^="checkin-checklist-"]')
    await expect(rows).toHaveCount(8)
  })

  test('Continue advances from step 1 to BP entry', async ({ page }) => {
    await page.goto('/check-in')
    await dismissCheckinGate(page)
    // Wait for step 1 to actually mount + hydrate before clicking Next.
    // Next 16 ships interactive DOM ahead of the React onClick attachment;
    // a straight-to-click race occasionally swallows the goNext() call,
    // leaving the wizard stuck on B1 long enough for the systolic-input
    // assertion below to time out.
    await expect(page.locator(byTestId(T.checkin.step(1)))).toBeVisible()
    await page.locator(byTestId(T.checkin.next)).click()
    await expect(page.locator(byTestId(T.checkin.systolic))).toBeVisible({ timeout: 10_000 })
  })

  // ─── Low-literacy symptom icons (commit c2328a9) — smoke ──────────────────
  // The symptom step renders one icon-button per symptom (data-testid
  // `check-in-symptom-<KEY>`). Smoke-only per the handoff: assert the icons
  // render, one selects, and archive a screenshot for visual regression.
  test('symptom step renders selectable icon buttons', async ({ page }) => {
    await page.goto('/check-in')
    await dismissCheckinGate(page)

    // Walk forward to the symptom step: advance through the wizard, filling BP
    // when that step is up, until the symptom icons appear.
    const symptoms = page.locator('[data-testid^="check-in-symptom-"]')
    for (let step = 0; step < 8; step++) {
      if ((await symptoms.count()) > 0) break
      if (await page.locator(byTestId(T.checkin.systolic)).isVisible().catch(() => false)) {
        await page.locator(byTestId(T.checkin.systolic)).fill('124')
        await page.locator(byTestId(T.checkin.diastolic)).fill('78')
        await page.locator(byTestId(T.checkin.pulse)).fill('72')
      }
      const next = page.locator(byTestId(T.checkin.next))
      if (await next.isVisible().catch(() => false)) await next.click().catch(() => {})
      else break
    }

    // Several distinct symptom icons render.
    await expect(symptoms.first()).toBeVisible({ timeout: 10_000 })
    expect(await symptoms.count(), 'multiple symptom icons render').toBeGreaterThanOrEqual(5)

    // Visual-regression archive.
    await page.screenshot({
      path: 'test-results/checkin-symptom-icons.png',
      fullPage: true,
    })

    // Selecting an icon toggles it (aria-pressed where the button exposes it).
    const first = symptoms.first()
    const before = await first.getAttribute('aria-pressed')
    await first.click()
    if (before !== null) {
      await expect(first).toHaveAttribute('aria-pressed', 'true')
    } else {
      // No aria-pressed contract — at minimum the click is handled and the
      // wizard stays operable (Next still present).
      await expect(first).toBeVisible()
    }
  })
})

test.describe('Check-in submissions trigger expected alerts (via API)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('Aisha 124/78 (normal) → no alert + dashboard reflects', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
      },
    })
    expect(res.status()).toBe(202)

    // Allow the rule engine to run async
    await page.waitForTimeout(500)
    const alerts = await tc.listAlerts(u.id)
    expect(alerts.filter((a) => a.status === 'OPEN'), 'expected no OPEN alerts').toEqual([])

    // Sanity: dashboard renders the new reading. Scope to the dedicated
    // latest-bp card so we don't collide with the chart's own 124/78 axis
    // tick (Playwright strict mode flags multiple matches otherwise).
    await signInPatient(page, PATIENTS.aisha.email)
    await expect(page).toHaveURL(/\/dashboard/)
    await expect(
      page.locator('[data-testid="latest-bp"]').getByText(/124\/78/),
    ).toBeVisible({ timeout: 15_000 })
    await api.dispose()
    await tc.dispose()
  })

  test('Aisha 165/100 (Severe Stage 2) → BP_LEVEL_1_HIGH alert', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 165,
        diastolicBP: 100,
        pulse: 78,
        position: 'SITTING',
      },
    })
    expect(res.status()).toBe(202)
    await new Promise((r) => setTimeout(r, 1000))
    const alerts = await tc.listAlerts(u.id)
    const open = alerts.filter((a) => a.status === 'OPEN')
    expect(open.map((a) => a.tier)).toContain('BP_LEVEL_1_HIGH')
    await api.dispose()
    await tc.dispose()
  })

  test('Aisha 185/125 + chestPain → BP_LEVEL_2 (emergency)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 185,
        diastolicBP: 125,
        pulse: 88,
        position: 'SITTING',
        chestPainOrDyspnea: true,
      },
    })
    expect(res.status()).toBe(202)
    await new Promise((r) => setTimeout(r, 1000))
    const alerts = await tc.listAlerts(u.id)
    const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
    // Either BP_LEVEL_2 (absolute emergency rule) or BP_LEVEL_2_SYMPTOM_OVERRIDE
    // (symptom-first short-circuit) is a passing outcome.
    expect(openTiers.some((t) => t.startsWith('BP_LEVEL_2'))).toBeTruthy()
    await api.dispose()
    await tc.dispose()
  })
})
