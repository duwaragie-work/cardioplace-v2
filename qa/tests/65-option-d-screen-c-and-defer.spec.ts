import { expect, test } from '@playwright/test'
import { authedApi, signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'
import { randomUUID } from 'node:crypto'

/**
 * Bug 26 — Screen C (confirmed-normal reassurance) renders after a sub-emergency
 * confirmatory submit instead of bouncing straight to /dashboard.
 * Bug 27 — the CONFIRMATORY reading no longer carries the "editable for a few
 * more minutes" defer (the engine evaluated the pair on create).
 */
test.describe('Option D — Screen C on confirmed-normal + confirmatory defer', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write test — gated behind RUN_WRITE_TESTS=1 (drives the Option D flow)',
  )

  test('confirmed-normal → Screen C reassurance + Done → dashboard; confirmatory has no defer', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Held first-of-pair emergency (AWAITING).
      const first = await api.post('daily-journal', {
        data: {
          measuredAt: new Date().toISOString(),
          systolicBP: 195,
          diastolicBP: 120,
          position: 'SITTING',
          sessionId: randomUUID(),
          beginEmergencyConfirmation: true,
        },
      })
      expect(first.status()).toBe(202)

      // /check-in auto-resumes Screen A; retake → Screen B → submit sub-emergency.
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await expect(page.locator(byTestId(T.optionD.retake))).toBeVisible({ timeout: 15_000 })
      await page.locator(byTestId(T.optionD.retake)).click()
      await expect(page.locator(byTestId(T.optionD.systolic))).toBeVisible()
      await page.locator(byTestId(T.optionD.systolic)).fill('145')
      await page.locator(byTestId(T.optionD.diastolic)).fill('85')
      await page.locator(byTestId(T.optionD.submitSecond)).click()

      // Bug 26 — Screen C renders with the confirmed-normal reassurance copy.
      await expect(page.locator(byTestId('optiond-screenc-title'))).toBeVisible({ timeout: 15_000 })
      await expect(page.locator(byTestId('optiond-screenc-title'))).toContainText(/looks better/i)

      // Bug 27 — the confirmatory 145/85 entry carries no editable defer.
      await expect
        .poll(
          async () => {
            const list = await api.get('daily-journal')
            const entries = ((await list.json()).data ?? []) as Array<{
              systolicBP?: number
              engineEvaluationDeferredUntil?: string | null
            }>
            const conf = entries.find((e) => e.systolicBP === 145)
            return conf ? conf.engineEvaluationDeferredUntil : 'not-found'
          },
          { timeout: 8_000 },
        )
        .toBeNull()

      // Done → dashboard.
      await page.locator(byTestId(T.optionD.done)).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
