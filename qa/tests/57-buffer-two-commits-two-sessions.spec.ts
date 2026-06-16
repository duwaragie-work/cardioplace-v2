import { expect, test } from '@playwright/test'
import { signInPatient, signInAdmin, authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { bufferReadingViaWizard, commitBuffer } from '../helpers/buffer.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Bug 14 deprecation / Part 1 — "I'm good" is an explicit session boundary. Two
 * SEPARATE buffer commits within 5 min must stay as two DISTINCT sessions (not
 * be silently merged + averaged by the old Bug-4 cross-id join). Verified on the
 * backend, the patient /readings list, and the admin Readings tab.
 */

test.describe('Bug 14 deprecation — two buffer commits stay two sessions', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard twice)',
  )

  test('two "I\'m good" commits within 5 min are two sessions on backend + patient + admin', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await signInPatient(page, PATIENTS.aisha.email)

      // Sitting 1 → commit.
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 130, diastolic: 85, heartRate: 72 })
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await commitBuffer(page)
      await expect.poll(async () => {
        const list = await api.get('daily-journal')
        return ((await list.json()).data ?? []).length
      }, { timeout: 10_000 }).toBe(1)

      // Sitting 2 → commit (well within 5 min of sitting 1).
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 128, diastolic: 82, heartRate: 70 })
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await commitBuffer(page)
      await expect.poll(async () => {
        const list = await api.get('daily-journal')
        return ((await list.json()).data ?? []).length
      }, { timeout: 10_000 }).toBe(2)

      // Backend — two DIFFERENT non-null sessionIds (not merged into one).
      const list = await api.get('daily-journal')
      const entries = ((await list.json()).data ?? []) as Array<{
        id: string
        systolicBP?: number
        sessionId?: string | null
      }>
      const r1 = entries.find((e) => e.systolicBP === 130)!
      const r2 = entries.find((e) => e.systolicBP === 128)!
      expect(r1.sessionId, 'sitting 1 has a session').toBeTruthy()
      expect(r2.sessionId, 'sitting 2 has a session').toBeTruthy()
      expect(r1.sessionId, 'two separate I\'m-good commits are two sessions').not.toBe(r2.sessionId)

      // Patient /readings — two standalone cards (a collapsed session card would
      // hide its children, so both rows being visible proves they are separate).
      await page.goto('/readings')
      await expect(page.locator(byTestId(`readings-row-${r1.id}`))).toBeVisible({ timeout: 15_000 })
      await expect(page.locator(byTestId(`readings-row-${r2.id}`))).toBeVisible()

      // Admin Readings tab — also two separate cards.
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${u.id}`)
      await page.locator(byTestId(T.admin.detailTab('readings'))).click()
      await expect(page.locator(byTestId(T.admin.readingsList))).toBeVisible({ timeout: 25_000 })
      await expect(page.locator(byTestId(T.admin.readingsCard(r1.id)))).toBeVisible()
      await expect(page.locator(byTestId(T.admin.readingsCard(r2.id)))).toBeVisible()
    } finally {
      await api.dispose()
      await tc.dispose()
    }
  })
})
