import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { acceptInviteViaApi } from '../helpers/api.js'
import { newTestControl } from '../helpers/test-control.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'
import type { Page } from '@playwright/test'

// phase/28 — per-row actions moved behind a 3-dots kebab. These helpers open
// the menu and click / assert an item, retrying the whole open+act so a
// list refetch (which re-renders the row and closes the menu) can't flake.
async function menuClick(page: Page, email: string, key: string): Promise<void> {
  await expect(async () => {
    await page.locator(byTestId(T.adminUsers.actionsMenu(email))).click()
    await page
      .locator(byTestId(T.adminUsers.action(key, email)))
      .click({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

async function menuHasItem(page: Page, email: string, key: string): Promise<void> {
  await expect(async () => {
    await page.locator(byTestId(T.adminUsers.actionsMenu(email))).click()
    await expect(
      page.locator(byTestId(T.adminUsers.action(key, email))),
    ).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/**
 * Spec 35 — admin user management (/users, phase/23).
 *
 * Surface map (from admin/src/components/user-management/*):
 *   • View gate (canViewUsers): COORDINATOR / HEALPLACE_OPS / SUPER_ADMIN /
 *     MEDICAL_DIRECTOR / PROVIDER. Only PATIENT gets the 403 card.
 *   • Manage gate (canManageUsers): the above minus PROVIDER — PROVIDER is
 *     read-only (no invite CTA / row actions). See 2026-07-01 access-scope patch.
 *   • SUPER_ADMIN / OPS see the full list + role/status/practice filters.
 *   • COORDINATOR sees their own-practice variant: NO role filter (single
 *     practice), a practice badge, and an invite CTA. The list now includes
 *     that practice's patients, providers, and medical directors.
 *   • Rows + per-row action buttons are keyed by EMAIL.
 *
 * Read-only assertions run ungated. The invite + deactivate/reactivate write
 * paths mutate the DB and are gated behind RUN_WRITE_TESTS (house pattern,
 * see 20b-patient-clinical-intake.spec.ts).
 */
test.describe('Spec 35 — admin user management', () => {
  // ─── Read paths (no DB mutation) ──────────────────────────────────────────

  test('35.1 — SUPER_ADMIN sees the user list', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await expect(page.locator(byTestId(T.adminUsers.search))).toBeVisible({
      timeout: 25_000,
    })
    // The list fetches async — wait for a known seed admin's row to render
    // before snapshotting the count (a bare .count() races the fetch).
    await expect(
      page.locator(byTestId(T.adminUsers.row(ADMINS.ops.email))),
    ).toBeVisible({ timeout: 25_000 })
    // The seed roster (admins + patients) is well under one page (limit 50),
    // so every seed account renders without paging.
    expect(
      await page.locator('[data-testid^="admin-users-row-"]').count(),
      'at least one user row',
    ).toBeGreaterThanOrEqual(1)
  })

  test('35.2 — search narrows the list to the matching account', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page
      .locator(byTestId(T.adminUsers.search))
      .fill(ADMINS.medicalDirector.email)
    // Debounced 300ms → backend refetch. The MD row stays; an unrelated seed
    // admin (ops) drops out.
    await expect(
      page.locator(byTestId(T.adminUsers.row(ADMINS.medicalDirector.email))),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator(byTestId(T.adminUsers.row(ADMINS.ops.email))),
    ).toHaveCount(0)
  })

  test('35.3 — role filter scopes the list server-side', async ({ page }) => {
    test.setTimeout(90_000)
    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.roleFilter)).selectOption('PROVIDER')
    // A PROVIDER seed appears; the HEALPLACE_OPS seed is filtered out.
    await expect(
      page.locator(byTestId(T.adminUsers.row(ADMINS.primaryProvider.email))),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      page.locator(byTestId(T.adminUsers.row(ADMINS.ops.email))),
    ).toHaveCount(0)
  })

  test('35.4 — COORDINATOR gets their own-practice variant (no role filter)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Coordinator's sidebar hides Dashboard — allow the wider landing set.
    await signInAdmin(
      page,
      ADMINS.coordinator.email,
      ADMIN_BASE_URL,
      /\/(dashboard|users|patients)/,
    )
    await page.goto(`${ADMIN_BASE_URL}/users`)
    // The invite CTA + search render; the role filter does NOT (the coordinator
    // is scoped to a single practice, so a cross-practice/role picker is moot —
    // they still see that practice's patients, providers, and medical directors).
    await expect(page.locator(byTestId(T.adminUsers.inviteSingle))).toBeVisible({
      timeout: 25_000,
    })
    await expect(page.locator(byTestId(T.adminUsers.search))).toBeVisible()
    await expect(page.locator(byTestId(T.adminUsers.roleFilter))).toHaveCount(0)
    // Practice badge tells them which practice they manage (Cedar Hill seed).
    await expect(
      page.locator(byTestId(T.adminUsers.coordinatorPractice)),
    ).toBeVisible()
  })

  test('35.5 — PROVIDER + MEDICAL_DIRECTOR can reach /users (2026-07-01)', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Access-scope patch: MED_DIR gained practice-scoped roster management and
    // PROVIDER gained read-only roster access. Neither sees the 403 card now.
    // MED_DIR is a manager (invite CTA present); PROVIDER is read-only (no CTA).
    // Finer behavior is pinned in specs 70 + 71.
    for (const persona of [ADMINS.primaryProvider, ADMINS.medicalDirector]) {
      // Clear the prior persona's session, else /sign-in redirects straight to
      // /dashboard (already authed) and the email field never renders.
      await page.context().clearCookies()
      await signInAdmin(page, persona.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/users`)
      // Roster chrome renders; the 403 card does NOT.
      await expect(
        page.locator(byTestId(T.adminUsers.search)),
        `${persona.email} should see the roster`,
      ).toBeVisible({ timeout: 25_000 })
      await expect(
        page.locator(byTestId(T.adminUsers.accessDenied)),
        `${persona.email} should NOT see the 403 card`,
      ).toHaveCount(0)
      // MED_DIR manages (invite CTA visible); PROVIDER is read-only (no CTA).
      const inviteCta = page.locator(byTestId(T.adminUsers.inviteSingle))
      if (persona.email === ADMINS.medicalDirector.email) {
        await expect(inviteCta).toBeVisible()
      } else {
        await expect(inviteCta).toHaveCount(0)
      }
    }
  })

  // ─── Write paths (DB mutation — gated) ────────────────────────────────────

  test('35.6 — SUPER_ADMIN invites a staff member via the modal', async ({
    page,
  }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'mutates DB (creates an invite)')
    test.setTimeout(90_000)
    const email = `qa.md.${randomUUID().slice(0, 8)}@cardioplace.test`

    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.inviteSingle)).click()
    await expect(page.locator(byTestId(T.adminUsers.inviteModal))).toBeVisible({
      timeout: 15_000,
    })

    await page.locator(byTestId(T.adminUsers.inviteName)).fill('QA Director')
    await page.locator(byTestId(T.adminUsers.inviteEmail)).fill(email)
    // MEDICAL_DIRECTOR is the one staff role a SUPER_ADMIN can invite WITHOUT
    // also picking a practice (inviteRequiresPractice → PATIENT/COORDINATOR/
    // PROVIDER only), keeping this test independent of the practice list.
    await page.locator(byTestId(T.adminUsers.inviteRole)).selectOption('MEDICAL_DIRECTOR')
    await page.locator(byTestId(T.adminUsers.inviteSubmit)).click()

    // A success toast confirms the POST landed (sonner).
    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 15_000,
    })

    // Cross-check via the backend list: the pending invite now exists. (Robust
    // against the UI's invite/user merge + i18n filter labels.)
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const res = await api.get('admin/users?status=INVITE_PENDING&limit=200')
    expect(res.ok(), `list invites: ${res.status()}`).toBeTruthy()
    expect(await res.text()).toContain(email)
    await api.dispose()
  })

  test('35.7 — SUPER_ADMIN deactivates then reactivates a user', async ({
    page,
  }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'mutates DB (deactivate/reactivate)')
    test.setTimeout(120_000)

    // Build a throwaway PATIENT (invite → accept) so we never deactivate a
    // shared seed persona.
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const email = `qa.deact.${randomUUID().slice(0, 8)}@cardioplace.test`
    const { token } = await tc.createInvite({
      email,
      name: 'QA Throwaway',
      role: 'PATIENT',
      practiceId: SEED_PRACTICE_ID,
    })
    await acceptInviteViaApi(API_BASE_URL, token)
    await tc.dispose()

    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.search)).fill(email)
    await expect(page.locator(byTestId(T.adminUsers.row(email)))).toBeVisible({
      timeout: 15_000,
    })

    // Deactivate → kebab item → confirm modal → reason → confirm.
    await menuClick(page, email, 'deactivate')
    await expect(
      page.locator(byTestId(T.adminUsers.deactivateModal)),
    ).toBeVisible({ timeout: 15_000 })
    await page
      .locator(byTestId(T.adminUsers.deactivateReason))
      .fill('QA automated deactivation')
    await page.locator(byTestId(T.adminUsers.deactivateConfirm)).click()
    // Modal closes only after the list has refetched → the row is now fresh.
    await expect(
      page.locator(byTestId(T.adminUsers.deactivateModal)),
    ).toHaveCount(0, { timeout: 15_000 })

    // Kebab now offers Reactivate → opens the scoped re-grant modal (no longer
    // a one-click action; HIPAA §164.308(a)(4)). The prior role (PATIENT) is
    // prefilled as "same role" — accept it and submit.
    await menuClick(page, email, 'reactivate')
    await expect(
      page.locator('[data-testid="admin-reactivate-modal"]'),
    ).toBeVisible({ timeout: 15_000 })
    await page.locator('[data-testid="admin-reactivate-submit"]').click()
    await expect(
      page.locator('[data-testid="admin-reactivate-modal"]'),
    ).toHaveCount(0, { timeout: 15_000 })

    // After reactivate, the kebab offers Deactivate again.
    await menuHasItem(page, email, 'deactivate')
  })
})
