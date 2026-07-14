import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { waitForAlerts } from '../helpers/api.js'

/**
 * F32 — patient-visible Tier 2 medication-discrepancy alerts.
 *
 * Bug: the patient /notifications alerts top-tab stripped ALL
 * TIER_2_DISCREPANCY rows ("admin-only"), so a RULE_MEDICATION_MISSED alert —
 * which the rule engine DOES populate with a patient-facing message — never
 * surfaced for the patient. The detail page also soft-404'd it.
 *
 * Fix: a Tier 2 alert with a non-empty patientMessage is patient-facing and
 * must render on the /alerts surface (bucketed under the "Info" chip) and on
 * its detail page.
 *
 * This spec fires a real RULE_MEDICATION_MISSED alert (2-of-3-day miss window)
 * on Aisha, verifies the DeviationAlert row carries tier=TIER_2_DISCREPANCY +
 * a non-null patientMessage, then asserts the patient app actually shows it.
 */

async function seedHistoryToClearPreDay3(
  tc: TestControl,
  userId: string,
): Promise<void> {
  const now = Date.now()
  const readings = Array.from({ length: 8 }).map((_, i) => ({
    measuredAt: new Date(now - (i + 1) * 24 * 60 * 60 * 1000).toISOString(),
    systolicBP: 120,
    diastolicBP: 78,
    pulse: 72,
    sessionId: randomUUID(),
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

test.describe('F32 — Tier 2 medication-discrepancy is patient-visible', () => {
  test.use({
    viewport: { width: 1280, height: 800 },
    actionTimeout: 60_000,
    navigationTimeout: 60_000,
  })
  test.setTimeout(180_000)

  test('RULE_MEDICATION_MISSED renders on the patient /alerts surface', async ({
    page,
  }, testInfo) => {
    const apiBase = process.env.API_BASE_URL ?? 'http://localhost:4000'

    // ── Setup: clean Aisha, clear preDay3, attach a verified ARB ───────────
    const tc = await newTestControl(apiBase, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(aisha.id)
    await seedHistoryToClearPreDay3(tc, aisha.id)
    await tc.setUserMedication(aisha.id, {
      drugName: 'Losartan',
      drugClass: 'ARB',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(apiBase, PATIENTS.aisha.email, 'patient')

    // ── Fire RULE_MEDICATION_MISSED via the 2-of-3-day miss window ─────────
    const day = 24 * 60 * 60 * 1000
    const now = Date.now()
    for (const offsetDays of [2, 1]) {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date(now - offsetDays * day).toISOString(),
          systolicBP: 124,
          diastolicBP: 78,
          pulse: 72,
          position: 'SITTING',
          medicationTaken: false,
          missedMedications: [
            { drugName: 'Losartan', drugClass: 'ARB', missedDoses: 1, reason: 'FORGOT' },
          ],
          sessionId: randomUUID(),
        },
      })
      expect(res.status(), `POST failed: ${await res.text()}`).toBe(202)
    }
    const trigger = await api.post('daily-journal', {
      data: {
        measuredAt: new Date(now).toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        medicationTaken: true,
        sessionId: randomUUID(),
      },
    })
    expect(trigger.status()).toBe(202)

    // ── DB verification — the Tier 2 alert exists WITH a patient message ───
    const alerts = await waitForAlerts(tc, aisha.id, (xs) =>
      xs.some(
        (a) => a.status === 'OPEN' && a.ruleId === 'RULE_MEDICATION_MISSED',
      ),
    )
    const medAlert = alerts.find((a) => a.ruleId === 'RULE_MEDICATION_MISSED')!
    expect(medAlert, 'RULE_MEDICATION_MISSED row exists').toBeDefined()
    expect(medAlert.tier).toBe('TIER_2_DISCREPANCY')
    expect(
      typeof medAlert.patientMessage === 'string' &&
        medAlert.patientMessage.trim().length > 0,
      'Tier 2 med-missed carries a patient-facing message',
    ).toBe(true)

    // ── UI: sign in (lands on /dashboard), then SPA-navigate to the alerts
    // top-tab via the persistent navbar notification bell (P2 removed the
    // dashboard recent-alerts strip + its "See all" link). page.goto would
    // hard-navigate and lose the marker cookie under Playwright + Next-16-dev;
    // a <Link> click preserves auth in memory. /notifications defaults to the
    // Alerts top-tab. ──
    await signInPatient(page, PATIENTS.aisha.email)
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 })
    await page.locator('[data-testid="notification-bell"]').click()
    await page.waitForURL(/\/notifications/, { timeout: 30_000 })
    await page.waitForLoadState('networkidle').catch(() => {})

    const filterRow = page.locator('[data-testid="alerts-tier-filter"]')
    await expect(filterRow).toBeVisible({ timeout: 15_000 })

    const cardCount = () =>
      page.locator('[data-testid^="notification-row-"]:visible').count()

    // F32 — the med-missed card is visible on the default ALL view (pre-fix it
    // was stripped out entirely and the patient saw nothing).
    expect(
      await cardCount(),
      'ALL chip shows the patient-visible Tier 2 med-missed alert',
    ).toBeGreaterThanOrEqual(1)
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-01-all.png`,
      fullPage: true,
    })

    // It buckets under the Info chip per the fix.
    await page.locator('[data-testid="alerts-tier-filter-info"]').click()
    await page.waitForTimeout(300)
    expect(
      await cardCount(),
      'Info chip surfaces the medication-discrepancy alert',
    ).toBeGreaterThanOrEqual(1)
    await page.screenshot({
      path: `reports/screenshots/${testInfo.title}-02-info.png`,
      fullPage: true,
    })

    // The patient-facing medication wording is on the page.
    expect(
      await page.locator('body').innerText(),
      'patient sees the medication check-in message',
    ).toMatch(/missed|medicine|medication/i)

    await tc.dispose()
  })
})
