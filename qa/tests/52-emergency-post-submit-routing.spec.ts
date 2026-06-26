import { expect, test } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Bug 16 — a symptom-override emergency (e.g. 195/120 + chest pain) must take the
 * patient straight to the full-screen "CALL 911" alert after submit, not the
 * generic "Reading sent" confirmation. The check-in handler polls the patient
 * alerts for the freshly-fired emergency tier and deep-links to /alerts/[id].
 */

test.describe('Bug 16 — emergency post-submit routing', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the patient wizard + fires an alert)',
  )

  test('195/120 + chest pain routes to the full-screen 911 alert, not "Reading sent"', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      const visible = (sel: string) =>
        page.locator(byTestId(sel)).first().isVisible().catch(() => false)

      for (let step = 0; step < 18; step++) {
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
        if (await visible(T.checkin.systolic)) {
          await page.locator(byTestId(T.checkin.systolic)).fill('195')
          await page.locator(byTestId(T.checkin.diastolic)).fill('120')
          await page.locator(byTestId(T.checkin.pulse)).fill('88')
          await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
        }
        // Answer every medication so the meds step can advance.
        const medYes = page.locator(byTestId(T.checkin.medicationYes))
        const medCount = await medYes.count().catch(() => 0)
        for (let m = 0; m < medCount; m++) {
          await medYes.nth(m).click().catch(() => {})
        }
        // Symptom step (also the submit step) — report chest pain so the reading
        // is a symptom-override emergency (Option A immediate fire, not Option D).
        if (await visible('check-in-symptom-CHEST_PAIN')) {
          await page.locator(byTestId('check-in-symptom-CHEST_PAIN')).click()
          await page.waitForTimeout(200)
        }
        if (await visible(T.checkin.submit)) {
          await page.locator(byTestId(T.checkin.submit)).click()
          break
        }
        if (await visible(T.checkin.next)) {
          await page.locator(byTestId(T.checkin.next)).click()
          await page.waitForTimeout(300)
          continue
        }
        await page.waitForTimeout(300)
      }

      // The handler polls the async engine then deep-links to the emergency alert.
      await expect(page).toHaveURL(/\/alerts\/[^/]+$/, { timeout: 25_000 })
      await expect(page.locator(byTestId(T.emergency.call911))).toBeVisible({
        timeout: 15_000,
      })
    } finally {
      await tc.dispose()
    }
  })
})
