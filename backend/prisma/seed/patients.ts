// DCHA demo seed (May 2026) — full rewrite of the prior 13-persona phase/19
// fixture set. Builds the seven-patient cohort the recording walks through:
//   • Marcus Williams — primary subject (lived-in intake, fires emergency live)
//   • Daniel Brown    — fresh-state intake demo
//   • Patricia / Robert / Doris / James / Loretta — admin-queue companions
//
// One spec deviation, agreed with Duwaragie before this rewrite landed:
//   Caregiver records (Tasha Williams for Marcus, Marcus Davis for Loretta) are
//   omitted. PatientCaregiver model + CAREGIVER role + dispatch path are not on
//   main or on prod (`findCaregiverUserIds` in escalation.service.ts returns []
//   until Lakshitha's Gap 5 ships). The seed runs cleanly on the current main
//   schema; the demo's "email-into-Tasha's-inbox" moment is dropped for this
//   recording cut. See qa/demo/README.md for the runbook impact.
//
// All seven patients attach to `seed-cedar-hill` with care team
// Okonkwo / Reyes / Raman. The five companion patients also carry their own
// inline alert + escalation state (moved here from state.ts so a production
// seed populates the admin queue — the previous NODE_ENV !== 'production'
// gate around state.ts is bypassed because production now needs that queue).
//
// Marcus's nine lived-in JournalEntry rows populate every structured field
// the current `main` check-in flow captures: BP, pulse, position, weight
// (optional), the five-symptom checklist (dizziness/syncope/palpitations/
// legSwelling/fatigue), per-medication adherence via medicationStatuses +
// missedMedications JSON, and medicationTaken aggregate. The day-17 fatigue
// flip and day-10 ankle-swelling + Furosemide-skipped detail are the rows
// the recorder will expand on camera.
import {
  prisma,
  DEMO_OTP,
  hashOtp,
  daysAgo,
  hoursAgo,
  seedPermaOtp,
} from './helpers.js'
import type { SeededPractices } from './practices.js'
import type { SeededAdmins } from './admins.js'

// ─── Local persona shape ───────────────────────────────────────────────────
// Defined inline (not in helpers.ts) because the DCHA personas carry richer
// per-reading + inline-alert state than the v1 PatientSeed type — and this
// rewrite is a one-shot demo cut, not a long-lived shape.

type DrugClass =
  | 'ACE_INHIBITOR'
  | 'ARB'
  | 'BETA_BLOCKER'
  | 'DHP_CCB'
  | 'NDHP_CCB'
  | 'LOOP_DIURETIC'
  | 'STATIN'
  | 'ANTICOAGULANT'
  | 'ANTIARRHYTHMIC'

type Position = 'SITTING' | 'STANDING' | 'LYING'

type Symptoms = {
  // The patient-visible five-symptom checklist on the standard CheckIn step.
  // Matches frontend/src/components/cardio/CheckIn.tsx lines 214-218.
  dizziness: boolean
  syncope: boolean
  palpitations: boolean
  legSwelling: boolean
  fatigue: boolean
}

const SYMPTOMS_CLEAR: Symptoms = {
  dizziness: false,
  syncope: false,
  palpitations: false,
  legSwelling: false,
  fatigue: false,
}

type MedSkip = {
  drugName: string
  reason: string
  missedDoses: number
}

type DemoReading = {
  daysAgo: number
  sbp: number
  dbp: number
  pulse: number
  position: Position
  weightLb?: number // optional; converted to kg at write time
  symptoms?: Symptoms
  /**
   * Per-medication adherence:
   *   undefined / { skipped: [] } → every active med taken (medicationTaken=true)
   *   { skipped: [...] }          → those meds missed, rest taken
   *
   * Persisted via JournalEntry.medicationStatuses (per-med snapshot) +
   * missedMedications (just the skips) + missedDoses (aggregate count) +
   * medicationTaken (false iff any skip).
   */
  skipped?: MedSkip[]
}

type DemoMedication = {
  drugName: string
  drugClass: DrugClass
  frequency: 'ONCE_DAILY' | 'TWICE_DAILY'
}

