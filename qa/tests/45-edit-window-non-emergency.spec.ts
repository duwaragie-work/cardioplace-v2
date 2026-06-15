import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Step 2 — 5-min edit/delete window (Manisha 2026-06-12 Q1 + Q4).
 *
 * A patient-entered non-emergency reading is stamped with a server-authoritative
 * `engineEvaluationDeferredUntil` ≈ now + 5 min. The readings page reads it to
 * surface the "editable / not yet sent to your care team" affordance, and it is
 * the single source of truth for "is this reading still in its grace window?".
 *
 * Verified through the public daily-journal POST + GET (serializeEntry surfaces
 * the field on both).
 */

test.describe('Step 2 — non-emergency edit window (Manisha 2026-06-12 Q1+Q4)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (mutates seed-patient journal entries)',
  )

  test('a patient non-emergency reading carries a future engineEvaluationDeferredUntil on POST + GET', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      const before = Date.now()
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 125,
          diastolicBP: 80,
          pulse: 70,
          position: 'SITTING',
          sessionId: randomUUID(),
        },
      })
      expect(res.status()).toBe(202)
      const body = await res.json()
      const entryId = body.data.id
      const deferUntil = body.data.engineEvaluationDeferredUntil
      expect(deferUntil, 'POST response surfaces the edit-window deadline').toBeTruthy()
      const deferMs = new Date(deferUntil).getTime()
      // Roughly now + 5 min (allow generous slack for clock/latency).
      expect(deferMs).toBeGreaterThan(before + 60_000)
      expect(deferMs).toBeLessThan(before + 15 * 60_000)

      // GET surfaces the same field (drives the readings-page affordance).
      const list = await api.get('daily-journal')
      expect(list.status()).toBe(200)
      const listJson = await list.json()
      const entries = (listJson.data ?? listJson) as Array<{
        id: string
        engineEvaluationDeferredUntil?: string | null
      }>
      const found = entries.find((e) => e.id === entryId)
      expect(found, 'the new entry is in the list').toBeTruthy()
      expect(found!.engineEvaluationDeferredUntil).toBeTruthy()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
