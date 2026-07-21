import { test, expect, type Page } from '@playwright/test'
import { signInAdmin, signInPatient, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  correctProfileFieldViaUI,
  editThresholdViaUI,
  admitPatientViaUI,
  gotoPatientDetailById,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL, PATIENT_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * UI end-to-end coverage for the threshold-review / enrollment-safety cluster
 * (IVR-04 + THR-REVIEW + IVR-08/16/23 + care-team notifications). Drives the
 * REAL admin browser — the land-first Thresholds nudge (flag + persistent
 * banner, no lock), the enrollment revert / auto-restore, the per-field verify
 * controls, and the care-team notification deep-link. test-control is used
 * ONLY to stage deterministic preconditions, never to assert behaviour.
 *
 * Scratch patient: PATIENTS.olive — referenced by zero other specs, so we own
 * her clinical profile for mutation. Every test re-stages a clean baseline.
 *
 * Requires a backend with ENABLE_TEST_CONTROL=true + the patientUserId
 * migration applied, the admin app on ADMIN_BASE_URL, and RUN_WRITE_TESTS=1.
 */

const ADMIN = ADMINS.support // SUPER_ADMIN — edits thresholds, corrects, enrolls; bypasses scope.

// ── Needs-threshold assertions (lock removed) ───────────────────────────────
// A needs-threshold patient lands on the Thresholds tab (one-shot), carries a
// pulsing flag on that tab, and shows the persistent banner on other tabs — but
// every tab stays NAVIGABLE (no lock).
async function expectNeedsThreshold(page: Page): Promise<void> {
  // Landed on Thresholds…
  await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 20_000 },
  )
  // …but the other tabs are NOT locked — freely navigable.
  await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeEnabled()
  await expect(page.locator(byTestId(T.admin.detailTab('profile')))).toBeEnabled()
  // The flag marks the Thresholds tab until it's set / attested.
  await expect(page.locator(byTestId(T.admin.tabThresholdsFlag))).toBeVisible({ timeout: 20_000 })
}

async function expectNoThresholdNeeded(page: Page): Promise<void> {
  await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeEnabled({
    timeout: 20_000,
  })
  await expect(page.locator(byTestId(T.admin.tabThresholdsFlag))).toBeHidden({ timeout: 20_000 })
}

/** Re-stage olive to a known clean baseline (non-mandatory, clean logs/threshold). */
async function stageScratch(
  tc: TestControl,
  userId: string,
  opts: {
    enrolled: boolean
    verified?: boolean
    hcm?: boolean
    withThreshold?: boolean
  },
): Promise<void> {
  await tc.resetUser(userId)
  await tc.clearProfileVerificationLogs(userId)
  await tc.clearPatientThreshold(userId)
  // Clear every mandatory flag first so the baseline is non-mandatory.
  await tc.setUserCondition(userId, 'hasHCM', false)
  await tc.setUserCondition(userId, 'hasDCM', false)
  await tc.setUserCondition(userId, 'hasHeartFailure', false, 'NOT_APPLICABLE')
  if (opts.hcm) await tc.setUserCondition(userId, 'hasHCM', true)
  if (opts.withThreshold) await tc.setPatientThreshold(userId, { sbpLowerTarget: 100 })
  await tc.setProfileVerificationStatus(userId, opts.verified === false ? 'UNVERIFIED' : 'VERIFIED')
  await tc.setEnrollment(userId, opts.enrolled ? 'ENROLLED' : 'NOT_ENROLLED')
}

