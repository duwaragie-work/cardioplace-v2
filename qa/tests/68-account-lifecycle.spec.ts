import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * phase/28 — account lifecycle (deactivate / reactivate / permanent-close).
 *
 * 68.1  Patient self-deactivate → the just-used session is instantly revoked
 *       (tokenVersion kill-switch) → an admin reactivate restores access.
 * 68.2  Admin permanent-close is gated by the typed-DisplayID anti-typo check
 *       (a wrong DisplayID is rejected 400 and does NOT close the account).
 *
 * Uses the Aisha control persona and always restores her to ACTIVE so the rest
 * of the suite is unaffected. 68.2 deliberately never actually closes a seed
 * account (irreversible) — it only exercises the mismatch guard.
 *
 * NOTE: we assert the *session kill-switch* (401 on the next request), NOT the
 * "OTP blocked" message — seed accounts short-circuit the OTP status check via
 * the demo-OTP path (auth.service.ts), so the OTP-block only fires for real
 * (non-demo) patients and can't be exercised with a seed persona.
 */
test.describe('phase/28 — account lifecycle', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'account lifecycle e2e gated behind RUN_WRITE_TESTS')

  test('68.1 — patient self-deactivate revokes the session; admin reactivate restores access', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    // Defensive: make sure she starts ACTIVE (ignore "already active").
    const pre = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    await pre
      .post(`admin/users/${aisha.id}/reactivate`, { data: { restoreRoles: true } })
      .catch(() => {})
    await pre.dispose()

    try {
      // 1. Patient signs in, then deactivates their OWN account.
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
      const deact = await patientApi.post('v2/auth/account/deactivate')
      expect(deact.ok(), `deactivate: ${deact.status()}`).toBeTruthy()

      // 2. Kill-switch — the token just used is now revoked (tokenVersion bump +
      //    session wipe), so the very next authenticated request is 401.
      const afterProfile = await patientApi.get('v2/auth/profile')
      expect(afterProfile.status(), 'session should be revoked').toBe(401)
      await patientApi.dispose()

      // 3. Admin reactivates (restoreRoles keeps her PATIENT role).
      const adminApi = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
      const react = await adminApi.post(`admin/users/${aisha.id}/reactivate`, {
        data: { restoreRoles: true },
      })
      expect(react.ok(), `reactivate: ${react.status()}`).toBeTruthy()
      await adminApi.dispose()

      // 4. The patient can sign in again and reach an authenticated route.
      const patientApi2 = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
      const ok = await patientApi2.get('v2/auth/profile')
      expect(ok.ok(), `profile after reactivate: ${ok.status()}`).toBeTruthy()
      await patientApi2.dispose()
    } finally {
      // Belt + braces — leave Aisha ACTIVE for the rest of the suite.
      const restore = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
      await restore
        .post(`admin/users/${aisha.id}/reactivate`, { data: { restoreRoles: true } })
        .catch(() => {})
      await restore.dispose()
      await tc.dispose()
    }
  })

  test('68.2 — permanent-close rejects a wrong DisplayID and does not close the account', async ({}, testInfo) => {
    testInfo.setTimeout(60_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    const adminApi = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    // Wrong DisplayID → 400 anti-typo gate, BEFORE anything is closed.
    const res = await adminApi.post(`admin/users/${aisha.id}/permanent-close`, {
      data: { confirmDisplayId: 'CP-DEFINITELY-WRONG', reason: 'qa gate test' },
    })
    expect(res.status()).toBe(400)

    // The account must still be reachable / not tombstoned.
    const still = await tc.findUser(PATIENTS.aisha.email)
    expect(still.id).toBe(aisha.id)

    await adminApi.dispose()
    await tc.dispose()
  })
})
