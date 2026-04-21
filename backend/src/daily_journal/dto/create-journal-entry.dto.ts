import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  registerDecorator,
  ValidationOptions,
} from 'class-validator'

function IsMeasuredAtReasonable(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isMeasuredAtReasonable',
      target: (object as { constructor: new (...args: unknown[]) => unknown })
        .constructor,
      propertyName,
      options: {
        message: `${propertyName} must be within the last 30 days and no more than 5 minutes in the future`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false
          const d = new Date(value)
          if (isNaN(d.getTime())) return false
          const now = Date.now()
          const maxFuture = now + 5 * 60 * 1000
          const maxPast = now - 30 * 24 * 60 * 60 * 1000
          return d.getTime() <= maxFuture && d.getTime() >= maxPast
        },
      },
    })
  }
}

export class CreateJournalEntryDto {
  @IsNotEmpty({ message: 'measuredAt is required' })
  @IsISO8601({}, { message: 'measuredAt must be a valid ISO 8601 UTC timestamp' })
  @IsMeasuredAtReasonable()
  measuredAt!: string

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(250)
  systolicBP?: number

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(150)
  diastolicBP?: number

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(220)
  pulse?: number

  @IsOptional()
  @IsNumber()
  @Min(20)
  @Max(300)
  weight?: number

  @IsOptional()
  @IsIn(['SITTING', 'STANDING', 'LYING'])
  position?: 'SITTING' | 'STANDING' | 'LYING'

  @IsOptional()
  @IsUUID()
  sessionId?: string

  @IsOptional()
  @IsObject({ message: 'measurementConditions must be a JSON object' })
  measurementConditions?: Record<string, unknown>

  @IsOptional()
  @IsBoolean()
  medicationTaken?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  missedDoses?: number

  // TODO(phase/15): replace this freeform field with the structured Level-2
  // symptom booleans (severeHeadache, visualChanges, etc.) once Dev 1 lands
  // the card-based intake UI. For now, incoming symptom[] values are stored
  // on JournalEntry.otherSymptoms to keep v1 clients compiling.
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  symptoms?: string[]

  @IsOptional()
  @IsString()
  teachBackAnswer?: string

  @IsOptional()
  @IsBoolean()
  teachBackCorrect?: boolean

  @IsOptional()
  @IsString()
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
