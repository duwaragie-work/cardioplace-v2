import { IsObject, IsOptional, IsString, MaxLength } from 'class-validator'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

/** POST /v2/auth/webauthn/register/verify — finish biometric enrollment. */
export class WebAuthnRegisterVerifyDto {
  /** Stateless token from register/start carrying the signed challenge. */
  @IsString()
  registrationToken: string

  /** The navigator.credentials.create() result (attestation). */
  @IsObject()
  response: RegistrationResponseJSON

  /** Optional user-facing device label ("iPhone 15"). */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  deviceName?: string
}

/** POST /v2/auth/webauthn/authenticate/options — fetch assertion options for a
 *  pending biometric second factor (the patient holds only the challenge
 *  token at this point). */
export class WebAuthnAuthOptionsDto {
  @IsString()
  challengeToken: string
}

/** POST /v2/auth/webauthn/authenticate/verify — complete the second factor. */
export class WebAuthnAuthVerifyDto {
  @IsString()
  challengeToken: string

  /** The navigator.credentials.get() result (assertion). */
  @IsObject()
  response: AuthenticationResponseJSON
}

/** POST /v2/auth/webauthn/authenticate/recover — graceful lost-device path.
 *  The challenge token proves a fresh first-factor (OTP/magic-link) pass, so
 *  we remove the patient's biometric credentials and sign them in. */
export class WebAuthnRecoverDto {
  @IsString()
  challengeToken: string
}
