import { expect, test } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId } from '../helpers/selectors.js'
import { bufferReadingViaWizard, commitBuffer } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 20a — the "We're setting up your care team" success-screen line is for
 * NOT_ENROLLED patients only. An ENROLLED patient (Iris) must NOT see it. The
 * fix reads enrollmentStatus directly and defaults to enrolled unless explicitly
 * NOT_ENROLLED (which also fixes the old loading/flicker case).
 */

test.describe('Bug 20a — enrolled patient confirmation copy', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard)',
  )

  test('an enrolled patient does NOT see the "setting up your care team" message', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.iris.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.iris.email)
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 124, diastolic: 80, heartRate: 70 })
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await commitBuffer(page)

      // The success screen renders — Iris is enrolled, so the not-enrolled
      // "setting up your care team" copy must be absent.
      await expect(page.getByText(/setting up your care team/i)).toHaveCount(0, { timeout: 15_000 })
    } finally {
      await tc.dispose()
    }
  })
})
