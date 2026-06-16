import { expect, test } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { bufferReadingViaWizard, commitBuffer } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Part 1 — editing a buffered reading re-opens the wizard PRE-FILLED, and the
 * backend only ever sees the final edited value (the whole point of the buffer:
 * no phantom intermediate value reaches the engine or the provider chart).
 */

test.describe('Part 1 — edit a reading while buffered', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard)',
  )

  test('edit pre-fills the wizard; only the edited value commits', async ({ page }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 130, diastolic: 85, heartRate: 72 })

      const card = page.locator(byTestId('checkin-buffer-reading-0'))
      await expect(card).toBeVisible({ timeout: 15_000 })
      await expect(card).toContainText('130/85')

      // Edit → the wizard re-opens pre-filled with the buffered values.
      await page.locator(byTestId('checkin-buffer-edit-0')).click()
      await expect(page.locator(byTestId(T.checkin.systolic))).toHaveValue('130', { timeout: 15_000 })

      // Correct the typo to 128/82 and re-submit → back on the review screen.
      await bufferReadingViaWizard(page, { systolic: 128, diastolic: 82, heartRate: 70 })
      const card2 = page.locator(byTestId('checkin-buffer-reading-0'))
      await expect(card2).toBeVisible({ timeout: 15_000 })
      await expect(card2).toContainText('128/82')
      // Still exactly one buffered reading (edit replaced in place, not appended).
      await expect(page.locator(byTestId('checkin-buffer-reading-1'))).toHaveCount(0)

      await commitBuffer(page)

      // The backend has the EDITED value, never the original 130.
      await expect
        .poll(
          async () => {
            const list = await api.get('daily-journal')
            return ((await list.json()).data ?? []) as Array<{ systolicBP?: number }>
          },
          { timeout: 10_000 },
        )
        .toEqual(expect.arrayContaining([expect.objectContaining({ systolicBP: 128 })]))
      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{ systolicBP?: number }>
      expect(entries.some((e) => e.systolicBP === 130), 'the original 130 never reached the backend').toBe(false)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
