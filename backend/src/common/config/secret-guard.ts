import { MFA_ENCRYPTION_KEY_PATTERN } from '../encryption.service.js'

/**
 * Boot-time secret guard — HIPAA §164.312(d), Humaira's Person-or-Entity
 * Authentication assessment v(v), Activity 2 Technical item 1: "Weak default
 * secrets ship in the example config — safe only if operators override them in
 * every environment." Before this, a .env copied verbatim from .env.example
 * booted a fully functional server with JWT_SECRET=change-me-… and a 32-byte
 * MFA key of all zeroes. EncryptionService only ever checked the key's FORMAT
 * (64 hex chars), which all-zero passes.
 *
 * Contract: a PRESENT-but-weak value is rejected. An ABSENT value is not.
 *
 * That asymmetry is deliberate and load-bearing. Several services are built so
 * that "unset" means "feature cleanly off" — WebPushService no-ops without VAPID
 * keys, SMTP no-ops, LangSmith no-ops, OTLP no-ops, and EncryptionService
 * validates the MFA key lazily precisely so a deploy without it still boots (MFA
 * is dark-launched behind MFA_ENFORCEMENT_ENABLED). A guard that demanded
 * presence would silently convert every one of those optional features into a
 * hard boot requirement. So: empty ⇒ skip, set ⇒ must be strong. JWT_ACCESS_SECRET
 * is the single exception — it is already genuinely required (jwt.strategy.ts
 * uses getOrThrow) and stays required.
 *
 * Fails closed in EVERY environment, not just production — mirroring the doctrine
 * already stated in jwt.strategy.ts ("Fail closed: no fallback default … the
 * process must refuse to start").
 */

/** How the value is generated, so a violation tells the operator what to run. */
const GEN_RANDOM_48 =
  'node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"'
const GEN_HEX_32 =
  'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'

interface SecretSpec {
  /** Must be present AND strong. Everything else: strong only if present. */
  required?: boolean
  /** Shortest defensible length for this *kind* of secret (see note below). */
  minLength: number
  /** Extra shape check beyond strength — currently only the MFA key. */
  pattern?: { re: RegExp; describe: string }
  /** Shown on any violation of this secret. */
  fix: string
}

/**
 * minLength is per-secret, not global, because the secrets are not the same kind
 * of thing. A Gmail app password is 16 characters and is a legitimate SMTP_PASS —
 * a blanket 32-char floor would reject a valid credential and send someone
 * hunting a phantom bug.
 *
 * NOT guarded: GOOGLE_CLIENT_SECRET, APPLE_PRIVATE_KEY, APPLE_TEAM_ID,
 * APPLE_KEY_ID. The Google and Apple strategies are commented out of the
 * providers array (auth.module.ts, "DISABLED – OTP-only auth"), so they never
 * construct. Guarding dead config is noise, not safety. Re-add them here the day
 * social login is switched back on.
 */
const SECRETS: Record<string, SecretSpec> = {
  // The only secret actually consumed at runtime for signing (jwt.strategy.ts).
  JWT_ACCESS_SECRET: { required: true, minLength: 32, fix: GEN_RANDOM_48 },

  // JWT_SECRET and JWT_REFRESH_SECRET are read NOWHERE in backend/src — refresh
  // tokens are opaque randomBytes(40), not JWTs. They are guarded anyway because
  // they ship in .env.example and would otherwise sit there looking authoritative
  // with a "change-me" value forever. Hardening them changes no runtime behaviour.
  JWT_SECRET: { minLength: 32, fix: GEN_RANDOM_48 },
  JWT_REFRESH_SECRET: { minLength: 32, fix: GEN_RANDOM_48 },

  MFA_ENCRYPTION_KEY: {
    minLength: 64,
    pattern: {
      re: MFA_ENCRYPTION_KEY_PATTERN,
      describe: 'must be exactly 64 hex characters (32 bytes)',
    },
    fix: GEN_HEX_32,
  },

  TEST_CONTROL_SECRET: { minLength: 32, fix: GEN_RANDOM_48 },
  VAPID_PRIVATE_KEY: { minLength: 20, fix: 'npx web-push generate-vapid-keys' },
  SMTP_PASS: { minLength: 12, fix: 'use the app password issued by your mail provider' },
}

