// Phase 0 §C — admin / provider / ops roster.
//
// The six rows below are copied verbatim from the pre-Phase-0 seed.ts
// (back-compat admins + provider trio + ops). §E adds the missing matrix
// rows (Practice B MD/provider, unassigned secondary, SUSPENDED provider)
// under the same firstname.lastname@ / role@ scheme — no recreation.
import { prisma, DEMO_OTP, hashPassword, hashOtp, seedPermaOtp } from './helpers.js'

export async function seedAdmins() {
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

  // ─── Coordinator (phase/23 user-management + e2e persona) ────────────────
  // Front-desk role scoped to a single practice via PracticeCoordinator.
  // The QA suite (specs 35/37/38) signs in as this persona to drive the
  // patient-invite + user-management flows and to assert the COORDINATOR
  // permission boundaries. Linked to the Cedar Hill seed practice so the
  // server-side implicit-practice fill has something to resolve.
  const coordinator = await prisma.user.upsert({
    where: { email: 'coordinator.fernando@cardioplace.test' },
    update: { roles: ['COORDINATOR'] },
    create: {
      email: 'coordinator.fernando@cardioplace.test',
      pwdhash,
      name: 'Lakshitha Fernando',
      roles: ['COORDINATOR'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
    },
  })
  await seedPermaOtp('coordinator.fernando@cardioplace.test', otpHash)
  await prisma.practiceCoordinator.upsert({
    where: { userId: coordinator.id },
    update: { practiceId: 'seed-cedar-hill' },
    create: { userId: coordinator.id, practiceId: 'seed-cedar-hill' },
  })

  console.log(
    `  providers: primary ${primaryProvider.email}, backup ${backupProvider.email}, MD ${medicalDirector.email}`,
  )
  console.log(`  ops: ${opsUser.email}`)
  console.log(`  coordinator: ${coordinator.email} (practice seed-cedar-hill)`)

  return {
    manishaPatel,
    supportAdmin,
    primaryProvider,
    backupProvider,
    medicalDirector,
    opsUser,
    coordinator,
  }
}

export type SeededAdmins = Awaited<ReturnType<typeof seedAdmins>>
