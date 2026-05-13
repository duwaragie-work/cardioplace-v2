import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Seed 7 backdated baseline readings so the user clears preDay3Mode
 * (which requires `readingCount >= 7` per ProfileResolverService.PRE_DAY_3_MIN_READINGS).
 * Without this, resetUser leaves the user at 0 readings → engine takes the
 * preDay3 path with looser thresholds, and the Cluster 6 Q2 gate (which is
 * gated on `!preDay3Mode`) never engages.
 *
 * Each backdated reading uses a unique sessionId so they don't collide with
 * the current-session anchor + averaging.
 */
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

/**
 * Cluster 6 engine coverage via the API (Manisha 5/9 sign-off).
 *
 * Drives the rule engine through the public daily-journal endpoints + the
 * Q2 finalize endpoint. Backend Jest covers the rule predicates in isolation;
 * these tests assert the engine + persistence + axis pipeline cooperate
 * end-to-end so a real patient POST produces the expected DeviationAlert
 * rows.
 *
 *  Q2 — session averaging gate
 *   1. Single-reading non-emergency: response carries
 *      `pendingSecondReading: true` and NO L1 alert is open (held).
 *   2. Finalize endpoint flips singleReadingFinalized → previously-held L1
 *      alert fires.
 *   3. Second reading in same sessionId → averaged → L1 alert fires.
 *   4. Emergency single-reading still bypasses the gate (BP_LEVEL_2 fires
 *      on one reading).
 *  Q4 — multi-rule co-fire is not consolidated
 *   5. Priya (pregnant + ACE) at 175/115 → both pregnancy L2 emergency
 *      AND ACE/ARB contraindication rows fire on one reading.
 *
 * Bucket B personas (Olive, Iris, etc.) intentionally NOT used here — they
 * may not exist in every dev DB. We compose the scenarios on the stable
 * seed personas (Aisha as control, Priya as pregnant/ACE archetype).
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

/**
 * Poll listAlerts until `predicate` returns true OR timeout elapses.
 * Returns the alert array as last observed.
 *
 * Replaces fixed-sleep waits: alert persistence under serializable txn +
 * deadlock retry can take 2-5s under load, which the previous fixed wait
 * routinely missed and produced flaky "got: []" failures even though the
 * backend log showed "Alert fired".
 */
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

/**
 * Inverse of waitForAlerts — assert that NO alert matching `predicate`
 * exists during a short stability window. For the "held" assertion, we
 * need to confirm the engine had time to evaluate and chose NOT to fire,
 * not just that we read before it persisted.
 */
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

