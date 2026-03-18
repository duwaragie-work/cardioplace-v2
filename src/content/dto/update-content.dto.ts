import { IsArray, IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator'

/** All fields optional — only allowed while content is in DRAFT status */
export class UpdateContentDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string

  @IsOptional()
  @IsString()
  @MinLength(10)
  body?: string

  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  summary?: string

  @IsOptional()
  @IsString()
  @MaxLength(150)
  author?: string

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  @IsOptional()
  @IsUrl()
  mediaUrl?: string
}
