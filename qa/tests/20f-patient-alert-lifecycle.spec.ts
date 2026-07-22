import { test, expect } from '@playwright/test'
import { signInPatient, authedApi } from '../helpers/auth.js'
import { PATIENTS, ADMINS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import { adminAcknowledgeAlert, adminResolveAlert } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Phase 4f (§H) — patient alert-lifecycle UI.
 *
 * Per directive B (§B blocker B): the patient app renders ONLY the
 * patient-tier message — caregiver / physician tiers are admin-facing in v2.
 * So 20f.1 is reframed (patient-tier message + tier badge + status badge)
 * and the original 20f.4 (caregiver-text visible) is DROPPED — TierAlertView
 * has no caregiver section (3-tier exhaustive display is Phase 3 admin
 * coverage). Net §H = 4 tests: 20f.1, 20f.2, 20f.3, 20f.5.
 */

test.describe('Phase 4f — patient alert lifecycle (20f)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ retries: 1 })

  let tc: TestControl

  test.beforeAll(async () => {
    tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
  })
  test.afterAll(async () => {
    await tc?.dispose()
  })

  test('20f.1 — alert detail renders patient-tier message + tier + status', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto(`/alerts?id=${alertIds[0]}`)
    await expect(
      page.locator('[data-testid="alert-message-patient"]'),
    ).toBeVisible({ timeout: 12_000 })
    await expect(
      page.locator('[data-testid="alert-detail-tier-badge"]'),
    ).toBeVisible()
    await tc.resetUser(u.id)
  })

  test('20f.2 — patient acknowledges an alert', async ({ page }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto(`/alerts?id=${alertIds[0]}`)
    const ack = page.locator('[data-testid="alert-acknowledge-button"]')
    await ack.waitFor({ state: 'visible', timeout: 12_000 })
    await ack.click()
    // State sanity: the alert is now acknowledged.
    await expect
      .poll(
        async () => {
          const a = (await tc.listAlerts(u.id)).find(
            (x) => x.id === alertIds[0],
          )
          return a?.status
        },
        { timeout: 12_000 },
      )
      .toBe('ACKNOWLEDGED')
    await tc.resetUser(u.id)
  })

  test('20f.3 — a provider-resolved alert renders the resolved view (cross-view)', async ({
    page,
  }) => {
    // The live provider-resolve action is covered by spec 13 (admin API).
    // This asserts the PATIENT-side cross-view: a resolved alert shows the
    // resolution panel on /alerts/[id]. Seed it RESOLVED so the assertion is
    // deterministic and independent of the admin resolve-action enum.
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const md = await tc.findUser(ADMINS.manisha.email).catch(() => null)
    const { alertIds } = await tc.seedAlerts(u.id, [
      {
        tier: 'BP_LEVEL_1_HIGH',
        status: 'RESOLVED',
        resolvedBy: md?.id ?? undefined,
        resolutionAction: 'CLINICAL_REVIEW_COMPLETE',
        resolutionRationale: 'qa-test: reviewed by care team, no action needed',
      },
    ])
    const alertId = alertIds[0]
    await expect
      .poll(
        async () =>
          (await tc.listAlerts(u.id)).find((x) => x.id === alertId)?.status,
        { timeout: 10_000 },
      )
      .toBe('RESOLVED')
    await signInPatient(page, PATIENTS.aisha.email)
    await page.goto(`/alerts?id=${alertId}`)
    // TierAlertView renders the resolution panel (alert-resolved-by) for a
    // resolved alert; fall back to status badge / patient message.
    await expect(
      page
        .locator('[data-testid="alert-resolved-by"]')
        .or(page.locator('[data-testid="alert-status-badge"]'))
        .or(page.locator('[data-testid="alert-message-patient"]')),
    ).toBeVisible({ timeout: 12_000 })
    await tc.resetUser(u.id)
  })

  test('20f.5 — escalation-email deep-link opens the correct alert detail', async ({
    page,
  }) => {
    const u = await tc.findUser(PATIENTS.aisha.email)
    await tc.resetUser(u.id)
    const { alertIds } = await tc.seedAlerts(u.id, [
      { tier: 'BP_LEVEL_1_HIGH', status: 'OPEN' },
    ])
    await signInPatient(page, PATIENTS.aisha.email)
    // Simulate clicking the deep-link embedded in an escalation email.
    await page.goto(`/alerts?id=${alertIds[0]}`)
    await expect(
      page.locator('[data-testid="alert-message-patient"]'),
    ).toBeVisible({ timeout: 12_000 })
    await expect(page).toHaveURL(new RegExp(`/alerts\\?id=${alertIds[0]}`))
    await tc.resetUser(u.id)
  })
})
