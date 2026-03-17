import { Transform, Type } from 'class-transformer'
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator'
import { ContentStatus, ContentType } from '../../generated/prisma/enums.js'

export class ListContentQueryDto {
  @IsOptional()
  @IsEnum(ContentType)
  type?: ContentType

  /** Filter by one or more tags — pass as repeated query params: ?tags=hot_flashes&tags=anxiety */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  tags?: string[]

  /**
   * Admin-only: filter by arbitrary status.
   * Public consumers always get status=PUBLISHED&needsReview=false (enforced in service).
   */
  @IsOptional()
  @IsEnum(ContentStatus)
  status?: ContentStatus

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20
}
