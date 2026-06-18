import { expect, test } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { byTestId, T } from '../helpers/selectors.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { randomUUID } from 'node:crypto'

/**
 * Item B — Option D large-discrepancy badge. When an AWAITING first-of-pair and
 * its CONFIRMATORY second reading differ a lot (≥40 SBP or ≥20 DBP), the admin
 * Readings tab flags the session so a provider can judge measurement-error vs
 * transient spike. Patient UX is unchanged.
 */
test.describe('Item B — Option D large-discrepancy badge', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write test — gated behind RUN_WRITE_TESTS=1 (creates Option D pairs)',
  )

  async function makePair(
    email: string,
    awaiting: { s: number; d: number },
    confirm: { s: number; d: number },
  ) {
    const api = await authedApi(API_BASE_URL, email)
    const sessionId = randomUUID()
    const first = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: awaiting.s,
        diastolicBP: awaiting.d,
        pulse: 88,
        position: 'SITTING',
        sessionId,
        beginEmergencyConfirmation: true,
      },
    })
    const firstId = (await first.json()).data.id
    await api.post('daily-journal', {
      data: {
        measuredAt: new Date(Date.now() + 60_000).toISOString(),
        systolicBP: confirm.s,
        diastolicBP: confirm.d,
        pulse: 84,
        position: 'SITTING',
        sessionId,
        confirmsEntryId: firstId,
      },
    })
    await api.dispose()
  }

  test('a 195/120 → 145/85 pair shows the badge; a 195/120 → 185/115 pair does not', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)

    // Large-delta patient.
    const big = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(big.id)
    await makePair(PATIENTS.aisha.email, { s: 195, d: 120 }, { s: 145, d: 85 })

    // Small-delta patient (separate user so the two sessions don't intermingle).
    const small = await tc.findUser(PATIENTS.carol.email)
    await tc.resetUser(small.id)
    await makePair(PATIENTS.carol.email, { s: 195, d: 120 }, { s: 185, d: 115 })

    try {
      await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)

      // Large delta → badge visible.
      await page.goto(`${ADMIN_BASE_URL}/patients/${big.id}`)
      await page.locator(byTestId(T.admin.detailTab('readings'))).click()
      await expect(page.locator(byTestId(T.admin.readingsList))).toBeVisible({ timeout: 25_000 })
      await expect(
        page.locator(byTestId('admin-readings-discrepancy-badge')),
      ).toBeVisible()

      // Small delta → no badge.
      await page.goto(`${ADMIN_BASE_URL}/patients/${small.id}`)
      await page.locator(byTestId(T.admin.detailTab('readings'))).click()
      await expect(page.locator(byTestId(T.admin.readingsList))).toBeVisible({ timeout: 25_000 })
      await expect(
        page.locator(byTestId('admin-readings-discrepancy-badge')),
      ).toHaveCount(0)
    } finally {
      await tc.dispose()
    }
  })
})
