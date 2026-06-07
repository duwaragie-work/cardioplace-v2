import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import type {
  MedicationHoldReasonInput,
  VerifyMedicationPayload,
} from '@cardioplace/shared'

const STATUSES = ['VERIFIED', 'REJECTED', 'AWAITING_PROVIDER', 'HOLD'] as const

const HOLD_REASONS = [
  'AWAITING_RECORDS',
  'UNCLEAR_NAME',
  'UNCLEAR_DOSE',
  'PROVIDER_DIRECTED_HOLD',
  'OTHER',
] as const satisfies readonly MedicationHoldReasonInput[]

export class VerifyMedicationDto implements VerifyMedicationPayload {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number]

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  rationale?: string

  // Required when status === 'HOLD' (enforced in the service so the message can
  // explain). Drives the two-path patient message.
  @IsOptional()
  @IsIn(HOLD_REASONS)
  holdReason?: MedicationHoldReasonInput
}
