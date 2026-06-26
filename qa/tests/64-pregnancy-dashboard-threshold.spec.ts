import { expect, test } from '@playwright/test'
import { signInPatient } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { byTestId } from '../helpers/selectors.js'

/**
 * Item C / Bug 24 — pregnancy-aware dashboard threshold. Priya is pregnant with
 * a provider-set custom threshold of 176/120, but the engine fires at the
 * pregnancy override (140/90). The dashboard used to advertise "alerts begin at
 * 196"; it must now show the EFFECTIVE threshold (140/90) + a pregnancy caption.
 *
 * Read-only (no writes) — relies on Priya's seeded pregnancy + custom threshold.
 */
test.describe('Item C — pregnancy-aware dashboard threshold', () => {
  test('Priya sees her effective pregnancy threshold (140/90), not the raw 176/120 / 196', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await signInPatient(page, PATIENTS.priya.email)
    await page.goto('/dashboard')

    // The goal card shows the EFFECTIVE goal.
    await expect(page.getByText(/Below\s*140\/90\s*mmHg/i)).toBeVisible({ timeout: 20_000 })

    // The caption explains the pregnancy override + the real alert point.
    const caption = page.locator(byTestId('dashboard-goal-tolerance'))
    await expect(caption).toBeVisible()
    await expect(caption).toContainText(/pregnancy/i)
    await expect(caption).toContainText('140/90')

    // The old lie is gone — no "196" (176 + 20 tolerance) anywhere in the goal card.
    await expect(page.getByText(/196/)).toHaveCount(0)
  })
})
