import { validateSecrets, validateEnvSecrets } from './secret-guard.js'

/**
 * Boot-time secret guard (§164.312(d)). The contract under test:
 *   • a PRESENT-but-weak secret is rejected
 *   • an ABSENT secret is allowed — unless it is JWT_ACCESS_SECRET
 *   • every violation is reported at once, not just the first
 */

// A real 48-byte base64url value and a real 32-byte hex key. Generated, not typed.
const STRONG = '8cfCn3ZrZHZj_JxONQF_4GJoZLWay3tuERnFngEKd_YqPuxMp_eODCjkcgaPOECd'
const STRONG_HEX_KEY =
  'fa11da7e7124e04f5e2eae5004398676cdc6b401a46d6832766b5ea28f5c036f'

/** The minimum env that passes, so each test can vary exactly one thing. */
const clean = (over: Record<string, string | undefined> = {}) => ({
  JWT_ACCESS_SECRET: STRONG,
  ...over,
})

describe('validateSecrets', () => {
  it('accepts a fully-populated strong environment', () => {
    expect(
      validateSecrets({
        JWT_ACCESS_SECRET: STRONG,
        JWT_SECRET: STRONG,
        JWT_REFRESH_SECRET: STRONG,
        MFA_ENCRYPTION_KEY: STRONG_HEX_KEY,
        TEST_CONTROL_SECRET: STRONG,
      }),
    ).toEqual([])
  })

  describe('presence', () => {
    it('rejects a missing JWT_ACCESS_SECRET — the one required secret', () => {
      const v = validateSecrets({})
      expect(v).toHaveLength(1)
      expect(v[0]).toMatch(/JWT_ACCESS_SECRET is required/)
    })

    it('treats an empty string as absent, not as a weak value', () => {
      expect(validateSecrets({ JWT_ACCESS_SECRET: '   ' })[0]).toMatch(
        /JWT_ACCESS_SECRET is required/,
      )
    })

    // The asymmetry that keeps push / SMTP / MFA dark-launchable. If this test
    // ever fails, someone has turned an optional feature into a boot requirement.
    it.each([
      'JWT_SECRET',
      'JWT_REFRESH_SECRET',
      'MFA_ENCRYPTION_KEY',
      'TEST_CONTROL_SECRET',
      'VAPID_PRIVATE_KEY',
      'SMTP_PASS',
    ])('allows %s to be absent (unset = feature off)', (name) => {
      expect(validateSecrets(clean({ [name]: undefined }))).toEqual([])
    })
  })

  describe('weak values', () => {
    it.each([
      ['the .env.example JWT placeholder', 'change-me-to-a-long-random-string'],
      ['the other .env.example JWT placeholder', 'change-me-to-another-long-random-string'],
      ['a CI placeholder', 'ci-jwt-access-secret'],
      ['a "your-" placeholder', 'your-smtp-app-password'],
      ['an angle-bracket placeholder', '<your-secret-here-please-replace-it>'],
      ['an XXXX placeholder', 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'],
    ])('rejects %s', (_label, value) => {
      const v = validateSecrets({ JWT_ACCESS_SECRET: value })
      expect(v).toHaveLength(1)
      expect(v[0]).toMatch(/placeholder value from the example config/)
    })

    it('rejects a secret that is too short', () => {
      const v = validateSecrets({ JWT_ACCESS_SECRET: 'abc123' })
      expect(v[0]).toMatch(/too short \(6 chars, minimum 32\)/)
    })

    it('rejects an all-zero MFA key — the .env.example default', () => {
      const v = validateSecrets(clean({ MFA_ENCRYPTION_KEY: '0'.repeat(64) }))
      expect(v).toHaveLength(1)
      expect(v[0]).toMatch(/MFA_ENCRYPTION_KEY/)
      // All-zero is a repeated unit before it is low-variety, so that is the
      // reason reported. Either would be correct; assert we say *something*.
      expect(v[0]).toMatch(/repeated end to end|distinct characters/)
    })

    it('rejects a low-variety value that is not an exact repeat', () => {
      // 'a'x16 + 'b'x16 — no repeating unit divides it, but only 2 distinct chars.
      const v = validateSecrets({
        JWT_ACCESS_SECRET: 'a'.repeat(16) + 'b'.repeat(16),
      })
      expect(v[0]).toMatch(/only 2 distinct characters/)
    })
  })

  /**
   * The regression test this whole guard exists for.
   *
   * CI's MFA_ENCRYPTION_KEY was '0123456789abcdef' repeated four times. It is
   * 64 hex chars, so the format check passes. It has 16 distinct symbols in a
   * uniform distribution, so its Shannon entropy is MAXIMAL for a hex alphabet —
   * an entropy threshold waves it straight through. Only the repeated-unit check
   * catches it. If someone "simplifies" the guard to an entropy score, this fails.
   */
  describe('the entropy trap', () => {
    const CI_KEY = '0123456789abcdef'.repeat(4)

    it('rejects 0123456789abcdef x4 despite its perfect Shannon entropy', () => {
      const v = validateSecrets(clean({ MFA_ENCRYPTION_KEY: CI_KEY }))
      expect(v).toHaveLength(1)
      expect(v[0]).toMatch(/MFA_ENCRYPTION_KEY/)
      expect(v[0]).toMatch(/repeated end to end/)
    })

    it('the trap key passes the format check it used to be judged by', () => {
      // Proof the old check was insufficient, not that the new one is redundant.
      expect(/^[0-9a-fA-F]{64}$/.test(CI_KEY)).toBe(true)
      expect(new Set(CI_KEY).size).toBe(16) // maximal symbol variety for hex
    })

    it.each([['abab...', 'ab'.repeat(20)], ['xyzxyz...', 'xyz'.repeat(12)]])(
      'also rejects %s',
      (_label, value) => {
        expect(validateSecrets({ JWT_ACCESS_SECRET: value })[0]).toMatch(
          /repeated end to end/,
        )
      },
    )
  })

  describe('MFA_ENCRYPTION_KEY format', () => {
    it('rejects a strong value that is not 64 hex chars', () => {
      // STRONG is a fine JWT secret but the wrong shape for an AES-256 key.
      const v = validateSecrets(clean({ MFA_ENCRYPTION_KEY: STRONG }))
      expect(v).toHaveLength(1)
      expect(v[0]).toMatch(/exactly 64 hex characters/)
    })

    it('accepts a real 64-hex key', () => {
      expect(validateSecrets(clean({ MFA_ENCRYPTION_KEY: STRONG_HEX_KEY }))).toEqual([])
    })
  })

  describe('length floors are per-secret, not global', () => {
    // A Gmail app password is 16 chars. A blanket 32-char floor would reject a
    // legitimate credential and send someone hunting a bug that isn't there.
    it('accepts a 16-char SMTP_PASS', () => {
      expect(validateSecrets(clean({ SMTP_PASS: 'qwertasdfgzxcvb1' }))).toEqual([])
    })

    it('still rejects a 16-char JWT_ACCESS_SECRET', () => {
      expect(validateSecrets({ JWT_ACCESS_SECRET: 'qwertasdfgzxcvb1' })[0]).toMatch(
        /too short/,
      )
    })
  })

  it('reports EVERY violation at once, not just the first', () => {
    const v = validateSecrets({
      JWT_ACCESS_SECRET: 'change-me-to-a-long-random-string',
      JWT_SECRET: 'short',
      JWT_REFRESH_SECRET: 'ci-jwt-refresh-secret',
      MFA_ENCRYPTION_KEY: '0'.repeat(64),
    })
    expect(v).toHaveLength(4)
    expect(v.join('\n')).toMatch(/JWT_ACCESS_SECRET/)
    expect(v.join('\n')).toMatch(/JWT_SECRET/)
    expect(v.join('\n')).toMatch(/JWT_REFRESH_SECRET/)
    expect(v.join('\n')).toMatch(/MFA_ENCRYPTION_KEY/)
  })

  it('names the generation command on every violation', () => {
    const v = validateSecrets({ JWT_ACCESS_SECRET: 'change-me' })
    expect(v[0]).toMatch(/Generate: node -e/)
  })

  describe('secrets deliberately NOT guarded', () => {
    // Google / Apple strategies are commented out of auth.module.ts providers
    // ("DISABLED – OTP-only auth"), so they never construct. Guarding dead config
    // is noise. This test documents the omission so it reads as a decision.
    it.each(['GOOGLE_CLIENT_SECRET', 'APPLE_PRIVATE_KEY', 'APPLE_TEAM_ID'])(
      'ignores %s while social login is disabled',
      (name) => {
        expect(validateSecrets(clean({ [name]: 'XXXXXXXXXX' }))).toEqual([])
      },
    )
  })
})

describe('validateEnvSecrets (the ConfigModule hook)', () => {
  it('returns the config untouched when everything is strong', () => {
    const config = { JWT_ACCESS_SECRET: STRONG, PORT: '4000' }
    expect(validateEnvSecrets(config)).toBe(config)
  })

  it('throws with a refusal message listing every violation', () => {
    expect(() =>
      validateEnvSecrets({
        JWT_ACCESS_SECRET: 'change-me',
        MFA_ENCRYPTION_KEY: '0'.repeat(64),
      }),
    ).toThrow(/Refusing to start — 2 insecure secrets/)
  })

  it('singularises the message for a single violation', () => {
    expect(() => validateEnvSecrets({})).toThrow(
      /Refusing to start — 1 insecure secret in the environment/,
    )
  })
})
