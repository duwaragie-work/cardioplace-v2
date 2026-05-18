import { test, expect } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Phase 3 §N — cross-practice access denial. qa-fixtures branch ONLY.
 *
 * Requires the test cohort (Practice B `seed-river-east` + matrix admins
 * provider-b@ / medical-director-b@ + the `filler-b-*` Practice B patients)
 * which exists only when the seed ran with SEED_TEST_FIXTURES=true. These
 * intentionally DO NOT run in CI-on-dev (gated below) — they live on
 * duwaragie-qa-fixtures and never merge to dev.
 *
 * Security boundary (mirrors spec 11 Phase 2): a PROVIDER off a patient's
 * care team / in a different practice gets 403 on every
 * provider/patients/:id/* endpoint. The admin patient-detail shell surfaces
 * that 403 as a header error — the patient's name never renders.
 */
const FIXTURES = !!process.env.SEED_TEST_FIXTURES && !!process.env.RUN_WRITE_TESTS

const PROVIDER_B = 'provider-b@cardioplace.test' // Practice B (seed-river-east)
const PRACTICE_B_PATIENT = 'filler-b-1@cardioplace.test' // assigned to provider-b
const PRIMARY_PROVIDER = 'primary-provider@cardioplace.test' // Practice A
// PATIENTS.james — Practice A (seed-cedar-hill), assigned to primary-provider.

test.describe('Phase 3 §N — cross-practice access denial (qa-fixtures only)', () => {
  test.skip(!FIXTURES, 'qa-fixtures cohort required (SEED_TEST_FIXTURES=true) — not run in CI-on-dev')

  test('30n.1 — provider-b CANNOT access a Practice A patient', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let jamesId: string
    try {
      jamesId = (await tc.findUser(PATIENTS.james.email)).id
    } catch (e) {
      test.skip(true, `cohort unprovisioned: ${(e as Error).message}`)
      return
    }

    // Security contract: cross-practice provider → 403 on the API.
    const api = await authedApi(API_BASE_URL, PROVIDER_B, 'admin')
    const res = await api.get(`provider/patients/${jamesId}/summary`)
    expect(res.status(), `provider-b → Practice A patient must be 403`).toBe(403)
    await api.dispose()

    // UI: the patient-detail shell surfaces the 403 — James never renders.
    await signInAdmin(page, PROVIDER_B, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${jamesId}`)
    await page.waitForTimeout(3000)
    await expect(page.locator(byTestId(T.admin.patientName))).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('James Okafor')
    await tc.dispose()
  })

  test('30n.2 — primary-provider CANNOT access a Practice B patient', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    let pbPatientId: string
    try {
      pbPatientId = (await tc.findUser(PRACTICE_B_PATIENT)).id
    } catch (e) {
      test.skip(true, `cohort unprovisioned: ${(e as Error).message}`)
      return
    }

    const api = await authedApi(API_BASE_URL, PRIMARY_PROVIDER, 'admin')
    const res = await api.get(`provider/patients/${pbPatientId}/summary`)
    expect(res.status(), `primary-provider → Practice B patient must be 403`).toBe(403)
    await api.dispose()

    await signInAdmin(page, PRIMARY_PROVIDER, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${pbPatientId}`)
    await page.waitForTimeout(3000)
    await expect(page.locator(byTestId(T.admin.patientName))).toHaveCount(0)
    await tc.dispose()
  })
})
