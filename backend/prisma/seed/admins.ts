// Phase 0 §C — admin / provider / ops roster.
//
// The six rows below are copied verbatim from the pre-Phase-0 seed.ts
// (back-compat admins + provider trio + ops). §E adds the missing matrix
// rows (Practice B MD/provider, unassigned secondary, SUSPENDED provider)
// under the same firstname.lastname@ / role@ scheme — no recreation.
import { DisplayIdClass } from '../../src/generated/prisma/enums.js'
import { getOrGenerateDisplayIdForEmail } from './display-ids.js'
import { prisma, DEMO_OTP, hashPassword, hashOtp, seedPermaOtp } from './helpers.js'

const SEED_TEST_FIXTURES = process.env.SEED_TEST_FIXTURES === 'true'

// Wrapper for the common admin pattern: every admin upsert must supply a
// displayId in its `create` clause now that User.displayId is NOT NULL.
// Idempotent — re-running the seed reuses the existing value.
async function staffDisplayId(email: string): Promise<string> {
  return getOrGenerateDisplayIdForEmail(prisma, email, DisplayIdClass.STAFF)
}

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
      displayId: await staffDisplayId('manisha.patel@cardioplace.test'),
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
      displayId: await staffDisplayId('support@healplace.com'),
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
      displayId: await staffDisplayId('primary-provider@cardioplace.test'),
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
      displayId: await staffDisplayId('backup-provider@cardioplace.test'),
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
      displayId: await staffDisplayId('medical-director@cardioplace.test'),
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
      displayId: await staffDisplayId('ops@healplace.com'),
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
      displayId: await staffDisplayId('coordinator.fernando@cardioplace.test'),
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

  // ─── Out-of-scope PROVIDER (V-01/V-04 IDOR spec harness) ─────────────────
  // PROVIDER role linked ONLY to the IDOR harness practice (seed-idor-harness,
  // created in practices.ts). That practice holds ZERO patients, so every
  // seed alert lives in a different practice than this actor's active
  // context. PatientAccessService.assertCanAccessPatient's inActiveScope()
  // check trips the 403 branch on every alert, which is exactly what spec 76
  // (V-01/V-04 IDOR) needs to prove the HTTP-layer scope gate.
  //
  // Why one membership and not zero: auth.service.ts:224-232's
  // resolvePracticeContext blocks sign-in for PROVIDERs/MDs with zero
  // PracticeProvider (or PracticeMedicalDirector) rows — "No practice
  // membership — contact your admin". A single membership on a harness
  // practice satisfies that guard AND keeps the actor out-of-scope for every
  // real patient. Two memberships would trigger the practice-selector flow,
  // which the spec's headless apiSignIn doesn't drive.
  //
  // Using the primary/backup/multi-practice providers for this spec would
  // legitimately return 200 (they're all Cedar Hill members) — see
  // qa/tests/76-alert-scope-idor.spec.ts for the actor rationale.
  //
  // NOT gated behind SEED_TEST_FIXTURES: spec 76 is a security-critical
  // finding that must run in every CI shard, and the row cost is trivial
  // (one User, one Practice, one PracticeProvider join).
  const outOfScopeProvider = await prisma.user.upsert({
    where: { email: 'outofscope-provider@cardioplace.test' },
    update: {},
    create: {
      email: 'outofscope-provider@cardioplace.test',
      pwdhash,
      name: 'Dr. Ines Vega',
      roles: ['PROVIDER'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
      displayId: await staffDisplayId('outofscope-provider@cardioplace.test'),
    },
  })
  await seedPermaOtp('outofscope-provider@cardioplace.test', otpHash)
  await prisma.practiceProvider.upsert({
    where: {
      practiceId_userId: {
        practiceId: 'seed-idor-harness',
        userId: outOfScopeProvider.id,
      },
    },
    update: {},
    create: {
      practiceId: 'seed-idor-harness',
      userId: outOfScopeProvider.id,
    },
  })
  console.log(`  out-of-scope provider: ${outOfScopeProvider.email} (single membership: seed-idor-harness — V-01/V-04 harness)`)

  // ─── Multi-practice provider fixture (phase/practice-identity) ───────────
  // Behind SEED_TEST_FIXTURES so production seeds stay single-practice. Drives
  // Playwright specs 34/35/36: this provider is a member of BOTH Cedar Hill
  // and BridgePoint, so sign-in surfaces the selector and the top-bar chip
  // becomes a switcher. PracticeProvider memberships are added in the same
  // gate (no-op when SEED_TEST_FIXTURES is unset because Practice B doesn't
  // exist).
  let multiPracticeProvider: Awaited<
    ReturnType<typeof prisma.user.upsert>
  > | null = null
  if (SEED_TEST_FIXTURES) {
    multiPracticeProvider = await prisma.user.upsert({
      where: { email: 'multi-practice-provider@cardioplace.test' },
      update: { roles: ['PROVIDER'] },
      create: {
        email: 'multi-practice-provider@cardioplace.test',
        pwdhash,
        name: 'Dr. Aisha Nasser',
        roles: ['PROVIDER'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
        timezone: 'America/New_York',
        displayId: await staffDisplayId(
          'multi-practice-provider@cardioplace.test',
        ),
      },
    })
    await seedPermaOtp('multi-practice-provider@cardioplace.test', otpHash)
    await prisma.practiceProvider.upsert({
      where: {
        practiceId_userId: {
          practiceId: 'seed-cedar-hill',
          userId: multiPracticeProvider.id,
        },
      },
      update: {},
      create: {
        practiceId: 'seed-cedar-hill',
        userId: multiPracticeProvider.id,
      },
    })
    await prisma.practiceProvider.upsert({
      where: {
        practiceId_userId: {
          practiceId: 'seed-bridgepoint',
          userId: multiPracticeProvider.id,
        },
      },
      update: {},
      create: {
        practiceId: 'seed-bridgepoint',
        userId: multiPracticeProvider.id,
      },
    })
    console.log(
      `  multi-practice provider: ${multiPracticeProvider.email} (cedar-hill + bridgepoint, SEED_TEST_FIXTURES)`,
    )
  }

  return {
    manishaPatel,
    supportAdmin,
    primaryProvider,
    backupProvider,
    medicalDirector,
    opsUser,
    coordinator,
    outOfScopeProvider,
    multiPracticeProvider,
  }
}

export type SeededAdmins = Awaited<ReturnType<typeof seedAdmins>>
