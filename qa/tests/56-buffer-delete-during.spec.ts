import { expect, test } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId } from '../helpers/selectors.js'
import { bufferReadingViaWizard } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Part 1 — deleting the only buffered reading discards the draft entirely: the
 * backend never sees it (nothing was ever posted) and the patient returns to
 * the dashboard. The buffer is the patient's; a discard is a discard.
 */

test.describe('Part 1 — delete a reading while buffered', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard)',
  )

  test('removing the only buffered reading discards it — no POST ever happens', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      let createPosts = 0
      await page.route('**/api/daily-journal', (route) => {
        if (route.request().method() === 'POST') createPosts += 1
        return route.continue()
      })

      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 131, diastolic: 86, heartRate: 71 })
      await expect(page.locator(byTestId('checkin-buffer-reading-0'))).toBeVisible({ timeout: 15_000 })

      // Remove the only reading → buffer discarded → back to the dashboard.
      await page.locator(byTestId('checkin-buffer-remove-0')).click()
      await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 })

      expect(createPosts, 'a discarded buffer never posts').toBe(0)
      const list = await api.get('daily-journal')
      expect(((await list.json()).data ?? []).length, 'backend has no entry').toBe(0)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
