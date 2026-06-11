import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { activateInviteViaUI } from '../helpers/api.js'
import { newTestControl } from '../helpers/test-control.js'
import { ADMINS, SEED_PRACTICE_ID } from '../helpers/accounts.js'
import {
  API_BASE_URL,
  ADMIN_BASE_URL,
  PATIENT_BASE_URL,
} from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Spec 37 — patient invite flow (COORDINATOR-driven, phase/23).
 *
 * The coordinator's core job: getting patients onto the platform. Two intake
 * paths (single modal + bulk CSV) plus the patient-side activation landing.
 *
 * Coordinator specifics baked into these tests:
 *   • Role is locked to PATIENT (invitableRoles(coordinator) === ['PATIENT'])
 *     and the practice is implicit (server-fills from PracticeCoordinator),
 *     so the modal/CSV need only name + email.
 *   • CSV columns are `name,email,role,practiceId` (TEMPLATE_HEADERS);
 *     practiceId may be blank for a coordinator.
 *
 * Every test here creates invites / users, so the whole file is gated behind
 * RUN_WRITE_TESTS.
 */
test.describe('Spec 37 — patient invite flow', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'creates invites + activates users')

  const coordinatorLanding = /\/(dashboard|users|patients)/

  test('37.1 — coordinator invites a single patient', async ({ page }) => {
    test.setTimeout(90_000)
    const email = `qa.patient.${randomUUID().slice(0, 8)}@cardioplace.test`

    await signInAdmin(page, ADMINS.coordinator.email, ADMIN_BASE_URL, coordinatorLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.inviteSingle)).click()
    await expect(page.locator(byTestId(T.adminUsers.inviteModal))).toBeVisible({
      timeout: 15_000,
    })

    // Coordinator: role is locked to PATIENT and practice is implicit — only
    // name + email are collected.
    await page.locator(byTestId(T.adminUsers.inviteName)).fill('QA Patient One')
    await page.locator(byTestId(T.adminUsers.inviteEmail)).fill(email)
    await page.locator(byTestId(T.adminUsers.inviteSubmit)).click()

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 15_000,
    })

    // The pending invite exists (verified via a SUPER_ADMIN list read).
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const res = await api.get('admin/users?status=INVITE_PENDING&limit=200')
    expect(res.ok(), `list invites: ${res.status()}`).toBeTruthy()
    expect(await res.text()).toContain(email)
    await api.dispose()
  })

  test('37.2 — an invited patient activates and lands on onboarding', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // Mint the invite directly so we have the raw activation token the e-mail
    // would carry (CI has no real mailbox).
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const email = `qa.activate.${randomUUID().slice(0, 8)}@cardioplace.test`
    const { token } = await tc.createInvite({
      email,
      name: 'QA Activator',
      role: 'PATIENT',
      practiceId: SEED_PRACTICE_ID,
    })
    await tc.dispose()

    // Drive the real /activate/[token] page on the PATIENT app. A brand-new
    // patient is routed into the onboarding wizard (privacy-trust step first).
    await activateInviteViaUI(
      page,
      PATIENT_BASE_URL,
      token,
      /\/(onboarding|clinical-intake|dashboard)/,
    )
    // Session minted — we are NOT bounced back to sign-in.
    await expect(page).not.toHaveURL(/\/sign-in/)
    // When routed to onboarding, the privacy-trust gate renders first.
    if (/\/onboarding/.test(page.url())) {
      await expect(
        page.locator(byTestId(T.onboarding.agreeTerms)),
      ).toBeVisible({ timeout: 15_000 })
    }
  })

  test('37.3 — coordinator bulk-invites patients via CSV upload', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    const emailA = `qa.csv.${randomUUID().slice(0, 8)}@cardioplace.test`
    const emailB = `qa.csv.${randomUUID().slice(0, 8)}@cardioplace.test`
    // TEMPLATE_HEADERS = name,email,role,practiceId. practiceId blank → the
    // server fills it from the coordinator's PracticeCoordinator row.
    const csv = [
      'name,email,role,practiceId',
      `QA CSV A,${emailA},PATIENT,`,
      `QA CSV B,${emailB},PATIENT,`,
      '',
    ].join('\n')

    await signInAdmin(page, ADMINS.coordinator.email, ADMIN_BASE_URL, coordinatorLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)

    // Reveal the CSV affordance, then upload.
    await page.locator(byTestId(T.adminUsers.csvToggle)).click()
    await expect(page.locator(byTestId(T.adminUsers.csvCard))).toBeVisible({
      timeout: 15_000,
    })
    await page.locator(byTestId(T.adminUsers.csvFileInput)).setInputFiles({
      name: 'patients.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    })

    // Both rows parsed + valid → Send enables.
    const send = page.locator(byTestId(T.adminUsers.csvSend))
    await expect(send).toBeEnabled({ timeout: 15_000 })
    await send.click()

    await expect(page.locator('[data-sonner-toast]').first()).toBeVisible({
      timeout: 20_000,
    })

    // Both invites exist after the batch.
    const api = await authedApi(API_BASE_URL, ADMINS.support.email, 'admin')
    const res = await api.get('admin/users?status=INVITE_PENDING&limit=200')
    expect(res.ok(), `list invites: ${res.status()}`).toBeTruthy()
    const txt = await res.text()
    expect(txt).toContain(emailA)
    expect(txt).toContain(emailB)
    await api.dispose()
  })

  test('37.4 — CSV preview surfaces a row with an invalid email', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    const good = `qa.csvok.${randomUUID().slice(0, 8)}@cardioplace.test`
    const bad = 'not-an-email'
    const csv = [
      'name,email,role,practiceId',
      `QA Good,${good},PATIENT,`,
      `QA Bad,${bad},PATIENT,`,
      '',
    ].join('\n')

    await signInAdmin(page, ADMINS.coordinator.email, ADMIN_BASE_URL, coordinatorLanding)
    await page.goto(`${ADMIN_BASE_URL}/users`)
    await page.locator(byTestId(T.adminUsers.csvToggle)).click()
    await expect(page.locator(byTestId(T.adminUsers.csvCard))).toBeVisible({
      timeout: 15_000,
    })
    await page.locator(byTestId(T.adminUsers.csvFileInput)).setInputFiles({
      name: 'mixed.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    })

    // Both rows are parsed into the preview; the bad address is shown so the
    // coordinator can see what was flagged. (Per-row pass/flag styling has no
    // testid yet — a follow-up could add `admin-csv-row-{i}` for a tighter
    // assertion; the card content proves row-level parsing here.)
    const card = page.locator(byTestId(T.adminUsers.csvCard))
    await expect(card).toContainText(bad, { timeout: 15_000 })
    await expect(card).toContainText(good)
  })
})
