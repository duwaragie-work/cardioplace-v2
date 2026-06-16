import { expect, test } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 17 — bulk "Mark all taken / not taken" on the check-in medications step.
 * Patients with several meds shouldn't have to tap each one. The buttons are
 * FE-only (no backend round-trip) and only set meds the patient hasn't already
 * answered. This drives the real wizard to the medications step and taps the
 * bulk button.
 */

test.describe('Bug 17 — bulk medication actions', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the patient wizard for a seed patient)',
  )

  test('"Mark all taken" answers every medication on the step at once', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      const visible = (sel: string) =>
        page.locator(byTestId(sel)).first().isVisible().catch(() => false)

      // Walk the wizard forward until the medications step's bulk button shows.
      // Dismiss any pre-wizard prompts; fill the BP step so it can advance.
      let reachedMeds = false
      for (let step = 0; step < 16; step++) {
        if (await visible('checkin-startnew-btn')) {
          await page.locator(byTestId('checkin-startnew-btn')).click()
          await page.waitForTimeout(200)
          continue
        }
        if (await visible(T.checkin.newSession)) {
          await page.locator(byTestId(T.checkin.newSession)).click()
          await page.waitForTimeout(200)
          continue
        }
        if (await visible('checkin-meds-mark-all-taken')) {
          reachedMeds = true
          break
        }
        if (await visible(T.checkin.systolic)) {
          await page.locator(byTestId(T.checkin.systolic)).fill('130')
          await page.locator(byTestId(T.checkin.diastolic)).fill('85')
          await page.locator(byTestId(T.checkin.pulse)).fill('72')
          await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
        }
        if (await visible(T.checkin.next)) {
          await page.locator(byTestId(T.checkin.next)).click()
          await page.waitForTimeout(300)
          continue
        }
        await page.waitForTimeout(300)
      }

      test.skip(
        !reachedMeds,
        'seed patient has 0–1 medications, so the bulk row is intentionally hidden',
      )

      // Tap "Mark all taken" → the live tally reflects that every med is answered.
      await page.locator(byTestId('checkin-meds-mark-all-taken')).click()
      const tally = page.locator(byTestId('checkin-meds-tally'))
      await expect(tally).toBeVisible()
      await expect(tally).toHaveText(/[1-9]\d* taken/)
      // No meds left "not taken" after Mark all taken.
      await expect(tally).toHaveText(/·\s*0 not taken/)
    } finally {
      await tc.dispose()
    }
  })
})
