import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'
import type { DrugClassInput, MedicationFrequencyInput } from '@cardioplace/shared'

// #92 — admin add/edit medication. Mirrors the patient UpdateMedicationDto
// validator style. NSAID is included (the DrugClass enum supports it and an
// admin should be able to record an OTC NSAID a patient mentioned).
const DRUG_CLASSES = [
  'ACE_INHIBITOR',
  'ARB',
  'BETA_BLOCKER',
  'DHP_CCB',
  'NDHP_CCB',
  'LOOP_DIURETIC',
  'THIAZIDE',
  'MRA',
  'SGLT2',
  'ANTICOAGULANT',
  'STATIN',
  'ANTIARRHYTHMIC',
  'VASODILATOR_NITRATE',
  'ARNI',
  'NSAID',
  'OTHER_UNVERIFIED',
] as const satisfies readonly DrugClassInput[]

const FREQUENCIES = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'AS_NEEDED',
  'UNSURE',
] as const satisfies readonly MedicationFrequencyInput[]

export class AdminAddMedicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  drugName!: string

  @IsIn(DRUG_CLASSES)
  drugClass!: DrugClassInput

  @IsIn(FREQUENCIES)
  frequency!: MedicationFrequencyInput

  /** Optional free-text dose ("25 mg"); folded into notes (no dose column). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  /** Set true after the admin acknowledges the ACE/ARB-on-angioedema hold. */
  @IsOptional()
  acknowledgedContraindication?: boolean
}

export class AdminEditMedicationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  drugName?: string

  @IsOptional()
  @IsIn(DRUG_CLASSES)
  drugClass?: DrugClassInput

  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: MedicationFrequencyInput

  @IsOptional()
  @IsString()
  @MaxLength(100)
  dose?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
