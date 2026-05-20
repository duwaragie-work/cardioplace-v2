import { test, expect } from '@playwright/test'
import { authedApi, signInAdmin } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import {
  adminEnrollmentCheck,
  adminCompleteEnrollment,
  admitPatientViaUI,
} from '../helpers/api.js'
import { API_BASE_URL, ADMIN_BASE_URL } from '../playwright.config.js'
import { byTestId, T } from '../helpers/selectors.js'

/**
 * Admin enrollment gate (TESTING_FLOW_GUIDE §6.2). The 4-piece gate at
 * `POST /admin/patients/:id/complete-enrollment`:
 *   1. PatientProviderAssignment exists                   → no-assignment
 *   2. Linked Practice has business hours all set         → practice-missing-business-hours
 *   3. PatientProfile row exists                          → patient-profile-missing
 *   4. If HFrEF/HCM/DCM: PatientThreshold exists          → threshold-required-for-condition
 *
 * GET /admin/patients/:id/enrollment-check returns the same set of reasons
 * without flipping enrollmentStatus.
 *
 * The 5 seeded patients are all already ENROLLED in the seed. We cannot
 * easily roll them back to NOT_ENROLLED + missing-piece without destructive
 * test-control work. Spec covers the happy path on enrolled patients +
 * sketches the failure-mode tests as TODOs gated by extra test-control hooks.
 */

test.describe('Enrollment gate — happy path', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated')

  test('seeded enrolled patient passes /enrollment-check', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    const api = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')
    const result = await adminEnrollmentCheck(api, u.id)
    expect(result.ready, `enrollment-check reasons: ${JSON.stringify(result.reasons)}`).toBe(true)
    expect(result.reasons).toEqual([])
    await api.dispose()
    await tc.dispose()
  })

  test('complete-enrollment is idempotent on already-enrolled patients', async () => {
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    const api = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')

    // Force ENROLLED first (defensive — if a prior test backed out, restore)
    await tc.setEnrollment(u.id, 'ENROLLED')
    const r1 = await adminCompleteEnrollment(api, u.id)
    expect(r1.ok, `first complete: ${JSON.stringify(r1)}`).toBeTruthy()
    const r2 = await adminCompleteEnrollment(api, u.id)
    expect(r2.ok, `second complete: ${JSON.stringify(r2)}`).toBeTruthy()
    await api.dispose()
    await tc.dispose()
  })
})

test.describe('Enrollment gate — failure modes (TODO)', () => {
  test('NOT_ENROLLED patient with no assignment fails with no-assignment reason', async () => {
    test.skip(
      true,
      'TODO(next-pass): add /test-control/assignment/wipe + create blank patient archetype, ' +
        'then assert reasons[] contains "no-assignment".',
    )
  })

  test('HFrEF patient without threshold fails with threshold-required-for-condition', async () => {
    test.skip(
      true,
      'TODO(next-pass): test-control needs to wipe James\'s PatientThreshold row, then ' +
        'enrollment-check returns reasons:[ "threshold-required-for-condition" ].',
    )
  })

  test('Practice missing business hours fails with practice-missing-business-hours', async () => {
    test.skip(!process.env.RUN_WRITE_TESTS, 'Write tests gated — mutates practice businessHours then restores')
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const u = await tc.findUser(PATIENTS.aisha.email)
    const api = await authedApi(API_BASE_URL, ADMINS.manisha.email, 'admin')

    // Clear businessHours on the practice attached to Aisha's assignment.
    // Capture the prior values so the `finally` block can restore them and
    // keep the seed state intact for downstream tests.
    const { prior } = await tc.clearPracticeBusinessHours(u.id)
    try {
      const result = await adminEnrollmentCheck(api, u.id)
      expect(result.ready, `enrollment-check reasons: ${JSON.stringify(result.reasons)}`).toBe(false)
      expect(result.reasons).toContain('practice-missing-business-hours')
    } finally {
      await tc.restorePracticeBusinessHours(u.id, prior)
      await api.dispose()
      await tc.dispose()
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Phase 3 §F — enrollment workflow UI (30f.1, 30f.2)
//
// §F.3 (unenroll) is DROPPED: there is NO unenroll affordance anywhere in
// the admin UI — EnrollmentCard only admits and returns null once ENROLLED.
// Documented as a Category-C product gap in RESULTS.md (no fake skip).
//
// PATIENTS.aisha is the canonical enrollable patient (passes the gate with
// reasons:[] per the happy-path test above). The enrollment status flip is
// the audit-backed proof (no tc.listAuditTrail endpoint exists).
// ───────────────────────────────────────────────────────────────────────────
test.describe('Phase 3 §F — enrollment workflow (UI)', () => {
  test.skip(!process.env.RUN_WRITE_TESTS, 'Phase 3 admin write/e2e gated')

  test('30f.1 — admit a NOT_ENROLLED patient via EnrollmentCard → status flips ENROLLED', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    // Deterministic setup: verified profile + NOT_ENROLLED. Aisha already
    // has a care-team assignment (no mandatory threshold — control/HTN).
    await tc.setProfileVerificationStatus(aisha.id, 'VERIFIED')
    await tc.setEnrollment(aisha.id, 'NOT_ENROLLED')

    // Confirm the gate is open (button would be disabled otherwise).
    const api = await authedApi(API_BASE_URL, ADMINS.medicalDirector.email, 'admin')
    const chk = await adminEnrollmentCheck(api, aisha.id)
    await api.dispose()
    expect(chk.ready, `enrollment gate blocked: ${JSON.stringify(chk.reasons)}`).toBe(true)

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await admitPatientViaUI(page, aisha.id) // clicks enroll, waits card to unmount

    const after = await tc.findUser(PATIENTS.aisha.email)
    expect(after.enrollmentStatus).toBe('ENROLLED')
  })

  test('30f.2 — an ENROLLED patient shows the "Enrolled" pill in the /patients list', async ({ page }) => {
    test.setTimeout(90_000)
    const tc = await newTestControl(API_BASE_URL, process.env.TEST_CONTROL_SECRET)
    const aisha = await tc.findUser(PATIENTS.aisha.email)
    await tc.setEnrollment(aisha.id, 'ENROLLED')

    await signInAdmin(page, ADMINS.medicalDirector.email, ADMIN_BASE_URL)
    await page.goto(`${ADMIN_BASE_URL}/patients`)
    const row = page.locator(byTestId(T.admin.patientListRow(aisha.id)))
    await expect(row).toBeVisible({ timeout: 20_000 })
    await expect(row).toContainText(/enrolled/i)
  })
})
