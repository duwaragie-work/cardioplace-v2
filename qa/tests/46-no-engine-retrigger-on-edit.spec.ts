import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 9 — the rule engine must NOT re-evaluate on a patient EDIT (signed CTO
 * 2026-06-09 no-re-trigger policy; Manisha 2026-06-12 Q2 "we cannot un-page").
 *
 * Strongest behavioral guard: a benign reading that fires NO alert, edited UP
 * into emergency range, must STILL fire no alert — because the edit is
 * audit-log-only and never re-triggers the engine. (Under the old behavior the
 * ENTRY_UPDATED listener would re-evaluate and fire BP_LEVEL_2.) The corrected
 * value only reaches the engine when it next evaluates a NEW entry.
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

async function expectNoAlerts(
  tc: TestControl,
  userId: string,
  predicate: (alerts: AlertRow[]) => boolean,
  stabilityMs = 3000,
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

test.describe('Bug 9 — no engine re-trigger on patient edit (CTO 2026-06-09)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('editing a benign reading UP into emergency range fires NO alert (no re-trigger)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Benign single reading — no alert (held single non-emergency reading).
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 120,
          diastolicBP: 80,
          pulse: 70,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)
      const entryId = (await res.json()).data.id

      // No alert from the benign reading.
      const before = await expectNoAlerts(tc, u.id, (xs) => xs.some((a) => a.status === 'OPEN'))
      expect(before.filter((a) => a.status === 'OPEN')).toEqual([])

      // Patient edits the reading UP into emergency range. Under the no-re-trigger
      // policy this must NOT cause the engine to fire.
      const edit = await api.put(`daily-journal/${entryId}`, {
        data: { systolicBP: 195, diastolicBP: 120 },
      })
      expect(edit.status()).toBeGreaterThanOrEqual(200)
      expect(edit.status()).toBeLessThan(300)

      // No emergency (or any) alert fires off the edit.
      const after = await expectNoAlerts(tc, u.id, (xs) => xs.some((a) => a.status === 'OPEN'))
      const openTiers = after.filter((a) => a.status === 'OPEN').map((a) => a.tier)
      expect(
        openTiers,
        `editing into emergency range must NOT re-trigger the engine (got: [${openTiers.join(', ')}])`,
      ).toEqual([])
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
