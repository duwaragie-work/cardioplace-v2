import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcrypt'
import 'dotenv/config'

// Minimum-viable seed for phase/2: just enough fixtures to boot the backend,
// sign in as an admin or a patient, and render a patient detail view.
//
// Out of scope here (phase/19 owns the rich demo data): medications, thresholds,
// deviation alerts, escalations, scheduled calls, conversations. If 90-day
// demo data is needed before phase/19, port it from git history of seed.ts.

const dbUrl = process.env.DATABASE_URL!
const isAccelerate = dbUrl.startsWith('prisma://')
const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000)
}

async function main() {
  console.log('Seeding minimum-viable fixtures for cardioplace v2 …')

  const pwdhash = await bcrypt.hash('demo-password', 10)

  // ─── 1. Admin user (provider + super admin) ─────────────────────────────────
  const admin = await prisma.user.upsert({
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
  console.log(`  admin: ${admin.email}`)

  // ─── 1b. Super admin for testing (OTP 666666, never expires) ────────────────
  // auth.service.sendOtp short-circuits when a row with expiresAt > 2098-01-01
  // exists, so Resend is never called and the code stays fixed at 666666.
  const testAdmin = await prisma.user.upsert({
    where: { email: 'support@healplace.com' },
    update: {},
    create: {
      email: 'support@healplace.com',
      pwdhash,
      name: 'Dr. Manisha Singal',
      roles: ['SUPER_ADMIN'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      timezone: 'America/New_York',
      preferredLanguage: 'en',
    },
  })
  await prisma.otpCode.deleteMany({
    where: {
      email: 'support@healplace.com',
      expiresAt: { gt: new Date('2098-01-01') },
    },
  })
  await prisma.otpCode.create({
    data: {
      email: 'support@healplace.com',
      codeHash: await bcrypt.hash('666666', 10),
      expiresAt: new Date('2099-12-31'),
    },
  })
  console.log(`  test admin: ${testAdmin.email} (OTP 666666)`)

  // ─── 2. Practice ────────────────────────────────────────────────────────────
  const practice = await prisma.practice.upsert({
    where: { id: 'seed-cedar-hill' },
    update: {},
    create: {
      id: 'seed-cedar-hill',
      name: 'Cedar Hill Internal Medicine',
      businessHoursStart: '08:00',
      businessHoursEnd: '18:00',
      businessHoursTimezone: 'America/New_York',
      afterHoursProtocol:
        'Route urgent alerts to the on-call line; defer non-urgent to next business day.',
    },
  })
  console.log(`  practice: ${practice.name}`)

  // ─── 3. Patient A — HF (HFrEF), female ──────────────────────────────────────
  const patientA = await prisma.user.upsert({
    where: { email: 'patient-a@cardioplace.test' },
    update: {},
    create: {
      email: 'patient-a@cardioplace.test',
      pwdhash,
      name: 'Aisha Johnson',
      roles: ['PATIENT'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      dateOfBirth: new Date('1958-08-22'),
      timezone: 'America/New_York',
      preferredLanguage: 'en',
    },
  })

  await prisma.patientProfile.upsert({
    where: { userId: patientA.id },
    update: {},
    create: {
      userId: patientA.id,
      gender: 'FEMALE',
      heightCm: 165,
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
      profileVerificationStatus: 'VERIFIED',
      profileVerifiedAt: new Date(),
      profileVerifiedBy: admin.id,
    },
  })
  console.log(`  patient A: ${patientA.email}`)

  // ─── 4. Patient B — diagnosed hypertension, male ────────────────────────────
  const patientB = await prisma.user.upsert({
    where: { email: 'patient-b@cardioplace.test' },
    update: {},
    create: {
      email: 'patient-b@cardioplace.test',
      pwdhash,
      name: 'Marcus Reed',
      roles: ['PATIENT'],
      isVerified: true,
      onboardingStatus: 'COMPLETED',
      dateOfBirth: new Date('1966-03-10'),
      timezone: 'America/New_York',
      preferredLanguage: 'en',
    },
  })

  await prisma.patientProfile.upsert({
    where: { userId: patientB.id },
    update: {},
    create: {
      userId: patientB.id,
      gender: 'MALE',
      heightCm: 178,
      diagnosedHypertension: true,
      profileVerificationStatus: 'VERIFIED',
      profileVerifiedAt: new Date(),
      profileVerifiedBy: admin.id,
    },
  })
  console.log(`  patient B: ${patientB.email}`)

  // ─── 5. Provider assignments (Dr. Patel for both patients) ──────────────────
  for (const patient of [patientA, patientB]) {
    await prisma.patientProviderAssignment.upsert({
      where: { userId: patient.id },
      update: {},
      create: {
        userId: patient.id,
        practiceId: practice.id,
        primaryProviderId: admin.id,
        backupProviderId: admin.id,
        medicalDirectorId: admin.id,
      },
    })
  }
  console.log('  assignments: 2')

  // ─── 6. A handful of journal entries per patient ────────────────────────────
  const readingsA = [
    { hoursAgo: 6, sbp: 138, dbp: 88, pulse: 72 },
    { hoursAgo: 30, sbp: 142, dbp: 90, pulse: 75 },
    { hoursAgo: 54, sbp: 135, dbp: 85, pulse: 70 },
    { hoursAgo: 102, sbp: 148, dbp: 92, pulse: 78 },
  ]
  const readingsB = [
    { hoursAgo: 4, sbp: 128, dbp: 82, pulse: 68 },
    { hoursAgo: 28, sbp: 132, dbp: 84, pulse: 70 },
    { hoursAgo: 76, sbp: 129, dbp: 80, pulse: 66 },
  ]

  for (const r of readingsA) {
    const measuredAt = hoursAgo(r.hoursAgo)
    await prisma.journalEntry.upsert({
      where: { userId_measuredAt: { userId: patientA.id, measuredAt } },
      update: {},
      create: {
        userId: patientA.id,
        measuredAt,
        systolicBP: r.sbp,
        diastolicBP: r.dbp,
        pulse: r.pulse,
        position: 'SITTING',
        medicationTaken: true,
      },
    })
  }

  for (const r of readingsB) {
    const measuredAt = hoursAgo(r.hoursAgo)
    await prisma.journalEntry.upsert({
      where: { userId_measuredAt: { userId: patientB.id, measuredAt } },
      update: {},
      create: {
        userId: patientB.id,
        measuredAt,
        systolicBP: r.sbp,
        diastolicBP: r.dbp,
        pulse: r.pulse,
        position: 'SITTING',
        medicationTaken: true,
      },
    })
  }
  console.log(`  journal entries: ${readingsA.length + readingsB.length}`)

  console.log('Seed complete.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
