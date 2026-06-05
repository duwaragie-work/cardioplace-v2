// Phase 0 §C — patient personas.
//
// The 13 clinical personas + per-patient seeding loop are copied verbatim
// from the pre-Phase-0 seed.ts (phase/19 demo fixtures + Bucket B). No
// clinical data changed — §F appends the filler cohort separately so this
// module's output stays byte-identical for the modularization commit.
import {
  prisma,
  DEMO_OTP,
  hashOtp,
  daysAgo,
  seedPermaOtp,
  type PatientSeed,
} from './helpers.js'
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'

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
      historyHDP: true,
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

  // ─── Bucket B personas (8 of 11) ───────────────────────────────────────
  // Added for qa/tests/09 Bucket B coverage. Keep readings benign so they
  // don't accidentally fire alerts on seed import — tests post the actual
  // alert-triggering readings via the API. Defer Dana / Larry / Eve until
  // Cluster 6 needs them; tests substitute closest existing persona or
  // mark test.fixme with TODO.
  {
    email: 'carol.miller@cardioplace.test',
    name: 'Carol Miller',
    dateOfBirth: new Date('1958-09-12'),
    gender: 'FEMALE',
    heightCm: 165,
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
    },
    // HFrEF without the NDHP-CCB contraindication that James has — clean
    // HFrEF persona for HF-rule tests that shouldn't be confounded by Tier 1.
    medications: [
      { drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
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
      { daysAgo: 0, sbp: 120, dbp: 76, pulse: 70 },
      { daysAgo: 3, sbp: 122, dbp: 78, pulse: 72 },
      { daysAgo: 6, sbp: 118, dbp: 74, pulse: 68 },
      { daysAgo: 10, sbp: 124, dbp: 80, pulse: 74 },
      { daysAgo: 13, sbp: 121, dbp: 76, pulse: 70 },
    ],
    archetype: 'HFrEF + loop diuretic — clean (no NDHP)',
  },
  {
    email: 'mike.peterson@cardioplace.test',
    name: 'Mike Peterson',
    dateOfBirth: new Date('1962-03-08'),
    gender: 'MALE',
    heightCm: 178,
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFPEF',
    },
    // HFpEF — preserved EF, ARB-based regimen.
    medications: [
      { drugName: 'Losartan', drugClass: 'ARB', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    threshold: {
      sbpUpperTarget: 130,
      sbpLowerTarget: 110,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      notes: 'HFpEF lower bound 110 per §4.9.',
    },
    readings: [
      { daysAgo: 0, sbp: 128, dbp: 76, pulse: 76 },
      { daysAgo: 3, sbp: 124, dbp: 74, pulse: 74 },
      { daysAgo: 6, sbp: 130, dbp: 78, pulse: 78 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 76 },
      { daysAgo: 13, sbp: 122, dbp: 74, pulse: 72 },
    ],
    archetype: 'HFpEF — preserved EF, ARB regimen',
  },
  {
    email: 'olive.thompson@cardioplace.test',
    name: 'Olive Thompson',
    dateOfBirth: new Date('1955-06-20'),
    gender: 'FEMALE',
    heightCm: 160,
    profile: {
      diagnosedHypertension: true,
    },
    // Loop diuretic + age 70+ but no heart failure — orthostatic risk
    // persona for the loop-diuretic SBP <90 / 90-92 band tests.
    medications: [
      { drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 122, dbp: 70, pulse: 76 },
      { daysAgo: 3, sbp: 118, dbp: 68, pulse: 74 },
      { daysAgo: 6, sbp: 124, dbp: 72, pulse: 78 },
      { daysAgo: 10, sbp: 120, dbp: 70, pulse: 76 },
      { daysAgo: 13, sbp: 116, dbp: 66, pulse: 72 },
    ],
    archetype: 'Loop diuretic + age 70 — no HF',
  },
  {
    email: 'paul.davis@cardioplace.test',
    name: 'Paul Davis',
    dateOfBirth: new Date('1957-04-15'),
    gender: 'MALE',
    heightCm: 175,
    profile: {
      hasCAD: true,
    },
    // CAD + 65+ — different from Rita (CAD younger), distinct edge case
    // for age threshold deltas on top of CAD.
    medications: [
      { drugName: 'Atorvastatin', drugClass: 'STATIN', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
      { drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 128, dbp: 76, pulse: 70 },
      { daysAgo: 3, sbp: 124, dbp: 74, pulse: 68 },
      { daysAgo: 6, sbp: 130, dbp: 78, pulse: 72 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 70 },
      { daysAgo: 13, sbp: 122, dbp: 74, pulse: 68 },
    ],
    archetype: 'CAD + age 65+',
  },
  {
    email: 'kate.wong@cardioplace.test',
    name: 'Kate Wong',
    dateOfBirth: new Date('1969-11-30'),
    gender: 'FEMALE',
    heightCm: 162,
    profile: {
      hasHCM: true,
    },
    // HCM + DHP-CCB vasodilator — Amlodipine on HCM is the classic
    // afterload-reduction concern for outflow obstruction.
    medications: [
      { drugName: 'Amlodipine', drugClass: 'DHP_CCB', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    threshold: {
      sbpUpperTarget: 130,
      sbpLowerTarget: 110,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      notes: 'HCM lower bound 110 — outflow obstruction risk.',
    },
    readings: [
      { daysAgo: 0, sbp: 124, dbp: 76, pulse: 72 },
      { daysAgo: 3, sbp: 128, dbp: 78, pulse: 74 },
      { daysAgo: 6, sbp: 122, dbp: 74, pulse: 70 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 72 },
      { daysAgo: 13, sbp: 120, dbp: 72, pulse: 68 },
    ],
    archetype: 'HCM + DHP-CCB — vasodilator concern',
  },
  {
    email: 'nora.adams@cardioplace.test',
    name: 'Nora Adams',
    dateOfBirth: new Date('1965-07-22'),
    gender: 'FEMALE',
    heightCm: 164,
    profile: {
      hasBradycardia: true,
    },
    // Bradycardia diagnosis + Metoprolol — HR rules suppressed within
    // expected-on-BB band; floor still fires.
    medications: [
      { drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 122, dbp: 76, pulse: 58 },
      { daysAgo: 3, sbp: 120, dbp: 74, pulse: 56 },
      { daysAgo: 6, sbp: 124, dbp: 78, pulse: 60 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 62 },
      { daysAgo: 13, sbp: 118, dbp: 72, pulse: 56 },
    ],
    archetype: 'Bradycardia + BB — HR rule suppression',
  },
  {
    email: 'iris.kim@cardioplace.test',
    name: 'Iris Kim',
    dateOfBirth: new Date('1960-02-14'),
    gender: 'FEMALE',
    heightCm: 168,
    profile: {
      hasAFib: true,
    },
    // Distinct from Charles — different demographics + retains AFib +
    // anticoag + BB combo so single-reading HR exception (Q5) tests have
    // a non-Charles target.
    medications: [
      { drugName: 'Apixaban', drugClass: 'ANTICOAGULANT', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
      { drugName: 'Metoprolol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 130, dbp: 80, pulse: 88 },
      { daysAgo: 3, sbp: 128, dbp: 78, pulse: 86 },
      { daysAgo: 6, sbp: 132, dbp: 82, pulse: 90 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 84 },
      { daysAgo: 13, sbp: 124, dbp: 78, pulse: 82 },
    ],
    archetype: 'AFib + anticoag + BB — single-reading HR exception target',
  },
  {
    email: 'jane.smith@cardioplace.test',
    name: 'Jane Smith',
    dateOfBirth: new Date('1956-12-03'),
    gender: 'FEMALE',
    heightCm: 167,
    profile: {},
    // Pure 65+ control with NO comorbidities and NO meds. Lets us test
    // age 65+ threshold deltas without confounders from any condition.
    medications: [],
    readings: [
      { daysAgo: 0, sbp: 124, dbp: 76, pulse: 72 },
      { daysAgo: 3, sbp: 128, dbp: 78, pulse: 74 },
      { daysAgo: 6, sbp: 122, dbp: 74, pulse: 70 },
      { daysAgo: 10, sbp: 126, dbp: 76, pulse: 72 },
      { daysAgo: 13, sbp: 120, dbp: 72, pulse: 68 },
    ],
    archetype: '65+ control — no comorbidities, age threshold edges',
  },

  // ─── Phase 4 §B.1 — young-adult persona (18–29 bucket) ──────────────────
  // Added for Phase 4 age-bucket coverage (spec 20g.2). General adult HTN
  // cohort, no special condition flags — exercises the standard-threshold /
  // SBP <90 lower path with PREVENT-not-validated (<30) UX. Gender 'OTHER':
  // the Gender enum + PatientSeed type are MALE|FEMALE|OTHER (no NON_BINARY).
  // Benign readings so seed import never fires an alert (tests post the
  // alert-triggering reading via the UI).
  {
    email: 'taylor.brown@cardioplace.test',
    name: 'Taylor Brown',
    dateOfBirth: new Date('2002-04-12'), // age ~24 at 2026-05-18
    gender: 'OTHER',
    heightCm: 170,
    profile: {
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 122, dbp: 78, pulse: 70 },
      { daysAgo: 3, sbp: 126, dbp: 80, pulse: 72 },
      { daysAgo: 6, sbp: 120, dbp: 76, pulse: 68 },
      { daysAgo: 10, sbp: 124, dbp: 80, pulse: 72 },
      { daysAgo: 13, sbp: 123, dbp: 78, pulse: 70 },
    ],
    archetype: 'Young adult (18–29 bucket) — general adult HTN, no PREVENT validation',
  },

  // ─── Handoff 5 Wave D — HDP-only (not pregnant) persona ─────────────────
  // Q7 broadened the A2 follow-up from "preeclampsia" to any hypertensive
  // disorder of pregnancy (historyHDP), asked of female patients regardless of
  // current pregnancy. The existing HDP persona (Priya) is pregnant; this one
  // is NOT pregnant with a documented HDP history — the target for the
  // broadened-question intake path + future risk stratification. Benign
  // readings so the seed import never fires an alert.
  {
    email: 'fatima.diallo@cardioplace.test',
    name: 'Fatima Diallo',
    dateOfBirth: new Date('1979-03-08'),
    gender: 'FEMALE',
    heightCm: 165,
    profile: {
      historyHDP: true,
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Amlodipine', drugClass: 'DHP_CCB', frequency: 'ONCE_DAILY', verificationStatus: 'VERIFIED' },
    ],
    readings: [
      { daysAgo: 0, sbp: 134, dbp: 84, pulse: 74 },
      { daysAgo: 3, sbp: 130, dbp: 82, pulse: 72 },
      { daysAgo: 7, sbp: 132, dbp: 84, pulse: 76 },
    ],
    archetype: 'HDP history, not pregnant — broadened-question (Q7) coverage target',
  },
]

export async function seedPatients(
  practices: SeededPractices,
  admins: SeededAdmins,
) {
  const otpHash = await hashOtp(DEMO_OTP)
  const { practiceA } = practices
  const {
    supportAdmin,
    primaryProvider,
    backupProvider,
    medicalDirector,
    manishaPatel,
  } = admins

  for (const p of patients) {
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {},
      create: {
        email: p.email,
        pwdhash: supportAdmin.pwdhash,
        name: p.name,
        roles: ['PATIENT'],
        isVerified: true,
        // Identity onboarding done (name/DOB captured here) + clinical
        // enrollment pre-passed: every demo patient below gets assignment +
        // profile + (threshold if HFREF/HCM/DCM) so the 4-piece enrollment
        // gate is satisfied. We mark them ENROLLED directly so escalation
        // dispatch + gap-alert / monthly-reask crons pick them up without
        // first having to POST /admin/patients/:id/complete-onboarding.
        onboardingStatus: 'COMPLETED',
        enrollmentStatus: 'ENROLLED',
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
        practiceId: practiceA.id,
        primaryProviderId: primaryProvider.id,
        backupProviderId: backupProvider.id,
        medicalDirectorId: medicalDirector.id,
      },
    })

    // Wipe + recreate readings each run. measuredAt is Date.now()-relative
    // (daysAgo), so an upsert keyed on userId_measuredAt never matches across
    // runs and stacks duplicates (65 → 130 → …) — the pre-Phase-0 monolith
    // had this bug. Mirroring the meds wipe-then-recreate keeps the count
    // stable AND the timestamps recent. DeviationAlert has onDelete:Cascade
    // on journalEntry, so any §G alert bound to these entries is cascaded
    // here and recreated by seedState (which runs after seedPatients in
    // run.ts) — net state stays idempotent.
    await prisma.journalEntry.deleteMany({ where: { userId: user.id } })
    for (const r of p.readings) {
      await prisma.journalEntry.create({
        data: {
          userId: user.id,
          measuredAt: daysAgo(r.daysAgo),
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

  // ── Explicit practice ↔ staff join rows (May 2026 role-scope) ─────────────
  // The PracticeProvider / PracticeMedicalDirector join tables are the source
  // of truth for PROVIDER (panel) + MED_DIR (practice) scoping. The original
  // backfill migration derived them from existing PatientProviderAssignment
  // rows, but a FRESH DB (CI: migrate deploy → seed) runs that backfill
  // against an empty assignment table, leaving the joins empty — which makes
  // every PROVIDER/MED_DIR see zero patients/practices. Seeding the rows here
  // (after the assignment loop) keeps a freshly-seeded DB consistent with the
  // scope queries. Idempotent via the composite unique key.
  const staffLinks: Array<{ practiceId: string; userId: string }> = [
    { practiceId: practiceA.id, userId: primaryProvider.id },
    { practiceId: practiceA.id, userId: backupProvider.id },
    // Manisha Patel (PROVIDER + SUPER_ADMIN) is also Cedar Hill staff so the
    // practice-scoped care-team dropdowns offer a SECOND selectable provider
    // besides the primary/backup trio — the 30e.4 idempotency-alternation
    // test toggles backup between Reyes and Patel. Her own data scope is
    // unaffected (SUPER_ADMIN short-circuits PatientAccessService.isUnscoped).
    { practiceId: practiceA.id, userId: manishaPatel.id },
  ]
  for (const link of staffLinks) {
    await prisma.practiceProvider.upsert({
      where: { practiceId_userId: link },
      update: {},
      create: link,
    })
  }
  await prisma.practiceMedicalDirector.upsert({
    where: {
      practiceId_userId: { practiceId: practiceA.id, userId: medicalDirector.id },
    },
    update: {},
    create: { practiceId: practiceA.id, userId: medicalDirector.id },
  })
  console.log(
    `  staff joins: ${staffLinks.length} providers + 1 medical director → ${practiceA.name}`,
  )
}
