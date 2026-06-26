import { expect, test } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { bufferReadingViaWizard } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Part 1 — when the 5-min window expires the buffer auto-commits, even without
 * the patient tapping "I'm good". Rather than wait 5 minutes, we age the stored
 * draft's createdAt and reload: the mount rehydrate loads an already-expired
 * draft, the review screen's countdown is at 0, and onExpire commits it.
 */

test.describe('Part 1 — buffer auto-submits on window expiry', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard)',
  )

  test('an expired buffered draft auto-commits on rehydrate (no "I\'m good" tap)', async ({
    page,
  }) => {
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
      await bufferReadingViaWizard(page, { systolic: 132, diastolic: 84, heartRate: 70 })
      await expect(page.locator('[data-testid="checkin-buffer-title"]')).toBeVisible({ timeout: 15_000 })
      expect(createPosts, 'nothing posted while buffered').toBe(0)

      // Age the stored draft so its 5-min window is already past, then reload.
      await page.evaluate(() => {
        for (let i = 0; i < window.sessionStorage.length; i++) {
          const k = window.sessionStorage.key(i)
          if (k && k.startsWith('cardioplace_buffer_draft:')) {
            const d = JSON.parse(window.sessionStorage.getItem(k) as string)
            d.createdAt = Date.now() - 6 * 60 * 1000 // 6 min ago → expired
            window.sessionStorage.setItem(k, JSON.stringify(d))
          }
        }
      })
      await page.reload()

      // The rehydrated, already-expired draft auto-commits — without any tap.
      await expect.poll(() => createPosts, { timeout: 15_000 }).toBe(1)
      await expect
        .poll(
          async () => {
            const list = await api.get('daily-journal')
            const entries = ((await list.json()).data ?? []) as Array<{ systolicBP?: number }>
            return entries.some((e) => e.systolicBP === 132)
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
