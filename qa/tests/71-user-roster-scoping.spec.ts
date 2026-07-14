import { test, expect } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 71 — user roster active-practice scoping + PROVIDER read-only (2026-07-01).
 *
 * Follow-up to the access-scope patch:
 *   • PROVIDER can VIEW the /users roster (their active practice's users) but
 *     cannot invite or act — the CTAs and row actions are suppressed.
 *   • The roster is scoped to the active/selected practice; the cross-practice
 *     practice filter is shown only to org-wide admins (SUPER / OPS).
 *   • MED_DIR invites are locked to the active practice (picker disabled +
 *     prefilled).
 *
 * Assertions are UI (visibility) + API (the RolesGuard is the real boundary).
 * None mutate seed state (writes are rejected at the guard; the invite modal
 * is opened but never submitted).
 */
test.describe('Spec 71 — roster scoping + PROVIDER read-only', () => {
  const staffLanding = /\/(dashboard|patients|users)/

  test('71.1 — PROVIDER CAN view /users but sees no invite CTAs', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL, staffLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    // Roster chrome renders (search box), and it is NOT the 403 card.
    await expect(page.locator(byTestId(T.adminUsers.search))).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.locator(byTestId(T.adminUsers.accessDenied))).toHaveCount(0)
    // Read-only: no invite / bulk / csv CTAs.
    await expect(page.locator(byTestId(T.adminUsers.inviteSingle))).toHaveCount(0)
    await expect(page.locator(byTestId(T.adminUsers.bulkToggle))).toHaveCount(0)
    await expect(page.locator(byTestId(T.adminUsers.csvToggle))).toHaveCount(0)
    // Cross-practice practice filter is org-wide-only — hidden for a provider.
    await expect(page.locator(byTestId(T.adminUsers.practiceFilter))).toHaveCount(0)
  })

  test('71.2 — PROVIDER API: read allowed, all writes forbidden', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const api = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    try {
      const list = await api.get('admin/users?limit=1')
      expect(list.status(), 'GET /admin/users allowed for PROVIDER').toBe(200)

      const invite = await api.post('admin/users/invite', {
        data: {
          email: 'qa-prov-invitee@example.com',
          name: 'X',
          role: 'PATIENT',
          practiceId: SEED_PRACTICE_ID,
        },
      })
      expect(invite.status(), 'PROVIDER invite forbidden').toBe(403)

      const deactivate = await api.post('admin/users/qa-nonexistent-user/deactivate', {
        data: { reason: 'x' },
      })
      expect(deactivate.status(), 'PROVIDER deactivate forbidden').toBe(403)
    } finally {
      await api.dispose()
    }
  })

  test('71.3 — MED_DIR invite practice is locked to the active practice', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL, staffLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    // MED_DIR is a manager — the invite CTA is present.
    const inviteBtn = page.locator(byTestId(T.adminUsers.inviteSingle))
    await expect(inviteBtn).toBeVisible({ timeout: 25_000 })
    await inviteBtn.click()
    await expect(page.locator(byTestId('admin-invite-user-modal'))).toBeVisible()
    // The practice picker is present, prefilled, and disabled (locked to the
    // active practice — to invite elsewhere the MD switches practice first).
    const practiceSelect = page.locator(byTestId('admin-invite-practice'))
    await expect(practiceSelect).toBeVisible()
    await expect(practiceSelect).toBeDisabled()
  })
})
