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
 *   • BP ≥180/120 WITHOUT symptoms → Option D (client-side retake-to-confirm,
 *     reading not submitted until a confirmatory reading / decline / 5-min
 *     expiry). Built in Step 3.
 *   • BP ≥180/120 WITH a target-organ-damage symptom, OR a symptom at any BP
 *     → Option A: fire IMMEDIATELY. A patient reporting chest pain must never
 *     be asked to "sit calmly and retake".
 *
 * Option D is not built yet (Step 3), so the retake screen does not exist and
 * every reading still submits immediately. This spec locks the invariant that
 * Step 3 MUST preserve: a symptom-bearing reading fires an emergency alert
 * immediately on a single reading and is never held for a confirmatory retake.
 *
 * Verified end-to-end via the public daily-journal POST (the same call the
 * check-in submit handler makes). The "no retake / no hold" signal at the API
 * layer is: response.pendingSecondReading is NOT true (the single-reading hold
 * the non-emergency Q2 flow uses), and a BP_LEVEL_2_SYMPTOM_OVERRIDE alert is
 * OPEN within the stability window.
 *
 * When Option D lands, add the UI assertion (emergency BP + chest pain →
 * straight to the confirmation screen, no Screen A) alongside these.
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

// Clear preDay3 (readingCount ≥ 7) so the single-reading HOLD would normally
// engage for a non-emergency reading at this point — making the "emergency
// bypasses the hold" assertion meaningful rather than incidentally true
// because the patient is still pre-baseline.
async function seedHistoryToClearPreDay3(tc: TestControl, userId: string): Promise<void> {
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

  test('emergency BP (195/120) + chest pain → BP_LEVEL_2_SYMPTOM_OVERRIDE fires immediately, no hold', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
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
      // No single-reading hold: a symptom emergency is never deferred for a
      // confirmatory retake (that is what Option D would do to a NO-symptom
      // emergency only).
      expect(
        body.pendingSecondReading,
        'symptom emergency must NOT be held for a second reading',
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
    await seedHistoryToClearPreDay3(tc, u.id)
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
      expect(body.pendingSecondReading).not.toBe(true)

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
