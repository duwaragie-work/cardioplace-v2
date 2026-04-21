import {
  IsBoolean,
  IsISO8601,
  IsOptional,
  ValidateIf,
} from 'class-validator'
import type { PregnancyPayload } from '@cardioplace/shared'

export class PregnancyDto implements PregnancyPayload {
  @IsBoolean()
  isPregnant!: boolean

  @ValidateIf((_, v) => v !== null)
  @IsOptional()
  @IsISO8601({}, { message: 'pregnancyDueDate must be ISO 8601' })
  pregnancyDueDate?: string | null

  @IsOptional()
  @IsBoolean()
  historyPreeclampsia?: boolean
}
