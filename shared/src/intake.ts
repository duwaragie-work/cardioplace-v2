// Request contracts for patient-intake + admin-verification endpoints.
// Enum values mirror the Prisma schema (patient_profile.prisma,
// patient_medication.prisma, profile_verification_log.prisma) as string-literal
// unions so the shared package stays framework-free.

export type GenderInput = 'MALE' | 'FEMALE' | 'OTHER'

export type HeartFailureTypeInput =
  | 'HFREF'
  | 'HFPEF'
  | 'UNKNOWN'
  | 'NOT_APPLICABLE'

export type DrugClassInput =
  | 'ACE_INHIBITOR'
  | 'ARB'
  | 'BETA_BLOCKER'
  | 'DHP_CCB'
  | 'NDHP_CCB'
  | 'LOOP_DIURETIC'
  | 'THIAZIDE'
  | 'MRA'
  | 'SGLT2'
  | 'ANTICOAGULANT'
  | 'STATIN'
  | 'ANTIARRHYTHMIC'
  | 'VASODILATOR_NITRATE'
  | 'ARNI'
  | 'OTHER_UNVERIFIED'

export type MedicationFrequencyInput =
  | 'ONCE_DAILY'
  | 'TWICE_DAILY'
  | 'THREE_TIMES_DAILY'
  | 'UNSURE'

export type MedicationSourceInput =
  | 'PATIENT_SELF_REPORT'
  | 'PROVIDER_ENTERED'
  | 'PATIENT_VOICE'
  | 'PATIENT_PHOTO'

export type MedicationVerificationStatusInput =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'AWAITING_PROVIDER'

export type ProfileVerificationStatusInput =
  | 'UNVERIFIED'
  | 'VERIFIED'
  | 'CORRECTED'

// ── POST /intake/profile ───────────────────────────────────────────────────

export interface IntakeProfilePayload {
  gender?: GenderInput
  heightCm?: number

  isPregnant?: boolean
  pregnancyDueDate?: string | null
  historyPreeclampsia?: boolean

  hasHeartFailure?: boolean
  heartFailureType?: HeartFailureTypeInput
  hasAFib?: boolean
  hasCAD?: boolean
  hasHCM?: boolean
  hasDCM?: boolean
  hasTachycardia?: boolean
  hasBradycardia?: boolean
  diagnosedHypertension?: boolean
}

// ── POST /intake/medications ───────────────────────────────────────────────

export interface IntakeMedicationItem {
  drugName: string
  drugClass: DrugClassInput
  frequency: MedicationFrequencyInput
  isCombination?: boolean
  combinationComponents?: DrugClassInput[]
  source?: MedicationSourceInput
  rawInputText?: string
  notes?: string
}

export interface IntakeMedicationsPayload {
  medications: IntakeMedicationItem[]
}

// ── PATCH /me/medications/:id ──────────────────────────────────────────────

export interface UpdateMedicationPayload {
  drugName?: string
  drugClass?: DrugClassInput
  frequency?: MedicationFrequencyInput
  isCombination?: boolean
  combinationComponents?: DrugClassInput[]
  rawInputText?: string
  notes?: string
  // `true` soft-deletes by setting discontinuedAt = now()
  discontinue?: boolean
}

// ── POST /me/pregnancy ─────────────────────────────────────────────────────

export interface PregnancyPayload {
  isPregnant: boolean
  pregnancyDueDate?: string | null
  historyPreeclampsia?: boolean
}

// ── POST /admin/users/:id/verify-profile ───────────────────────────────────

export interface VerifyProfilePayload {
  rationale?: string
}

// ── POST /admin/users/:id/correct-profile ──────────────────────────────────

export interface CorrectProfilePayload {
  corrections: IntakeProfilePayload
  rationale: string
}

// ── POST /admin/medications/:id/verify ─────────────────────────────────────

export interface VerifyMedicationPayload {
  status: Extract<
    MedicationVerificationStatusInput,
    'VERIFIED' | 'REJECTED' | 'AWAITING_PROVIDER'
  >
  rationale?: string
}
