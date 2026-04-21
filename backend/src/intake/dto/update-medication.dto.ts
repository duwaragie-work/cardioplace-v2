import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import type {
  DrugClassInput,
  MedicationFrequencyInput,
  UpdateMedicationPayload,
} from '@cardioplace/shared'

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
  'OTHER_UNVERIFIED',
] as const satisfies readonly DrugClassInput[]

const FREQUENCIES = [
  'ONCE_DAILY',
  'TWICE_DAILY',
  'THREE_TIMES_DAILY',
  'UNSURE',
] as const satisfies readonly MedicationFrequencyInput[]

export class UpdateMedicationDto implements UpdateMedicationPayload {
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
  @IsBoolean()
  isCombination?: boolean

  @IsOptional()
  @IsArray()
  @IsIn(DRUG_CLASSES, { each: true })
  combinationComponents?: DrugClassInput[]

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rawInputText?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string

  @IsOptional()
  @IsBoolean()
  discontinue?: boolean
}
