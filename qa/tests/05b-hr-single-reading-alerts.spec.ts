import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * NIVA_HR doc — the HR emergency floors (HR<40 absolute bradycardia, HR>130
 * severe tachycardia) must fire on a SINGLE reading for an ESTABLISHED,
 * non-AFib patient. Previously they sat behind the Cluster 6 Q2 single-reading
 * non-emergency gate and only materialized on a 2nd reading / finalize.
 *
 * The "established" part is load-bearing: a freshly-reset patient is in
 * pre-Day-3 mode (lifetime readings < 7), where single readings already fire —
 * which is exactly why the regression was invisible. We seed 7 prior readings
 * so preDay3Mode is false, then submit ONE HR reading and assert the alert.
 *
 * Gated behind RUN_WRITE_TESTS (seeds + mutates the seed patient).
 */

const DAY = 24 * 60 * 60 * 1000

async function seedEstablishedHistory(tc: any, userId: string) {
  const now = Date.now()
  const readings = Array.from({ length: 7 }, (_, i) => ({
    measuredAt: new Date(now - (i + 1) * DAY).toISOString(),
    systolicBP: 120,
    diastolicBP: 78,
    pulse: 72,
  }))
  await tc.seedReadingsAtTime(userId, readings)
}

test.describe('HR emergency floors fire on a single reading (established patient)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (seeds + mutates the seed patient)',
  )

  test('established single reading HR 38 → RULE_BRADY_ABSOLUTE (Tier 1) fires immediately', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedEstablishedHistory(tc, u.id)
    await tc.setUserCondition(u.id, 'hasAFib', false)
    await tc.setUserCondition(u.id, 'hasBradycardia', true)
    try {
      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      const res = await api.post('daily-journal', {
        data: { measuredAt: new Date().toISOString(), systolicBP: 118, diastolicBP: 72, pulse: 38, position: 'SITTING' },
      })
      expect(res.status()).toBe(202)
      await new Promise((r) => setTimeout(r, 1000))

      const alerts = await tc.listAlerts(u.id)
      const open = alerts.filter((a) => a.status === 'OPEN')
      expect(open.map((a) => a.ruleId)).toContain('RULE_BRADY_ABSOLUTE')
      expect(open.map((a) => a.tier)).toContain('TIER_1_CONTRAINDICATION')
      await api.dispose()

      // UI: the alert surfaces on the patient dashboard.
      await signInPatient(page, PATIENTS.aisha.email)
      await expect(page.locator(byTestId(T.dashboard.activeAlertBanner))).toBeVisible({ timeout: 15_000 })
    } finally {
      await tc.setUserCondition(u.id, 'hasBradycardia', false)
      await tc.dispose()
    }
  })

  test('established single reading HR 135 → RULE_TACHY_HR fires immediately', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedEstablishedHistory(tc, u.id)
    await tc.setUserCondition(u.id, 'hasAFib', false)
    await tc.setUserCondition(u.id, 'hasTachycardia', true)
    try {
      const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
      const res = await api.post('daily-journal', {
        data: { measuredAt: new Date().toISOString(), systolicBP: 124, diastolicBP: 78, pulse: 135, position: 'SITTING' },
      })
      expect(res.status()).toBe(202)
      await new Promise((r) => setTimeout(r, 1000))

      const alerts = await tc.listAlerts(u.id)
      const open = alerts.filter((a) => a.status === 'OPEN')
      expect(open.map((a) => a.ruleId)).toContain('RULE_TACHY_HR')
      await api.dispose()
    } finally {
      await tc.setUserCondition(u.id, 'hasTachycardia', false)
      await tc.dispose()
    }
  })
})
