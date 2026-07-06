import { Type } from 'class-transformer'
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator'

/**
 * Query params for GET /v2/admin/audit/auth-log (ops audit-review console,
 * HIPAA §164.312(b) L2). All optional.
 */
export class ListAuthLogQuery {
  /** Auth event name, e.g. 'login', 'policy_acknowledged', 'training_acknowledged'. */
  @IsOptional()
  @IsString()
  event?: string

  /** The subject user's id (null on pre-auth events — use `identifier` then). */
  @IsOptional()
  @IsString()
  userId?: string

  /** Login identifier (email / phone) for events with no resolved userId. */
  @IsOptional()
  @IsString()
  identifier?: string

  /** Outcome filter — 'true' (success) or 'false' (failure). */
  @IsOptional()
  @IsIn(['true', 'false'])
  success?: string

  /** Practice attribution on the actor's session at event time. */
  @IsOptional()
  @IsString()
  practiceContext?: string

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
