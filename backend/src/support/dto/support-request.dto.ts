import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator'
import {
  SupportCategory,
  SupportContactPref,
} from '../../generated/prisma/enums.js'

/** POST /v2/support/contact — a signed-in user raising a support ticket. */
export class ContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  subject!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string

  @IsEnum(SupportCategory)
  category!: SupportCategory

  @IsOptional()
  @IsEnum(SupportContactPref)
  contactPreference?: SupportContactPref

  /** Optional link back to an alert the user is asking about. */
  @IsOptional()
  @IsString()
  alertId?: string
}

/** POST /v2/support/locked-out — public, from a user who cannot sign in. */
export class LockedOutDto {
  @IsEmail()
  email!: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description!: string

  @IsOptional()
  @IsString()
  @MaxLength(40)
  contactPhone?: string
}

/** POST /v2/admin/support/tickets/:id/reply — ops replying to the user. */
export class ReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string
}

/** POST /v2/admin/support/tickets/:id/verify-identity — ops attesting they
 *  verified the requester's identity (phone callback + security questions). */
export class VerifyIdentityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  method!: string

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string
}

/** POST /v2/admin/support/tickets/:id/actions/* — the privileged reset actions
 *  wrap the existing admin reset endpoints and require a reason for the audit. */
export class ActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string
}

/** POST /v2/admin/support/tickets/:id/resolve — close the ticket. */
export class ResolveDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolutionNotes?: string
}
