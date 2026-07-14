import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator'
import {
  SupportCategory,
  SupportPriority,
  SupportStatus,
} from '../../generated/prisma/enums.js'

/** Query params for GET /v2/admin/support/tickets (ops queue). All optional. */
export class ListTicketsQuery {
  @IsOptional()
  @IsEnum(SupportStatus)
  status?: SupportStatus

  @IsOptional()
  @IsEnum(SupportCategory)
  category?: SupportCategory

  @IsOptional()
  @IsEnum(SupportPriority)
  priority?: SupportPriority

  /** Free-text — matches ticketNumber / email / subject (+ displayId). */
  @IsOptional()
  @IsString()
  search?: string

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number
}