type AlertSeed = {
  /**
   * Which reading (by daysAgo) the alert is bound to. The reading must exist
   * in the patient's `readings` array. journalEntryId is resolved at insert
   * time after readings are created.
   */
  boundToReadingDaysAgo: number
  tier:
    | 'TIER_1_CONTRAINDICATION'
    | 'TIER_2_DISCREPANCY'
    | 'TIER_3_INFO'
    | 'BP_LEVEL_1_HIGH'
    | 'BP_LEVEL_1_LOW'
    | 'BP_LEVEL_2'
    | 'BP_LEVEL_2_SYMPTOM_OVERRIDE'
  ruleId: string
  mode: 'STANDARD' | 'PERSONALIZED'
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED'
  patientMessage: string
  caregiverMessage?: string | null
  physicianMessage: string
  /**
   * Optional resolution / acknowledgement details. When resolvedAt is set the
   * alert also carries resolutionAction + resolutionRationale (15-field
   * Joint-Commission audit row).
   */
  acknowledgedHoursAgo?: number
  acknowledgedByActor?: ActorKey
  resolvedHoursAgo?: number
  resolvedByActor?: ActorKey
  resolutionAction?: string
  resolutionRationale?: string
  /**
   * Escalation timeline rows. Each step seeds one EscalationEvent row whose
   * recipientIds[] holds the resolved User IDs for the chosen roles — matching
   * the runtime engine's per-step row shape (one row per dispatch step, not
   * one per recipient — see escalation.service.ts:671).
   */
  escalations?: AlertEscalation[]
}

type ActorKey =
  | 'okonkwo'
  | 'reyes'
  | 'raman'
  | 'singal'
  | 'ops'

type AlertEscalation = {
  ladderStep: 'T0' | 'T4H' | 'T8H' | 'T24H' | 'T48H'
  triggeredHoursAgo: number
  notificationChannel: 'PUSH' | 'EMAIL' | 'DASHBOARD'
  recipientRoles: Array<
    | 'PRIMARY_PROVIDER'
    | 'BACKUP_PROVIDER'
    | 'MEDICAL_DIRECTOR'
    | 'HEALPLACE_OPS'
  >
  /** Set when this step was the one the human acted on. */
  acknowledgedHoursAgo?: number
  acknowledgedByActor?: ActorKey
}

type DemoPatient = {
  email: string
  name: string
  dateOfBirth: Date
  gender: 'MALE' | 'FEMALE' | 'OTHER'
  heightCm: number
  /** false → intake-demo patient (Daniel) only. */
  enrolled: boolean
  enrolledDaysAgo?: number
  profile: {
    isPregnant?: boolean
    hasHeartFailure?: boolean
    heartFailureType?: 'HFREF' | 'HFPEF' | 'NOT_APPLICABLE'
    hasAFib?: boolean
    hasCAD?: boolean
    hasHCM?: boolean
    hasDCM?: boolean
    hasBradycardia?: boolean
    hasTachycardia?: boolean
    diagnosedHypertension?: boolean
  }
  medications: DemoMedication[]
  threshold?: {
    sbpUpperTarget?: number
    sbpLowerTarget?: number
    dbpUpperTarget?: number
    dbpLowerTarget?: number
    notes?: string
    setDaysAgo?: number
  }
  readings: DemoReading[]
  alerts?: AlertSeed[]
  archetype: string
}

// ─── Helpers ───────────────────────────────────────────────────────────────
const KG_PER_LB = 0.45359237
const lbToKg = (lb: number) => Math.round(lb * KG_PER_LB * 10) / 10

const all = (s: Symptoms) => s

// ─── Persona definitions ───────────────────────────────────────────────────
// Bound below the type defs so editing one persona stays self-contained.

