import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import { UserRole } from '../../generated/prisma/enums.js'

/**
 * Body for `POST /admin/users/:id/reactivate`.
 *
 * HIPAA §164.308(a)(4) — reactivation is a DELIBERATE, authorized re-grant, not
 * an automatic restore. The admin must explicitly send the role(s) to grant;
 * there is no server-side default. The chosen roles are checked against the SAME
 * grant-authority matrix as invite (`assertCanGrantRole`), so reactivation can
 * never become a privilege-escalation path. The UI prefills `roles` with the
 * prior role from `terminationSnapshot`, but the admin can change it.
 */
export class ReactivateDto {
  // The role(s) to grant on reactivation — the deliberate re-auth decision.
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(UserRole, { each: true })
  roles!: UserRole[]

  // Required when ANY chosen role is practice-bound (PROVIDER / MEDICAL_DIRECTOR
  // / COORDINATOR). Ignored for PATIENT-only reactivation.
  @IsOptional()
  @IsString()
  practiceId?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}