/**
 * Values that are obviously not secrets. Short, ambiguous markers ("ci-", "test-")
 * are anchored to the start of the string on purpose: an unanchored 3-character
 * substring can occur by chance inside a genuinely random base64url secret, and a
 * false positive here is a baffling boot failure at 3am.
 */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /change-?me/i,
  /replace-?me/i,
  /changeit/i,
  /placeholder/i,
  /<your/i,
  /xxxx/i,
  /^your-/i,
  /^ci-/i,
  /^test-/i,
  /^dummy/i,
  /^sample/i,
]

/**
 * Is `s` some shorter unit repeated end to end? ("abcabcabc" → yes, unit "abc".)
 *
 * THIS is the check that catches CI's MFA_ENCRYPTION_KEY, which is
 * "0123456789abcdef" repeated four times. Note carefully that Shannon entropy
 * *passes* that string with flying colours — 16 distinct symbols, uniform
 * distribution, maximal entropy for a hex alphabet. An entropy threshold would
 * wave it straight through. The structure is the tell, not the symbol frequency.
 */
function isRepeatedUnit(s: string): boolean {
  const n = s.length
  for (let unit = 1; unit <= n / 2; unit++) {
    if (n % unit !== 0) continue
    if (s.slice(0, unit).repeat(n / unit) === s) return true
  }
  return false
}

/** Distinct characters, the cheap proxy for "someone mashed one key". */
function distinctChars(s: string): number {
  return new Set(s).size
}

/**
 * Validate every configured secret and return EVERY violation.
 *
 * Returns all of them rather than throwing on the first, so an operator fixing
 * four secrets learns about four in one boot instead of discovering them one
 * painful restart at a time.
 *
 * Pure: no Nest, no DI, no I/O. Takes the env as data so it can be unit-tested
 * without standing up a module.
 */
export function validateSecrets(
  env: Record<string, string | undefined>,
): string[] {
  const violations: string[] = []

  for (const [name, spec] of Object.entries(SECRETS)) {
    const value = env[name]?.trim() ?? ''

    if (value === '') {
      // Absent. Only a problem if this secret is required — see the contract note
      // at the top of this file for why absence is otherwise allowed.
      if (spec.required) {
        violations.push(`${name} is required but not set. Generate: ${spec.fix}`)
      }
      continue
    }

    const reason = weaknessOf(value, spec)
    if (reason) {
      violations.push(`${name} ${reason}. Generate: ${spec.fix}`)
    }
  }

  return violations
}

/** First reason `value` is unacceptable, or null if it passes. */
function weaknessOf(value: string, spec: SecretSpec): string | null {
  const placeholder = PLACEHOLDER_PATTERNS.find((re) => re.test(value))
  if (placeholder) {
    return 'is a placeholder value from the example config, not a real secret'
  }

  if (spec.pattern && !spec.pattern.re.test(value)) {
    return spec.pattern.describe
  }

  if (value.length < spec.minLength) {
    return `is too short (${value.length} chars, minimum ${spec.minLength})`
  }

  if (isRepeatedUnit(value)) {
    return 'is a short pattern repeated end to end, so it has far less entropy than its length suggests'
  }

  // Scale the floor to the value's own length so a legitimately short credential
  // (a 12-char provider password) isn't held to a 64-char key's standard.
  const minDistinct = Math.min(8, Math.floor(value.length / 2))
  if (distinctChars(value) < minDistinct) {
    return `uses only ${distinctChars(value)} distinct characters — too little variety to be random`
  }

  return null
}

/**
 * ConfigModule `validate` hook. Throws with EVERY violation listed, one per line.
 *
 * The throw propagates out of NestFactory.create(AppModule) into the existing
 * bootstrap().catch() in main.ts, which already console.errors and exits non-zero
 * — so a clear message and a non-zero exit code come for free.
 */
export function validateEnvSecrets(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const violations = validateSecrets(config as Record<string, string | undefined>)

  if (violations.length > 0) {
    throw new Error(
      `Refusing to start — ${violations.length} insecure secret${
        violations.length === 1 ? '' : 's'
      } in the environment:\n` +
        violations.map((v) => `  • ${v}`).join('\n') +
        '\n',
    )
  }

  return config
}
