import { IsString } from 'class-validator'

/**
 * Phase/practice-identity — exchange a practice-select challenge token
 * (from /otp/verify or /magic-link/verify) for a real token pair, with the
 * chosen practice persisted on the new AuthSession.
 */
export class SelectPracticeDto {
  @IsString()
  challengeToken: string

  @IsString()
  practiceId: string
}

/**
 * Phase/practice-identity — mid-session practice switch for users who are
 * members of multiple practices. Requires a valid access token (the
 * controller decorator enforces JwtAuthGuard).
 */
export class SwitchPracticeDto {
  @IsString()
  practiceId: string
}
