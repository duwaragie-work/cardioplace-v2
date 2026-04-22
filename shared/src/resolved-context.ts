// Phase/4 ResolvedContext — the single immutable snapshot of a patient's
// clinical state that the rule engine (phase/5) consumes. The resolver loads
// this in one Prisma query; the engine never touches the DB again for the
// same reading.
//
// Framework-free: plain interfaces + string-literal unions. Re-exported from
// `shared/src/index.ts` so `/backend` and `/admin` can both type-check
// against the same shape.

import type {
  DrugClassInput,
  GenderInput,
  HeartFailureTypeInput,
  MedicationFrequencyInput,
  MedicationSourceInput,
  MedicationVerificationStatusInput,
  ProfileVerificationStatusInput,
} from './intake.js'
import type { AgeGroup } from './derivatives.js'

// ─── medications in-context ──────────────────────────────────────────────────

/** Medication entry as seen by the rule engine. */
export interface ContextMedication {
  id: string
  drugName: string
  drugClass: DrugClassInput
  /** True when imported from a combo card — drugClass + extraDrugClasses together. */
  isCombination: boolean
  /** Combo components' drug classes. Used for contraindication checks (e.g. Entresto → ARB). */
  combinationComponents: DrugClassInput[]
  frequency: MedicationFrequencyInput
  source: MedicationSourceInput
  verificationStatus: MedicationVerificationStatusInput
  reportedAt: Date
}

// ─── threshold ───────────────────────────────────────────────────────────────

export interface ContextThreshold {
  sbpUpperTarget: number | null
  sbpLowerTarget: number | null
  dbpUpperTarget: number | null
  dbpLowerTarget: number | null
  hrUpperTarget: number | null
  hrLowerTarget: number | null
  setByProviderId: string
  setAt: Date
  notes: string | null
}

// ─── assignment ──────────────────────────────────────────────────────────────

export interface ContextAssignment {
  practiceId: string
  primaryProviderId: string
  backupProviderId: string
  medicalDirectorId: string
}

// ─── profile (flattened for the engine) ──────────────────────────────────────

/**
 * Clinical profile the engine reads. `resolvedHFType` is the *safety-net-
 * adjusted* heart-failure type: HF type UNKNOWN → HFREF, DCM → HFREF. Use
 * this over `heartFailureType` when picking condition branches.
 */
export interface ContextProfile {
  gender: GenderInput | null
  heightCm: number | null

  isPregnant: boolean
  pregnancyDueDate: Date | null
  historyPreeclampsia: boolean

  hasHeartFailure: boolean
  heartFailureType: HeartFailureTypeInput
  resolvedHFType: HeartFailureTypeInput

  hasAFib: boolean
  hasCAD: boolean
  hasHCM: boolean
  hasDCM: boolean
  hasTachycardia: boolean
  hasBradycardia: boolean
  diagnosedHypertension: boolean

  verificationStatus: ProfileVerificationStatusInput
  verifiedAt: Date | null
  lastEditedAt: Date
}

// ─── top-level context ───────────────────────────────────────────────────────

export interface ResolvedContext {
  userId: string
  /** Used for age-group derivation and nothing else. */
  dateOfBirth: Date | null
  /** IANA timezone for reading-context derivation. Falls back to UTC. */
  timezone: string | null
  /** AHA 2025 age bucket (or null if DOB missing / under 18). */
  ageGroup: AgeGroup | null

  profile: ContextProfile

  /** Active, known-class medications. Includes UNVERIFIED known-class meds
   * so the engine can apply suppression logic (e.g. beta-blocker HR 50–60
   * suppression). Contraindication rules must additionally check the
   * `triggerPregnancyContraindicationCheck` flag for unverified ACE/ARB +
   * pregnancy — that's the only safety-critical pair that fires on
   * unverified meds. */
  contextMeds: ContextMedication[]

  /** Medications excluded from automated alerting:
   * - drugClass = OTHER_UNVERIFIED
   * - source ∈ {PATIENT_VOICE, PATIENT_PHOTO} with UNVERIFIED status
   * - verificationStatus = REJECTED
   *
   * Retained for admin reconciliation (phase/12), not for rule firing. */
  excludedMeds: ContextMedication[]

  threshold: ContextThreshold | null
  assignment: ContextAssignment | null

  /** Count of the patient's lifetime JournalEntry rows as of resolution time. */
  readingCount: number
  /** True when readingCount < 7 — engine forces STANDARD mode. */
  preDay3Mode: boolean
  /** True when threshold exists AND readingCount ≥ 7. */
  personalizedEligible: boolean

  /** Pregnancy thresholds apply even if profile is UNVERIFIED (safety-net). */
  pregnancyThresholdsActive: boolean
  /** ACE/ARB contraindication fires on unverified meds too. */
  triggerPregnancyContraindicationCheck: boolean

  /** Resolved at this instant (UTC). */
  resolvedAt: Date
}

export class ProfileNotFoundException extends Error {
  constructor(userId: string) {
    super(`No PatientProfile for user ${userId} — engine cannot evaluate.`)
    this.name = 'ProfileNotFoundException'
  }
}
