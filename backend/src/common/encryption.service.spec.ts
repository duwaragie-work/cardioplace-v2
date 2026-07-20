import { jest } from '@jest/globals'
import { ConfigService } from '@nestjs/config'
import { EncryptionService } from './encryption.service.js'

// V-06 dual-write helpers are the addition here; base encrypt/decrypt were
// already field-tested in prod on TotpCredential.secretEncrypted. This spec
// keeps a round-trip check for regression insurance + covers the new
// null-passthrough shape callers depend on.

// 64 hex chars — a valid MFA_ENCRYPTION_KEY shape. Not real prod key
// material; the boot-time secret-guard rejects zero-shape / repeated-pattern
// values, so the spec uses a mixed-nibble sample.
const TEST_KEY = '0123456789abcdef' + '0123456789abcdef' + 'fedcba9876543210' + 'fedcba9876543210'

function makeService(): EncryptionService {
  const config = {
    get: jest.fn((k: string) => (k === 'MFA_ENCRYPTION_KEY' ? TEST_KEY : undefined)),
  } as unknown as ConfigService
  return new EncryptionService(config)
}

describe('EncryptionService', () => {
  let svc: EncryptionService

  beforeEach(() => {
    svc = makeService()
  })

  describe('encrypt / decrypt round-trip', () => {
    it('round-trips a simple ASCII string', () => {
      const plaintext = 'felt dizzy this morning'
      const envelope = svc.encrypt(plaintext)
      expect(envelope.split(':')).toHaveLength(3)
      expect(svc.decrypt(envelope)).toBe(plaintext)
    })

    it('round-trips unicode + surrogate pairs', () => {
      const plaintext = 'Þórr ⚡ 🩺 blood pressure — high'
      expect(svc.decrypt(svc.encrypt(plaintext))).toBe(plaintext)
    })

    it('round-trips an empty string', () => {
      // Empty is a valid input — the null-vs-empty distinction matters at the
      // application layer, so encryptNullable preserves both.
      expect(svc.decrypt(svc.encrypt(''))).toBe('')
    })

    it('produces a distinct envelope on repeated encrypts (IV randomization)', () => {
      const a = svc.encrypt('same input')
      const b = svc.encrypt('same input')
      expect(a).not.toBe(b) // different IVs → different envelopes
      expect(svc.decrypt(a)).toBe(svc.decrypt(b))
    })

    it('throws on a tampered envelope (auth-tag failure)', () => {
      const envelope = svc.encrypt('secret')
      const [iv, tag, ct] = envelope.split(':')
      // Flip a nibble in the ciphertext — GCM auth tag should reject it.
      const tampered = `${iv}:${tag}:${ct.slice(0, -2)}${ct.slice(-2) === '00' ? '11' : '00'}`
      expect(() => svc.decrypt(tampered)).toThrow()
    })
  })

  describe('encryptNullable — V-06 dual-write helper', () => {
    it('null → null', () => {
      expect(svc.encryptNullable(null)).toBeNull()
    })

    it('undefined → null', () => {
      expect(svc.encryptNullable(undefined)).toBeNull()
    })

    it('empty string → valid envelope (preserves null-vs-empty distinction)', () => {
      const envelope = svc.encryptNullable('')
      expect(envelope).not.toBeNull()
      expect(envelope!.split(':')).toHaveLength(3)
      expect(svc.decrypt(envelope!)).toBe('')
    })

    it('non-empty string → envelope that round-trips', () => {
      const plaintext = 'patient notes'
      const envelope = svc.encryptNullable(plaintext)
      expect(envelope).not.toBeNull()
      expect(svc.decrypt(envelope!)).toBe(plaintext)
    })
  })

  describe('encryptJson — V-06 dual-write helper for arrays/JSON columns', () => {
    it('null → null', () => {
      expect(svc.encryptJson(null)).toBeNull()
    })

    it('undefined → null', () => {
      expect(svc.encryptJson(undefined)).toBeNull()
    })

    it('empty array → valid envelope encoding "[]"', () => {
      const envelope = svc.encryptJson([])
      expect(envelope).not.toBeNull()
      expect(JSON.parse(svc.decrypt(envelope!))).toEqual([])
    })

    it('string array (JournalEntry.otherSymptoms shape) round-trips via JSON', () => {
      const arr = ['dizziness', 'headache', 'palpitations']
      const envelope = svc.encryptJson(arr)
      expect(JSON.parse(svc.decrypt(envelope!))).toEqual(arr)
    })

    it('object → envelope that round-trips to the same object shape', () => {
      const obj = { previousValue: 100, newValue: 90, unit: 'mg/dL' }
      const envelope = svc.encryptJson(obj)
      expect(JSON.parse(svc.decrypt(envelope!))).toEqual(obj)
    })
  })
})
