import { test, expect, type Page } from '@playwright/test'
import { ADMINS } from '../helpers/accounts.js'
import { signInAdmin } from '../helpers/auth.js'
import { byTestId, T } from '../helpers/selectors.js'
import { ADMIN_BASE_URL } from '../playwright.config.js'

/**
 * Part B — reactivation as an EXPLICIT, scoped re-authorization
 * (HIPAA §164.308(a)(4)). The one-click reactivate is replaced by a modal that
 * makes the admin choose the role(s) to grant, limited to what that admin may
 * grant (assignableRoles) — reactivation can never become a privilege-escalation
 * path.
 *
 * Write tests mutate the DB and are gated behind RUN_WRITE_TESTS (house pattern,
 * matching spec 35). Each mutating test is state-neutral: it deactivates a seed
 * account and reactivates it back to the SAME role, so the shared seed DB ends
 * where it started ([[playwright-shared-db-state-pollution]]).
 */

// Reactivate-modal locators (data-testids live on ReactivateModal.tsx).
const modal = '[data-testid="admin-reactivate-modal"]'
const sameRadio = '[data-testid="admin-reactivate-same"]'
const differentRadio = '[data-testid="admin-reactivate-different"]'
const roleSelect = '[data-testid="admin-reactivate-role"]'
const submitBtn = '[data-testid="admin-reactivate-submit"]'

async function openRowMenu(page: Page, email: string, key: string): Promise<void> {
  // Retry the open+click so a background list refetch (which re-renders the row
  // and closes the kebab) can't flake — same shape as spec 35's menuClick.
  await expect(async () => {
    await page.locator(byTestId(T.adminUsers.actionsMenu(email))).click()
    await page
      .locator(byTestId(T.adminUsers.action(key, email)))
      .click({ timeout: 1500 })
  }).toPass()
}

test.describe('Reactivation re-authorization (Part B)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'mutates DB (deactivate + reactivate)')

  const target = ADMINS.backupProvider // PROVIDER — safe to round-trip

  test('OPS reactivates a provider with the SAME role → back to ACTIVE as PROVIDER', async ({
    page,
  }) => {
    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await expect(page.locator(byTestId(T.adminUsers.row(target.email)))).toBeVisible({
      timeout: 20_000,
    })

    // Deactivate first so there's a DEACTIVATED row to reactivate.
    await openRowMenu(page, target.email, 'deactivate')
    // DeactivateConfirmModal → confirm.
    await page.getByRole('button', { name: /deactivate/i }).last().click()
    await expect(page.locator(byTestId(T.adminUsers.row(target.email)))).toContainText(
      /deactivated/i,
      { timeout: 15_000 },
    )

    // Reactivate → modal opens (NOT a one-click action).
    await openRowMenu(page, target.email, 'reactivate')
    await expect(page.locator(modal)).toBeVisible()
    // "Same role" is the default when a prior role exists.
    await expect(page.locator(sameRadio)).toBeChecked()
    await page.locator(submitBtn).click()

    await expect(page.locator(modal)).toBeHidden({ timeout: 15_000 })
    await expect(page.locator(byTestId(T.adminUsers.row(target.email)))).toContainText(
      /active/i,
      { timeout: 15_000 },
    )
  })

  test('OPS reactivate modal never offers PATIENT (OPS cannot grant it)', async ({
    page,
  }) => {
    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await expect(page.locator(byTestId(T.adminUsers.row(target.email)))).toBeVisible({
      timeout: 20_000,
    })

    // Ensure a DEACTIVATED row (idempotent — skip if already deactivated).
    const rowText = await page
      .locator(byTestId(T.adminUsers.row(target.email)))
      .innerText()
    if (!/deactivated/i.test(rowText)) {
      await openRowMenu(page, target.email, 'deactivate')
      await page.getByRole('button', { name: /deactivate/i }).last().click()
      await expect(
        page.locator(byTestId(T.adminUsers.row(target.email))),
      ).toContainText(/deactivated/i, { timeout: 15_000 })
    }

    await openRowMenu(page, target.email, 'reactivate')
    await expect(page.locator(modal)).toBeVisible()
    await page.locator(differentRadio).click()

    // OPS assignableRoles = PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS /
    // COORDINATOR — never PATIENT or SUPER_ADMIN.
    const optionValues = await page
      .locator(`${roleSelect} option`)
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value))
    expect(optionValues).not.toContain('PATIENT')
    expect(optionValues).not.toContain('SUPER_ADMIN')
    expect(optionValues).toContain('PROVIDER')

    // Restore state: reactivate back to PROVIDER so the seed DB is unchanged.
    await page.locator(differentRadio).click()
    await page.locator(roleSelect).selectOption('PROVIDER')
    await page.locator(submitBtn).click()
    await expect(page.locator(modal)).toBeHidden({ timeout: 15_000 })
  })
})
