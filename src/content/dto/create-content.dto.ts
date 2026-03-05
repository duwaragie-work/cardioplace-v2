import {
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator'
import { ContentType } from '../../generated/prisma/enums.js'

export class CreateContentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string

  @IsEnum(ContentType)
  contentType: ContentType

  @IsString()
  @MinLength(10)
  body: string // Markdown

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  summary: string

  /** Display-only author name. If omitted, frontend falls back to submittedBy.name */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  author?: string

  /** Controlled vocabulary tags */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[]

  /** S3 media URL — leave empty for now; populated later when S3 is integrated */
  @IsOptional()
  @IsUrl()
  mediaUrl?: string
}