const personas: DemoPatient[] = [
  // ── 1. Marcus Williams — primary recording subject (lived-in) ──────────
  {
    email: 'duwaragiek.racsliit@gmail.com',
    name: 'Marcus Williams',
    dateOfBirth: new Date('1961-04-12'),
    gender: 'MALE',
    heightCm: 178,
    enrolled: true,
    enrolledDaysAgo: 30,
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY' },
      { drugName: 'Metoprolol succinate', drugClass: 'BETA_BLOCKER', frequency: 'ONCE_DAILY' },
      { drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY' },
      { drugName: 'Atorvastatin', drugClass: 'STATIN', frequency: 'ONCE_DAILY' },
    ],
    threshold: {
      sbpUpperTarget: 130,
      sbpLowerTarget: 100,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      notes:
        'HFrEF + Stage-2 HTN — target <130/80, set by Dr. Okonkwo at intake.',
      setDaysAgo: 30,
    },
    readings: [
      // Sub-threshold day-17 / day-10 entries are the rich past records the
      // recorder opens on camera — neither row may fire a rule.
      { daysAgo: 28, sbp: 152, dbp: 96, pulse: 78, position: 'SITTING', weightLb: 198, symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 25, sbp: 148, dbp: 92, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 21, sbp: 142, dbp: 88, pulse: 74, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      {
        daysAgo: 17,
        sbp: 138,
        dbp: 86,
        pulse: 72,
        position: 'STANDING',
        weightLb: 197,
        symptoms: { ...SYMPTOMS_CLEAR, fatigue: true },
      },
      { daysAgo: 14, sbp: 134, dbp: 84, pulse: 71, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      {
        daysAgo: 10,
        sbp: 132,
        dbp: 82,
        pulse: 70,
        position: 'SITTING',
        weightLb: 199,
        symptoms: { ...SYMPTOMS_CLEAR, legSwelling: true },
        skipped: [
          {
            drugName: 'Furosemide',
            reason: 'Skipped — frequent bathroom trips',
            missedDoses: 1,
          },
        ],
      },
      { daysAgo: 7, sbp: 130, dbp: 80, pulse: 70, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 4, sbp: 128, dbp: 78, pulse: 68, position: 'LYING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 2, sbp: 132, dbp: 82, pulse: 70, position: 'SITTING', weightLb: 196, symptoms: all(SYMPTOMS_CLEAR) },
    ],
    // No pre-seeded alerts/notifications/chat — emergency fires live during the recording.
    archetype:
      'HFrEF + Stage-2 HTN — lived-in 30-day trend, all sub-threshold; emergency fires live during Video 1',
  },

  // ── 2. Daniel Brown — fresh-state intake-demo patient ──────────────────
  {
    email: 'daniel.brown@cardioplace.demo',
    name: 'Daniel Brown',
    dateOfBirth: new Date('1965-09-08'),
    gender: 'MALE',
    heightCm: 180,
    enrolled: false,
    profile: {},
    medications: [],
    readings: [],
    archetype:
      'Fresh intake — lands on intake form (onboarding NOT_COMPLETED, no readings, no alerts)',
  },

  // ── 3. Patricia Johnson — open L1-HIGH, acknowledged (queue: in progress) ──
  {
    email: 'patricia.johnson@cardioplace.demo',
    name: 'Patricia Johnson',
    dateOfBirth: new Date('1968-02-19'),
    gender: 'FEMALE',
    heightCm: 164,
    enrolled: true,
    enrolledDaysAgo: 45,
    profile: {
      hasCAD: true,
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY' },
      { drugName: 'Atorvastatin', drugClass: 'STATIN', frequency: 'ONCE_DAILY' },
    ],
    readings: [
      { daysAgo: 10, sbp: 134, dbp: 86, pulse: 74, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 7, sbp: 138, dbp: 88, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 4, sbp: 142, dbp: 90, pulse: 78, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      // Yesterday — the reading that fires the alert.
      { daysAgo: 1, sbp: 148, dbp: 94, pulse: 80, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
    ],
    alerts: [
      {
        boundToReadingDaysAgo: 1,
        tier: 'BP_LEVEL_1_HIGH',
        ruleId: 'RULE_STANDARD_L1_HIGH',
        mode: 'STANDARD',
        status: 'ACKNOWLEDGED',
        patientMessage:
          'Your blood pressure is higher than your target. Please re-check in the morning and reach out to your care team if it stays high.',
        physicianMessage:
          'Sustained Stage-1 HTN (148/94, single reading). CAD on med list. Acknowledged by primary provider — consider med adjustment or in-person follow-up.',
        acknowledgedHoursAgo: 6,
        acknowledgedByActor: 'okonkwo',
        escalations: [
          {
            ladderStep: 'T0',
            triggeredHoursAgo: 18,
            notificationChannel: 'EMAIL',
            recipientRoles: ['PRIMARY_PROVIDER'],
            acknowledgedHoursAgo: 6,
            acknowledgedByActor: 'okonkwo',
          },
        ],
      },
    ],
    archetype: 'Stage-1 HTN + CAD — open L1-HIGH, acknowledged → admin queue "in progress"',
  },

  // ── 4. Robert Carter — recently enrolled, no alerts ────────────────────
  {
    email: 'robert.carter@cardioplace.demo',
    name: 'Robert Carter',
    dateOfBirth: new Date('1955-06-14'),
    gender: 'MALE',
    heightCm: 175,
    enrolled: true,
    enrolledDaysAgo: 14,
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
      hasAFib: true,
    },
    medications: [
      { drugName: 'Carvedilol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY' },
      { drugName: 'Apixaban', drugClass: 'ANTICOAGULANT', frequency: 'TWICE_DAILY' },
      { drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY' },
    ],
    threshold: {
      sbpUpperTarget: 130,
      sbpLowerTarget: 100,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      notes: 'HFrEF + AFib — target <130/80, set at enrollment.',
      setDaysAgo: 14,
    },
    readings: [
      { daysAgo: 12, sbp: 124, dbp: 76, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 9, sbp: 122, dbp: 74, pulse: 78, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 6, sbp: 126, dbp: 78, pulse: 74, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 3, sbp: 120, dbp: 74, pulse: 72, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 1, sbp: 122, dbp: 76, pulse: 70, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
    ],
    archetype: 'HFrEF + AFib — recently enrolled, well-controlled, no alerts',
  },

  // ── 5. Doris Thompson — fully resolved alert with 15-field audit ────────
  {
    email: 'doris.thompson@cardioplace.demo',
    name: 'Doris Thompson',
    dateOfBirth: new Date('1958-11-22'),
    gender: 'FEMALE',
    heightCm: 158,
    enrolled: true,
    enrolledDaysAgo: 60,
    profile: {
      diagnosedHypertension: true,
    },
    medications: [
      // Lisinopril 20mg/day — post-adjustment dose per resolutionRationale below.
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY' },
      { drugName: 'Hydrochlorothiazide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY' },
    ],
    readings: [
      { daysAgo: 12, sbp: 142, dbp: 88, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 9, sbp: 146, dbp: 90, pulse: 78, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 6, sbp: 150, dbp: 92, pulse: 80, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      // The reading that fired the now-resolved alert.
      { daysAgo: 5, sbp: 158, dbp: 98, pulse: 82, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 3, sbp: 138, dbp: 84, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 1, sbp: 130, dbp: 80, pulse: 72, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
    ],
    alerts: [
      {
        boundToReadingDaysAgo: 5,
        tier: 'BP_LEVEL_1_HIGH',
        ruleId: 'RULE_STANDARD_L1_HIGH',
        mode: 'STANDARD',
        status: 'RESOLVED',
        patientMessage:
          'Your blood pressure was higher than your target. Your care team adjusted your medication — keep logging readings so we can confirm it is back on track.',
        physicianMessage:
          'Sustained L1-HIGH 158/98 — adjusted lisinopril 10→20 mg daily. BP trending down on subsequent days (138/84 → 130/80).',
        acknowledgedHoursAgo: 5 * 24 - 4, // ~4h after the reading
        acknowledgedByActor: 'okonkwo',
        resolvedHoursAgo: 4 * 24, // resolved ~24h after acknowledgement
        resolvedByActor: 'okonkwo',
        resolutionAction: 'BP_L2_CONTACTED_MED_ADJUSTED',
        resolutionRationale:
          'Adjusted lisinopril from 10mg to 20mg daily; will recheck BP in 48h.',
        escalations: [
          {
            ladderStep: 'T0',
            triggeredHoursAgo: 5 * 24,
            notificationChannel: 'EMAIL',
            recipientRoles: ['PRIMARY_PROVIDER'],
            acknowledgedHoursAgo: 5 * 24 - 4,
            acknowledgedByActor: 'okonkwo',
          },
          {
            ladderStep: 'T4H',
            triggeredHoursAgo: 5 * 24 - 4,
            notificationChannel: 'EMAIL',
            recipientRoles: ['PRIMARY_PROVIDER', 'BACKUP_PROVIDER'],
          },
          {
            ladderStep: 'T8H',
            triggeredHoursAgo: 5 * 24 - 8,
            notificationChannel: 'EMAIL',
            recipientRoles: ['MEDICAL_DIRECTOR'],
          },
          {
            ladderStep: 'T24H',
            triggeredHoursAgo: 5 * 24 - 24,
            notificationChannel: 'EMAIL',
            recipientRoles: ['HEALPLACE_OPS'],
          },
          {
            ladderStep: 'T48H',
            triggeredHoursAgo: 5 * 24 - 48,
            notificationChannel: 'DASHBOARD',
            recipientRoles: ['HEALPLACE_OPS'],
          },
        ],
      },
    ],
    archetype:
      'Stage-1 HTN — fully resolved alert with 5-step ladder + 15-field audit + medication-adjustment rationale (Video 2 expands)',
  },

  // ── 6. James Lewis — open first-month adherence nudge ───────────────────
  {
    email: 'james.lewis@cardioplace.demo',
    name: 'James Lewis',
    dateOfBirth: new Date('1964-03-30'),
    gender: 'MALE',
    heightCm: 180,
    enrolled: true,
    enrolledDaysAgo: 12, // within 30 days → first-month nudge eligible
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFPEF',
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Losartan', drugClass: 'ARB', frequency: 'ONCE_DAILY' },
      { drugName: 'Metoprolol succinate', drugClass: 'BETA_BLOCKER', frequency: 'ONCE_DAILY' },
    ],
    readings: [
      { daysAgo: 10, sbp: 128, dbp: 78, pulse: 74, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 7, sbp: 130, dbp: 80, pulse: 76, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      {
        daysAgo: 4,
        sbp: 132,
        dbp: 82,
        pulse: 78,
        position: 'SITTING',
        symptoms: all(SYMPTOMS_CLEAR),
        skipped: [
          { drugName: 'Losartan', reason: 'Forgot — busy morning', missedDoses: 1 },
        ],
      },
      {
        daysAgo: 1,
        sbp: 134,
        dbp: 84,
        pulse: 78,
        position: 'SITTING',
        symptoms: all(SYMPTOMS_CLEAR),
        skipped: [
          { drugName: 'Metoprolol succinate', reason: 'Ran out — refill pending', missedDoses: 1 },
        ],
      },
    ],
    alerts: [
      {
        boundToReadingDaysAgo: 1,
        tier: 'TIER_3_INFO',
        ruleId: 'RULE_FIRST_MONTH_ADHERENCE_NUDGE',
        mode: 'STANDARD',
        status: 'OPEN',
        patientMessage:
          'Starting a new medicine can take some getting used to. If you missed a dose, try to take your next one on time. Your care team is here to help if anything is making it hard to stay on schedule.',
        physicianMessage:
          'First-month adherence nudge: 2 missed doses in last 4 readings (Losartan, Metoprolol). Patient enrolled 12 days ago — within first-month support window.',
        escalations: [
          {
            ladderStep: 'T0',
            triggeredHoursAgo: 6,
            notificationChannel: 'DASHBOARD',
            recipientRoles: ['PRIMARY_PROVIDER'],
          },
        ],
      },
    ],
    archetype: 'HFpEF newly-enrolled — open first-month adherence nudge (yellow row)',
  },

  // ── 7. Loretta Davis — open HF-decomp (teal heart-failure card) ────────
  {
    email: 'loretta.davis@cardioplace.demo',
    name: 'Loretta Davis',
    dateOfBirth: new Date('1953-08-05'),
    gender: 'FEMALE',
    heightCm: 160,
    enrolled: true,
    enrolledDaysAgo: 90,
    profile: {
      hasHeartFailure: true,
      heartFailureType: 'HFREF',
      hasCAD: true,
      diagnosedHypertension: true,
    },
    medications: [
      { drugName: 'Lisinopril', drugClass: 'ACE_INHIBITOR', frequency: 'ONCE_DAILY' },
      { drugName: 'Carvedilol', drugClass: 'BETA_BLOCKER', frequency: 'TWICE_DAILY' },
      { drugName: 'Furosemide', drugClass: 'LOOP_DIURETIC', frequency: 'ONCE_DAILY' },
      { drugName: 'Atorvastatin', drugClass: 'STATIN', frequency: 'ONCE_DAILY' },
    ],
    threshold: {
      sbpUpperTarget: 130,
      sbpLowerTarget: 100,
      dbpUpperTarget: 80,
      dbpLowerTarget: 60,
      notes: 'HFrEF + CAD — target <130/80 per Cedar Hill HF protocol.',
      setDaysAgo: 90,
    },
    readings: [
      { daysAgo: 12, sbp: 128, dbp: 80, pulse: 72, position: 'SITTING', weightLb: 144, symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 9, sbp: 132, dbp: 82, pulse: 74, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 6, sbp: 136, dbp: 84, pulse: 76, position: 'SITTING', weightLb: 146, symptoms: all(SYMPTOMS_CLEAR) },
      { daysAgo: 3, sbp: 142, dbp: 85, pulse: 78, position: 'SITTING', symptoms: all(SYMPTOMS_CLEAR) },
      // Yesterday — fires HF decomp: BP up + leg swelling + weight up.
      {
        daysAgo: 1,
        sbp: 148,
        dbp: 86,
        pulse: 82,
        position: 'SITTING',
        weightLb: 150,
        symptoms: { ...SYMPTOMS_CLEAR, legSwelling: true },
      },
    ],
    alerts: [
      {
        boundToReadingDaysAgo: 1,
        tier: 'TIER_2_DISCREPANCY',
        ruleId: 'RULE_HF_DECOMPENSATION',
        mode: 'STANDARD',
        status: 'OPEN',
        patientMessage:
          'Your blood pressure is up and you have new leg swelling. Please contact your care team today — they may want to see you sooner.',
        physicianMessage:
          'HF decompensation signal: SBP up 20 mmHg from baseline + new leg swelling + weight up 6 lb in 11 days. HFrEF on loop diuretic. Consider in-person eval and diuretic dose review.',
        escalations: [
          {
            ladderStep: 'T0',
            triggeredHoursAgo: 8,
            notificationChannel: 'EMAIL',
            recipientRoles: ['PRIMARY_PROVIDER'],
          },
        ],
      },
    ],
    archetype:
      'HFrEF + CAD — open HF-decomp (rule-aware teal card on admin, A1 fix on main)',
  },
]

// ─── Persistence ───────────────────────────────────────────────────────────
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
    opsUser,
  } = admins

  const actorById: Record<ActorKey, string> = {
    okonkwo: primaryProvider.id,
    reyes: backupProvider.id,
    raman: medicalDirector.id,
    singal: supportAdmin.id,
    ops: opsUser.id,
  }
  const recipientRoleToActor: Record<
    AlertEscalation['recipientRoles'][number],
    ActorKey
  > = {
    PRIMARY_PROVIDER: 'okonkwo',
    BACKUP_PROVIDER: 'reyes',
    MEDICAL_DIRECTOR: 'raman',
    HEALPLACE_OPS: 'ops',
  }

  for (const p of personas) {
    // ── User ────────────────────────────────────────────────────────────
    const user = await prisma.user.upsert({
      where: { email: p.email },
      update: {
        name: p.name,
        roles: ['PATIENT'],
        onboardingStatus: p.enrolled ? 'COMPLETED' : 'NOT_COMPLETED',
        enrollmentStatus: p.enrolled ? 'ENROLLED' : 'NOT_ENROLLED',
        enrolledAt:
          p.enrolled && p.enrolledDaysAgo
            ? daysAgo(p.enrolledDaysAgo)
            : null,
        dateOfBirth: p.dateOfBirth,
      },
      create: {
        email: p.email,
        pwdhash: supportAdmin.pwdhash,
        name: p.name,
        roles: ['PATIENT'],
        isVerified: true,
        onboardingStatus: p.enrolled ? 'COMPLETED' : 'NOT_COMPLETED',
        enrollmentStatus: p.enrolled ? 'ENROLLED' : 'NOT_ENROLLED',
        enrolledAt:
          p.enrolled && p.enrolledDaysAgo
            ? daysAgo(p.enrolledDaysAgo)
            : null,
        dateOfBirth: p.dateOfBirth,
        timezone: 'America/New_York',
        preferredLanguage: 'en',
      },
    })
    await seedPermaOtp(p.email, otpHash)

    // ── PatientProfile ──────────────────────────────────────────────────
    await prisma.patientProfile.upsert({
      where: { userId: user.id },
      update: {
        gender: p.gender,
        heightCm: p.heightCm,
        ...p.profile,
        // Daniel intake-demo: keep status UNVERIFIED so the admin verification
        // screen has something to review during the recording.
        profileVerificationStatus: p.enrolled ? 'VERIFIED' : 'UNVERIFIED',
        profileVerifiedAt: p.enrolled ? new Date() : null,
        profileVerifiedBy: p.enrolled ? supportAdmin.id : null,
      },
      create: {
        userId: user.id,
        gender: p.gender,
        heightCm: p.heightCm,
        ...p.profile,
        profileVerificationStatus: p.enrolled ? 'VERIFIED' : 'UNVERIFIED',
        profileVerifiedAt: p.enrolled ? new Date() : null,
        profileVerifiedBy: p.enrolled ? supportAdmin.id : null,
      },
    })

    // ── PatientMedication ───────────────────────────────────────────────
    // Wipe + recreate so re-seeds never accumulate.
    await prisma.patientMedication.deleteMany({ where: { userId: user.id } })
    for (const m of p.medications) {
      await prisma.patientMedication.create({
        data: {
          userId: user.id,
          drugName: m.drugName,
          drugClass: m.drugClass,
          frequency: m.frequency,
          source: 'PATIENT_SELF_REPORT',
          verificationStatus: 'VERIFIED',
          verifiedByAdminId: supportAdmin.id,
          verifiedAt: new Date(),
        },
      })
    }

    // ── PatientThreshold ────────────────────────────────────────────────
    if (p.threshold) {
      const { setDaysAgo, ...thresholdFields } = p.threshold
      await prisma.patientThreshold.upsert({
        where: { userId: user.id },
        update: {
          ...thresholdFields,
          setByProviderId: primaryProvider.id,
          setAt: setDaysAgo ? daysAgo(setDaysAgo) : new Date(),
        },
        create: {
          userId: user.id,
          ...thresholdFields,
          setByProviderId: primaryProvider.id,
          setAt: setDaysAgo ? daysAgo(setDaysAgo) : new Date(),
        },
      })
    }

    // ── PatientProviderAssignment ───────────────────────────────────────
    await prisma.patientProviderAssignment.upsert({
      where: { userId: user.id },
      update: {
        practiceId: practiceA.id,
        primaryProviderId: primaryProvider.id,
        backupProviderId: backupProvider.id,
        medicalDirectorId: medicalDirector.id,
      },
      create: {
        userId: user.id,
        practiceId: practiceA.id,
        primaryProviderId: primaryProvider.id,
        backupProviderId: backupProvider.id,
        medicalDirectorId: medicalDirector.id,
      },
    })

    // ── JournalEntry rows + per-medication adherence snapshot ───────────
    // Cascade-deletes any existing entries (and the alerts bound to them)
    // before we recreate, so reruns stay idempotent.
    await prisma.journalEntry.deleteMany({ where: { userId: user.id } })
    const entryIdByDaysAgo = new Map<number, string>()
    for (const r of p.readings) {
      const skipped = r.skipped ?? []
      const skippedNames = new Set(skipped.map((s) => s.drugName))
      const symptoms = r.symptoms ?? SYMPTOMS_CLEAR

      const medicationStatuses = p.medications.map((m) => {
        const skip = skipped.find((s) => s.drugName === m.drugName)
        return skip
          ? {
              drugName: m.drugName,
              drugClass: m.drugClass,
              taken: 'no' as const,
              reason: skip.reason,
              missedDoses: skip.missedDoses,
            }
          : {
              drugName: m.drugName,
              drugClass: m.drugClass,
              taken: 'yes' as const,
            }
      })

      const missedMedications = skipped.map((s) => ({
        drugName: s.drugName,
        drugClass:
          p.medications.find((m) => m.drugName === s.drugName)?.drugClass ?? null,
        reason: s.reason,
        missedDoses: s.missedDoses,
      }))

      const created = await prisma.journalEntry.create({
        data: {
          userId: user.id,
          measuredAt: daysAgo(r.daysAgo),
          systolicBP: r.sbp,
          diastolicBP: r.dbp,
          pulse: r.pulse,
          position: r.position,
          weight:
            r.weightLb !== undefined ? lbToKg(r.weightLb).toFixed(1) : null,
          medicationTaken: p.medications.length === 0 ? null : skippedNames.size === 0,
          missedDoses: skipped.reduce((sum, s) => sum + s.missedDoses, 0),
          missedMedications: missedMedications.length > 0 ? missedMedications : undefined,
          medicationStatuses: medicationStatuses.length > 0 ? medicationStatuses : undefined,
          dizziness: symptoms.dizziness,
          syncope: symptoms.syncope,
          palpitations: symptoms.palpitations,
          legSwelling: symptoms.legSwelling,
          fatigue: symptoms.fatigue,
          source: 'MANUAL',
        },
      })
      entryIdByDaysAgo.set(r.daysAgo, created.id)
    }

    // ── Inline alert + escalation + notification seeding ────────────────
    if (p.alerts && p.alerts.length > 0) {
      for (const a of p.alerts) {
        const journalEntryId = entryIdByDaysAgo.get(a.boundToReadingDaysAgo)
        if (!journalEntryId) {
          throw new Error(
            `[seed] ${p.email} alert references missing reading daysAgo=${a.boundToReadingDaysAgo}`,
          )
        }

        const alert = await prisma.deviationAlert.create({
          data: {
            userId: user.id,
            journalEntryId,
            tier: a.tier,
            ruleId: a.ruleId,
            mode: a.mode,
            status: a.status,
            patientMessage: a.patientMessage,
            caregiverMessage: a.caregiverMessage ?? null,
            physicianMessage: a.physicianMessage,
            escalated: (a.escalations?.length ?? 0) > 0,
            acknowledgedAt:
              a.acknowledgedHoursAgo !== undefined
                ? hoursAgo(a.acknowledgedHoursAgo)
                : null,
            acknowledgedByUserId: a.acknowledgedByActor
              ? actorById[a.acknowledgedByActor]
              : null,
            resolvedAt:
              a.resolvedHoursAgo !== undefined
                ? hoursAgo(a.resolvedHoursAgo)
                : null,
            resolvedBy: a.resolvedByActor ? actorById[a.resolvedByActor] : null,
            resolutionAction: a.resolutionAction ?? null,
            resolutionRationale: a.resolutionRationale ?? null,
          },
        })

        for (const e of a.escalations ?? []) {
          const recipientIds = e.recipientRoles.map(
            (role) => actorById[recipientRoleToActor[role]],
          )
          const event = await prisma.escalationEvent.create({
            data: {
              alertId: alert.id,
              userId: user.id,
              escalationLevel: e.ladderStep === 'T0' ? 'LEVEL_1' : 'LEVEL_2',
              reason: `${e.ladderStep} dispatched (DCHA seed)`,
              ladderStep: e.ladderStep,
              recipientIds,
              recipientRoles: e.recipientRoles,
              notificationChannel: e.notificationChannel,
              afterHours: false,
              dispatchedBySystem: true,
              triggeredAt: hoursAgo(e.triggeredHoursAgo),
              notificationSentAt: hoursAgo(e.triggeredHoursAgo),
              acknowledgedAt:
                e.acknowledgedHoursAgo !== undefined
                  ? hoursAgo(e.acknowledgedHoursAgo)
                  : null,
              acknowledgedBy: e.acknowledgedByActor
                ? actorById[e.acknowledgedByActor]
                : null,
            },
          })

          // One Notification per (escalation step, recipient) — matches what
          // the runtime engine writes via writeNotificationsAndEmit. The
          // composite unique key (alertId, escalationEventId, userId, channel)
          // already enforces no duplicates if a re-seed retries.
          for (let i = 0; i < recipientIds.length; i++) {
            await prisma.notification.create({
              data: {
                userId: recipientIds[i],
                alertId: alert.id,
                escalationEventId: event.id,
                patientUserId: user.id,
                channel: e.notificationChannel,
                title: titleForStep(e.ladderStep, a.tier),
                body: a.physicianMessage,
                tips: [],
                sentAt: hoursAgo(e.triggeredHoursAgo),
              },
            })
          }
        }
      }
    }

    const alertSummary = p.alerts?.length
      ? `, ${p.alerts.length} alert(s)`
      : ''
    console.log(
      `  patient: ${p.email} — ${p.archetype} (${p.medications.length} meds, ${p.readings.length} readings${p.threshold ? ', +threshold' : ''}${alertSummary})`,
    )
  }

  // ── Practice ↔ staff join rows (May 2026 role-scope) ───────────────────
  // Idempotent via the composite unique key — keeps a freshly-seeded DB
  // consistent with PROVIDER (panel) + MED_DIR (practice) scope queries.
  const staffLinks: Array<{ practiceId: string; userId: string }> = [
    { practiceId: practiceA.id, userId: primaryProvider.id },
    { practiceId: practiceA.id, userId: backupProvider.id },
    { practiceId: practiceA.id, userId: admins.manishaPatel.id },
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

function titleForStep(
  step: AlertEscalation['ladderStep'],
  tier: AlertSeed['tier'],
): string {
  if (tier === 'BP_LEVEL_2' || tier === 'BP_LEVEL_2_SYMPTOM_OVERRIDE') {
    return 'Urgent Blood Pressure Alert'
  }
  if (tier.startsWith('TIER_1')) return 'Tier 1 — Contraindication alert'
  if (tier === 'BP_LEVEL_1_HIGH') {
    return step === 'T0' ? 'High Blood Pressure Alert' : `BP alert reminder (${step})`
  }
  if (tier === 'BP_LEVEL_1_LOW') return 'Low Blood Pressure Alert'
  return `Alert (${step})`
}
