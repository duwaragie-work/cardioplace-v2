import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator'

// ─── Cardio enum values (mirrors Prisma enums) ──────────────────────────────

export const RISK_TIER_VALUES = ['STANDARD', 'ELEVATED', 'HIGH'] as const
export const COMMUNICATION_PREFERENCE_VALUES = ['TEXT_FIRST', 'AUDIO_FIRST'] as const

// ─── Custom validator: ISO date string that lies in the past ──────────────────

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

// ─── DTO ──────────────────────────────────────────────────────────────────────

export class ProfileDto {
  /** Display name — optional, max 100 chars. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string

  /**
   * Date of birth as YYYY-MM-DD. Must be a past date.
   * Left as null when not provided — no approximation is made.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateOfBirth must be in YYYY-MM-DD format',
  })
  @IsDateInPast()
  dateOfBirth?: string | null

  /** Primary cardiovascular condition (e.g. "hypertension"). */
  @IsOptional()
  @IsString()
  primaryCondition?: string

  /** Preferred language code (e.g. "en", "es"). */
  @IsOptional()
  @IsString()
  preferredLanguage?: string

  /** Risk tier for escalation thresholds. */
  @IsOptional()
  @IsIn(RISK_TIER_VALUES)
  riskTier?: (typeof RISK_TIER_VALUES)[number]

  /** Communication preference: text-first or audio-first. */
  @IsOptional()
  @IsIn(COMMUNICATION_PREFERENCE_VALUES)
  communicationPreference?: (typeof COMMUNICATION_PREFERENCE_VALUES)[number]

  /**
   * IANA timezone identifier (e.g. "Asia/Colombo", "America/New_York").
   * Auto-detected by the client and sent on first onboarding / after travel.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z_]+\/[A-Za-z_]/, {
    message:
      'timezone must be a valid IANA identifier (e.g. "America/New_York")',
  })
  timezone?: string
}
