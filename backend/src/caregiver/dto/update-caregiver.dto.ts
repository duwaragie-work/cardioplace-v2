import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import type {
  CaregiverNotifyChannelInput,
  UpdateCaregiverPayload,
} from '@cardioplace/shared'

const CHANNELS = [
  'NONE',
  'DASHBOARD',
  'SMS',
  'EMAIL',
] as const satisfies readonly CaregiverNotifyChannelInput[]

export class UpdateCaregiverDto implements UpdateCaregiverPayload {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  relationship?: string | null

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string | null

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string | null

  @IsOptional()
  @IsIn(CHANNELS)
  notifyChannel?: CaregiverNotifyChannelInput

  @IsOptional()
  @IsBoolean()
  consentGiven?: boolean

  @IsOptional()
  @IsBoolean()
  active?: boolean
}
