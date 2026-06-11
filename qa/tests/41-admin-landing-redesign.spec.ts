import { test, expect } from '@playwright/test'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Spec 41 — admin landing redesign (commit ec50c03). Smoke-only.
 *
 * The admin landing (`/` on the admin subdomain) is the first surface staff
 * hit before sign-in, so a regression here is highly visible. The redesign
 * pinned three things worth locking down:
 *   • a 6-card feature grid (the last two cards advertise User management +
 *     Report generation — the new surfaces),
 *   • a trimmed header (NO Home/About/Contact nav buttons),
 *   • a footer with the contact form removed.
 * Plus a sanity check that the patient sign-in privacy + disclaimer copy still
 * renders after the layout reorg.
 *
 * No write paths — runs ungated.
 */
test.describe('Spec 41 — admin landing redesign', () => {
  test('41.1 — the 6 feature cards render', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(`${ADMIN_BASE_URL}/`)
    for (const title of [
      'Alert queue',
      'Patient list',
      'BP trends',
      'Care teams',
      'User management',
      'Report generation',
    ]) {
      await expect(
        page.getByText(title, { exact: true }).first(),
        `feature card "${title}"`,
      ).toBeVisible({ timeout: 20_000 })
    }
  })

  test('41.2 — header has no Home/About/Contact nav (regression guard)', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto(`${ADMIN_BASE_URL}/`)
    // These nav items used to exist and were intentionally removed.
    await expect(
      page.getByRole('link', { name: /^(Home|About|Contact)$/i }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: /^(Home|About|Contact)$/i }),
    ).toHaveCount(0)
  })

  test('41.3 — footer has no contact form', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto(`${ADMIN_BASE_URL}/`)
    // No form posting to a contact endpoint, and no message textbox — the
    // contact form was removed intentionally; this catches its restoration.
    await expect(page.locator('form[action*="contact"]')).toHaveCount(0)
    await expect(page.getByRole('textbox', { name: /message/i })).toHaveCount(0)
  })

  test('41.4 — patient sign-in still renders privacy + medical disclaimer', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    // Patient app (default baseURL). The mobile+desktop reorg must not drop
    // the register.privacyAssurance + register.medicalDisclaimer strings.
    await page.goto('/sign-in')
    await page.waitForLoadState('domcontentloaded')
    const body = page.locator('body')
    // Tolerant copy match (i18n English) — privacy assurance + a medical
    // disclaimer phrase. Tighten with dedicated testids if the copy shifts.
    await expect(body).toContainText(/privacy/i, { timeout: 15_000 })
    await expect(body).toContainText(
      /not a substitute|medical advice|informational|emergency|disclaimer/i,
    )
  })
})
