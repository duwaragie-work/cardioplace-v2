import {
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator'

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export class UpdatePracticeDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string

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