test.describe('THR-REVIEW + enrollment safety (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  // ── IVR-04: admin adds a mandatory condition with NO threshold ────────────
  test('31.1 — admin adds HCM (no threshold) → enrollment reverts + lands on Thresholds (no lock)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    // Add HCM via the Profile tab (writes the condition log + runs IVR-04).
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'true', 'QA: add HCM')

    // Lands on Thresholds with the flag; other tabs stay navigable.
    await expectNeedsThreshold(page)
    // Enrollment reverted → the EnrollmentCard reappears.
    await expect(page.locator(byTestId(T.admin.enrollmentCard))).toBeVisible({ timeout: 20_000 })
    // Backend cross-check (single source of truth for the flip).
    const after = await tc.findUser(PATIENTS.olive.email)
    expect(after.enrollmentStatus).toBe('NOT_ENROLLED')
    await tc.dispose()
  })

  // ── IVR-04 auto-re-enroll: setting the threshold restores monitoring ──────
  test('31.2 — setting the threshold auto-re-enrolls + clears the flag + logs to Timeline', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Reverted state: mandatory (HCM), no threshold, NOT_ENROLLED, with a revert
    // audit row so the auto-restore "was reverted" check passes.
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })
    await tc.seedAuditTrail(olive.id, [
      {
        changeType: 'ADMIN_CORRECT',
        fieldPath: 'user.enrollmentStatus',
        changedBy: olive.id,
        changedByRole: 'ADMIN',
        previousValue: 'ENROLLED',
        newValue: 'NOT_ENROLLED',
        rationale: 'QA seed: prior auto-revert',
      },
    ])

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await editThresholdViaUI(page, olive.id, { sbpLowerTarget: 100 })

    // Auto-re-enroll → EnrollmentCard unmounts + flag clears.
    await expect(page.locator(byTestId(T.admin.enrollmentCard))).toBeHidden({ timeout: 20_000 })
    await expectNoThresholdNeeded(page)
    const after = await tc.findUser(PATIENTS.olive.email)
    expect(after.enrollmentStatus).toBe('ENROLLED')

    // Timeline shows the auto-restore audit row (tabs now navigable).
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    await expect(page.locator(byTestId(T.admin.timelineList))).toContainText(/patient enrolled/i, {
      timeout: 20_000,
    })
    await tc.dispose()
  })

  // ── THR-REVIEW stale (add) + one-click attest path ────────────────────────
  test('31.3 — admin adds HCM with a threshold on file → stale review; one-click attest clears it', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'true', 'QA: add HCM (stale)')

    // Stale review — flag + banner shown, enrollment unchanged (threshold exists).
    await expectNeedsThreshold(page)
    await expect(page.locator(byTestId(T.admin.thresholdReviewBanner))).toBeVisible({ timeout: 20_000 })
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('ENROLLED')

    // Attest "Targets still correct" — ONE CLICK, no note required → flag clears.
    await page.locator(byTestId(T.admin.thresholdAttest)).click()
    await expectNoThresholdNeeded(page)
    await tc.dispose()
  })

  // ── THR-REVIEW on REMOVAL (admin disables HCM) ────────────────────────────
  test('31.4 — admin disables HCM with a threshold on file → re-review flag fires', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, hcm: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'false', 'QA: remove HCM')

    await expectNeedsThreshold(page)
    await expect(page.locator(byTestId(T.admin.thresholdReviewBanner))).toBeVisible({ timeout: 20_000 })
    await tc.dispose()
  })

  // ── Initial setup lands an editor on Thresholds; OPS is not auto-redirected ─
  test('31.5 — mandatory patient with no threshold lands an editor on Thresholds on open', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await expectNeedsThreshold(page)
    await tc.dispose()
  })

  test('31.6 — HEALPLACE_OPS is not auto-redirected, but sees the awareness flag', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 20_000 })
    await page.waitForTimeout(2500)
    // OPS can't author thresholds → NOT auto-landed: stays on the default tab.
    await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute(
      'aria-selected',
      'false',
    )
    // …but the awareness flag + banner still surface so OPS can route the case,
    // and every tab is freely navigable.
    await expect(page.locator(byTestId(T.admin.tabThresholdsFlag))).toBeVisible({ timeout: 20_000 })
    await expect(page.locator(byTestId(T.admin.thresholdNeededBanner))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeEnabled()
    await tc.dispose()
  })

  // ── Tab order: Profile → Thresholds → Medications ─────────────────────────
  test('31.7 — patient-detail tab order puts Thresholds second', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    // evaluateAll does NOT auto-wait, and the detail shell resolves its patient
    // client-side now (id off the URL), so the tabs mount a beat after
    // navigation. Wait for the first tab before snapshotting the order.
    await page
      .locator('[role="tablist"] [data-testid^="admin-tab-"]')
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
    const order = await page
      .locator('[role="tablist"] [data-testid^="admin-tab-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')))
    expect(order.slice(0, 3)).toEqual(['admin-tab-profile', 'admin-tab-thresholds', 'admin-tab-medications'])
    await tc.dispose()
  })

  // Regression for the James/Priya bug: a mandatory patient with a VALID
  // (non-stale) threshold must NOT be force-redirected to Thresholds. The gate
  // reads `threshold` only after it has loaded — otherwise the null-while-
  // loading window briefly reads "missing" and strands the page on Thresholds.
  test('31.23 — mandatory patient with a valid threshold stays on the Profile tab (no false redirect)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Mandatory (HCM) + a threshold + no condition change after it → not stale.
    await stageScratch(tc, olive.id, { enrolled: true, hcm: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 20_000 })
    // Let threshold + logs load + the gate settle — this is the window that,
    // unfixed, strands the page on Thresholds.
    await page.waitForTimeout(2500)
    await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeEnabled()
    await expect(page.locator(byTestId(T.admin.detailTab('profile')))).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute(
      'aria-selected',
      'false',
    )
    // A valid (non-stale) threshold → no needs-threshold flag at all.
    await expect(page.locator(byTestId(T.admin.tabThresholdsFlag))).toBeHidden()
    await tc.dispose()
  })
})

