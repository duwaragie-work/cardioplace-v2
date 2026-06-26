import { IsString, Length, MaxLength, MinLength } from 'class-validator'

/** POST /v2/auth/mfa/enroll/complete — finish TOTP enrollment. */
export class EnrollCompleteDto {
  /** Stateless enrollment token returned by enroll/start (carries the pending
   *  secret, signed by the server). */
  @IsString()
  enrollmentToken: string

  /** First 6-digit code from the authenticator app. */
  @IsString()
  @Length(6, 6)
  code: string
}

/** POST /v2/auth/mfa/challenge — second-factor code at sign-in. */
export class MfaChallengeDto {
  @IsString()
  challengeToken: string

  @IsString()
  @Length(6, 6)
  code: string
}

/** POST /v2/auth/mfa/recovery — sign in with a one-time recovery code. */
export class MfaRecoveryDto {
  @IsString()
  challengeToken: string

  @IsString()
  @MinLength(8)
  recoveryCode: string
}

/** POST /v2/auth/admin/mfa/reset/:userId — required, audited reason. */
export class AdminResetMfaDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string
}
