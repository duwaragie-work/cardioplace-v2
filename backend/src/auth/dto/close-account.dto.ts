import { IsString, MaxLength } from 'class-validator'

/**
 * Body for `POST /v2/auth/account/permanent-close/confirm`. The single-use
 * token arrives by email (1-hour TTL) — the anti-impulse gate for a patient
 * permanently closing their own account.
 */
export class PermanentCloseConfirmDto {
  @IsString()
  @MaxLength(4096)
  confirmationToken!: string
}
