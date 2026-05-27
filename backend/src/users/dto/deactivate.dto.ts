import { IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /admin/users/:id/deactivate`. `reason` is free-text and
 * lands in the AuthLog metadata for audit. Reactivation has no body.
 */
export class DeactivateDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
