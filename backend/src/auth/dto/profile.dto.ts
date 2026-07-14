import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator'

export const COMMUNICATION_PREFERENCE_VALUES = ['TEXT_FIRST', 'AUDIO_FIRST'] as const

function IsDateInPast(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isDateInPast',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a valid ISO date (YYYY-MM-DD) in the past`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          const d = new Date(value)
          return !isNaN(d.getTime()) && d < new Date()
        },
      },
    })
  }
}

export class ProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be in YYYY-MM-DD format',
  })
  @IsDateInPast()
  dateOfBirth?: string | null

  @IsOptional()
  @IsString()
  preferredLanguage?: string

  @IsOptional()
  @IsIn(COMMUNICATION_PREFERENCE_VALUES)
  communicationPreference?: (typeof COMMUNICATION_PREFERENCE_VALUES)[number]

  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_]+\/[A-Za-z_]/, {
    message:
      'timezone must be a valid IANA identifier (e.g. "America/New_York")',
  })
  timezone?: string

  // N8 (2026-07-13) — Reminder & Engagement preferences. All three are
  // patient-local "HH:mm" 24-hour strings validated to a 30-min-slot regex
  // (matches the UI's <select> options). Empty string is rejected to catch a
  // frontend clearing bug; use the absence of the field to mean "no change".
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, {
    message: 'reminderTime must be a 30-min HH:mm slot (e.g. "09:00" or "09:30")',
  })
  reminderTime?: string

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, {
    message: 'quietHoursStart must be a 30-min HH:mm slot (e.g. "22:00")',
  })
  quietHoursStart?: string

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):(00|30)$/, {
    message: 'quietHoursEnd must be a 30-min HH:mm slot (e.g. "07:00")',
  })
  quietHoursEnd?: string
}
