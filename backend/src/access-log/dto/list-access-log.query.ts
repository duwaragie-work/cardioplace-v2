import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator'

/**
 * Query params for GET /v2/admin/audit/access-log (ops audit-review console,
 * HIPAA §164.312(b) L2). All optional — an empty query lists the most recent
 * PHI-access rows.
 */
export class ListAccessLogQuery {
  /** The acting user's id. */
  @IsOptional()
  @IsString()
  actorId?: string

  /** 'USER' | 'SYSTEM_ACTOR'. */
  @IsOptional()
  @IsIn(['USER', 'SYSTEM_ACTOR'])
  actorType?: string

  /** 'READ' | 'WRITE' | 'DELETE'. */
  @IsOptional()
  @IsIn(['READ', 'WRITE', 'DELETE'])
  action?: string

  /** PHI model touched, e.g. 'JournalEntry', 'DeviationAlert'. */
  @IsOptional()
  @IsString()
  modelName?: string

  /** Single-record ops pin the record id (patient / reading / alert). */
  @IsOptional()
  @IsString()
  recordId?: string

  /** ISO-8601 lower bound on createdAt (inclusive). */
  @IsOptional()
  @IsISO8601()
  from?: string

  /** ISO-8601 upper bound on createdAt (inclusive). */
  @IsOptional()
  @IsISO8601()
  to?: string

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
