import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Step 4 regression guard — symptom-override emergencies BYPASS Option D.
 *
 * Manisha 2026-06-12 Q2 (Edit-Window + Session Policy sign-off) is a HYBRID:
 *   • BP ≥180/120 WITHOUT symptoms → Option D (client-side retake-to-confirm).
 *   • BP ≥180/120 WITH a target-organ-damage symptom, OR a symptom at any BP
 *     → Option A: fire IMMEDIATELY. A patient reporting chest pain must never
 *     be asked to "sit calmly and retake".
 *
 * The Option D retake is a CLIENT-side decision made in CheckIn before
 * submission; the symptom-override emergency is a BACKEND pre-gate rule that
 * fires on a single reading regardless of preDay3 / session size. This spec
 * locks the invariant that the symptom path fires immediately and is never
 * held — so the Step-3 Option D work (now landed) can't have entangled it.
 *
 * Verified end-to-end via the public daily-journal POST (the same call the
 * check-in submit handler makes). No history seeding is needed — the symptom
 * override is a pre-gate emergency that fires on the first reading.
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

test.describe('Step 4 — symptom-override bypasses Option D (Manisha 2026-06-12 Q2)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('emergency BP (195/120) + chest pain → BP_LEVEL_2_SYMPTOM_OVERRIDE fires immediately, not held', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          pulse: 88,
          position: 'SITTING',
          sessionId: randomUUID(),
          chestPainOrDyspnea: true,
        },
      })
      expect(res.status()).toBe(202)
      const body = await res.json()
      // A symptom emergency is never routed into the Option D retake flow.
      expect(
        body.pendingEmergencyConfirmation,
        'symptom emergency must NOT enter Option D (no held confirmation)',
      ).not.toBe(true)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'),
      )
      const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers.includes('BP_LEVEL_2_SYMPTOM_OVERRIDE'),
        `expected BP_LEVEL_2_SYMPTOM_OVERRIDE to fire immediately on one reading (got: [${openTiers.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('sub-emergency BP (150/95) + chest pain → symptom override still fires immediately (independent of the BP-only Option D band)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 150,
          diastolicBP: 95,
          pulse: 80,
          position: 'SITTING',
          sessionId: randomUUID(),
          chestPainOrDyspnea: true,
        },
      })
      expect(res.status()).toBe(202)
      const body = await res.json()
      expect(body.pendingEmergencyConfirmation).not.toBe(true)

      // BP is below the 180/120 emergency band, so the ONLY way an emergency
      // tier can appear is the symptom override — proving the symptom path is
      // independent of the BP-only retake trigger.
      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE'),
      )
      const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers.includes('BP_LEVEL_2_SYMPTOM_OVERRIDE'),
        `expected symptom override to fire at sub-emergency BP (got: [${openTiers.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
