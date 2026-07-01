import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /admin/users/:id/reactivate`. `restoreRoles` defaults to
 * false — reactivation is a fresh re-authorization (HIPAA N12), so prior
 * staff roles are handed back ONLY when the admin explicitly opts in.
 */
export class ReactivateDto {
  @IsOptional()
  @IsBoolean()
  restoreRoles?: boolean

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