test.describe('Cluster 6 — engine via API (Manisha 5/9)', () => {
  // All five tests mutate journal state. Gated behind RUN_WRITE_TESTS=1
  // following the convention of spec 05.
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('Q2 — single non-emergency reading is HELD; response carries pendingSecondReading=true', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 165,
          diastolicBP: 100,
          pulse: 75,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)
      const body = await res.json()
      expect(body.pendingSecondReading, 'pendingSecondReading hint flips the UI prompt').toBe(true)

      // Verify no OPEN alert appears during a stability window — the engine
      // had time to evaluate and chose to hold per the Q2 gate.
      const finalAlerts = await expectNoAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN'),
      )
      const openTiers = finalAlerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers,
        `expected no non-emergency alerts on a single reading (got: [${openTiers.join(', ')}])`,
      ).toEqual([])
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Q2 — finalize endpoint fires the held L1 alert on a single reading', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 165,
          diastolicBP: 100,
          pulse: 75,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)
      const created = await res.json()
      const entryId = created.data.id

      // Held — confirm no L1 fires during stability window.
      const heldAlerts = await expectNoAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      )
      expect(
        heldAlerts.filter((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      ).toEqual([])

      // Simulate the 5-min timeout that the frontend posts when no second
      // reading arrives.
      const fin = await api.post(`daily-journal/${entryId}/finalize-single-reading`)
      expect(
        fin.status(),
        `finalize endpoint failed: ${await fin.text()}`,
      ).toBeGreaterThanOrEqual(200)
      expect(fin.status()).toBeLessThan(300)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      )
      const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers.some((t) => t === 'BP_LEVEL_1_HIGH'),
        `expected BP_LEVEL_1_HIGH after finalize (got: [${openTiers.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Q2 — second reading in same sessionId triggers averaged L1 alert (no finalize needed)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const sessionId = randomUUID()
      const t0 = Date.now()

      const r1 = await api.post('daily-journal', {
        data: {
          measuredAt: new Date(t0).toISOString(),
          systolicBP: 165,
          diastolicBP: 100,
          pulse: 74,
          position: 'SITTING',
          sessionId,
        },
      })
      expect(r1.status()).toBe(202)
      // Still held after first reading.
      const heldAfterFirst = await expectNoAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      )
      expect(
        heldAfterFirst.filter((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      ).toEqual([])

      const r2 = await api.post('daily-journal', {
        data: {
          measuredAt: new Date(t0 + 60_000).toISOString(),
          systolicBP: 165,
          diastolicBP: 100,
          pulse: 76,
          position: 'SITTING',
          sessionId,
        },
      })
      expect(r2.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'),
      )
      const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers.some((t) => t === 'BP_LEVEL_1_HIGH'),
        `expected BP_LEVEL_1_HIGH after second reading averaged (got: [${openTiers.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Q2 safety — absolute emergency BYPASSES the single-reading gate', async () => {
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
          diastolicBP: 130,
          pulse: 88,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)

      const alerts = await waitForAlerts(tc, u.id, (xs) =>
        xs.some((a) => a.status === 'OPEN' && a.tier.startsWith('BP_LEVEL_2')),
      )
      const openTiers = alerts.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      // L2 emergency fires regardless of session size. The single-reading
      // gate must not suppress safety-critical alerts.
      expect(
        openTiers.some((t) => t.startsWith('BP_LEVEL_2')),
        `expected BP_LEVEL_2* alert on a single emergency reading (got: [${openTiers.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })

  test('Q4 — pregnant + ACE at 175/115 fires both rows on one reading (not consolidated)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.priya.email)
    await tc.resetUser(u.id)
    await seedHistoryToClearPreDay3(tc, u.id)
    // Priya's seed archetype is "Pregnant + ACE inhibitor → Tier 1
    // contraindication". resetUser wipes journal/alert state, NOT profile
    // flags or meds, but we re-assert both defensively in case another
    // spec left her in a different state. The Q4 invariant we want to
    // exercise is the dual co-fire — both bars need to be true before
    // the 175/115 POST.
    await tc.setUserCondition(u.id, 'isPregnant', true)
    await tc.setUserMedication(u.id, {
      drugName: 'Lisinopril',
      drugClass: 'ACE_INHIBITOR',
      frequency: 'ONCE_DAILY',
      verificationStatus: 'VERIFIED',
    })
    const api = await authedApi(API_BASE_URL, PATIENTS.priya.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 175,
          diastolicBP: 115,
          pulse: 84,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)

      // Wait for both rows — ACE/ARB Tier 1 (Stage A pre-gate, fires
      // on a single reading because contraindications bypass the Q2
      // gate) AND the pregnancy L2 emergency row (Stage B).
      const alerts = await waitForAlerts(tc, u.id, (xs) => {
        const open = xs.filter((a) => a.status === 'OPEN').map((a) => a.ruleId)
        const hasAce = open.includes('RULE_PREGNANCY_ACE_ARB')
        const hasL2 = open.some((r) => /PREGNANCY_L2|STANDARD_L2|EMERGENCY/.test(r))
        return hasAce && hasL2
      })
      const ruleIds = alerts.filter((a) => a.status === 'OPEN').map((a) => a.ruleId)
      // Per Q4 — the engine MUST keep these as separate rows.
      expect(
        ruleIds,
        `expected RULE_PREGNANCY_ACE_ARB present (got: [${ruleIds.join(', ')}])`,
      ).toContain('RULE_PREGNANCY_ACE_ARB')
      expect(
        ruleIds.some((r) => /PREGNANCY_L2|STANDARD_L2|EMERGENCY/.test(r)),
        `expected an L2 emergency row co-firing with ACE/ARB (got: [${ruleIds.join(', ')}])`,
      ).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
