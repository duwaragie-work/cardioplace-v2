import { test, expect } from '@playwright/test'
import { authedApi } from '../helpers/auth.js'
import { ADMINS, PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { adminEnrollmentCheck, adminCompleteEnrollment } from '../helpers/api.js'
import { API_BASE_URL } from '../playwright.config.js'

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
    test.skip(true, 'TODO(next-pass): test-control endpoint to null out practice business hours')
  })
})
