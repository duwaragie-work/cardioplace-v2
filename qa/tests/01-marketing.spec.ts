import { test, expect } from '@playwright/test'

/**
 * Marketing + public-route smoke. The patient frontend (port 3000) hosts
 * the marketing surface — homepage, /about, /privacy, /terms — plus /sign-in.
 *
 * These tests run unauthenticated. They verify the public surface renders
 * and the proxy correctly redirects gated paths.
 */

test.describe('Marketing surface (public)', () => {
  test('homepage loads', async ({ page }) => {
    const res = await page.goto('/')
    expect(res?.status(), 'homepage HTTP').toBe(200)
    await expect(page).toHaveURL(/\/$/)
    // Cardioplace marketing copy — exact phrasing may drift; loose check.
    await expect(page.locator('body')).toContainText(/cardio|blood pressure|heart/i)
  })

  test('homepage exposes a single h1', async ({ page }) => {
    await page.goto('/')
    const h1Count = await page.locator('h1').count()
    expect(h1Count, 'duplicate <h1> on homepage (brief §P1.2)').toBe(1)
  })

  test('/about loads', async ({ page }) => {
    const res = await page.goto('/about')
    expect(res?.status()).toBe(200)
  })

  test('/privacy loads', async ({ page }) => {
    const res = await page.goto('/privacy')
    expect(res?.status()).toBe(200)
  })

  test('/terms loads', async ({ page }) => {
    const res = await page.goto('/terms')
    expect(res?.status()).toBe(200)
  })

  test('gated paths redirect to /sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL(/\/sign-in/, { timeout: 10_000 })
    await expect(page).toHaveURL(/\/sign-in/)
  })

  test('/check-in redirects to /sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/check-in')
    await page.waitForURL(/\/sign-in/, { timeout: 10_000 })
  })

  test('/notifications redirects to /sign-in when unauthenticated', async ({ page }) => {
    await page.goto('/notifications')
    await page.waitForURL(/\/sign-in/, { timeout: 10_000 })
  })
})
