import { expect, test } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { API_BASE_URL } from '../playwright.config.js'
import { randomUUID } from 'node:crypto'

/**
 * Bug 25 — collision prevention. The readings edit modal now rejects a duplicate
 * measuredAt inline (against the readings already in memory) before the PATCH.
 * The backend @@unique([userId, measuredAt]) → ConflictException (HTTP 409) is
 * the safety net the FE's ReadingTimeConflictError catch relies on for a reading
 * outside the loaded window or a race. This spec pins that backend guard.
 */
test.describe('Bug 25 — duplicate measuredAt is rejected (409)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write test — gated behind RUN_WRITE_TESTS=1 (creates readings)',
  )

  test('a second reading at the exact same instant returns 409', async () => {
    const api = await authedApi(API_BASE_URL, PATIENTS.paul.email)
    try {
      const measuredAt = new Date().toISOString()
      const first = await api.post('daily-journal', {
        data: {
          measuredAt,
          systolicBP: 130,
          diastolicBP: 80,
          pulse: 70,
          position: 'SITTING',
          source: 'manual',
          sessionId: randomUUID(),
          closeSession: true,
        },
      })
      expect(first.status()).toBe(202)

      // Exact-duplicate measuredAt for the same patient → unique-constraint hit.
      const dup = await api.post('daily-journal', {
        data: {
          measuredAt,
          systolicBP: 142,
          diastolicBP: 79,
          pulse: 72,
          position: 'SITTING',
          source: 'manual',
          sessionId: randomUUID(),
          closeSession: true,
        },
      })
      expect(dup.status()).toBe(409)
    } finally {
      await api.dispose()
    }
  })
})
