import {
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator'

// HH:MM (00:00 — 23:59)
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export class CreatePracticeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string

  @IsOptional()
  @Matches(TIME_RE, { message: 'businessHoursStart must be HH:MM (24h)' })
  businessHoursStart?: string

  @IsOptional()
  @Matches(TIME_RE, { message: 'businessHoursEnd must be HH:MM (24h)' })
  businessHoursEnd?: string

  @IsOptional()
  @IsString()
  @MaxLength(100)
  businessHoursTimezone?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  afterHoursProtocol?: string
}
