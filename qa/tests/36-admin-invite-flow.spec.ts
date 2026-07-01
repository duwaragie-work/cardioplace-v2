import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { activateInviteViaUI } from '../helpers/api.js'
import { newTestControl } from '../helpers/test-control.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 36 — admin/staff invite flow (phase/23).
 *
 * Distinct from spec 37 (patient invites): this is inviting STAFF onto the
 * platform (PROVIDER / MEDICAL_DIRECTOR / COORDINATOR / HEALPLACE_OPS) and the
 * who-can-invite-whom matrix from roleGates.invitableRoles:
 *
 *   SUPER_ADMIN    → any role
 *   HEALPLACE_OPS  → PROVIDER / MEDICAL_DIRECTOR / HEALPLACE_OPS / COORDINATOR
 *   COORDINATOR    → PATIENT / PROVIDER / MEDICAL_DIRECTOR (own practice only;
 *                    NOT COORDINATOR / HEALPLACE_OPS / SUPER_ADMIN)
 *   PROVIDER       → cannot invite (not on the /admin/users controller @Roles)
 *
 * Successful-invite tests mutate the DB (gated). The scoping-403 test rejects
 * before any write, so it runs ungated.
 */
test.describe('Spec 36 — admin invite flow', () => {
  test('36.1 — SUPER_ADMIN invites a PROVIDER (practice required)', async ({
    page,
  }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'creates an invite')
    test.setTimeout(90_000)
    const email = `qa.provider.${randomUUID().slice(0, 8)}@cardioplace.test`

    await signInAdmin(page, ADMINS.support.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.inviteSingle)).click()
    await expect(page.locator(byTestId(T.adminUsers.inviteModal))).toBeVisible({
      timeout: 15_000,
    })

    await page.locator(byTestId(T.adminUsers.inviteName)).fill('QA Provider')
    await page.locator(byTestId(T.adminUsers.inviteEmail)).fill(email)
    await page.locator(byTestId(T.adminUsers.inviteRole)).selectOption('PROVIDER')
    // PROVIDER invites require a practice — the picker renders once the role
    // is chosen.
    const practice = page.locator(byTestId(T.adminUsers.invitePractice))
    await expect(practice).toBeVisible({ timeout: 10_000 })
    await practice.selectOption(SEED_PRACTICE_ID)
    await page.locator(byTestId(T.adminUsers.inviteSubmit)).click()

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 15_000,
    })

    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const res = await api.get('admin/users?status=INVITE_PENDING&limit=200')
    expect(res.ok(), `list invites: ${res.status()}`).toBeTruthy()
    expect(await res.text()).toContain(email)
    await api.dispose()
  })

  test('36.2 — an invited staff member activates on the admin app', async ({
    page,
  }) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'activates (creates) a user')
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const email = `qa.staff.${randomUUID().slice(0, 8)}@cardioplace.test`
    // MEDICAL_DIRECTOR needs no practice to mint the invite row.
    const { token } = await tc.createInvite({
      email,
      name: 'QA Staff Director',
      role: 'MEDICAL_DIRECTOR',
    })
    await tc.dispose()

    // Staff are activated but NOT auto-logged-in (phase/27 MFA): the activate
    // page hands off to /sign-in?activated=1 so they complete OTP (+ TOTP).
    // See admin/src/app/activate/[token]/page.tsx. Full sign-in is covered by
    // the auth/MFA specs; here we assert the activation→sign-in handoff.
    await activateInviteViaUI(page, ADMIN_BASE_URL, token, /\/sign-in\?activated=1/)
    await expect(page).toHaveURL(/\/sign-in\?activated=1/)
    // Email is prefilled for the OTP step.
    await expect(page).toHaveURL(/email=/)
  })

  test('36.3 — invite scoping: disallowed caller→role pairs return 403', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const mk = (role: string) => ({
      email: `qa.scope.${randomUUID().slice(0, 8)}@cardioplace.test`,
      name: 'QA Scope',
      role,
    })

    // COORDINATOR may invite PATIENT / PROVIDER / MEDICAL_DIRECTOR into their
    // own practice, but NOT org-level roles → inviting a SUPER_ADMIN is
    // forbidden (the role check rejects before any practice lookup or write).
    const coord = await authedApi(API_BASE_URL, ADMINS.coordinator.email, 'admin')
    // HEALPLACE_OPS may invite staff but NOT patients.
    const ops = await authedApi(API_BASE_URL, ADMINS.ops.email, 'admin')
    // PROVIDER is not on the /admin/users controller at all.
    const provider = await authedApi(API_BASE_URL, ADMINS.primaryProvider.email, 'admin')
    try {
      const coordRes = await coord.post('admin/users/invite', { data: mk('SUPER_ADMIN') })
      expect(coordRes.status(), 'coordinator→SUPER_ADMIN forbidden').toBe(403)

      const opsRes = await ops.post('admin/users/invite', { data: mk('PATIENT') })
      expect(opsRes.status(), 'ops→PATIENT forbidden').toBe(403)

      const provRes = await provider.post('admin/users/invite', { data: mk('PATIENT') })
      expect(provRes.status(), 'provider→anyone forbidden').toBe(403)
    } finally {
      await coord.dispose()
      await ops.dispose()
      await provider.dispose()
    }
  })

  test('36.4 — COORDINATOR invites a PROVIDER into their own practice', async ({}, testInfo) => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'creates an invite')
    testInfo.setTimeout(90_000)
    const coord = await authedApi(API_BASE_URL, ADMINS.coordinator.email, 'admin')
    try {
      const email = `qa.coord.prov.${randomUUID().slice(0, 8)}@cardioplace.test`
      // No practiceId sent — the backend auto-fills the coordinator's own
      // PracticeCoordinator practice and scope-checks it. PROVIDER + MED_DIR
      // are now invitable by a coordinator (own practice only).
      const res = await coord.post('admin/users/invite', {
        data: { email, name: 'QA Coord Provider', role: 'PROVIDER' },
      })
      expect(
        res.status(),
        `coordinator→PROVIDER allowed: ${await res.text()}`,
      ).toBe(201)
      const body = await res.json()
      const inviteId = body?.data?.id as string
      expect(inviteId, 'invite id returned').toBeTruthy()
      // Clean up so the email is freed + the list isn't polluted across reruns.
      const revoke = await coord.post(`admin/users/invite/${inviteId}/revoke`)
      expect(revoke.status(), 'coordinator can revoke their own invite').toBeLessThan(300)
    } finally {
      await coord.dispose()
    }
  })
})
