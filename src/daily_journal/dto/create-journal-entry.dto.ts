import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateIf,
  ValidationOptions,
} from 'class-validator'

function IsDateNotInFuture(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isDateNotInFuture',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      options: {
        message: `${propertyName} must not be a future date`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          const d = new Date(value)
          if (isNaN(d.getTime())) return false
          const today = new Date()
          today.setHours(23, 59, 59, 999)
          return d <= today
        },
      },
    })
  }
}

const VALID_MOODS = [
  'calm',
  'anxious',
  'depressed',
  'irritable',
  'energized',
  'neutral',
] as const

export class CreateJournalEntryDto {
  @IsNotEmpty({ message: 'entryDate is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'entryDate must be in YYYY-MM-DD format',
  })
  @IsDateNotInFuture()
  entryDate!: string

  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: 'sleepHours must be a number with at most 2 decimal places' },
  )
  @Min(0, { message: 'sleepHours must be at least 0' })
  @Max(24, { message: 'sleepHours must be at most 24' })
  sleepHours?: number

  @IsOptional()
  @IsInt({ message: 'sleepQuality must be an integer' })
  @Min(1, { message: 'sleepQuality must be at least 1' })
  @Max(10, { message: 'sleepQuality must be at most 10' })
  sleepQuality?: number

  @IsOptional()
  @IsInt({ message: 'awakenings must be an integer' })
  @Min(0, { message: 'awakenings must be at least 0' })
  awakenings?: number

  @IsOptional()
  @IsString({ message: 'bedtime must be a string' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'bedtime must be in HH:MM format (24-hour)',
  })
  bedtime?: string

  @IsOptional()
  @IsString({ message: 'wakeTime must be a string' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'wakeTime must be in HH:MM format (24-hour)',
  })
  wakeTime?: string

  @IsOptional()
  @IsObject({ message: 'symptoms must be a JSON object' })
  symptoms?: Record<string, unknown>

  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString({ message: 'mood must be a string' })
  @IsIn(VALID_MOODS, {
    message: `mood must be one of: ${VALID_MOODS.join(', ')}`,
  })
  mood?: (typeof VALID_MOODS)[number] | null

  @IsOptional()
  @IsString({ message: 'notes must be a string' })
  @MaxLength(500, { message: 'notes must be at most 500 characters' })
  notes?: string

  @IsOptional()
  @IsString({ message: 'source must be a string' })
  @IsIn(['manual', 'healthkit'], {
    message: 'source must be one of: manual, healthkit',
  })
  source?: 'manual' | 'healthkit'

  @IsOptional()
  @IsObject({ message: 'sourceMetadata must be a JSON object' })
  sourceMetadata?: Record<string, unknown>
}
