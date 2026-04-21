import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import bcrypt from 'bcrypt'
import 'dotenv/config'

// Phase/19 — demo seed.
//
// Five patient archetypes that each exercise one clinical branch of the rule
// engine (phase/5). Every user in this seed — including providers and ops —
// gets the perma-OTP 666666 so demos can log in as anyone without a real
// email inbox. The perma-OTP trick relies on auth.service.sendOtp short-
// circuiting when a row with expiresAt > 2098-01-01 exists (ships today).

const dbUrl = process.env.DATABASE_URL!
const isAccelerate = dbUrl.startsWith('prisma://')
const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: dbUrl })
  : new PrismaClient({ adapter: new PrismaPg(new pg.Pool({ connectionString: dbUrl })) })

const DEMO_OTP = '666666'
const PERMA_EXPIRY = new Date('2099-12-31')

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
}

async function seedPermaOtp(email: string, codeHash: string) {
  await prisma.otpCode.deleteMany({
    where: { email, expiresAt: { gt: new Date('2098-01-01') } },
  })
  await prisma.otpCode.create({
    data: { email, codeHash, expiresAt: PERMA_EXPIRY },
  })
}

async function main() {
  console.log('Seeding phase/19 demo fixtures …')

  const pwdhash = await bcrypt.hash('demo-password', 10)
  const otpHash = await bcrypt.hash(DEMO_OTP, 10)

  // ─── 1. Back-compat admin users (keep for existing Postman collections) ────

  await prisma.user.upsert({
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

  // ─── 2. Provider trio + HealPlace ops (assignment targets) ─────────────────

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

  // ─── 3. Practice ───────────────────────────────────────────────────────────

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

  // ─── 4. Five demo patients ─────────────────────────────────────────────────

  type PatientSeed = {
    email: string
    name: string
    dateOfBirth: Date
    gender: 'MALE' | 'FEMALE' | 'OTHER'
    heightCm: number
    profile: {
      isPregnant?: boolean
      pregnancyDueDate?: Date
      historyPreeclampsia?: boolean
      hasHeartFailure?: boolean
      heartFailureType?: 'HFREF' | 'HFPEF' | 'UNKNOWN' | 'NOT_APPLICABLE'
      hasAFib?: boolean
      hasCAD?: boolean
      diagnosedHypertension?: boolean
    }
    medications: Array<{
      drugName: string
      drugClass:
        | 'ACE_INHIBITOR'
        | 'ARB'
        | 'BETA_BLOCKER'
        | 'DHP_CCB'
        | 'NDHP_CCB'
        | 'STATIN'
        | 'ANTICOAGULANT'
      frequency: 'ONCE_DAILY' | 'TWICE_DAILY'
      verificationStatus: 'VERIFIED' | 'UNVERIFIED'
    }>
    threshold?: {
      sbpUpperTarget?: number
      sbpLowerTarget?: number
      dbpUpperTarget?: number
      dbpLowerTarget?: number
      notes?: string
    }
    readings: Array<{ daysAgo: number; sbp: number; dbp: number; pulse: number }>
    archetype: string
  }

  const patients: PatientSeed[] = [
    {
      email: 'priya.menon@cardioplace.test',
      name: 'Priya Menon',
      dateOfBirth: new Date('1991-07-14'),
      gender: 'FEMALE',
      heightCm: 162,
      profile: {
        isPregnant: true,
        pregnancyDueDate: new Date(Date.now() + 90 * 24 * 3600 * 1000),
        historyPreeclampsia: true,
      },
      // Lisinopril on a pregnant patient — Tier 1 teratogenic contraindication.
      medications: [
        { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
      ],
      readings: [
        { daysAgo: 0, sbp: 138, dbp: 88, pulse: 82 },
        { daysAgo: 3, sbp: 132, dbp: 84, pulse: 78 },
        { daysAgo: 6, sbp: 142, dbp: 92, pulse: 84 }, // pregnancy L1 ≥140/90
        { daysAgo: 10, sbp: 128, dbp: 80, pulse: 76 },
        { daysAgo: 13, sbp: 134, dbp: 86, pulse: 80 },
      ],
      archetype: 'Pregnant + ACE inhibitor → Tier 1 contraindication',
    },
    {
      email: 'james.okafor@cardioplace.test',
      name: 'James Okafor',
      dateOfBirth: new Date('1963-04-22'),
      gender: 'MALE',
      heightCm: 176,
      profile: {
        hasHeartFailure: true,
        heartFailureType: 'HFREF',
      },
      // Diltiazem (NDHP-CCB) + HFrEF — Tier 1 contraindication, harmful negative inotropy.
      medications: [
        { drugName: 'Diltiazem', drugClass: 'NDHP_CCB', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
        { drugName: 'Carvedilol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
      ],
      threshold: {
        sbpUpperTarget: 130,
        sbpLowerTarget: 85,
        dbpUpperTarget: 85,
        dbpLowerTarget: 55,
        notes: 'HFrEF conservative lower bound per §4.2.',
      },
      readings: [
        { daysAgo: 0, sbp: 118, dbp: 74, pulse: 68 },
        { daysAgo: 3, sbp: 122, dbp: 76, pulse: 70 },
        { daysAgo: 6, sbp: 115, dbp: 72, pulse: 66 },
        { daysAgo: 10, sbp: 124, dbp: 78, pulse: 72 },
        { daysAgo: 13, sbp: 120, dbp: 74, pulse: 68 },
      ],
      archetype: 'HFrEF + NDHP-CCB → Tier 1 contraindication',
    },
    {
      email: 'rita.washington@cardioplace.test',
      name: 'Rita Washington',
      dateOfBirth: new Date('1967-11-02'),
      gender: 'FEMALE',
      heightCm: 170,
      profile: {
        hasCAD: true,
        diagnosedHypertension: true,
      },
      medications: [
        { drugName: 'Atorvastatin', drugClass: 'STATIN', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
        { drugName: 'Amlodipine', drugClass: 'DHP_CCB', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
        { drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
      ],
      readings: [
        { daysAgo: 0, sbp: 122, dbp: 68, pulse: 72 }, // CAD DBP<70 critical
        { daysAgo: 3, sbp: 128, dbp: 74, pulse: 70 },
        { daysAgo: 6, sbp: 118, dbp: 66, pulse: 68 }, // CAD DBP<70 critical
        { daysAgo: 10, sbp: 130, dbp: 78, pulse: 74 },
        { daysAgo: 13, sbp: 125, dbp: 72, pulse: 70 },
      ],
      archetype: 'CAD + DBP <70 → CAD critical',
    },
    {
      email: 'charles.brown@cardioplace.test',
      name: 'Charles Brown',
      dateOfBirth: new Date('1955-02-18'),
      gender: 'MALE',
      heightCm: 181,
      profile: {
        hasAFib: true,
      },
      medications: [
        { drugName: 'Apixaban', drugClass: 'ANTICOAGULANT', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
        { drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
      ],
      readings: [
        { daysAgo: 0, sbp: 132, dbp: 82, pulse: 118 }, // AFib HR >110
        { daysAgo: 3, sbp: 128, dbp: 80, pulse: 92 },
        { daysAgo: 6, sbp: 135, dbp: 84, pulse: 114 }, // AFib HR >110
        { daysAgo: 10, sbp: 130, dbp: 82, pulse: 88 },
        { daysAgo: 13, sbp: 126, dbp: 78, pulse: 96 },
      ],
      archetype: 'AFib + HR >110 → AFib HR alert',
    },
    {
      email: 'aisha.johnson@cardioplace.test',
      name: 'Aisha Johnson',
      dateOfBirth: new Date('1958-08-22'),
      gender: 'FEMALE',
      heightCm: 165,
      profile: {
        diagnosedHypertension: true,
      },
      medications: [
        { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
        { drugName: 'Amlodipine', drugClass: 'DHP_CCB', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
      ],
      readings: [
        { daysAgo: 0, sbp: 124, dbp: 78, pulse: 72 },
        { daysAgo: 3, sbp: 128, dbp: 80, pulse: 70 },
        { daysAgo: 6, sbp: 122, dbp: 76, pulse: 68 },
        { daysAgo: 10, sbp: 130, dbp: 82, pulse: 74 },
        { daysAgo: 13, sbp: 126, dbp: 78, pulse: 72 },
      ],
      archetype: 'Control — well-controlled HTN, no alerts',
    },
  ]

  for (const p of patients) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        email: p.email,
        pwdhash,
        name: p.name,
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: 'COMPLETED',
        dateOfBirth: p.dateOfBirth,
        timezone: 'America/New_York',
        preferredLanguage: 'en',
      },
    })
    await seedPermaOtp(p.email, otpHash)

    await prisma.patientProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        gender: p.gender,
        heightCm: p.heightCm,
        ...p.profile,
        profileVerificationStatus: 'VERIFIED',
        profileVerifiedAt: new Date(),
        profileVerifiedBy: supportAdmin.id,
      },
    })

    // Wipe existing meds to avoid drift on re-seed.
    await prisma.patientMedication.deleteMany({ where: { userId: user.id } })
    for (const m of p.medications) {
      await prisma.patientMedication.create({
        data: {
          userId: user.id,
          drugName: m.drugName,
          drugClass: m.drugClass,
          frequency: m.frequency,
          source: 'PATIENT_SELF_REPORT',
          verificationStatus: m.verificationStatus,
          verifiedByAdminId:
            m.verificationStatus === 'VERIFIED' ? supportAdmin.id : null,
          verifiedAt: m.verificationStatus === 'VERIFIED' ? new Date() : null,
        },
      })
    }

    if (p.threshold) {
      await prisma.patientThreshold.upsert({
        where: { userId: user.id },
        update: {},
        create: {
          userId: user.id,
          setByProviderId: medicalDirector.id,
          ...p.threshold,
        },
      })
    }

    await prisma.patientProviderAssignment.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        userId: user.id,
        practiceId: practice.id,
        primaryProviderId: primaryProvider.id,
        backupProviderId: backupProvider.id,
        medicalDirectorId: medicalDirector.id,
      },
    })

    for (const r of p.readings) {
      const measuredAt = daysAgo(r.daysAgo)
      await prisma.journalEntry.upsert({
        where: { userId_measuredAt: { userId: user.id, measuredAt } },
        update: {},
        create: {
          userId: user.id,
          measuredAt,
          systolicBP: r.sbp,
          diastolicBP: r.dbp,
          pulse: r.pulse,
          position: 'SITTING',
          medicationTaken: true,
        },
      })
    }

    console.log(
      `  patient: ${p.email} — ${p.archetype} (${p.medications.length} meds, ${p.readings.length} readings${p.threshold ? ', +threshold' : ''})`,
    )
  }

  console.log('\nSeed complete.')
  console.log(`All users login via OTP ${DEMO_OTP} (perma-expiry).`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
