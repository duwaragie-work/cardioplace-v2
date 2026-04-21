import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator'

export class UpsertThresholdDto {
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(250)
  sbpUpperTarget?: number

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(250)
  sbpLowerTarget?: number

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(150)
  dbpUpperTarget?: number

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(150)
  dbpLowerTarget?: number

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(220)
  hrUpperTarget?: number

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(220)
  hrLowerTarget?: number

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}