// ── IVR-08 / IVR-16 — per-field verification controls (UI) ───────────────────
test.describe('Per-field profile verification (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.8 — ✓ Confirm marks a field confirmed + persists an ADMIN_VERIFY log', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Non-mandatory + UNVERIFIED so the per-field controls render and there's no lock.
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileConfirm('hasCAD'))).click()

    // Field flips to confirmed + the ✓ disables (IVR-08 idempotency).
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'confirmed',
      { timeout: 20_000 },
    )
    await expect(page.locator(byTestId(T.admin.profileConfirm('hasCAD')))).toBeDisabled()

    // Backend cross-check: an ADMIN_VERIFY row exists for profile.hasCAD.
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const res = await api.get(`admin/users/${olive.id}/verification-logs`)
    const body = await res.json()
    const logs = (body?.data ?? body) as Array<{ fieldPath: string; changeType: string }>
    expect(
      logs.some((l) => l.fieldPath === 'profile.hasCAD' && l.changeType === 'ADMIN_VERIFY'),
    ).toBe(true)
    await api.dispose()
    await tc.dispose()
  })

  test('31.9 — Reject marks a field rejected + disables the Reject button (IVR-16)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileReject('hasCAD'))).click()

    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'rejected',
      { timeout: 20_000 },
    )
    await expect(page.locator(byTestId(T.admin.profileReject('hasCAD')))).toBeDisabled()
    await tc.dispose()
  })

  test('31.10 — "Confirm all" confirms every pending field', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    const confirmAll = page.locator(byTestId(T.admin.profileConfirmAll))
    await expect(confirmAll).toBeVisible({ timeout: 20_000 })
    await confirmAll.click()
    // Once everything's confirmed there are no pending fields left to confirm.
    await expect(confirmAll).toBeHidden({ timeout: 20_000 })
    await tc.dispose()
  })

  // Reject hard-gate — a rejected field is an open "needs correction" item, so
  // "Verification complete" must stay blocked (FE button disabled + banner; BE
  // 400) until it's resolved. Resolving (re-confirm here) releases the gate.
  test('31.24 — a rejected field blocks "Verification complete" (UI + backend) until resolved', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // UNVERIFIED + non-mandatory so the per-field controls render and nothing locks.
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)

    // Reject CAD → the gate engages.
    await page.locator(byTestId(T.admin.profileReject('hasCAD'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'rejected',
      { timeout: 20_000 },
    )
    await expect(page.locator(byTestId(T.admin.profileRejectedBanner))).toBeVisible()
    await expect(page.locator(byTestId(T.admin.profileVerifyComplete))).toBeDisabled()

    // Backend belt: verify-profile is refused (400) while a field is rejected.
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const blocked = await api.post(`admin/users/${olive.id}/verify-profile`, {
      data: { rationale: 'QA: attempt verify with a reject open' },
    })
    expect(blocked.ok(), 'verify-profile should be refused while a field is rejected').toBeFalsy()
    expect(blocked.status()).toBe(400)
    expect(await blocked.text()).toMatch(/resolve rejected field/i)

    // Resolve by confirming the field (the ✓ stays available on a rejected row).
    await page.locator(byTestId(T.admin.profileConfirm('hasCAD'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'confirmed',
      { timeout: 20_000 },
    )
    await expect(page.locator(byTestId(T.admin.profileRejectedBanner))).toBeHidden()
    await expect(page.locator(byTestId(T.admin.profileVerifyComplete))).toBeEnabled()

    // Now completing verification succeeds end-to-end.
    await page.locator(byTestId(T.admin.profileVerifyComplete)).click()
    await page.locator(byTestId(T.admin.profileVerifyConfirm)).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'verified',
      { timeout: 20_000 },
    )
    await api.dispose()
    await tc.dispose()
  })

  // Display fix — the gate prevents NEW records from reaching VERIFIED + a
  // rejected field, but a legacy record can hold that state. The row must show
  // the field's own rejected status (not the whole-profile "Verified" flag), so
  // the badge and the highlighted Reject button never contradict each other.
  test('31.25 — a rejected field never reads "Verified" on a fully-verified profile (display fix)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: true, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)
    // Seed an ADMIN_REJECT as the latest log for hasCAD on an otherwise-VERIFIED
    // profile (future-dated so it wins the latest-log derivation deterministically).
    await tc.seedAuditTrail(olive.id, [
      {
        changeType: 'ADMIN_REJECT',
        fieldPath: 'profile.hasCAD',
        changedBy: olive.id,
        changedByRole: 'ADMIN',
        previousValue: true,
        newValue: null,
        rationale: 'QA seed: legacy reject on a verified profile',
        createdAtIso: new Date(Date.now() + 60_000).toISOString(),
      },
    ])

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)

    const field = page.locator(byTestId(T.admin.profileField('hasCAD')))
    await expect(field).toHaveAttribute('data-status', 'rejected', { timeout: 20_000 })
    await expect(field).toContainText(/rejected/i)
    await expect(field).not.toContainText(/verified/i)
    // Badge + button agree: the Reject control stays highlighted/disabled.
    await expect(page.locator(byTestId(T.admin.profileReject('hasCAD')))).toBeDisabled()
    await tc.dispose()
  })
})

