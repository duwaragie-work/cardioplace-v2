import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type { VerifyMedicationPayload } from '@cardioplace/shared'

const STATUSES = ['VERIFIED', 'REJECTED', 'AWAITING_PROVIDER'] as const

export class VerifyMedicationDto implements VerifyMedicationPayload {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number]

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string
}
