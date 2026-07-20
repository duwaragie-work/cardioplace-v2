import { EncryptionService } from '../encryption.service.js'

/**
 * Deterministic EncryptionService mock for Jest unit tests. Every service
 * touched by V-06 now injects EncryptionService; specs that build a Nest
 * TestingModule (or directly `new` the service) have to hand one in.
 *
 * The mock uses a trivial `enc:<plaintext>` envelope so `encrypt`/`decrypt`
 * round-trips are still assertable — real AES-GCM crypto in unit specs would
 * couple every test to a valid MFA_ENCRYPTION_KEY without adding coverage
 * (the crypto surface is covered by encryption.service.spec.ts).
 *
 * Usage in a spec (Nest Testing module):
 *   { provide: EncryptionService, useValue: encryptionMock() }
 *
 * Usage when hand-constructing a service:
 *   new SomeService(prisma, encryptionMock() as unknown as EncryptionService)
 */
export function encryptionMock(): Pick<
  EncryptionService,
  'encrypt' | 'decrypt' | 'encryptNullable' | 'encryptJson'
> {
  return {
    encrypt: (plaintext: string) => `enc:${plaintext}`,
    decrypt: (envelope: string) => envelope.replace(/^enc:/, ''),
    encryptNullable: (plaintext: string | null | undefined) =>
      plaintext == null ? null : `enc:${plaintext}`,
    encryptJson: (value: unknown) =>
      value == null ? null : `enc:${JSON.stringify(value)}`,
  }
}
