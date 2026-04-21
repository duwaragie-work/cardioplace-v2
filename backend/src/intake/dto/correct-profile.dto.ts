import { Type } from 'class-transformer'
import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'
import type { CorrectProfilePayload, VerifyProfilePayload } from '@cardioplace/shared'
import { IntakeProfileDto } from './intake-profile.dto.js'

export class VerifyProfileDto implements VerifyProfilePayload {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string
}

export class CorrectProfileDto implements CorrectProfilePayload {
  @ValidateNested()
  @Type(() => IntakeProfileDto)
  corrections!: IntakeProfileDto

  // Mandatory for admin corrections — Joint Commission NPSG.03.06.01 audit trail.
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  rationale!: string
}
