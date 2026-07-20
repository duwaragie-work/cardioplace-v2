// E2E onboarding fixture — a single throwaway patient seeded UN-onboarded so
// the Playwright onboarding suite (spec 03, A1–A5) can walk the flow from cold
// and reset back to this state via test-control between tests.
//
// Every clinical persona in patients.ts is COMPLETED + ENROLLED, which is why
// spec 03 had no un-onboarded subject and stayed skipped. This patient is the
// missing archetype: NOT_COMPLETED, no name / comm / reminder / consent state,
// no PatientProfile (onboarding is identity-only, orthogonal to enrollment),
// and the perma-OTP so a spec can log in without a real inbox.
//
// TEST-ONLY: run.ts calls this outside production only, and it uses a clearly
// synthetic *.cardioplace.test address — never real PHI.
import { DisplayIdClass } from '../../src/generated/prisma/enums.js'
import { getOrGenerateDisplayIdForEmail } from './display-ids.js'
import { prisma, DEMO_OTP, hashOtp, seedPermaOtp } from './helpers.js'
import type { SeededAdmins } from './admins.js'

export const E2E_ONBOARDING_EMAIL = 'e2e-onboarding@cardioplace.test'

export async function seedE2EOnboardingPatient(admins: SeededAdmins) {
  const otpHash = await hashOtp(DEMO_OTP)
  const displayId = await getOrGenerateDisplayIdForEmail(
    prisma,
    E2E_ONBOARDING_EMAIL,
    DisplayIdClass.PATIENT,
  )

  // upsert with an explicit UN-onboarded update branch: a re-seed must reset
  // this fixture back to cold state even if a prior test run left it COMPLETED.
  const coldState = {
    name: null,
    communicationPreference: null,
    reminderPreferenceSet: false,
    policyAcknowledgedAt: null,
    acknowledgedPolicyVersion: null,
    onboardingStatus: 'NOT_COMPLETED' as const,
    enrollmentStatus: 'NOT_ENROLLED' as const,
  }

  await prisma.user.upsert({
    where: { email: E2E_ONBOARDING_EMAIL },
    update: coldState,
    create: {
      email: E2E_ONBOARDING_EMAIL,
      pwdhash: admins.supportAdmin.pwdhash,
      roles: ['PATIENT'],
      isVerified: true,
      timezone: 'America/New_York',
      preferredLanguage: 'en',
      displayId,
      ...coldState,
    },
  })
  await seedPermaOtp(E2E_ONBOARDING_EMAIL, otpHash)

  console.log(
    `  e2e onboarding fixture: ${E2E_ONBOARDING_EMAIL} (NOT_COMPLETED, perma-OTP)`,
  )
}
