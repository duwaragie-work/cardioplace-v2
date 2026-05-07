import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator'
import type { IntakeProfilePayload } from '@cardioplace/shared'

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const
const HF_TYPES = ['HFREF', 'HFPEF', 'UNKNOWN', 'NOT_APPLICABLE'] as const

export class IntakeProfileDto implements IntakeProfilePayload {
  @IsOptional()
  @IsIn(GENDERS)
  gender?: (typeof GENDERS)[number]

  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(250)
  heightCm?: number

  // Date of birth (YYYY-MM-DD). Stored on User, not PatientProfile, but
  // collected here so the rule engine has age available before the patient
  // can submit any check-in. `null` clears it.
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({}, { message: 'dateOfBirth must be ISO 8601 (YYYY-MM-DD)' })
  dateOfBirth?: string | null

  @IsOptional()
  @IsBoolean()
  isPregnant?: boolean

  // `null` is allowed so a patient can clear a previous due date when
  // reporting they are no longer pregnant.
  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({}, { message: 'pregnancyDueDate must be ISO 8601' })
  pregnancyDueDate?: string | null

  @IsOptional()
  @IsBoolean()
  historyPreeclampsia?: boolean

  @IsOptional()
  @IsBoolean()
  hasHeartFailure?: boolean

  @IsOptional()
  @IsIn(HF_TYPES)
  heartFailureType?: (typeof HF_TYPES)[number]

  @IsOptional()
  @IsBoolean()
  hasAFib?: boolean

  @IsOptional()
  @IsBoolean()
  hasCAD?: boolean

  @IsOptional()
  @IsBoolean()
  hasHCM?: boolean

  @IsOptional()
  @IsBoolean()
  hasDCM?: boolean

  @IsOptional()
  @IsBoolean()
  hasTachycardia?: boolean

  @IsOptional()
  @IsBoolean()
  hasBradycardia?: boolean

  @IsOptional()
  @IsBoolean()
  diagnosedHypertension?: boolean
}
