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

  // L-3 — `contactPhone` was removed. The locked-out form no longer collects a
  // callback number (the phone-callback implication was dropped in Fix 6/7).
  // With the global ValidationPipe whitelist (V-14), a client that still sends
  // contactPhone is rejected rather than silently stored.
}

/** POST /v2/admin/support/tickets/:id/reply — ops replying to the user. */
export class ReplyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  body!: string
}

/** POST /v2/admin/support/tickets/:id/verify-identity — ops attesting they
 *  verified the requester's identity, with a free-text rationale describing how
 *  (e.g. "matched security questions in reply email; confirmed DOB + last
 *  visit"). No prescribed method — we have no phone-verification infrastructure
 *  yet, so ops records whatever they actually did (Fix 7). */
export class VerifyIdentityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  rationale!: string
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
