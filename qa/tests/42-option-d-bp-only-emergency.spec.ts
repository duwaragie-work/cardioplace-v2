import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Option D — retake-to-confirm for BP-only emergencies (Manisha 2026-06-12 Q2).
 *
 * A BP ≥180/120 reading WITHOUT symptoms is held (AWAITING — no alert pages
 * anyone) and the patient is asked to take a confirmatory second reading.
 * Three outcomes, all exercised end-to-end through the public daily-journal
 * endpoints (the same calls the check-in submit handler makes):
 *
 *   1. First held → NO alert during the stability window (the whole point —
 *      a single extreme reading must not page on its own).
 *   2. Confirmatory reading STILL ≥180/120 → RULE_ABSOLUTE_EMERGENCY (BP L2).
 *   3. Confirmatory reading BELOW threshold → RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL
 *      (Tier 3 informational); NO BP Level 2 fires.
 *   4. Patient declines (decline-confirmation) → RULE_UNCONFIRMED_EMERGENCY
 *      (Tier 1, PROVIDER-ONLY: empty patient message), locked physician wording.
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

async function waitForAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  timeoutMs = 12_000,
): Promise<AlertRow[]> {
  const deadline = Date.now() + timeoutMs
  let last: AlertRow[] = []
  while (Date.now() < deadline) {
    last = await tc.listAlerts(userId)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 200))
  }
  return last
}

async function expectNoAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  stabilityMs = 2500,
): Promise<AlertRow[]> {
  const start = Date.now()
  let last: AlertRow[] = []
  while (Date.now() - start < stabilityMs) {
    last = await tc.listAlerts(userId)
    if (predicate(last)) return last
    await new Promise((r) => setTimeout(r, 300))
  }
  return last
}

test.describe('Option D — BP-only emergency retake-to-confirm (Manisha 2026-06-12 Q2)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('first reading is HELD (no alert), confirmatory ≥180/120 → RULE_ABSOLUTE_EMERGENCY (BP Level 2)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      // Begin — held first-of-pair.
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          pulse: 88,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstBody = await first.json()
      expect(firstBody.pendingEmergencyConfirmation).toBe(true)
      const firstId = firstBody.data.id

      // Held — no alert of any tier fires on the lone AWAITING reading.
      const held = await expectNoAlerts(tc, u.id, (xs) => xs.some((a) => a.status === 'OPEN'))
      expect(held.filter((a) => a.status === 'OPEN')).toEqual([])

      // Confirmatory reading, still emergency range.
      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 190,
          diastolicBP: 121,
          pulse: 90,
          position: 'SITTING',
          sessionId,
          confirmsEntryId: firstId,
        },
      })
      expect(second.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2'),
      )
      const l2 = alerts.filter((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2')
      expect(l2.length, `expected a confirmed BP Level 2 emergency`).toBeGreaterThan(0)
      expect(l2[0]!.ruleId).toBe('RULE_ABSOLUTE_EMERGENCY')
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('confirmatory reading BELOW threshold → RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL (Tier 3), no BP Level 2', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      const second = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 135,
          diastolicBP: 85,
          position: 'SITTING',
          sessionId,
          confirmsEntryId: firstId,
        },
      })
      expect(second.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL'),
      )
      const confirmedNormal = alerts.filter(
        (a) => a.ruleId === 'RULE_EMERGENCY_RANGE_CONFIRMED_NORMAL',
      )
      expect(confirmedNormal.length, 'expected a Tier 3 confirmed-normal flag').toBeGreaterThan(0)
      expect(confirmedNormal[0]!.tier).toBe('TIER_3_INFO')
      // No emergency ladder — the confirmatory reading cleared it.
      expect(alerts.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2')).toBeFalsy()
      // Provider-only physician message names both readings.
      expect(confirmedNormal[0]!.physicianMessage).toContain('195/120')
      expect(confirmedNormal[0]!.physicianMessage).toContain('135/85')
      expect(confirmedNormal[0]!.patientMessage).toBeFalsy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('patient declines → RULE_UNCONFIRMED_EMERGENCY (Tier 1, provider-only) with locked wording', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId,
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)
      const firstId = (await first.json()).data.id

      // Patient declines the retake.
      const decline = await api.post(`daily-journal/${firstId}/decline-confirmation`)
      expect(decline.status()).toBeGreaterThanOrEqual(200)
      expect(decline.status()).toBeLessThan(300)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.ruleId === 'RULE_UNCONFIRMED_EMERGENCY'),
      )
      const unconfirmed = alerts.filter((a) => a.ruleId === 'RULE_UNCONFIRMED_EMERGENCY')
      expect(unconfirmed.length, 'expected a Tier 1 unconfirmed-emergency flag').toBeGreaterThan(0)
      const a = unconfirmed[0]!
      expect(a.tier).toBe('TIER_1_CONTRAINDICATION')
      // Locked Manisha wording + provider-only (no patient message).
      expect(a.physicianMessage).toContain(
        'Single unconfirmed emergency-range reading',
      )
      expect(a.physicianMessage).toContain('195/120 mmHg')
      expect(a.patientMessage).toBeFalsy()
      // No emergency (BP Level 2) on the lone unconfirmed reading.
      expect(alerts.some((x) => x.status === 'OPEN' && x.tier === 'BP_LEVEL_2')).toBeFalsy()

      // Bug 12 — the provider-only flag must NOT appear on the PATIENT's own
      // alerts feed (it has an empty patientMessage). The patient endpoint
      // filters it server-side regardless of tier.
      const feedRes = await api.get('daily-journal/alerts')
      expect(feedRes.status()).toBe(200)
      const feed = await feedRes.json()
      const patientAlerts = (feed.data ?? feed) as Array<{ ruleId?: string | null }>
      expect(
        patientAlerts.some((x) => x.ruleId === 'RULE_UNCONFIRMED_EMERGENCY'),
        'provider-only RULE_UNCONFIRMED_EMERGENCY must not leak into the patient alerts feed',
      ).toBeFalsy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
