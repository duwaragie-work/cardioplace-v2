import {
  IsArray,
  IsBoolean,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  registerDecorator,
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

export class CreateJournalEntryDto {
  @IsNotEmpty({ message: 'entryDate is required' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'entryDate must be in YYYY-MM-DD format',
  })
  @IsDateNotInFuture()
  entryDate!: string

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
  @IsNumber()
  @Min(20)
  @Max(300)
  weight?: number

  @IsOptional()
  @IsBoolean()
  medicationTaken?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  missedDoses?: number

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
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'measurementTime must be in HH:mm format (e.g., 08:30, 14:15)',
  })
  measurementTime?: string

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