// ── Care-team notifications (patient self-edit → admin) ───────────────────────
test.describe('Care-team notifications + deep-link (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.11 — patient adds HCM (no threshold) → care-team notice; clicking it deep-links to the patient', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    const provider = await tc.findUser(ADMINS.primaryProvider.email)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })
    // Clear recipient inboxes so the assertion sees only the new notice.
    await tc.resetUser(provider.id)
    await tc.resetUser(md.id)

    // Patient self-edits via their own API (the clinical-intake save path).
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.olive.email, 'patient')
    const res = await patientApi.post('intake/profile', { data: { hasHCM: true } })
    expect(res.ok(), `patient profile edit: ${res.status()} ${await res.text()}`).toBeTruthy()
    await patientApi.dispose()

    // Backend safety: enrollment reverted silently for the patient.
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('NOT_ENROLLED')

    // The notice landed in the care team's inbox (primary provider or MD).
    const provNotifs = await tc.listNotifications(provider.id)
    const mdNotifs = await tc.listNotifications(md.id)
    const all = [...provNotifs, ...mdNotifs]
    const notice = all.find((n) => /enrollment paused/i.test(n.title))
    expect(notice, `no care-team notice found; titles: ${all.map((n) => n.title).join(', ')}`).toBeTruthy()

    // UI deep-link: provider opens the Notifications sub-tab (where non-alert
    // care-team notices live — the page defaults to the Alerts sub-tab, so the
    // `?tab=notifications` param matters, exactly as the bell's "View all" link
    // does), clicks the notice → routes to the patient detail.
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/notifications?tab=notifications`)
    const provNotice = provNotifs.find((n) => /enrollment paused/i.test(n.title))
    if (provNotice) {
      const row = page.locator(byTestId(T.admin.notificationRow(provNotice.id)))
      await row.waitFor({ state: 'visible', timeout: 20_000 })
      await row.click()
      // F1 — bare /patients/detail route; the id is handed off via
      // sessionStorage, so it must NOT be in the URL.
      await page.waitForURL(/\/patients\/detail$/, { timeout: 20_000 })
      expect(page.url()).toContain('/patients/detail')
      expect(page.url()).not.toContain('id=')
    }
    await tc.dispose()
  })

  test('31.12 — patient removes HCM (threshold on file) → "review needed" care-team notice', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    const provider = await tc.findUser(ADMINS.primaryProvider.email)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await stageScratch(tc, olive.id, { enrolled: true, hcm: true, withThreshold: true })
    await tc.resetUser(provider.id)
    await tc.resetUser(md.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.olive.email, 'patient')
    const res = await patientApi.post('intake/profile', { data: { hasHCM: false } })
    expect(res.ok(), `patient profile edit: ${res.status()} ${await res.text()}`).toBeTruthy()
    await patientApi.dispose()

    // Threshold exists → enrollment stays; only the review notice fires.
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('ENROLLED')
    const all = [...(await tc.listNotifications(provider.id)), ...(await tc.listNotifications(md.id))]
    expect(
      all.some((n) => /condition change|review needed/i.test(n.title)),
      `titles: ${all.map((n) => n.title).join(', ')}`,
    ).toBe(true)
    await tc.dispose()
  })
})

// ── Timeline audit trail (UI E2E) ────────────────────────────────────────────
// Verifies that this session's audit rows render in the Timeline tab with the
// friendly labels — especially the enrollment rows (the "User.enrollment Status"
// raw-label bug fixed this round) and the per-field verify/reject/correct rows.
test.describe('Timeline audit trail (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 150_000 })

  test('31.13 — enrollment lifecycle renders as "Enrollment reverted" + "Patient enrolled" (not raw user.* path)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    // Add HCM (no threshold) → revert + lock; then set the threshold → auto-restore.
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'true', 'QA: add HCM')
    await editThresholdViaUI(page, olive.id, { sbpLowerTarget: 100 })
    // Make sure the auto-restore committed before the Timeline loads its logs.
    await expect
      .poll(async () => (await tc.findUser(PATIENTS.olive.email)).enrollmentStatus, { timeout: 15_000 })
      .toBe('ENROLLED')

    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    await expect(tl).toContainText(/enrollment reverted/i, { timeout: 20_000 })
    await expect(tl).toContainText(/patient enrolled/i)
    await expect(tl).toContainText(/hypertrophic cardiomyopathy/i)
    // Timeline now surfaces the real actor ROLE (provider / medical director)
    // instead of a flat "by admin" — accept any of them.
    await expect(tl).toContainText(/corrected by (admin|medical director|provider)/i)
    // The fix: no raw "User.enrollment Status" / "user." path leaks through.
    await expect(tl).not.toContainText(/user\.enrollment/i)
    await tc.dispose()
  })

  test('31.14 — per-field confirm / reject / correct each render with friendly labels', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // UNVERIFIED + non-mandatory so the per-field controls render and nothing locks.
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)
    await tc.setUserCondition(olive.id, 'hasAFib', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    // Confirm CAD…
    await page.locator(byTestId(T.admin.profileConfirm('hasCAD'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'confirmed',
      { timeout: 20_000 },
    )
    // …reject AFib…
    await page.locator(byTestId(T.admin.profileReject('hasAFib'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasAFib')))).toHaveAttribute(
      'data-status',
      'rejected',
      { timeout: 20_000 },
    )
    // …correct a boolean the baseline reset to false (so the edit is a real
    // change on every re-run — heightCm would no-op once already set).
    await correctProfileFieldViaUI(page, olive.id, 'hasHeartFailure', 'true', 'QA: correct HF flag')

    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    // Timeline surfaces the real actor ROLE (provider / medical director) now,
    // not a flat "by admin".
    await expect(tl).toContainText(/verified by (admin|medical director|provider)/i, {
      timeout: 20_000,
    })
    // Same-second same-type logs collapse into an expandable burst ("Profile
    // rejected · N fields") that hides individual field names. Expand every
    // collapsed group so per-field labels (e.g. "Atrial fibrillation") render.
    const groups = page.locator('[data-testid^="admin-timeline-group-"]')
    for (let i = 0, n = await groups.count(); i < n; i++) {
      await groups.nth(i).click().catch(() => {})
    }
    await expect(tl).toContainText(/atrial fibrillation/i)
    await expect(tl).toContainText(/rejected by (admin|medical director|provider)/i)
    await expect(tl).toContainText(/heart failure/i)
    await expect(tl).toContainText(/corrected by (admin|medical director|provider)/i)
    await tc.dispose()
  })
})

// ── Variants + remaining coverage (UI E2E) ───────────────────────────────────
test.describe('Variants + remaining coverage (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 150_000 })

  // HFrEF travels the enum (heartFailureType) path, not a boolean flag — a
  // distinct branch in the lock detector + thresholdMandatory.
  test('31.15 — admin adds HFrEF (enum, no threshold) → revert + lock', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'heartFailureType', 'HFREF', 'QA: HFrEF')
    await expectNeedsThreshold(page)
    await expect(page.locator(byTestId(T.admin.enrollmentCard))).toBeVisible({ timeout: 20_000 })
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('NOT_ENROLLED')
    await tc.dispose()
  })

  // THR-016 — DCM is managed as HFrEF: the suggested default is SBP-lower 85.
  test('31.16 — DCM patient → "Apply defaults" prefills SBP-lower target 85', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasDCM', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    // Mandatory + no threshold → forced onto Thresholds, where the suggested
    // default + Apply button render.
    await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 20_000 },
    )
    await page.getByRole('button', { name: /apply defaults/i }).click()
    await expect(page.locator(byTestId(T.admin.thresholdSbpLower))).toHaveValue('85', { timeout: 10_000 })
    await tc.dispose()
  })

  // IVR-23 — a patient edit AFTER an admin review surfaces the "changed since
  // last verification" banner.
  test('31.17 — patient edit after admin confirm → "changed since last verification" banner', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)
    await tc.setUserCondition(olive.id, 'diagnosedHypertension', true)

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileConfirm('hasCAD'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'confirmed',
      { timeout: 20_000 },
    )

    // Patient edits a verifiable field after the admin confirm.
    const patientApi = await authedApi(API_BASE_URL, PATIENTS.olive.email, 'patient')
    const res = await patientApi.post('intake/profile', { data: { diagnosedHypertension: false } })
    expect(res.ok(), `patient edit: ${res.status()} ${await res.text()}`).toBeTruthy()
    await patientApi.dispose()

    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    const banner = page.locator(byTestId(T.admin.profileChangedBanner))
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(/diagnosed hypertension/i)
    await tc.dispose()
  })

  // Patient adds a mandatory condition WHILE a threshold exists → no revert, a
  // "review needed" notice, and the admin lands on Thresholds on open (stale threshold).
  test('31.18 — patient adds HCM with a threshold on file → review notice + admin lands on Thresholds on open', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    const provider = await tc.findUser(ADMINS.primaryProvider.email)
    const md = await tc.findUser(ADMINS.medicalDirector.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: true })
    await tc.resetUser(provider.id)
    await tc.resetUser(md.id)

    const patientApi = await authedApi(API_BASE_URL, PATIENTS.olive.email, 'patient')
    const res = await patientApi.post('intake/profile', { data: { hasHCM: true } })
    expect(res.ok(), `patient edit: ${res.status()} ${await res.text()}`).toBeTruthy()
    await patientApi.dispose()

    // Threshold exists → no revert; only the review notice fires.
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('ENROLLED')
    const all = [...(await tc.listNotifications(provider.id)), ...(await tc.listNotifications(md.id))]
    expect(
      all.some((n) => /condition change|review needed/i.test(n.title)),
      `titles: ${all.map((n) => n.title).join(', ')}`,
    ).toBe(true)

    // An editor opening the patient is locked (the threshold is now stale).
    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await expectNeedsThreshold(page)
    await tc.dispose()
  })

  // Manual "Enroll" writes its own Timeline audit row (round-B fix — manual
  // enroll previously wrote nothing to the Timeline).
  test('31.19 — manual Enroll writes an "Enrollment completed by admin" Timeline row', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Non-mandatory + NOT_ENROLLED so the gate is open and the Enroll button shows.
    await stageScratch(tc, olive.id, { enrolled: false, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await admitPatientViaUI(page, olive.id)
    await expect
      .poll(async () => (await tc.findUser(PATIENTS.olive.email)).enrollmentStatus, { timeout: 15_000 })
      .toBe('ENROLLED')

    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    await expect(page.locator(byTestId(T.admin.timelineList))).toContainText(
      /enrollment completed by admin/i,
      { timeout: 20_000 },
    )
    await tc.dispose()
  })

  // Land-first + flag applies to a PROVIDER (a threshold-editor), not only SUPER_ADMIN.
  test('31.20 — a PROVIDER also lands on Thresholds for a mandatory-without-threshold patient', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await expectNeedsThreshold(page)
    await tc.dispose()
  })
})

// ── Seed-patient threshold-flag diagnosis (UI E2E) ─────────────────────────────────────
// Read-only: for shared seed patients (James/Paul) the needs-threshold flag must fire EXACTLY
// when the threshold is missing or stale (a mandatory condition changed after
// the threshold was set). A patient flagged with a threshold and NO newer
// condition change would be a false-positive bug — this asserts against that
// and attaches the breakdown so the cause is visible.
test.describe('Seed-patient threshold-flag diagnosis (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  // Mirrors the FE detector (mandatoryConditionChangedAt).
  function mandatoryChangedAtMs(
    logs: Array<{ fieldPath: string; newValue: unknown; previousValue: unknown; createdAt: string }>,
  ): number {
    let latest = 0
    for (const l of logs) {
      const changed =
        l.fieldPath === 'profile.hasHCM' ||
        l.fieldPath === 'profile.hasDCM' ||
        (l.fieldPath === 'profile.heartFailureType' &&
          (l.newValue === 'HFREF' || l.previousValue === 'HFREF'))
      if (changed) latest = Math.max(latest, new Date(l.createdAt).getTime())
    }
    return latest
  }

  for (const [n, key] of [[31.21, 'james'], [31.22, 'paul']] as const) {
    test(`${n} — ${key}: needs-threshold flag fires iff threshold missing or stale (diagnosis)`, async ({ page }, testInfo) => {
      const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
      const u = await tc.findUser(PATIENTS[key].email)
      const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')

      const tRes = await api.get(`admin/patients/${u.id}/threshold`)
      const threshold = tRes.status() === 404 ? null : ((await tRes.json())?.data ?? null)
      const profile = (await (await api.get(`admin/users/${u.id}/profile`)).json())?.data ?? null
      const logs = (await (await api.get(`admin/users/${u.id}/verification-logs`)).json())?.data ?? []
      await api.dispose()

      const mandatory =
        profile?.heartFailureType === 'HFREF' || !!profile?.hasHCM || !!profile?.hasDCM
      const changedAt = mandatoryChangedAtMs(logs)
      const setAt = threshold ? new Date(threshold.setAt).getTime() : 0
      const stale = !!threshold && changedAt > 0 && setAt < changedAt
      const wouldFlag = stale || (mandatory && !threshold)

      // Observe the real UI signal — the pulsing flag on the Thresholds tab
      // (the hard lock is gone; the flag is the new "needs threshold" marker).
      await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
      await gotoPatientDetailById(page, ADMIN_BASE_URL, u.id)
      await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 20_000 })
      // Let the shell load logs + the gate settle before reading the flag.
      await page.waitForTimeout(2500)
      const uiFlagged = await page.locator(byTestId(T.admin.tabThresholdsFlag)).isVisible()

      const diagnosis = {
        patient: key,
        mandatory,
        hasThreshold: !!threshold,
        thresholdSetAt: threshold?.setAt ?? null,
        latestMandatoryConditionChangeAt: changedAt ? new Date(changedAt).toISOString() : null,
        stale,
        // Check `stale` first: a non-mandatory patient can still be flagged when
        // a mandatory condition was REMOVED after the threshold was set.
        reason: stale
          ? 'a mandatory condition changed AFTER the threshold was set → stale → flagged (re-save/attest to clear)'
          : mandatory && !threshold
            ? 'mandatory + NO threshold → flagged (set one to clear)'
            : !mandatory
              ? 'not mandatory + not stale → not flagged'
              : 'threshold present + not stale → not flagged',
        wouldFlag,
        uiFlagged,
      }
      await testInfo.attach(`threshold-diagnosis-${key}`, {
        body: JSON.stringify(diagnosis, null, 2),
        contentType: 'application/json',
      })

      // The flag must fire EXACTLY when missing-or-stale — no false positives.
      expect(uiFlagged, `flag mismatch — diagnosis: ${JSON.stringify(diagnosis)}`).toBe(wouldFlag)
      await tc.dispose()
    })
  }
})

// ── Patient re-check on field reject (cross-app UI E2E) ───────────────────────
// When an admin rejects a self-reported field, the patient must (a) get an inbox
// notice that names the field, and (b) see a "please re-check: {field}" banner on
// their own profile. Drives BOTH apps: admin rejects via API, patient asserts UI.
test.describe('Patient re-check on reject (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.26 — admin rejects a field → patient sees a named re-check banner + inbox notice', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // UNVERIFIED + a field to reject. stageScratch resets the user (clears the
    // notification inbox + verification logs), so the only notice is the new one.
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)

    // Admin rejects CAD (drives the same endpoint the Profile tab ✗ button hits).
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const rej = await api.post(`admin/users/${olive.id}/reject-profile-field`, {
      data: { field: 'hasCAD', rationale: 'QA: reject CAD to trigger patient re-check' },
    })
    expect(rej.ok(), `reject-profile-field: ${rej.status()} ${await rej.text()}`).toBeTruthy()
    await api.dispose()

    // (a) Patient inbox notice names the field.
    const notes = await tc.listNotifications(olive.id)
    const notice = notes.find((n) => /re-check a profile detail/i.test(n.title))
    expect(notice, `titles: ${notes.map((n) => n.title).join(', ')}`).toBeTruthy()
    expect(notice?.body).toMatch(/coronary artery disease/i)

    // (b) Patient profile UI shows the named re-check banner (patient app, :3000).
    await signInPatient(page, PATIENTS.olive.email)
    await page.goto(`${PATIENT_BASE_URL}/profile`)
    const banner = page.locator(byTestId(T.profile.recheckBanner))
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(/coronary artery disease/i)
    await tc.dispose()
  })
})

// ── Correction UX: no-op + friendly validation (UI E2E) ───────────────────────
// "Correcting" a field to the value it already holds isn't a change — the admin
// should be nudged to ✓ Confirm, not shown a raw "No corrections supplied" /
// "corrections.heightCm must be an integer number" error.
test.describe('Profile correction UX (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.27 — re-saving Height with the same value shows a friendly "no change" note, not an error', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })

    // Read the current height so we can re-type the SAME value.
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const prof = await (await api.get(`admin/users/${olive.id}/profile`)).json()
    const current = (prof?.data ?? prof)?.heightCm ?? 170
    await api.dispose()

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileCorrect('heightCm'))).click()
    await page.locator(byTestId(T.admin.profileEditInput('heightCm'))).fill(String(current))
    await page.locator(byTestId(T.admin.profileEditSave('heightCm'))).click()

    // Friendly info note appears (no thrown error), pointing at Confirm.
    const note = page.locator(byTestId(T.admin.profileFieldNote('heightCm')))
    await expect(note).toBeVisible({ timeout: 20_000 })
    await expect(note).toContainText(/no change/i)
    await expect(note).toContainText(/confirm/i)
    // The row was NOT marked corrected (no write happened).
    await expect(page.locator(byTestId(T.admin.profileField('heightCm')))).not.toHaveAttribute(
      'data-status',
      'corrected',
    )
    await tc.dispose()
  })

  test('31.28 — a non-integer Height shows plain-language guidance, not the raw validator path', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })

    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const prof = await (await api.get(`admin/users/${olive.id}/profile`)).json()
    const current = (prof?.data ?? prof)?.heightCm ?? 170
    await api.dispose()

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileCorrect('heightCm'))).click()
    // A decimal that differs from the current value → a real (invalid) change.
    await page.locator(byTestId(T.admin.profileEditInput('heightCm'))).fill(`${current}.5`)
    await page.locator(byTestId(T.admin.profileEditSave('heightCm'))).click()

    const note = page.locator(byTestId(T.admin.profileFieldNote('heightCm')))
    await expect(note).toBeVisible({ timeout: 20_000 })
    await expect(note).toContainText(/whole number/i)
    // Not the raw "corrections.heightCm" / "must be an integer number" text.
    await expect(note).not.toContainText(/corrections\./i)
    await tc.dispose()
  })

  test('31.30 — on an already-verified profile the no-op note omits the ✓ Confirm hint (Confirm is hidden)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Fully VERIFIED → per-field ✓ Confirm buttons are hidden.
    await stageScratch(tc, olive.id, { enrolled: true, verified: true, withThreshold: false })

    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const prof = await (await api.get(`admin/users/${olive.id}/profile`)).json()
    const current = (prof?.data ?? prof)?.heightCm ?? 170
    await api.dispose()

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileCorrect('heightCm'))).click()
    await page.locator(byTestId(T.admin.profileEditInput('heightCm'))).fill(String(current))
    await page.locator(byTestId(T.admin.profileEditSave('heightCm'))).click()

    const note = page.locator(byTestId(T.admin.profileFieldNote('heightCm')))
    await expect(note).toBeVisible({ timeout: 20_000 })
    await expect(note).toContainText(/no change/i)
    // Confirm is hidden on a verified profile, so don't point at it.
    await expect(note).not.toContainText(/confirm/i)
    await tc.dispose()
  })
})

// ── Timeline actor role (UI E2E) ──────────────────────────────────────────────
// Admin actions are stored with a coarse VerifierRole.ADMIN; the Timeline should
// resolve and show the actor's REAL role (e.g. provider) instead of "(admin)".
test.describe('Timeline actor role (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.29 — a PROVIDER\'s action shows "(provider)" in the Timeline, not the generic "(admin)"', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })
    await tc.setUserCondition(olive.id, 'hasCAD', true)

    // Dr. Samuel Okonkwo is a PROVIDER (and olive's primary provider).
    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.profileConfirm('hasCAD'))).click()
    await expect(page.locator(byTestId(T.admin.profileField('hasCAD')))).toHaveAttribute(
      'data-status',
      'confirmed',
      { timeout: 20_000 },
    )

    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    await expect(tl).toContainText(/\(provider\)/i, { timeout: 20_000 })
    // The generic "(admin)" must NOT leak through for a real provider action.
    await expect(tl).not.toContainText(/\(admin\)/i)
    await tc.dispose()
  })

  // TL-071 — a Height change should read with its unit ("170 cm → 175 cm"), not
  // as a bare number. FE-only rendering of the existing log diff.
  test('31.31 — a Height change renders with the cm unit in the Timeline diff', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, verified: false, withThreshold: false })

    // A real (changed) value so a correction is written.
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const prof = await (await api.get(`admin/users/${olive.id}/profile`)).json()
    const current = (prof?.data ?? prof)?.heightCm ?? 170
    const next = (Number(current) || 170) === 175 ? 176 : 175
    await api.dispose()

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'heightCm', String(next), 'QA: change height')

    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    await expect(tl).toContainText(new RegExp(`${next}\\s*cm`, 'i'), { timeout: 20_000 })
    await tc.dispose()
  })
})

// ── No-lock navigation + persistent banner (UI E2E) ───────────────────────────
// The core of the redesign: a needs-threshold patient is GUIDED (land-first +
// flag + banner) but never CAGED — every tab is navigable, and the banner offers
// a one-click jump back to Thresholds.
test.describe('No-lock threshold navigation (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.32 — needs-threshold patient: lands on Thresholds but other tabs are navigable + banner jumps back', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    // Land-first on Thresholds, with the flag.
    await expectNeedsThreshold(page)

    // Navigate AWAY to a context tab — proves there's no lock.
    await page.locator(byTestId(T.admin.detailTab('readings'))).click()
    await expect(page.locator(byTestId(T.admin.detailTab('readings')))).toHaveAttribute('aria-selected', 'true')
    // The persistent banner follows across tabs.
    await expect(page.locator(byTestId(T.admin.thresholdNeededBanner))).toBeVisible({ timeout: 20_000 })

    // The banner's one-click jump returns to Thresholds.
    await page.locator(byTestId(T.admin.thresholdNeededGoto)).click()
    await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute('aria-selected', 'true')
    await tc.dispose()
  })
})

// ── Patient-list threshold signal (UI E2E) ────────────────────────────────────
// The list surfaces "needs threshold" from the OUTSIDE: a count chip (animated
// when >0) + a subtle red row tint, so a provider sees the work without opening
// each patient. Requires the backend `needsThreshold` flag.
test.describe('Patient-list threshold signal (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.33 — a needs-threshold patient is counted in the chip, tints their row, and filters in', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Mandatory + no threshold → needsThreshold=true at the backend list level.
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)

    const chip = page.locator(byTestId(T.admin.patientThresholdFilter))
    await expect(chip).toBeVisible({ timeout: 20_000 })
    await expect(chip).toContainText(/[1-9]/) // count ≥ 1

    // olive's row carries the whole-row subtle red tint class.
    const row = page.locator(byTestId(T.admin.patientListRow(olive.id)))
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toHaveClass(/bg-\[#FDE8E8\]/)

    // Filtering to "threshold needed" keeps olive in view.
    await chip.click()
    await expect(page.locator(byTestId(T.admin.patientListRow(olive.id)))).toBeVisible()
    await tc.dispose()
  })
})

// ── Threshold clear / delete + patient notify (UI E2E) ────────────────────────
// THR-032 (clear a field), THR-033 (delete the row + enrollment cascade),
// THR-034 (patient notified on a threshold change).
test.describe('Threshold clear/delete + notify (UI E2E)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write/e2e tests gated by RUN_WRITE_TESTS=1')
  test.describe.configure({ timeout: 120_000 })

  test('31.34 — clearing a mandatory patient\'s threshold deletes it + re-flags + reverts enrollment', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Mandatory (HCM) + threshold + enrolled, not stale → opens clean (no flag).
    await stageScratch(tc, olive.id, { enrolled: true, hcm: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('thresholds'))).click()

    // Two-step clear.
    await page.locator(byTestId(T.admin.thresholdClear)).click()
    await page.locator(byTestId(T.admin.thresholdClearConfirm)).click()

    // Threshold gone → needs-threshold flag returns; enrollment reverted (cascade).
    await expect(page.locator(byTestId(T.admin.tabThresholdsFlag))).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => (await tc.findUser(PATIENTS.olive.email)).enrollmentStatus, { timeout: 15_000 })
      .toBe('NOT_ENROLLED')

    // Backend cross-check — the row is actually deleted (404).
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const tRes = await api.get(`admin/patients/${olive.id}/threshold`)
    expect(tRes.status()).toBe(404)
    await api.dispose()
    await tc.dispose()
  })

  test('31.35 — emptying a single target field clears it on save (THR-032)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // Non-mandatory so nothing locks/flags; seed a threshold with a DBP-upper set.
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })
    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const create = await api.post(`admin/patients/${olive.id}/threshold`, {
      data: { dbpUpperTarget: 140, dbpLowerTarget: 70 },
    })
    expect(create.ok(), `seed threshold: ${create.status()} ${await create.text()}`).toBeTruthy()

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await gotoPatientDetailById(page, ADMIN_BASE_URL, olive.id)
    await page.locator(byTestId(T.admin.detailTab('thresholds'))).click()
    // Clear DBP-upper, keep DBP-lower, save.
    await page.locator(byTestId(T.admin.thresholdDbpUpper)).fill('')
    await page.locator(byTestId(T.admin.thresholdSave)).click()

    // Backend cross-check — dbpUpper is now null, dbpLower preserved.
    await expect
      .poll(async () => {
        const r = await api.get(`admin/patients/${olive.id}/threshold`)
        return (await r.json())?.data?.dbpUpperTarget
      }, { timeout: 15_000 })
      .toBeNull()
    const after = await (await api.get(`admin/patients/${olive.id}/threshold`)).json()
    expect(after?.data?.dbpLowerTarget).toBe(70)
    await api.dispose()
    await tc.dispose()
  })

  test('31.36 — setting a threshold notifies the patient (THR-034)', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    // resetUser (in stageScratch) clears the inbox, so only the new notice shows.
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })

    const api = await authedApi(API_BASE_URL, ADMIN.email, 'admin')
    const res = await api.post(`admin/patients/${olive.id}/threshold`, {
      data: { sbpUpperTarget: 140, sbpLowerTarget: 90 },
    })
    expect(res.ok(), `set threshold: ${res.status()} ${await res.text()}`).toBeTruthy()
    await api.dispose()

    const notes = await tc.listNotifications(olive.id)
    expect(
      notes.some((n) => /monitoring targets|targets updated/i.test(n.title)),
      `titles: ${notes.map((n) => n.title).join(', ')}`,
    ).toBe(true)
    await tc.dispose()
  })
})
