// Phase 0 §C — admin / provider / ops roster.
//
// The six rows below are copied verbatim from the pre-Phase-0 seed.ts
// (back-compat admins + provider trio + ops). §E adds 4 TEST-ONLY matrix
// rows (Practice B MD/provider, unassigned secondary, SUSPENDED provider)
// gated behind `includeTestMatrix`. The baseline 6 rows are unchanged so
// dev/staging/prod environments running the seed see exactly what they
// saw pre-Phase-0.
import { prisma, DEMO_OTP, hashPassword, hashOtp, seedPermaOtp } from './helpers.js'

export async function seedAdmins(options: { includeTestMatrix: boolean }) {
  const pwdhash = await hashPassword('demo-password')
  const otpHash = await hashOtp(DEMO_OTP)

  // ─── Back-compat admin users (keep for existing Postman collections) ─────
  const manishaPatel = await prisma.user.upsert({
    where: { email: 'manisha.patel@cardioplace.test' },
    update: {},
    create: {
      email: 'manisha.patel@cardioplace.test',
      pwdhash,
      name: 'Dr. Manisha Patel',
      roles: ['PROVIDER', 'SUPER_ADMIN'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      dateOfBirth: new Date('1972-05-14'),
      timezone: 'America/New_York',
      preferredLanguage: 'en',
    },
  })
  await seedPermaOtp('manisha.patel@cardioplace.test', otpHash)

  const supportAdmin = await prisma.user.upsert({
    where: { email: 'support@healplace.com' },
    update: { roles: ['SUPER_ADMIN', 'PROVIDER', 'MEDICAL_DIRECTOR'] },
    create: {
      email: 'support@healplace.com',
      pwdhash,
      name: 'Dr. Manisha Singal',
      roles: ['SUPER_ADMIN', 'PROVIDER', 'MEDICAL_DIRECTOR'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
      preferredLanguage: 'en',
    },
  })
  await seedPermaOtp('support@healplace.com', otpHash)
  console.log(`  admin: support@healplace.com (OTP ${DEMO_OTP})`)

  // ─── Provider trio + HealPlace ops (assignment targets) ──────────────────
  const primaryProvider = await prisma.user.upsert({
    where: { email: 'primary-provider@cardioplace.test' },
    update: {},
    create: {
      email: 'primary-provider@cardioplace.test',
      pwdhash,
      name: 'Dr. Samuel Okonkwo',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('primary-provider@cardioplace.test', otpHash)

  const backupProvider = await prisma.user.upsert({
    where: { email: 'backup-provider@cardioplace.test' },
    update: {},
    create: {
      email: 'backup-provider@cardioplace.test',
      pwdhash,
      name: 'Dr. Elena Reyes',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('backup-provider@cardioplace.test', otpHash)

  const medicalDirector = await prisma.user.upsert({
    where: { email: 'medical-director@cardioplace.test' },
    update: {},
    create: {
      email: 'medical-director@cardioplace.test',
      pwdhash,
      name: 'Dr. Priya Raman',
      roles: ['MEDICAL_DIRECTOR'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('medical-director@cardioplace.test', otpHash)

  const opsUser = await prisma.user.upsert({
    where: { email: 'ops@healplace.com' },
    update: {},
    create: {
      email: 'ops@healplace.com',
      pwdhash,
      name: 'HealPlace Ops',
      roles: ['HEALPLACE_OPS'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('ops@healplace.com', otpHash)

  console.log(
    `  providers: primary ${primaryProvider.email}, backup ${backupProvider.email}, MD ${medicalDirector.email}`,
  )
  console.log(`  ops: ${opsUser.email}`)

  // ─── §E — missing admin-matrix rows (TEST-ONLY) ──────────────────────────
  // Phase 3 needs: a Practice B medical director + Practice B provider
  // (cross-practice / scope tests), an unassigned PROVIDER (negative-case:
  // sees no patients), and a SUSPENDED provider (status-filter + reactivate
  // flow). CAREGIVER is intentionally absent — no such UserRole exists
  // (decision 3); the caregiver cohort/matrix row is dropped, not migrated.
  //
  // These 4 rows are only seeded when SEED_TEST_FIXTURES=true. Without them
  // the return shape stays compatible (matrix keys are undefined) so the
  // baseline seed still satisfies the SeededAdmins type.
  if (!options.includeTestMatrix) {
    return {
      manishaPatel,
      supportAdmin,
      primaryProvider,
      backupProvider,
      medicalDirector,
      opsUser,
      medicalDirectorB: undefined,
      providerB: undefined,
      secondaryProvider: undefined,
      suspendedProvider: undefined,
    }
  }

  const medicalDirectorB = await prisma.user.upsert({
    where: { email: 'medical-director-b@cardioplace.test' },
    update: {},
    create: {
      email: 'medical-director-b@cardioplace.test',
      pwdhash,
      name: 'Dr. Robert Jones',
      roles: ['MEDICAL_DIRECTOR'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('medical-director-b@cardioplace.test', otpHash)

  const providerB = await prisma.user.upsert({
    where: { email: 'provider-b@cardioplace.test' },
    update: {},
    create: {
      email: 'provider-b@cardioplace.test',
      pwdhash,
      name: 'Dr. Sarah Smith',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('provider-b@cardioplace.test', otpHash)

  // Practice A PROVIDER deliberately NOT named on any PatientProviderAssignment
  // — drives the "provider sees zero assigned patients" negative-case tests.
  const secondaryProvider = await prisma.user.upsert({
    where: { email: 'secondary-provider@cardioplace.test' },
    update: {},
    create: {
      email: 'secondary-provider@cardioplace.test',
      pwdhash,
      name: 'Dr. Sam Secondary',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('secondary-provider@cardioplace.test', otpHash)

  // SUSPENDED (decision 4 — AccountStatus has no INACTIVE; map to SUSPENDED).
  // `update` re-asserts SUSPENDED so a test that reactivates this user then
  // re-seeds gets the fixture back to its seeded state.
  const suspendedProvider = await prisma.user.upsert({
    where: { email: 'suspended-provider@cardioplace.test' },
    update: { accountStatus: 'SUSPENDED' },
    create: {
      email: 'suspended-provider@cardioplace.test',
      pwdhash,
      name: 'Dr. Pat Suspended',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      accountStatus: 'SUSPENDED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('suspended-provider@cardioplace.test', otpHash)

  console.log(
    `  +matrix: ${medicalDirectorB.email} (MD/B), ${providerB.email} (PROV/B), ${secondaryProvider.email} (unassigned), ${suspendedProvider.email} (SUSPENDED)`,
  )

  return {
    manishaPatel,
    supportAdmin,
    primaryProvider,
    backupProvider,
    medicalDirector,
    opsUser,
    medicalDirectorB,
    providerB,
    secondaryProvider,
    suspendedProvider,
  }
}

export type SeededAdmins = Awaited<ReturnType<typeof seedAdmins>>
