// Client-side form state for the multi-step Clinical Intake wizard (Flow A).
// Submitted to backend as IntakeProfilePayload + IntakeMedicationsPayload at A10.

import type {
  DrugClassInput,
  GenderInput,
  HeartFailureTypeInput,
  MedicationFrequencyInput,
  MedicationSourceInput,
} from '@cardioplace/shared';

export type IntakeStepKey =
  | 'A0b'
  | 'A1'
  | 'A2'
  | 'A3'
  | 'A4'
  | 'A5'
  | 'A6'
  | 'A8'
  | 'A9'
  // Gap 5 — optional caregiver capture + consent, just before review.
  | 'ACG'
  | 'A10'
  | 'A11';

export interface SelectedMedication {
  /** Stable key for catalog meds; undefined for free-text "other". */
  catalogId?: string;
  /** Server-side `PatientMedication.id` when loaded from a prior session;
   *  undefined for in-session adds that haven't been persisted yet. Used by
   *  OtherMedicationsList to key tiles + scope edit/delete to a single row. */
  serverId?: string;
  drugName: string;
  drugClass: DrugClassInput;
  isCombination: boolean;
  /** Drug classes a combo registers as (Entresto → ARNI+ARB). */
  combinationComponents?: DrugClassInput[];
  source: MedicationSourceInput;
  /** Voice transcript or photo OCR placeholder for "other". */
  rawInputText?: string;
  frequency?: MedicationFrequencyInput;
  /** Drug-enrichment service output, persisted on PatientMedication and
   *  carried into SelectedMedication on reload so OtherMedicationsList can
   *  render the pill image + plain-language line for previously-saved
   *  freeform meds. Undefined for in-session adds (background enrichment
   *  fires only after wizard submit). */
  pillImageUrl?: string | null;
  plainLanguageDescription?: string | null;
}

export interface IntakeFormState {
  // A1 demographics
  gender?: GenderInput;
  heightCm?: number;
  /** UI-only: which unit mode the patient is entering height in. Storage
   *  is always cm — this just toggles the input(s) shown. */
  heightUnit?: 'ftin' | 'cm';
  /** Date of birth in YYYY-MM-DD. Stored on User.dateOfBirth via the same
   *  intake.profile submit. Captured at A1 because age is a clinical input
   *  the rule engine needs whenever an alert fires. */
  dateOfBirth?: string;

  // A2 pregnancy (only relevant if gender === FEMALE)
  isPregnant?: boolean;
  pregnancyDueDate?: string; // YYYY-MM-DD
  historyHDP?: boolean;

  // A3 cardiac conditions
  hasHeartFailure?: boolean;
  hasAFib?: boolean;
  hasCAD?: boolean;
  hasHCM?: boolean;
  hasDCM?: boolean;
  // Manisha 5/24 Q5C — aortic stenosis (interim HCM-style thresholds).
  hasAorticStenosis?: boolean;
  diagnosedHypertension?: boolean;
  /** True only when the patient explicitly clicked "None of the above" on
   *  step A3. Lets the UI distinguish "no conditions answered yet" from
   *  "patient confirmed they have none" — avoids pre-selecting "None"
   *  when the user hasn't touched the step. */
  noneOfTheAboveAck?: boolean;

  // A4 HF subtype (only relevant if hasHeartFailure)
  heartFailureType?: HeartFailureTypeInput;

  // A5/A6/A8 medications
  selectedMedications: SelectedMedication[];

  // A8 "other" capture in progress before frequency assigned
  otherDraft?: { text?: string; photoNote?: string };

  // wizard meta
  currentStep?: IntakeStepKey;
  hasSubmitted?: boolean;

  /** F13 — hydrated from PatientProfile.aceContraindicatedAt. When true, adding
   *  an ACE inhibitor / ARB is gated behind a contraindication warning and the
   *  backend holds the med for provider review. UI-only; never submitted. */
  aceContraindicated?: boolean;
}

export const EMPTY_INTAKE_STATE: IntakeFormState = {
  selectedMedications: [],
};

/** Cardiac condition keys used by A3 + A4 + A10 review. */
export const CARDIAC_CONDITION_KEYS = [
  'hasHeartFailure',
  'hasAFib',
  'hasCAD',
  'hasHCM',
  'hasDCM',
  'hasAorticStenosis',
] as const;

export type CardiacConditionKey = (typeof CARDIAC_CONDITION_KEYS)[number];
