import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  registerDecorator,
  ValidationOptions,
} from 'class-validator'

// ─── MenopauseStage values (mirrors the Prisma enum) ─────────────────────────

export const MENOPAUSE_STAGE_VALUES = [
  'PERIMENOPAUSE',
  'MENOPAUSE',
  'POSTMENOPAUSE',
  'UNKNOWN',
] as const

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

  /** Menopause stage. Defaults to UNKNOWN in the DB if not submitted. */
  @IsOptional()
  @IsIn(MENOPAUSE_STAGE_VALUES)
  menopauseStage?: (typeof MENOPAUSE_STAGE_VALUES)[number]

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
