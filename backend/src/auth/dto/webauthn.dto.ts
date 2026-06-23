import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator'
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

/** POST /v2/auth/webauthn/register/start — begin enrollment.
 *  `mode` chooses the authenticator: 'platform' = this device's Face ID /
 *  fingerprint (default); 'cross-platform' = another device via the QR flow. */
export class WebAuthnRegisterStartDto {
  @IsOptional()
  @IsIn(['platform', 'cross-platform'])
  mode?: 'platform' | 'cross-platform'
}

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

/** PATCH /v2/auth/webauthn/credentials/:id — rename a registered device. */
export class WebAuthnRenameDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  deviceName: string
}

/** POST /v2/auth/webauthn/authenticate/recovery — recovery-code sign-in (the
 *  only fallback when biometric can't be used on this device). */
export class WebAuthnRecoverySignInDto {
  @IsString()
  challengeToken: string

  @IsString()
  @MinLength(8)
  recoveryCode: string
}

/** POST /v2/auth/admin/webauthn/reset/:userId — required, audited reason. */
export class AdminResetPatientBiometricDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason: string
}
