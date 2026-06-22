import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { randomBytes } from 'crypto'
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticatorTransportFuture,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type Uint8Array_,
} from '@simplewebauthn/server'
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers'

/**
 * Patient biometric second factor (WebAuthn / passkeys — Face ID / fingerprint).
 * Pure ceremony logic over @simplewebauthn — no Prisma, no HTTP — so it unit-
 * tests in isolation. DB persistence, token issuance, and audit logging live in
 * AuthService (mirrors how MfaService relates to AuthService for TOTP).
 *
 * "Platform" authenticator only (authenticatorAttachment: 'platform') so the
 * browser offers the device's built-in biometric, not roaming security keys.
 * userVerification: 'required' forces the actual Face ID / fingerprint prompt.
 *
 * RP config (relying party) comes from env so it can differ per environment:
 *   WEBAUTHN_RP_ID    — registrable domain, e.g. 'localhost' (dev),
 *                       'cardioplaceai.com' (prod). NO scheme, NO port.
 *   WEBAUTHN_RP_NAME  — user-visible name shown in the prompt.
 *   WEBAUTHN_ORIGIN   — full origin(s) the ceremony must occur on, comma-
 *                       separated, e.g. 'http://localhost:3000'.
 */
@Injectable()
export class WebAuthnService {
  constructor(private readonly config: ConfigService) {}

  private get rpID(): string {
    return this.config.get<string>('WEBAUTHN_RP_ID', 'localhost')
  }

  private get rpName(): string {
    return this.config.get<string>('WEBAUTHN_RP_NAME', 'Cardioplace')
  }

  /** One or more allowed origins (the patient app). Comma-separated in env. */
  private get expectedOrigins(): string[] {
    return this.config
      .get<string>('WEBAUTHN_ORIGIN', 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }

  /** Random challenge as a base64url string. Stored inside the signed
   *  registration / authentication token; never persisted. */
  randomChallenge(): string {
    return isoBase64URL.fromBuffer(new Uint8Array(randomBytes(32)))
  }

  // ─── Registration ─────────────────────────────────────────────────────────

  /** Build the options for navigator.credentials.create(). `challenge` is the
   *  base64url value carried in the registration token; passing it as bytes
   *  makes options.challenge round-trip back to the same string for verify. */
  async buildRegistrationOptions(opts: {
    userId: string
    userName: string
    userDisplayName: string
    challenge: string
    excludeCredentials: Array<{
      id: string
      transports?: AuthenticatorTransportFuture[]
    }>
  }): Promise<PublicKeyCredentialCreationOptionsJSON> {
    return generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userName: opts.userName,
      userDisplayName: opts.userDisplayName,
      userID: isoUint8Array.fromUTF8String(opts.userId),
      challenge: isoBase64URL.toBuffer(opts.challenge),
      attestationType: 'none',
      excludeCredentials: opts.excludeCredentials,
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'preferred',
        userVerification: 'required',
      },
    })
  }

  /** Verify the create() response against the expected challenge / origin / RP. */
  async verifyRegistration(opts: {
    response: RegistrationResponseJSON
    challenge: string
  }) {
    return verifyRegistrationResponse({
      response: opts.response,
      expectedChallenge: opts.challenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
      requireUserVerification: true,
    })
  }

  // ─── Authentication ───────────────────────────────────────────────────────

  /** Build the options for navigator.credentials.get(). allowCredentials is the
   *  user's registered credentials, so the browser only prompts on a device
   *  that actually holds one of them. */
  async buildAuthenticationOptions(opts: {
    challenge: string
    allowCredentials: Array<{
      id: string
      transports?: AuthenticatorTransportFuture[]
    }>
  }): Promise<PublicKeyCredentialRequestOptionsJSON> {
    return generateAuthenticationOptions({
      rpID: this.rpID,
      challenge: isoBase64URL.toBuffer(opts.challenge),
      allowCredentials: opts.allowCredentials,
      userVerification: 'required',
    })
  }

  /** Verify the get() response against the stored credential + challenge. */
  async verifyAuthentication(opts: {
    response: AuthenticationResponseJSON
    challenge: string
    credential: {
      id: string
      publicKey: string
      counter: number
      transports?: AuthenticatorTransportFuture[]
    }
  }) {
    return verifyAuthenticationResponse({
      response: opts.response,
      expectedChallenge: opts.challenge,
      expectedOrigin: this.expectedOrigins,
      expectedRPID: this.rpID,
      requireUserVerification: true,
      credential: {
        id: opts.credential.id,
        publicKey: this.decodePublicKey(opts.credential.publicKey),
        counter: opts.credential.counter,
        transports: opts.credential.transports,
      },
    })
  }

  // ─── Public-key (de)serialization for storage ───────────────────────────────

  /** COSE public key bytes → base64url for the DB column. */
  encodePublicKey(publicKey: Uint8Array_): string {
    return isoBase64URL.fromBuffer(publicKey)
  }

  /** Reverse of {@link encodePublicKey} — base64url column → bytes for verify. */
  decodePublicKey(encoded: string): Uint8Array_ {
    return isoBase64URL.toBuffer(encoded)
  }
}
