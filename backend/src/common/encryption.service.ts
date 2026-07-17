import { Injectable, InternalServerErrorException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'crypto'

/**
 * Symmetric encryption for secrets that must be reversible at rest. Two
 * consumers now:
 *   • the TOTP shared secret (Manisha 2026-06-12 Access Control §6, HIPAA 45 CFR
 *     §164.312(d)) — the original, dark-launched behind MFA_ENFORCEMENT_ENABLED;
 *   • V-06 field-level encryption of clinical free-text (§164.312(a)(2)(iv)) —
 *     ~60 dual-write sites on the core write path, read back through
 *     `common/prisma-extensions/v06-decrypt.extension.ts`.
 *
 * AES-256-GCM gives confidentiality + integrity (the auth tag detects tampering
 * on decrypt).
 *
 * Key source: MFA_ENCRYPTION_KEY — a 32-byte key as 64 hex chars. Generate one
 * with:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Ciphertext envelope (single string, colon-delimited hex):
 *     <iv>:<authTag>:<ciphertext>
 * iv = 12 bytes (GCM standard), authTag = 16 bytes.
 */

/**
 * Shape of a valid MFA_ENCRYPTION_KEY: 32 bytes as 64 hex chars. Exported so the
 * boot-time secret guard checks the same shape this service enforces at use-time
 * — one definition, so the two can never drift apart. Note this is a FORMAT check
 * only: an all-zero key matches it. Strength is the guard's job (secret-guard.ts).
 */
export const MFA_ENCRYPTION_KEY_PATTERN = /^[0-9a-fA-F]{64}$/

@Injectable()
export class EncryptionService {
  private static readonly ALGORITHM = 'aes-256-gcm'
  private static readonly IV_BYTES = 12
  private cachedKey: Buffer | null = null

  constructor(private readonly config: ConfigService) {}

  /**
   * Resolve + cache the master key.
   *
   * Still lazy, but the reasoning has changed. It used to be "a deploy without
   * the key still boots, because only the dark-launched MFA paths touch
   * encryption". That stopped being true with V-06: the dual-write sites are on
   * the clinical write path, so a missing key would surface as a 500 on every
   * check-in carrying a note. The key is therefore `required: true` in
   * secret-guard.ts as of 2026-07-17 and the process refuses to boot without it
   * — laziness here is now just caching, not a deployment affordance.
   *
   * The throw below is kept as the backstop for anything that bypasses the guard
   * (scripts, tests, a future direct instantiation).
   */
  private getKey(): Buffer {
    if (this.cachedKey) return this.cachedKey
    const hexKey = this.config.get<string>('MFA_ENCRYPTION_KEY')
    if (!hexKey || !MFA_ENCRYPTION_KEY_PATTERN.test(hexKey)) {
      throw new InternalServerErrorException(
        'MFA_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes). ' +
          'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
      )
    }
    this.cachedKey = Buffer.from(hexKey, 'hex')
    return this.cachedKey
  }

  /** Encrypt UTF-8 plaintext → "<iv>:<authTag>:<ciphertext>" (all hex). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(EncryptionService.IV_BYTES)
    const cipher = createCipheriv(EncryptionService.ALGORITHM, this.getKey(), iv)
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ])
    const authTag = cipher.getAuthTag()
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`
  }

  /**
   * Null-passthrough encrypt used by V-06 dual-write sites (sibling `*Encrypted`
   * columns for high-sensitivity free-text). `null`/`undefined` → `null` so the
   * encrypted sibling stays null when the plaintext is absent — matches the
   * TotpCredential.secretEncrypted convention (no cipher rows for empty inputs).
   * Empty string passes through to encrypt() so the null-vs-empty distinction is
   * preserved on the encrypted side too.
   */
  encryptNullable(plaintext: string | null | undefined): string | null {
    if (plaintext == null) return null
    return this.encrypt(plaintext)
  }

  /**
   * JSON envelope for V-06 array/object columns (JournalEntry.otherSymptoms is
   * the current case). `null`/`undefined` → `null`; else JSON.stringify then
   * encrypt into a single envelope. Follow-up read path is
   * `JSON.parse(decrypt(envelope))`.
   */
  encryptJson(value: unknown): string | null {
    if (value == null) return null
    return this.encrypt(JSON.stringify(value))
  }

  /** Reverse of {@link encrypt}. Throws if the envelope is malformed or the
   *  auth tag fails (tampered/garbage ciphertext). */
  decrypt(envelope: string): string {
    const parts = envelope.split(':')
    if (parts.length !== 3) {
      throw new InternalServerErrorException('Malformed ciphertext envelope')
    }
    const [ivHex, authTagHex, dataHex] = parts
    const decipher = createDecipheriv(
      EncryptionService.ALGORITHM,
      this.getKey(),
      Buffer.from(ivHex, 'hex'),
    )
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ])
    return plaintext.toString('utf8')
  }
}
