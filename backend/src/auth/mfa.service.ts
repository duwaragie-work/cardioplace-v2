import { Injectable } from '@nestjs/common'
import { randomBytes } from 'crypto'
import { authenticator } from 'otplib'
import * as QRCode from 'qrcode'
import { EncryptionService } from '../common/encryption.service.js'
import { BcryptService } from './bcrypt.service.js'

/**
 * Provider/admin TOTP second factor (Manisha 2026-06-12 Access Control §6,
 * HIPAA 45 CFR §164.312(d), RFC 6238). Pure crypto/TOTP/recovery-code logic —
 * no Prisma, no HTTP — so it unit-tests in isolation. DB persistence, token
 * issuance, and audit logging live in AuthService.
 *
 * TOTP parameters are the RFC 6238 defaults every authenticator app expects:
 * 6 digits, 30-second step, SHA-1. `window: 1` accepts the adjacent step on
 * each side (±30s) to tolerate device clock drift (edge case from the brief).
 */
@Injectable()
export class MfaService {
  static readonly RECOVERY_CODE_COUNT = 10

  constructor(
    private readonly encryption: EncryptionService,
    private readonly bcrypt: BcryptService,
  ) {
    authenticator.options = { window: 1 }
  }

  // ─── TOTP ───────────────────────────────────────────────────────────────────

  /** Generate a fresh base32 TOTP secret (not yet persisted). */
  generateSecret(): string {
    return authenticator.generateSecret()
  }

  /** Build the otpauth:// provisioning URI the QR code encodes. */
  buildProvisioningUri(email: string, secret: string, issuer: string): string {
    return authenticator.keyuri(email, issuer, secret)
  }

  /** Render the provisioning URI as a PNG data URL for the enrollment page. */
  async buildQrDataUrl(provisioningUri: string): Promise<string> {
    return QRCode.toDataURL(provisioningUri)
  }

  /** Verify a 6-digit code against the secret (±1 step clock-drift tolerance). */
  verifyCode(secret: string, code: string): boolean {
    const token = code?.trim()
    if (!token || !/^\d{6}$/.test(token)) return false
    try {
      return authenticator.verify({ token, secret })
    } catch {
      return false
    }
  }

  encryptSecret(secret: string): string {
    return this.encryption.encrypt(secret)
  }

  decryptSecret(envelope: string): string {
    return this.encryption.decrypt(envelope)
  }

  // ─── Recovery codes ───────────────────────────────────────────────────────

  /**
   * Generate {@link RECOVERY_CODE_COUNT} one-time recovery codes. Returns the
   * human-readable form (`XXXXX-XXXXX`) to display/download once, plus the
   * bcrypt hashes (of the normalized, hyphen-stripped form) to persist. The
   * plaintext is never stored.
   */
  async generateRecoveryCodes(): Promise<{ plain: string[]; hashes: string[] }> {
    const plain = Array.from({ length: MfaService.RECOVERY_CODE_COUNT }, () =>
      this.randomRecoveryCode(),
    )
    const hashes = await Promise.all(
      plain.map((code) => this.bcrypt.hash(this.normalizeRecoveryCode(code))),
    )
    return { plain, hashes }
  }

  /** Compare a user-entered code against one stored hash (order-insensitive
   *  to formatting — spaces/hyphens/case are normalized away). */
  async verifyRecoveryCode(entered: string, hash: string): Promise<boolean> {
    if (!entered?.trim()) return false
    return this.bcrypt.compare(this.normalizeRecoveryCode(entered), hash)
  }

  /** 10 hex chars rendered as two readable groups: `A1B2C-D3E4F`. */
  private randomRecoveryCode(): string {
    const raw = randomBytes(5).toString('hex').toUpperCase() // 10 chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`
  }

  private normalizeRecoveryCode(code: string): string {
    return code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  }
}
