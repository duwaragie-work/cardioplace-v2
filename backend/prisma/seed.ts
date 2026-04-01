import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import bcrypt from 'bcrypt'
import 'dotenv/config'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

// ─── Helpers ──────────────────────────────────────────────────────────────────

function daysAgo(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() - n)
  d.setHours(0, 0, 0, 0)
  return d
}

function dateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

const SYMPTOMS = [
  'Chest Pain',
  'Severe Headache',
  'Shortness of Breath',
  'Dizziness',
  'Blurred Vision',
  'Fatigue',
  'Nausea',
  'Swelling',
  'Palpitations',
]

function randomSymptoms(maxCount: number): string[] {
  const count = rand(0, maxCount)
  const shuffled = [...SYMPTOMS].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}

// ─── Seed emails (used for idempotent cleanup) ───────────────────────────────

const SEED_EMAILS = [
  'support@healplace.com',
  'dorothy.james@healplace.com',
  'marcus.williams@healplace.com',
  'maria.santos@healplace.com',
  'angela.thompson@healplace.com',
  'james.carter@healplace.com',
  'ethel.washington@healplace.com',
]

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Seeding database...')

  // ── Cleanup existing seed data (idempotent) ──
  // OtpCode has no cascade from User, clean separately
  await prisma.otpCode.deleteMany({ where: { email: { in: SEED_EMAILS } } })
  // Deleting users cascades: journalEntries, baselines, alerts, escalations,
  // notifications, scheduledCalls, refreshTokens, accounts, userDevices
  await prisma.user.deleteMany({ where: { email: { in: SEED_EMAILS } } })

  console.log('Cleaned up existing seed data.')

  // ══════════════════════════════════════════════════════════════════════════
  // 1. SUPER ADMIN + PROVIDER
  // ══════════════════════════════════════════════════════════════════════════

  const superAdmin = await prisma.user.create({
    data: {
      email: 'support@healplace.com',
      name: 'Dr. Manisha Patel',
      isVerified: true,
      roles: ['SUPER_ADMIN'],
      onboardingStatus: 'COMPLETED',
      accountStatus: 'ACTIVE',
      communicationPreference: 'TEXT_FIRST',
      preferredLanguage: 'en',
      timezone: 'America/New_York',
      dateOfBirth: new Date('1978-06-15'),
      primaryCondition: 'Provider - Cardiology',
    },
  })
  console.log(`Created super admin: ${superAdmin.email}`)

  // Pre-seed OTP 999999 that never expires
  const otpHash = await bcrypt.hash('999999', 10)
  await prisma.otpCode.create({
    data: {
      email: 'support@healplace.com',
      codeHash: otpHash,
      expiresAt: new Date('2099-12-31T23:59:59Z'),
      attempts: 0,
    },
  })
  console.log('Created non-expiring OTP for super admin (code: 999999)')

  // ══════════════════════════════════════════════════════════════════════════
  // 2. PATIENT USERS
  // ══════════════════════════════════════════════════════════════════════════

  const patientDefs = [
    {
      email: 'dorothy.james@healplace.com',
      name: 'Dorothy James',
      riskTier: 'STANDARD' as const,
      commPref: 'TEXT_FIRST' as const,
      lang: 'en',
      dob: '1958-03-22',
      condition: 'Hypertension - Stage 1',
      bp: { sysBase: 120, sysVar: 8, diaBase: 76, diaVar: 4 },
      weight: { base: 155, variance: 2 },
      medCompliance: 0.95,
      symptomFreq: 0,
      days: 30,
    },
    {
      email: 'marcus.williams@healplace.com',
      name: 'Marcus Williams',
      riskTier: 'ELEVATED' as const,
      commPref: 'AUDIO_FIRST' as const,
      lang: 'en',
      dob: '1965-11-08',
      condition: 'Hypertension - Stage 2',
      bp: { sysBase: 138, sysVar: 17, diaBase: 88, diaVar: 7 },
      weight: { base: 205, variance: 3 },
      medCompliance: 0.80,
      symptomFreq: 1,
      days: 21,
    },
    {
      email: 'maria.santos@healplace.com',
      name: 'Maria Santos',
      riskTier: 'HIGH' as const,
      commPref: 'AUDIO_FIRST' as const,
      lang: 'es',
      dob: '1952-07-14',
      condition: 'Hypertensive Crisis History',
      bp: { sysBase: 165, sysVar: 20, diaBase: 105, diaVar: 15 },
      weight: { base: 175, variance: 5 },
      medCompliance: 0.60,
      symptomFreq: 3,
      days: 14,
    },
    {
      email: 'angela.thompson@healplace.com',
      name: 'Angela Thompson',
      riskTier: 'ELEVATED' as const,
      commPref: 'TEXT_FIRST' as const,
      lang: 'en',
      dob: '1980-01-30',
      condition: 'Hypertension - Stage 2 (Healthcare Worker)',
      bp: { sysBase: 135, sysVar: 13, diaBase: 86, diaVar: 6 },
      weight: { base: 170, variance: 2 },
      medCompliance: 0.85,
      symptomFreq: 1,
      days: 21,
    },
    {
      email: 'james.carter@healplace.com',
      name: 'James Carter',
      riskTier: 'STANDARD' as const,
      commPref: 'TEXT_FIRST' as const,
      lang: 'en',
      dob: '1972-09-05',
      condition: 'Pre-Hypertension (Family History)',
      bp: { sysBase: 124, sysVar: 8, diaBase: 78, diaVar: 6 },
      weight: { base: 190, variance: 2 },
      medCompliance: 0.90,
      symptomFreq: 0,
      days: 14,
    },
    {
      email: 'ethel.washington@healplace.com',
      name: 'Ethel Washington',
      riskTier: 'HIGH' as const,
      commPref: 'AUDIO_FIRST' as const,
      lang: 'en',
      dob: '1945-12-19',
      condition: 'Hypertensive Crisis History, CHF',
      bp: { sysBase: 162, sysVar: 18, diaBase: 98, diaVar: 14 },
      weight: { base: 145, variance: 4 },
      medCompliance: 0.70,
      symptomFreq: 2,
      days: 14,
    },
  ]

  for (const def of patientDefs) {
    const user = await prisma.user.create({
      data: {
        email: def.email,
        name: def.name,
        isVerified: true,
        roles: ['REGISTERED_USER'],
        onboardingStatus: 'COMPLETED',
        accountStatus: 'ACTIVE',
        riskTier: def.riskTier,
        communicationPreference: def.commPref,
        preferredLanguage: def.lang,
        timezone: 'America/New_York',
        dateOfBirth: new Date(def.dob),
        primaryCondition: def.condition,
      },
    })
    console.log(`Created patient: ${user.name} (${user.email})`)

    // ── Journal Entries ──
    const entries: { id: string; date: Date; sys: number; dia: number; weight: number; medTaken: boolean }[] = []

    for (let i = def.days; i >= 1; i--) {
      const entryDate = dateOnly(daysAgo(i))
      const sys = def.bp.sysBase + rand(-def.bp.sysVar, def.bp.sysVar)
      const dia = def.bp.diaBase + rand(-def.bp.diaVar, def.bp.diaVar)
      const weight = def.weight.base + rand(-def.weight.variance, def.weight.variance)
      const medTaken = Math.random() < def.medCompliance
      const symptoms = randomSymptoms(def.symptomFreq)

      const entry = await prisma.journalEntry.create({
        data: {
          userId: user.id,
          entryDate,
          systolicBP: sys,
          diastolicBP: dia,
          weight,
          medicationTaken: medTaken,
          missedDoses: medTaken ? 0 : rand(1, 2),
          symptoms,
          notes: symptoms.length > 0 ? `Patient reported: ${symptoms.join(', ')}` : null,
          source: 'MANUAL',
        },
      })
      entries.push({ id: entry.id, date: entryDate, sys, dia, weight, medTaken })
    }
    console.log(`  Created ${entries.length} journal entries`)

    // ── Baseline Snapshots (every 7 days) ──
    const snapshotIds: string[] = []
    for (let i = 6; i < entries.length; i += 7) {
      const window = entries.slice(Math.max(0, i - 6), i + 1)
      const avgSys = window.reduce((s, e) => s + e.sys, 0) / window.length
      const avgDia = window.reduce((s, e) => s + e.dia, 0) / window.length
      const avgWeight = window.reduce((s, e) => s + e.weight, 0) / window.length

      const snapshot = await prisma.baselineSnapshot.create({
        data: {
          userId: user.id,
          computedForDate: entries[i].date,
          baselineSystolic: Math.round(avgSys * 100) / 100,
          baselineDiastolic: Math.round(avgDia * 100) / 100,
          baselineWeight: Math.round(avgWeight * 100) / 100,
          sampleSize: window.length,
        },
      })
      snapshotIds.push(snapshot.id)

      // Link journal entries to this snapshot
      const entryIds = window.map((e) => e.id)
      await prisma.journalEntry.updateMany({
        where: { id: { in: entryIds } },
        data: { snapshotId: snapshot.id },
      })
    }
    console.log(`  Created ${snapshotIds.length} baseline snapshots`)

    // ── Deviation Alerts ──
    // Find entries with elevated/crisis readings
    const alertEntries = entries.filter(
      (e) => e.sys >= 140 || e.dia >= 90 || !e.medTaken,
    )

    const createdAlerts: { id: string; severity: string; entryDate: Date }[] = []

    for (const ae of alertEntries) {
      const isCrisis = ae.sys >= 180 || ae.dia >= 120
      const isElevated = ae.sys >= 140 || ae.dia >= 90
      const severity = isCrisis ? 'HIGH' : isElevated ? 'MEDIUM' : 'LOW'

      // Determine deviation type — pick the most relevant
      let devType: 'SYSTOLIC_BP' | 'DIASTOLIC_BP' | 'MEDICATION_ADHERENCE' = 'SYSTOLIC_BP'
      let magnitude = Math.abs(ae.sys - def.bp.sysBase)
      let baselineVal = def.bp.sysBase
      let actualVal = ae.sys

      if (!ae.medTaken && ae.sys < 140 && ae.dia < 90) {
        devType = 'MEDICATION_ADHERENCE'
        magnitude = 1
        baselineVal = 1
        actualVal = 0
      } else if (ae.dia >= 90 && (ae.dia - def.bp.diaBase) > (ae.sys - def.bp.sysBase)) {
        devType = 'DIASTOLIC_BP'
        magnitude = Math.abs(ae.dia - def.bp.diaBase)
        baselineVal = def.bp.diaBase
        actualVal = ae.dia
      }

      const statusOptions: ('OPEN' | 'ACKNOWLEDGED' | 'RESOLVED')[] =
        severity === 'HIGH' ? ['OPEN', 'ACKNOWLEDGED'] : ['OPEN', 'ACKNOWLEDGED', 'RESOLVED']

      const status = pick(statusOptions)

      try {
        const alert = await prisma.deviationAlert.create({
          data: {
            userId: user.id,
            journalEntryId: ae.id,
            type: devType,
            severity: severity as 'LOW' | 'MEDIUM' | 'HIGH',
            magnitude,
            baselineValue: baselineVal,
            actualValue: actualVal,
            escalated: severity === 'HIGH',
            status,
            acknowledgedAt: status !== 'OPEN' ? daysAgo(rand(0, 3)) : null,
          },
        })
        createdAlerts.push({ id: alert.id, severity, entryDate: ae.date })
      } catch {
        // Skip if duplicate (journalEntryId + type unique constraint)
      }
    }
    console.log(`  Created ${createdAlerts.length} deviation alerts`)

    // ── Escalation Events ──
    const highAlerts = createdAlerts.filter((a) => a.severity === 'HIGH')
    let escalationCount = 0

    for (let i = 0; i < highAlerts.length && i < 3; i++) {
      const alert = highAlerts[i]
      await prisma.escalationEvent.create({
        data: {
          alertId: alert.id,
          userId: user.id,
          escalationLevel: i === 0 && highAlerts.length > 1 ? 'LEVEL_2' : 'LEVEL_1',
          reason:
            i === 0 && highAlerts.length > 1
              ? 'Crisis-level BP reading detected. Immediate intervention required.'
              : 'Elevated BP persists beyond threshold. Care team notification sent.',
          notificationSentAt: new Date(),
        },
      })
      escalationCount++
    }
    console.log(`  Created ${escalationCount} escalation events`)

    // ── Notifications ──
    let notifCount = 0
    for (const alert of createdAlerts.slice(0, 4)) {
      const isRead = Math.random() > 0.4
      await prisma.notification.create({
        data: {
          userId: user.id,
          alertId: alert.id,
          channel: pick(['PUSH', 'EMAIL'] as const),
          title:
            alert.severity === 'HIGH'
              ? 'Urgent: Critical Blood Pressure Reading'
              : 'Blood Pressure Alert',
          body:
            alert.severity === 'HIGH'
              ? 'Your blood pressure reading requires immediate attention. Please contact your care team.'
              : 'Your recent blood pressure reading was above your baseline. Please continue monitoring.',
          tips: [
            'Take your medication as prescribed',
            'Reduce sodium intake',
            'Stay hydrated and avoid caffeine',
          ],
          readAt: isRead ? daysAgo(rand(0, 2)) : null,
        },
      })
      notifCount++
    }
    console.log(`  Created ${notifCount} notifications`)

    // ── Scheduled Calls ──
    if (createdAlerts.length > 0) {
      const callStatuses: { status: 'UPCOMING' | 'COMPLETED' | 'MISSED'; dateOffset: number }[] = [
        { status: 'UPCOMING', dateOffset: -2 }, // 2 days in the future
        { status: 'COMPLETED', dateOffset: 5 },
        { status: 'MISSED', dateOffset: 3 },
      ]

      let callCount = 0
      for (const cs of callStatuses.slice(0, Math.min(2, createdAlerts.length))) {
        const callDate = daysAgo(cs.dateOffset)
        await prisma.scheduledCall.create({
          data: {
            userId: user.id,
            alertId: createdAlerts[callCount]?.id ?? null,
            callDate: callDate.toISOString().split('T')[0],
            callTime: pick(['09:00', '10:30', '14:00', '15:30']),
            callType: cs.status === 'UPCOMING' ? 'Follow-up' : 'Check-in',
            notes:
              cs.status === 'COMPLETED'
                ? 'Patient confirmed medication adherence. BP trending down.'
                : cs.status === 'MISSED'
                  ? 'Patient did not answer. Rescheduling required.'
                  : 'Scheduled follow-up for elevated BP readings.',
            status: cs.status,
          },
        })
        callCount++
      }
      console.log(`  Created ${callCount} scheduled calls`)
    }

    // ── Chat Conversations ──
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        title: 'Health Check-in',
        messageCount: 4,
      },
    })

    const convos = [
      {
        userMessage: "My blood pressure was high this morning, I'm worried.",
        aiSummary:
          "Patient expressed concern about elevated morning BP. Provided reassurance and recommended continued monitoring. Advised taking medication consistently and reducing sodium intake.",
        source: 'text',
      },
      {
        userMessage: 'I forgot to take my medication yesterday, is that bad?',
        aiSummary:
          'Patient missed one dose of medication. Explained importance of consistency but reassured that one missed dose is not critical. Recommended setting a daily reminder.',
        source: 'text',
      },
      {
        userMessage: "I've been feeling dizzy when I stand up quickly.",
        aiSummary:
          'Patient reported orthostatic dizziness. This could be related to medication or BP changes. Recommended standing up slowly and staying hydrated. Flagged for provider review.',
        source: 'voice',
      },
      {
        userMessage: 'What should I eat to help lower my blood pressure?',
        aiSummary:
          'Patient asked about dietary recommendations for BP management. Provided DASH diet overview: fruits, vegetables, whole grains, lean proteins. Limit sodium to under 2300mg/day. Increase potassium-rich foods.',
        source: 'text',
      },
    ]

    for (let i = 0; i < convos.length; i++) {
      await prisma.conversation.create({
        data: {
          sessionId: session.id,
          userMessage: convos[i].userMessage,
          aiSummary: convos[i].aiSummary,
          source: convos[i].source,
          timestamp: daysAgo(def.days - i * 3),
        },
      })
    }
    console.log(`  Created ${convos.length} conversations`)
  }

  console.log('\nSeed completed successfully!')
  console.log('────────────────────────────────────────')
  console.log('Super Admin Login:')
  console.log('  Email: support@healplace.com')
  console.log('  OTP:   999999')
  console.log('────────────────────────────────────────')
}

main()
  .catch((e) => {
    console.error('Seed failed:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
