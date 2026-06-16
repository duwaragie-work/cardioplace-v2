import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { bufferReadingViaWizard, commitBuffer } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 19 — "I'm good" (and Option D confirm/decline) is an explicit session
 * boundary. The backend stamps `sessionClosedAt` on the whole session, and the
 * active-session "Reading session in progress — add to this session?" prompt
 * must exclude closed sessions. Returning to /check-in within 5 min therefore
 * shows a FRESH wizard, not the prompt.
 */

test.describe('Bug 19 — no active-session prompt after an explicit close', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard)',
  )

  test('after "I\'m good", returning to /check-in shows a fresh wizard (no session prompt)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 126, diastolic: 82, heartRate: 70 })
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await commitBuffer(page)
      await expect(page).toHaveURL(/\/check-in/, { timeout: 15_000 }) // confirmation overlay

      // Within 5 min, start a new check-in — NO "add to this session?" prompt.
      await page.goto('/check-in')
      await expect(page.locator(byTestId('check-in-submit'))).toBeVisible({ timeout: 20_000 })
      await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toHaveCount(0)
    } finally {
      await tc.dispose()
    }
  })

  test('after declining Option D ("I can\'t right now"), /check-in shows no session prompt', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Hold a BP-only emergency, then decline via the endpoint (the decline
      // closes the session backend-side, same as the FE Screen-A "I can't").
      const held = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(held.status()).toBe(202)
      const decline = await api.post(`daily-journal/${(await held.json()).data.id}/decline-confirmation`)
      expect(decline.status()).toBeGreaterThanOrEqual(200)
      expect(decline.status()).toBeLessThan(300)

      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      // The resolved + closed emergency session must not surface the prompt.
      await expect(page.locator(byTestId('check-in-submit'))).toBeVisible({ timeout: 20_000 })
      await expect(page.locator(byTestId(T.checkin.openSessionPrompt))).toHaveCount(0)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
