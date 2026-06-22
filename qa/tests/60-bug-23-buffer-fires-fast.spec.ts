import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { newTestControl } from '../helpers/test-control.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'
import { randomUUID } from 'node:crypto'

/**
 * Bug 23 — per-pathway engine-evaluation deferral. The FE buffer already gives
 * the patient a 5-min on-device edit window before "I'm good"; the old backend
 * single-reading hold (released only by the every-2-min session-finalize cron)
 * added a SECOND 5-min window, so a buffer-committed alert fired 5-10 min
 * after submit. With BUFFER_SKIPS_DEFER on, a `closeSession` commit is finalized
 * at create — the engine fires immediately and the edit-window badge is hidden.
 *
 * API-driven (mirrors the exact buffer-commit payload) so it's deterministic and
 * doesn't depend on the 16-step wizard. Uses paul.davis — CAD, non-AFib, post-
 * Day-3 (so the single-reading hold genuinely applies when the flag is off).
 */
test.describe('Bug 23 — buffer commit fires fast', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write test — gated behind RUN_WRITE_TESTS=1 (creates readings)',
  )

  test('chat/voice-style reading (no closeSession) keeps the 5-min edit-window defer', async () => {
    const api = await authedApi(API_BASE_URL, PATIENTS.paul.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 145,
          diastolicBP: 85,
          pulse: 72,
          position: 'SITTING',
          source: 'manual',
          sessionId: randomUUID(),
          medicationTaken: true,
        },
      })
      expect(res.status()).toBe(202)
      const entry = (await res.json()).data
      // No closeSession → the engine-eval defer (FE edit-window badge) is set
      // ~5 min ahead. Flag-independent: chat/voice never fast-fire.
      expect(entry.engineEvaluationDeferredUntil).toBeTruthy()
      expect(
        new Date(entry.engineEvaluationDeferredUntil).getTime(),
      ).toBeGreaterThan(Date.now())
    } finally {
      await api.dispose()
    }
  })

  test('buffer commit (closeSession) fires immediately when BUFFER_SKIPS_DEFER is on', async () => {
    // Fresh ENROLLED stamp -> enrolledAt = now >= CAD Q2 rollout anchor, so
    // paul's CAD default sbpUpperTarget resolves to 140 and 146/86 fires
    // RULE_CAD_HIGH. Without it paul's seed enrolledAt is null -> ramp off ->
    // upper 160 -> nothing fires -> the fast-fire poll below times out.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const paul = await tc.findUser(PATIENTS.paul.email)
    await tc.setEnrollment(paul.id, 'ENROLLED')
    await tc.dispose()
    const api = await authedApi(API_BASE_URL, PATIENTS.paul.email)
    try {
      const res = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 146,
          diastolicBP: 86,
          pulse: 73,
          position: 'SITTING',
          source: 'manual',
          sessionId: randomUUID(),
          closeSession: true,
          medicationTaken: true,
        },
      })
      expect(res.status()).toBe(202)
      const entry = (await res.json()).data

      // Probe the backend's actual flag state via the entry it returns — the
      // flag lives in the backend process, not this runner. CI default is off.
      if (entry.engineEvaluationDeferredUntil != null) {
        test.skip(
          true,
          'BUFFER_SKIPS_DEFER is off on this backend — fast-fire not enabled',
        )
        return
      }

      // Flag ON: defer nulled (badge hidden) AND the alert fires now — no waiting
      // out the single-reading hold + cron.
      expect(entry.engineEvaluationDeferredUntil).toBeNull()
      await expect
        .poll(
          async () => {
            const list = await api.get('daily-journal/alerts')
            const alerts = ((await list.json()).data ?? []) as Array<{
              journalEntryId: string
            }>
            return alerts.some((a) => a.journalEntryId === entry.id)
          },
          { timeout: 8_000, message: 'alert dispatched without a cron tick' },
        )
        .toBe(true)
    } finally {
      await api.dispose()
    }
  })
})
