import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /admin/users/:id/reactivate`. `restoreRoles` defaults to
 * true — admin deactivate is a reversible pause, so reactivate hands the
 * pre-deactivation (staff) roles back. Pass restoreRoles:false to force a
 * fresh re-authorization that strips staff roles to PATIENT-only (HIPAA N12).
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
