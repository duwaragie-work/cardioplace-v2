import { expect, test } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { bufferReadingViaWizard, commitBuffer } from '../helpers/buffer.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Part 1 — the engine only ever sees the COMMITTED value. This is the core
 * guarantee of the buffer (and the exact thing the old persist-immediately
 * architecture got wrong): a reading edited DOWN before commit never fires the
 * phantom high alert, while a genuinely high committed reading does.
 *
 * (Aisha is pre-Day-3 after reset, so a single committed reading evaluates;
 * 165/95 fires RULE_STANDARD_L1_HIGH, a clean below-threshold reading fires
 * nothing high.)
 */

type AlertRow = Awaited<ReturnType<TestControl['listAlerts']>>[number]

async function waitForAlerts(
  tc: TestControl,
  userId: string,
  pred: (a: AlertRow[]) => boolean,
  timeoutMs = 12_000,
): Promise<AlertRow[]> {
  const deadline = Date.now() + timeoutMs
  let last: AlertRow[] = []
  while (Date.now() < deadline) {
    last = await tc.listAlerts(userId)
    if (pred(last)) return last
    await new Promise((r) => setTimeout(r, 250))
  }
  return last
}

const isL1High = (a: AlertRow) => a.status === 'OPEN' && a.tier === 'BP_LEVEL_1_HIGH'

test.describe('Part 1 — engine evaluates the committed value, never a phantom', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (drives the wizard + fires alerts)',
  )

  test('a reading edited DOWN before commit never fires the phantom high alert', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')

      // Buffer a HIGH reading — it stays on-device; the engine never sees it.
      await bufferReadingViaWizard(page, { systolic: 165, diastolic: 95, heartRate: 74 })
      await expect(page.locator(byTestId('checkin-buffer-reading-0'))).toContainText('165/95', {
        timeout: 15_000,
      })

      // Correct it DOWN to a below-threshold value before committing.
      await page.locator(byTestId('checkin-buffer-edit-0')).click()
      await expect(page.locator(byTestId(T.checkin.systolic))).toHaveValue('165', { timeout: 15_000 })
      await bufferReadingViaWizard(page, { systolic: 142, diastolic: 84, heartRate: 72 })
      await expect(page.locator(byTestId('checkin-buffer-reading-0'))).toContainText('142/84', {
        timeout: 15_000,
      })

      await commitBuffer(page)

      // The engine saw 142, not the phantom 165 — no BP Level 1 High fires.
      const alerts = await waitForAlerts(tc, u.id, () => false, 5_000) // settle, then assert
      expect(
        alerts.some(isL1High),
        'the edited-away 165 must never reach the engine',
      ).toBe(false)
    } finally {
      await tc.dispose()
    }
  })

  test('a genuinely high reading committed via "I\'m good" fires BP Level 1 High', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    try {
      await signInPatient(page, PATIENTS.aisha.email)
      await page.goto('/check-in')
      await bufferReadingViaWizard(page, { systolic: 165, diastolic: 95, heartRate: 74 })
      await expect(page.locator(byTestId('checkin-buffer-title'))).toBeVisible({ timeout: 15_000 })
      await commitBuffer(page)

      const alerts = await waitForAlerts(tc, u.id, (xs) => xs.some(isL1High))
      expect(alerts.some(isL1High), 'the committed 165 fires BP Level 1 High').toBe(true)
    } finally {
      await tc.dispose()
    }
  })
})
