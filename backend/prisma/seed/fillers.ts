// Phase 0 §F — filler patient cohort.
//
// 30 deterministic filler patients across 8 groups. Sized per decision 6:
// max(PAGE_SIZE+5, 30). The admin patient list has NO pagination (verified:
// admin/src/app/patients/page.tsx renders all rows client-side; backend
// provider.service.getPatients has no take/skip), so no PAGE_SIZE constant
// exists → the floor of 30 applies. Fillers therefore exist for the
// status / verification / open-alert / cross-practice filter cohorts and
// SUPER_ADMIN cross-practice visibility — NOT for a page-2 assertion.
//
// Idempotent: every row upserts on a unique key (email / userId); the
// med-verify group's medication is wipe+recreated like the personas.
// No PatientThreshold (fillers inherit the practice default — §O). No
// readings (not needed; list/filter tests don't require them). The
// `filler-alert-*` group's OPEN alert + its required JournalEntry are
// created by seedState (§G, dev/test only) so the production seed stays
// alert-free.
import {
  prisma,
  DEMO_OTP,
  hashOtp,
  seedPermaOtp,
} from './helpers.js'
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'

type FillerGroup = {
  key: string
  /** email prefix → `${prefix}-${n}@cardioplace.test` */
  prefix: string
  count: number
  practice: 'A' | 'B'
  enrollmentStatus: 'ENROLLED' | 'NOT_ENROLLED'
  accountStatus: 'ACTIVE' | 'SUSPENDED'
  profileVerificationStatus: 'UNVERIFIED' | 'VERIFIED'
  /** attach one UNVERIFIED medication (med-verify queue cohort) */
  unverifiedMed?: boolean
}

// 3+2+3+2+2+5+5+8 = 30
const GROUPS: FillerGroup[] = [
  { key: 'pending-profile-verif-A', prefix: 'filler-pv-a', count: 3, practice: 'A', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'UNVERIFIED' },
  { key: 'pending-profile-verif-B', prefix: 'filler-pv-b', count: 2, practice: 'B', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'UNVERIFIED' },
  { key: 'pending-med-verif', prefix: 'filler-mv', count: 3, practice: 'A', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'VERIFIED', unverifiedMed: true },
  { key: 'suspended', prefix: 'filler-susp', count: 2, practice: 'A', enrollmentStatus: 'ENROLLED', accountStatus: 'SUSPENDED', profileVerificationStatus: 'VERIFIED' },
  { key: 'not-enrolled', prefix: 'filler-ne', count: 2, practice: 'A', enrollmentStatus: 'NOT_ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'UNVERIFIED' },
  { key: 'no-open-alerts', prefix: 'filler-clear', count: 5, practice: 'A', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'VERIFIED' },
  { key: 'with-open-alert', prefix: 'filler-alert', count: 5, practice: 'A', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'VERIFIED' },
  { key: 'practice-B-filler', prefix: 'filler-b', count: 8, practice: 'B', enrollmentStatus: 'ENROLLED', accountStatus: 'ACTIVE', profileVerificationStatus: 'VERIFIED' },
]

/** Stable email for a filler — referenced by §G + Phase 3 tests. */
export function fillerEmail(prefix: string, n: number): string {
  return `${prefix}-${n}@cardioplace.test`
}

export async function seedFillers(
  practices: SeededPractices,
  admins: SeededAdmins,
) {
  const otpHash = await hashOtp(DEMO_OTP)
  const { practiceA, practiceB } = practices
  const {
    supportAdmin,
    primaryProvider,
    backupProvider,
    medicalDirector,
    providerB,
    medicalDirectorB,
  } = admins

  let globalIdx = 0
  for (const g of GROUPS) {
    for (let n = 1; n <= g.count; n++) {
      globalIdx++
      const email = fillerEmail(g.prefix, n)
      const verified = g.profileVerificationStatus === 'VERIFIED'

      const user = await prisma.user.upsert({
        where: { email },
        update: {
          // Re-assert the group's status fields so a test that mutates a
          // filler then triggers a re-seed gets the fixture back.
          enrollmentStatus: g.enrollmentStatus,
          accountStatus: g.accountStatus,
        },
        create: {
          email,
          pwdhash: supportAdmin.pwdhash,
          name: `Filler ${g.key} #${n}`,
          roles: ['PATIENT'],
          isVerified: true,
          onboardingStatus: 'COMPLETED',
          enrollmentStatus: g.enrollmentStatus,
          accountStatus: g.accountStatus,
          dateOfBirth: new Date(1955, 0, 1 + globalIdx),
          timezone: 'America/New_York',
          preferredLanguage: 'en',
        },
      })
      await seedPermaOtp(email, otpHash)

      await prisma.patientProfile.upsert({
        where: { userId: user.id },
        update: {
          profileVerificationStatus: g.profileVerificationStatus,
        },
        create: {
          userId: user.id,
          gender: globalIdx % 2 === 0 ? 'MALE' : 'FEMALE',
          heightCm: 165,
          diagnosedHypertension: true,
          profileVerificationStatus: g.profileVerificationStatus,
          profileVerifiedAt: verified ? new Date() : null,
          profileVerifiedBy: verified ? supportAdmin.id : null,
        },
      })

      const practiceId = g.practice === 'A' ? practiceA.id : practiceB.id
      const primaryId = g.practice === 'A' ? primaryProvider.id : providerB.id
      const backupId = g.practice === 'A' ? backupProvider.id : providerB.id
      const mdId = g.practice === 'A' ? medicalDirector.id : medicalDirectorB.id
      await prisma.patientProviderAssignment.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          practiceId,
          primaryProviderId: primaryId,
          backupProviderId: backupId,
          medicalDirectorId: mdId,
        },
      })

      if (g.unverifiedMed) {
        // Wipe+recreate (mirrors persona meds) so re-seed stays idempotent.
        await prisma.patientMedication.deleteMany({ where: { userId: user.id } })
        await prisma.patientMedication.create({
          data: {
            userId: user.id,
            drugName: 'Lisinopril',
            drugClass: 'ACE_INHIBITOR',
            frequency: 'ONCE_DAILY',
            source: 'PATIENT_SELF_REPORT',
            verificationStatus: 'UNVERIFIED',
          },
        })
      }
    }
    console.log(`  fillers: ${g.key} ×${g.count} (practice ${g.practice})`)
  }
}
