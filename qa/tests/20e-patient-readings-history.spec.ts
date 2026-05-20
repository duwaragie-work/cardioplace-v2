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
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    // Stub the real OCR backend route (ocr.service.ts → /api/v2/ocr/bp);
    // BpOcrSuccess = { sbp, dbp, pulse }.
    await page.route('**/api/v2/ocr/bp', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sbp: 138, dbp: 88, pulse: 72 }),
      })
    })
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/check-in')
    await page.waitForLoadState('networkidle').catch(() => {})
    // Walk B1 checklist → B2 reading step where BpPhotoButton renders.
    const photoBtn = page.locator('[data-testid="check-in-bp-photo-button"]')
    for (let i = 0; i < 6; i++) {
      if (await photoBtn.isVisible().catch(() => false)) break
      const next = page.locator('[data-testid="checkin-next-btn"]')
      if (await next.isVisible().catch(() => false)) {
        await next.click().catch(() => {})
        // Framer-motion step transition — give it time to settle.
        await page.waitForTimeout(800)
      } else break
    }
    await expect(photoBtn).toBeVisible({ timeout: 10_000 })
    // Set the hidden file input (BpPhotoButton). A 1px JPEG is enough — the
    // OCR response is stubbed.
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: 'cuff.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(
          '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==',
          'base64',
        ),
      })
    await expect(
      page.locator('[data-testid="bp-photo-confirm-modal"]'),
    ).toBeVisible({ timeout: 12_000 })
    await page.locator('[data-testid="bp-photo-confirm-button"]').click()
    // OCR values pre-fill the real BP inputs (checkin-systolic/-diastolic
    // are the inputs; check-in-systolic is the §B.4 wrapper).
    await expect(page.locator('[data-testid="checkin-systolic"]')).toHaveValue(
      '138',
      { timeout: 10_000 },
    )
    await expect(page.locator('[data-testid="checkin-diastolic"]')).toHaveValue(
      '88',
    )
    await tc.resetUser(u.id)
  })

  test('20e.5 — readings list renders 10 seeded readings newest-first', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    await tc.seedReadingsAtTime(
      u.id,
      Array.from({ length: 10 }).map((_, i) => ({
        // i=0 → 10 days ago (SBP 120); i=9 → 1 day ago (SBP 129)
        measuredAt: new Date(Date.now() - (10 - i) * 86_400_000).toISOString(),
        systolicBP: 120 + i,
        diastolicBP: 80 + (i % 3),
        pulse: 70 + (i % 5),
        sessionId: randomUUID(),
      })),
    )
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto('/readings')
    await expect(
      page.locator('[data-testid="readings-table"]'),
    ).toBeVisible({ timeout: 12_000 })
    const rows = page.locator('[data-testid^="readings-row-"]')
    await expect(rows.first()).toBeVisible({ timeout: 12_000 })
    await expect(rows).toHaveCount(10, { timeout: 12_000 })
    // Newest-first: the first card shows the most recent reading (SBP 129,
    // 1 day ago); the last shows the oldest (SBP 120, 10 days ago).
    await expect(rows.first()).toContainText('129')
    await expect(rows.last()).toContainText('120')
  })
})
