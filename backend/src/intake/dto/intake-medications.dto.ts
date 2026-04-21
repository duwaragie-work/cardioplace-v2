import { Type } from 'class-transformer'
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import type {
  DrugClassInput,
  IntakeMedicationItem,
  IntakeMedicationsPayload,
  MedicationFrequencyInput,
  MedicationSourceInput,
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

const SOURCES = [
  'PATIENT_SELF_REPORT',
  'PROVIDER_ENTERED',
  'PATIENT_VOICE',
  'PATIENT_PHOTO',
] as const satisfies readonly MedicationSourceInput[]

export class IntakeMedicationItemDto implements IntakeMedicationItem {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  drugName!: string

  @IsIn(DRUG_CLASSES)
  drugClass!: DrugClassInput

  @IsIn(FREQUENCIES)
  frequency!: MedicationFrequencyInput

  @IsOptional()
  @IsBoolean()
  isCombination?: boolean

  @IsOptional()
  @IsArray()
  @IsIn(DRUG_CLASSES, { each: true })
  combinationComponents?: DrugClassInput[]

  @IsOptional()
  @IsIn(SOURCES)
  source?: MedicationSourceInput

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rawInputText?: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

export class IntakeMedicationsDto implements IntakeMedicationsPayload {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => IntakeMedicationItemDto)
  medications!: IntakeMedicationItemDto[]
}
