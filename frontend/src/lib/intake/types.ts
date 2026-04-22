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
  | 'A10'
  | 'A11';

export interface SelectedMedication {
  /** Stable key for catalog meds; undefined for free-text "other". */
  catalogId?: string;
  drugName: string;
  drugClass: DrugClassInput;
  isCombination: boolean;
  /** Drug classes a combo registers as (Entresto → ARNI+ARB). */
  combinationComponents?: DrugClassInput[];
  source: MedicationSourceInput;
  /** Voice transcript or photo OCR placeholder for "other". */
  rawInputText?: string;
  frequency?: MedicationFrequencyInput;
}

export interface IntakeFormState {
  // A1 demographics
  gender?: GenderInput;
  heightCm?: number;

  // A2 pregnancy (only relevant if gender === FEMALE)
  isPregnant?: boolean;
  pregnancyDueDate?: string; // YYYY-MM-DD
  historyPreeclampsia?: boolean;

  // A3 cardiac conditions
  hasHeartFailure?: boolean;
  hasAFib?: boolean;
  hasCAD?: boolean;
  hasHCM?: boolean;
  hasDCM?: boolean;
  diagnosedHypertension?: boolean;

  // A4 HF subtype (only relevant if hasHeartFailure)
  heartFailureType?: HeartFailureTypeInput;

  // A5/A6/A8 medications
  selectedMedications: SelectedMedication[];

  // A8 "other" capture in progress before frequency assigned
  otherDraft?: { text?: string; photoNote?: string };

  // wizard meta
  currentStep?: IntakeStepKey;
  hasSubmitted?: boolean;
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
] as const;

export type CardiacConditionKey = (typeof CARDIAC_CONDITION_KEYS)[number];
