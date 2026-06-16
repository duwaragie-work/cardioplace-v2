import { expect, test, type Page } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Part 1 — FE buffer for non-emergency readings (CTO Ruhim 2026-06-09 + Manisha
 * Q1). A non-emergency reading is held ON-DEVICE for the 5-min window; the
 * backend doesn't see it until the patient taps "I'm good" or the window
 * expires. This rewrites the old API-only edit-window spec to drive the real
 * wizard and assert the no-POST-until-commit contract via route interception.
 */

// Drive the patient wizard to submit one reading. Dismisses pre-wizard prompts;
// answers all meds so the step can advance.
async function fillAndSubmitWizard(
  page: Page,
  reading: { systolic: number; diastolic: number; heartRate: number },
): Promise<void> {
  const visible = (sel: string) =>
    page.locator(byTestId(sel)).first().isVisible().catch(() => false)
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
    if (await visible(T.checkin.systolic)) {
      await page.locator(byTestId(T.checkin.systolic)).fill(String(reading.systolic))
      await page.locator(byTestId(T.checkin.diastolic)).fill(String(reading.diastolic))
      await page.locator(byTestId(T.checkin.pulse)).fill(String(reading.heartRate))
      await page.locator(byTestId('check-in-position-sitting')).click().catch(() => {})
    }
    const medYes = page.locator(byTestId(T.checkin.medicationYes))
    const medCount = await medYes.count().catch(() => 0)
    for (let m = 0; m < medCount; m++) await medYes.nth(m).click().catch(() => {})
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
}

test.describe('Part 1 — FE buffer for non-emergency readings', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the patient wizard)',
  )

  test('a non-emergency reading buffers on-device (no POST) until "I\'m good", then commits', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      // Count POSTs to the create endpoint without blocking them.
      let createPosts = 0
      await page.route('**/api/daily-journal', (route) => {
        if (route.request().method() === 'POST') createPosts += 1
        return route.continue()
      })

      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await fillAndSubmitWizard(page, { systolic: 130, diastolic: 85, heartRate: 72 })

      // The review screen takes over — and NOTHING was posted to the backend.
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await expect(page.locator(byTestId('checkin-buffer-reading-0'))).toBeVisible()
      expect(createPosts, 'no backend POST while buffered').toBe(0)
      const beforeList = await api.get('daily-journal')
      expect(((await beforeList.json()).data ?? []).length, 'backend has no entry yet').toBe(0)

      // Tap "I'm good" → commit → exactly one POST → the reading lands on the backend.
      await page.locator(byTestId('checkin-buffer-im-good')).click()
      await expect.poll(() => createPosts, { timeout: 15_000 }).toBe(1)

      // Poll the backend (the POST commits asynchronously after the request is sent).
      await expect
        .poll(
          async () => {
            const list = await api.get('daily-journal')
            const entries = ((await list.json()).data ?? []) as Array<{ systolicBP?: number }>
            return entries.some((e) => e.systolicBP === 130)
          },
          { timeout: 10_000 },
        )
        .toBe(true)
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
