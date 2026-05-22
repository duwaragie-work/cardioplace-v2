import { test, expect, type Page } from '@playwright/test'
import { signInAdmin, authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl, type TestControl } from '../helpers/test-control.js'
import {
  correctProfileFieldViaUI,
  editThresholdViaUI,
  admitPatientViaUI,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * UI end-to-end coverage for the threshold-review / enrollment-safety cluster
 * (IVR-04 + THR-REVIEW + IVR-08/16/23 + care-team notifications). Drives the
 * REAL admin browser — the force-to-Thresholds lock (other tabs disabled +
 * auto-redirect), the enrollment revert / auto-restore, the per-field verify
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

// ── Lock assertions (the heart of THR-REVIEW) ───────────────────────────────
async function expectLockedToThresholds(page: Page): Promise<void> {
  // Forced onto Thresholds…
  await expect(page.locator(byTestId(T.admin.detailTab('thresholds')))).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 20_000 },
  )
  // …and the other tabs + Back are blocked.
  await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeDisabled({
    timeout: 20_000,
  })
  await expect(page.locator(byTestId(T.admin.detailTab('profile')))).toBeDisabled()
}

async function expectUnlocked(page: Page): Promise<void> {
  await expect(page.locator(byTestId(T.admin.detailTab('medications')))).toBeEnabled({
    timeout: 20_000,
  })
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
  test('31.1 — admin adds HCM (no threshold) → enrollment reverts + locked to Thresholds', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    // Add HCM via the Profile tab (writes the condition log + runs IVR-04).
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'true', 'QA: add HCM')

    // Lock engaged (forced to Thresholds, other tabs disabled).
    await expectLockedToThresholds(page)
    // Enrollment reverted → the EnrollmentCard reappears.
    await expect(page.locator(byTestId(T.admin.enrollmentCard))).toBeVisible({ timeout: 20_000 })
    // Backend cross-check (single source of truth for the flip).
    const after = await tc.findUser(PATIENTS.olive.email)
    expect(after.enrollmentStatus).toBe('NOT_ENROLLED')
    await tc.dispose()
  })

  // ── IVR-04 auto-re-enroll: setting the threshold restores monitoring ──────
  test('31.2 — setting the threshold auto-re-enrolls + clears the lock + logs to Timeline', async ({ page }) => {
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

    // Auto-re-enroll → EnrollmentCard unmounts + lock clears.
    await expect(page.locator(byTestId(T.admin.enrollmentCard))).toBeHidden({ timeout: 20_000 })
    await expectUnlocked(page)
    const after = await tc.findUser(PATIENTS.olive.email)
    expect(after.enrollmentStatus).toBe('ENROLLED')

    // Timeline shows the auto-restore audit row (tabs now navigable).
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    await expect(page.locator(byTestId(T.admin.timelineList))).toContainText(/patient enrolled/i, {
      timeout: 20_000,
    })
    await tc.dispose()
  })

  // ── THR-REVIEW stale (add) + attest path ──────────────────────────────────
  test('31.3 — admin adds HCM with a threshold on file → stale lock; attest clears it', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'true', 'QA: add HCM (stale)')

    // Stale lock — review banner shown, enrollment unchanged (threshold exists).
    await expectLockedToThresholds(page)
    await expect(page.locator(byTestId(T.admin.thresholdReviewBanner))).toBeVisible({ timeout: 20_000 })
    expect((await tc.findUser(PATIENTS.olive.email)).enrollmentStatus).toBe('ENROLLED')

    // Attest "Targets still correct" with the required note → lock clears.
    await page.locator(byTestId(T.admin.thresholdReviewNote)).fill('QA: targets still appropriate')
    await page.locator(byTestId(T.admin.thresholdAttest)).click()
    await expectUnlocked(page)
    await tc.dispose()
  })

  // ── THR-REVIEW on REMOVAL (admin disables HCM) ────────────────────────────
  test('31.4 — admin disables HCM with a threshold on file → re-review lock fires', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, hcm: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await correctProfileFieldViaUI(page, olive.id, 'hasHCM', 'false', 'QA: remove HCM')

    await expectLockedToThresholds(page)
    await expect(page.locator(byTestId(T.admin.thresholdReviewBanner))).toBeVisible({ timeout: 20_000 })
    await tc.dispose()
  })

  // ── Initial setup also locks; OPS is never locked ─────────────────────────
  test('31.5 — mandatory patient with no threshold locks an editor on open', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await expectLockedToThresholds(page)
    await tc.dispose()
  })

  test('31.6 — HEALPLACE_OPS is NOT locked (read-only, cannot edit thresholds)', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMINS.ops.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    // OPS can freely navigate — the Medications tab stays enabled.
    await expectUnlocked(page)
    await tc.dispose()
  })

  // ── Tab order: Profile → Thresholds → Medications ─────────────────────────
  test('31.7 — patient-detail tab order puts Thresholds second', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: true, withThreshold: true })

    await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    const confirmAll = page.locator(byTestId(T.admin.profileConfirmAll))
    await expect(confirmAll).toBeVisible({ timeout: 20_000 })
    await confirmAll.click()
    // Once everything's confirmed there are no pending fields left to confirm.
    await expect(confirmAll).toBeHidden({ timeout: 20_000 })
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
      await page.waitForURL(new RegExp(`/patients/${olive.id}`), { timeout: 20_000 })
      expect(page.url()).toContain(`/patients/${olive.id}`)
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

    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    await expect(tl).toContainText(/enrollment reverted/i, { timeout: 20_000 })
    await expect(tl).toContainText(/patient enrolled/i)
    await expect(tl).toContainText(/hypertrophic cardiomyopathy/i)
    await expect(tl).toContainText(/corrected by admin/i)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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

    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    const tl = page.locator(byTestId(T.admin.timelineList))
    await expect(tl).toContainText(/coronary artery disease.*verified by admin|verified by admin/i, {
      timeout: 20_000,
    })
    await expect(tl).toContainText(/atrial fibrillation/i)
    await expect(tl).toContainText(/rejected by admin/i)
    await expect(tl).toContainText(/heart failure/i)
    await expect(tl).toContainText(/corrected by admin/i)
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
    await expectLockedToThresholds(page)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
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

    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    const banner = page.locator(byTestId(T.admin.profileChangedBanner))
    await expect(banner).toBeVisible({ timeout: 20_000 })
    await expect(banner).toContainText(/diagnosed hypertension/i)
    await tc.dispose()
  })

  // Patient adds a mandatory condition WHILE a threshold exists → no revert, a
  // "review needed" notice, and the admin is locked on open (stale threshold).
  test('31.18 — patient adds HCM with a threshold on file → review notice + admin locked on open', async ({ page }) => {
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
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await expectLockedToThresholds(page)
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

    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await page.locator(byTestId(T.admin.detailTab('timeline'))).click()
    await expect(page.locator(byTestId(T.admin.timelineList))).toContainText(
      /enrollment completed by admin/i,
      { timeout: 20_000 },
    )
    await tc.dispose()
  })

  // The lock applies to a PROVIDER (a threshold-editor), not only SUPER_ADMIN.
  test('31.20 — a PROVIDER is also locked by a mandatory-without-threshold patient', async ({ page }) => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const olive = await tc.findUser(PATIENTS.olive.email)
    await stageScratch(tc, olive.id, { enrolled: false, hcm: true, withThreshold: false })

    await signInAdmin(page, ADMINS.primaryProvider.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients/${olive.id}`)
    await expectLockedToThresholds(page)
    await tc.dispose()
  })
})

// ── Seed-patient lock diagnosis (UI E2E) ─────────────────────────────────────
// Read-only: for shared seed patients (James/Paul) the lock must fire EXACTLY
// when the threshold is missing or stale (a mandatory condition changed after
// the threshold was set). A patient locked with a threshold and NO newer
// condition change would be a false-positive bug — this asserts against that
// and attaches the breakdown so the cause is visible.
test.describe('Seed-patient lock diagnosis (UI E2E)', () => {
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
    test(`${n} — ${key}: lock fires iff threshold missing or stale (diagnosis)`, async ({ page }, testInfo) => {
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
      const wouldLock = stale || (mandatory && !threshold)

      // Observe the real UI lock.
      await signInAdmin(page, ADMIN.email, ADMIN_BASE_URL)
      await page.goto(`${ADMIN_BASE_URL}/patients/${u.id}`)
      await page.locator(byTestId(T.admin.detailHeader)).waitFor({ state: 'visible', timeout: 20_000 })
      // Let the shell load logs + the gate settle before reading the lock.
      await page.waitForTimeout(2500)
      const uiLocked = await page.locator(byTestId(T.admin.detailTab('medications'))).isDisabled()

      const diagnosis = {
        patient: key,
        mandatory,
        hasThreshold: !!threshold,
        thresholdSetAt: threshold?.setAt ?? null,
        latestMandatoryConditionChangeAt: changedAt ? new Date(changedAt).toISOString() : null,
        stale,
        // Check `stale` first: a non-mandatory patient can still lock when a
        // mandatory condition was REMOVED after the threshold was set.
        reason: stale
          ? 'a mandatory condition changed AFTER the threshold was set → stale → locked (re-save/attest to clear)'
          : mandatory && !threshold
            ? 'mandatory + NO threshold → locked (set one to clear)'
            : !mandatory
              ? 'not mandatory + not stale → not locked'
              : 'threshold present + not stale → not locked',
        wouldLock,
        uiLocked,
      }
      await testInfo.attach(`lock-diagnosis-${key}`, {
        body: JSON.stringify(diagnosis, null, 2),
        contentType: 'application/json',
      })

      // The lock must fire EXACTLY when missing-or-stale — no false positives.
      expect(uiLocked, `lock mismatch — diagnosis: ${JSON.stringify(diagnosis)}`).toBe(wouldLock)
      await tc.dispose()
    })
  }
})
