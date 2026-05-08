import { test, expect } from '@playwright/test'
import { signInPatient, apiSignIn, authedApi } from '../helpers/auth.js'
import { PATIENTS } from '../helpers/accounts.js'
import { newTestControl } from '../helpers/test-control.js'
import { API_BASE_URL } from '../playwright.config.js'

/**
 * Onboarding (identity-level) and the Layer A journaling gate. Per
 * TESTING_FLOW_GUIDE §6, a patient must have a `PatientProfile` row before
 * `POST /daily-journal` accepts a reading — the backend returns 403
 * `{ message: "clinical-intake-required" }` otherwise.
 *
 * The seed patients (Priya/James/Rita/Charles/Aisha) are all already past
 * onboarding + intake, so to test the gate we use the test-control endpoint
 * to wipe a seed patient's PatientProfile (NOT done — destructive and
 * irreversible without a reseed). Instead, use a fresh ad-hoc email and walk
 * the journey from cold.
 */

const AD_HOC_EMAIL = `qa-onboarding-${Date.now()}@cardioplace.test`

test.describe.serial('Patient onboarding journey (ad-hoc account)', () => {
  test.skip(
    !process.env.RUN_WRITE_TESTS,
    'Write tests gated behind RUN_WRITE_TESTS=1 (creates new user)',
  )

  test('cold sign-in lands on /onboarding for fresh email', async ({ page }) => {
    // Step 1 — OTP send via API (real OTP would normally email out; in dev
    // the auth.service should accept seed perma-OTP only for seeded accounts.
    // This ad-hoc flow needs a real sent OTP — see backend logs for the
    // `OTP for <email>: NNNNNN` line.
    test.skip(
      true,
      'TODO(next-pass): seed a blank-archetype patient in seed.ts that uses the perma-OTP ' +
        '666666, then exercise the onboarding redirect end-to-end. Until then the ad-hoc ' +
        'flow needs a fresh OTP from backend logs and cannot run unattended.',
    )
    await page.goto('/sign-in')
  })
})

test.describe('Layer A journaling gate (no PatientProfile → 403)', () => {
  test('seed patient with profile can POST /daily-journal (control case)', async ({}, testInfo) => {
    // Confirm the gate doesn't fire for an enrolled seed patient. Aisha is
    // the no-alert control — her existing PatientProfile means the engine
    // accepts the reading and runs the rule pipeline (which produces no alert
    // for 124/78/72).
    const api = await authedApi(API_BASE_URL, PATIENTS.aisha.email)
    const res = await api.post('daily-journal', {
      data: {
        measuredAt: new Date().toISOString(),
        systolicBP: 124,
        diastolicBP: 78,
        pulse: 72,
        position: 'SITTING',
      },
    })
    expect(res.status(), `aisha control reading: ${await res.text()}`).toBe(202)
    await api.dispose()
  })

  test(
    'patient WITHOUT PatientProfile gets 403 clinical-intake-required',
    async () => {
      // Drive via test-control to flip a seed patient back to no-profile is
      // destructive — we'd need to delete + reseed PatientProfile. Skip until
      // the test-control endpoint adds a `wipe-profile` helper, OR until
      // seed.ts adds a blank patient archetype.
      test.skip(
        true,
        'TODO(next-pass): add /test-control/profile/wipe endpoint OR a "blank" seed archetype, ' +
          'then assert 403 + body.message="clinical-intake-required".',
      )
    },
  )
})
