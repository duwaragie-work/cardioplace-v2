import { test, expect, request as pwRequest } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * phase/28 — account lifecycle (deactivate / reactivate / permanent-close).
 *
 * 68.1  Patient self-deactivate → OTP re-login is blocked with a clear
 *       "deactivated" message → an admin reactivate restores sign-in.
 * 68.2  Admin permanent-close is gated by the typed-DisplayID anti-typo check
 *       (a wrong DisplayID is rejected 400 and does NOT close the account).
 *
 * Uses the Aisha control persona and always restores her to ACTIVE so the rest
 * of the suite is unaffected. 68.2 deliberately never actually closes a seed
 * account (irreversible) — it only exercises the mismatch guard.
 */
test.describe('phase/28 — account lifecycle', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'account lifecycle e2e gated behind RUN_WRITE_TESTS')

  const root = API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '')

  test('68.1 — patient self-deactivate blocks re-login; admin reactivate restores it', async ({}, testInfo) => {
    testInfo.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)

    // Defensive: make sure she starts ACTIVE (ignore "already active").
    const pre = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    await pre
      .post(`admin/users/${aisha.id}/reactivate`, { data: { restoreRoles: true } })
      .catch(() => {})
    await pre.dispose()

    const anon = await pwRequest.newContext({
      baseURL: `${root}/api/`,
      extraHTTPHeaders: { 'x-device-id': 'qa-lifecycle' },
    })

    try {
      // 1. Patient deactivates their OWN account.
      const patientApi = await authedApi(API_BASE_URL, PATIENTS.aisha.email, 'patient')
      const deact = await patientApi.post('v2/auth/account/deactivate')
      expect(deact.ok(), `deactivate: ${deact.status()}`).toBeTruthy()
      await patientApi.dispose()

      // 2. Re-login is now blocked with a clear message (not a generic error).
      const blocked = await anon.post('v2/auth/otp/send', {
        data: { email: PATIENTS.aisha.email, deviceId: 'qa-lifecycle' },
      })
      expect(blocked.status()).toBe(403)
      expect((await blocked.text()).toLowerCase()).toContain('deactivated')

      // 3. Admin reactivates (restoreRoles keeps her PATIENT role).
      const adminApi = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
      const react = await adminApi.post(`admin/users/${aisha.id}/reactivate`, {
        data: { restoreRoles: true },
      })
      expect(react.ok(), `reactivate: ${react.status()}`).toBeTruthy()
      await adminApi.dispose()

      // 4. OTP send works again.
      const ok = await anon.post('v2/auth/otp/send', {
        data: { email: PATIENTS.aisha.email, deviceId: 'qa-lifecycle' },
      })
      expect(ok.ok(), `otp after reactivate: ${ok.status()}`).toBeTruthy()
    } finally {
      // Belt + braces — leave Aisha ACTIVE for the rest of the suite.
      const restore = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
      await restore
        .post(`admin/users/${aisha.id}/reactivate`, { data: { restoreRoles: true } })
        .catch(() => {})
      await restore.dispose()
      await anon.dispose()
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
