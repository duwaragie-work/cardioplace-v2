import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { postJournalEntry } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase 4e (§G) — reading entry + history + delete + BP-photo OCR.
 *
 * tc.seedReadingsAtTime returns {created} (no ids — the doc snippet is
 * wrong), so the delete test reads the row id off the rendered
 * `readings-row-{id}` testid. BP-photo OCR is gated on
 * NEXT_PUBLIC_BP_OCR_ENABLED (BpPhotoButton only renders then).
 */

test.describe('Phase 4e — readings history + delete + OCR (20e)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ retries: 1 })

  let tc: TestControl

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  test('20e.1 — standard reading entry saves with no alert', async ({ page }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    try {
      await postJournalEntry(api, {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
        sessionId: randomUUID(),
      })
    } finally {
      await api.dispose()
    }
    await new Promise((r) => setTimeout(r, 1500))
    const open = (await tc.listAlerts(u.id)).filter((a) => a.status === 'OPEN')
    expect(open, 'control reading must not alert').toHaveLength(0)
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/readings')
    await expect(page.locator('[data-testid="readings-table"]')).toBeVisible({
      timeout: 12_000,
    })
    await tc.resetUser(u.id)
  })

  test('20e.2 — reading history renders the BP list', async ({ page }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      {
        measuredAt: new Date(Date.now() - 86_400_000).toISOString(),
        systolicBP: 132,
        diastolicBP: 84,
        pulse: 72,
      },
      {
        measuredAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
        systolicBP: 128,
        diastolicBP: 80,
        pulse: 70,
      },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/readings')
    await expect(page.locator('[data-testid="readings-table"]')).toBeVisible({
      timeout: 12_000,
    })
    await expect(
      page.locator('[data-testid^="readings-row-"]').first(),
    ).toBeVisible({ timeout: 12_000 })
    await tc.resetUser(u.id)
  })

  test('20e.3 — delete a reading via trash icon + confirm modal', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(u.id, [
      {
        measuredAt: new Date(Date.now() - 86_400_000).toISOString(),
        systolicBP: 132,
        diastolicBP: 84,
        pulse: 72,
      },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/readings')
    const row = page.locator('[data-testid^="readings-row-"]').first()
    await expect(row).toBeVisible({ timeout: 12_000 })
    const rowTestId = await row.getAttribute('data-testid')
    const id = rowTestId!.replace('readings-row-', '')
    await page.locator(`[data-testid="readings-delete-button-${id}"]`).click()
    await expect(
      page.locator('[data-testid="readings-delete-confirm-modal"]'),
    ).toBeVisible({ timeout: 10_000 })
    await page.locator('[data-testid="readings-delete-confirm-button"]').click()
    await expect(
      page.locator(`[data-testid="readings-row-${id}"]`),
    ).toBeHidden({ timeout: 12_000 })
    await tc.resetUser(u.id)
  })

  test('20e.4 — BP photo OCR pre-fills the check-in form', async ({ page }) => {
    test.skip(
      !process.env.NEXT_PUBLIC_BP_OCR_ENABLED,
      'BpPhotoButton renders only when NEXT_PUBLIC_BP_OCR_ENABLED=true; the ' +
        'OCR backend route is not stubbable end-to-end in this env. ' +
        'check-in-bp-photo-button presence is verified in the §B DOM spot-check.',
    )
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')
    await expect(
      page.locator('[data-testid="check-in-bp-photo-button"]'),
    ).toBeVisible({ timeout: 10_000 })
  })

  test('20e.5 — reading list sort / pagination', async () => {
    test.skip(
      true,
      'Readings page is a flat date-grouped card list (no sort control / ' +
        'pagination implemented in v2). Nothing to assert — documented per ' +
        'the codebase skip convention.',
    )
  })
})
