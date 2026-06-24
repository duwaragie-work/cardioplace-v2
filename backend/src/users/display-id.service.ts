// Human-readable, prefixed, permanent identifier for every User account.
// Issued once at account creation, locked forever. Full spec in
// docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.
//
// Format: CP-PAT-XXXXXXX-C (patient) / CP-STF-XXXXXXX-C (staff)
// - CP        — brand constant
// - PAT|STF   — population class (initial; never re-derived from current roles)
// - XXXXXXX   — 7 random chars from Crockford base32 (no I L O U)
// - C         — 1-char Luhn-mod-32 check digit
// Canonical storage drops hyphens + uppercases ("CPPATK8M2R4N7"). Hyphens are
// presentation-only.

import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { randomInt } from 'crypto'
import type { Prisma } from '../generated/prisma/client.js'
import { DisplayIdClass } from '../generated/prisma/enums.js'
import { PrismaService } from '../prisma/prisma.service.js'

export type IssuedVia =
  | 'otp'
  | 'magic_link'
  | 'google_oauth'
  | 'invite_accept'
  | 'backfill'

// ─── Constants ───────────────────────────────────────────────────────────────

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford base32
const RADIX = ALPHABET.length // 32
const BRAND = 'CP'
const CLASS_PREFIX = {
  [DisplayIdClass.PATIENT]: 'PAT',
  [DisplayIdClass.STAFF]: 'STF',
} as const
const BODY_LEN = 7
const MAX_ALLOCATION_ATTEMPTS = 3

// ─── Service ─────────────────────────────────────────────────────────────────

@Injectable()
export class DisplayIdService {
  private readonly logger = new Logger(DisplayIdService.name)

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Creates a User row with a pre-generated permanent DisplayId in one
   * transaction. The caller provides a `createUserFn` closure that runs
   * `tx.user.create({ data: { ..., displayId } })` with the value this
   * service supplies.
   *
   * This pattern is required because `User.displayId` is NOT NULL —
   * Postgres checks NOT NULL at INSERT-statement-end (not COMMIT), so the
   * row must include `displayId` at the moment of insert. Generating
   * post-insert and updating would fail the constraint.
   *
   * Collision handling: if the User insert (or the subsequent ledger
   * insert) fails on a displayId unique constraint, the whole step
   * retries up to MAX_ALLOCATION_ATTEMPTS with a fresh value.
   * Non-collision errors (e.g. duplicate email) propagate immediately.
   *
   * Throws ConflictException on collision exhaustion (RNG broken or
   * namespace exhausted — both need a human).
   */
  async issueForCreate<T extends { id: string }>(
    tx: Prisma.TransactionClient,
    cls: DisplayIdClass,
    via: IssuedVia,
    createUserFn: (displayIdValue: string) => Promise<T>,
  ): Promise<T> {
    let attempts = 0
    const collidedAttempts: string[] = []

    while (attempts < MAX_ALLOCATION_ATTEMPTS) {
      attempts++
      const value = generateCanonical(cls)
      const display = formatForDisplay(value)

      try {
        // User insert MUST include displayId in `data` — the caller's
        // closure is responsible for that.
        const user = await createUserFn(value)
        // Ledger row, in the same transaction. If THIS fails on the
        // value-PK collision the outer catch retries; if it fails for
        // another reason it propagates.
        await tx.displayId.create({
          data: {
            value,
            display,
            class: cls,
            userId: user.id,
            issuedVia: via,
          },
        })
        if (collidedAttempts.length > 0) {
          await tx.displayIdCollisionLog.create({
            data: {
              attemptedValue: collidedAttempts[0]!,
              class: cls,
              attempts,
              resolvedValue: value,
            },
          })
        }
        return user
      } catch (err: unknown) {
        if (isDisplayIdCollision(err)) {
          collidedAttempts.push(value)
          this.logger.warn(
            `Display ID collision on attempt ${attempts}/${MAX_ALLOCATION_ATTEMPTS} for ${cls}: ${value}`,
          )
          continue
        }
        throw err
      }
    }

    throw new ConflictException(
      `Failed to allocate display ID after ${MAX_ALLOCATION_ATTEMPTS} attempts — namespace pressure or RNG fault. Tried: ${collidedAttempts.join(', ')}`,
    )
  }

  /**
   * Resolves any user-typed form of a display ID — with or without hyphens,
   * mixed case, with Crockford-ambiguous chars (I/L→1, O→0) — to the live
   * `DisplayId` row. Returns null if not found or if the input fails the
   * check digit.
   */
  async findByAnyForm(input: string): Promise<{
    value: string
    display: string
    class: DisplayIdClass
    userId: string | null
  } | null> {
    let canonical: string
    try {
      canonical = normalize(input)
    } catch {
      return null
    }
    if (!isWellFormed(canonical) || !isValidCheckDigit(canonical)) return null

    return this.prisma.displayId.findUnique({ where: { value: canonical } })
  }

  // Static helpers exposed for tests + callers that need pure functions.
  static normalize = normalize
  static formatForDisplay = formatForDisplay
  static isWellFormed = isWellFormed
  static isValidCheckDigit = isValidCheckDigit
  static classFromRoles = classFromRoles
}

// ─── Pure helpers (exported for tests) ───────────────────────────────────────

/**
 * Strips hyphens / whitespace, uppercases, applies Crockford ambiguity
 * mapping (I/L → 1, O → 0). Throws on chars not in the Crockford-permissive
 * input alphabet — that catches paste-ins from foreign systems early.
 */
export function normalize(input: string): string {
  const cleaned = input.replace(/[\s\-]/g, '').toUpperCase()
  if (cleaned.length === 0) {
    throw new Error('Display ID is empty after normalization')
  }
  let out = ''
  for (const ch of cleaned) {
    if (ch === 'I' || ch === 'L') {
      out += '1'
      continue
    }
    if (ch === 'O') {
      out += '0'
      continue
    }
    if (ch === 'U') {
      // U is excluded from Crockford and has no permissive mapping.
      throw new Error(`Display ID contains illegal char 'U'`)
    }
    if (ALPHABET.indexOf(ch) < 0) {
      throw new Error(`Display ID contains illegal char '${ch}'`)
    }
    out += ch
  }
  return out
}

/**
 * Inserts hyphens at the documented positions: CP-PAT-XXXXXXX-C.
 * Total canonical length = 2 (brand) + 3 (class) + 7 (body) + 1 (check) = 13.
 */
export function formatForDisplay(canonical: string): string {
  if (canonical.length !== 13) {
    throw new Error(
      `Cannot format display ID of length ${canonical.length} (expected 13)`,
    )
  }
  const brand = canonical.slice(0, 2)
  const cls = canonical.slice(2, 5)
  const body = canonical.slice(5, 12)
  const check = canonical.slice(12, 13)
  return `${brand}-${cls}-${body}-${check}`
}

/**
 * Quick structural check: length, brand, known class prefix, alphabet
 * conformance. Does NOT validate the check digit — that's a separate step.
 */
export function isWellFormed(canonical: string): boolean {
  if (canonical.length !== 13) return false
  if (canonical.slice(0, 2) !== BRAND) return false
  const cls = canonical.slice(2, 5)
  if (cls !== CLASS_PREFIX.PATIENT && cls !== CLASS_PREFIX.STAFF) return false
  // The body + check must be drawn from the Crockford alphabet.
  for (let i = 5; i < 13; i++) {
    if (ALPHABET.indexOf(canonical[i]!) < 0) return false
  }
  return true
}

/**
 * Luhn-mod-N check. The check digit is the LAST char; everything before it
 * is the payload. Validation: include the check char, alternate factor=2,1
 * starting from the right (the check digit is factor=1, the char to its
 * left is factor=2, etc). Sum-of-base-N-digits per char. Result mod N must
 * be 0 for a valid string.
 *
 * Only validates the body + check; ignores brand + class prefix (they're
 * not encoded into the checksum — they're labels, not data).
 */
export function isValidCheckDigit(canonical: string): boolean {
  if (canonical.length !== 13) return false
  const body = canonical.slice(5) // 7 chars body + 1 check = 8 chars total
  let sum = 0
  let factor = 1 // rightmost (check digit) gets factor 1; second-from-right gets 2
  for (let i = body.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(body[i]!)
    if (codePoint < 0) return false
    let addend = codePoint * factor
    // Sum of base-N digits.
    while (addend >= RADIX) {
      const hi = Math.floor(addend / RADIX)
      const lo = addend % RADIX
      addend = hi + lo
    }
    sum += addend
    factor = factor === 1 ? 2 : 1
  }
  return sum % RADIX === 0
}

/**
 * Computes the check digit for a payload (brand + class + 7 body chars).
 * The check digit is appended at the END.
 */
export function computeCheckDigit(payloadAfterClass: string): string {
  // payloadAfterClass = 7 body chars
  let sum = 0
  let factor = 2 // because the check digit (to-be-appended) has factor 1
  for (let i = payloadAfterClass.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(payloadAfterClass[i]!)
    if (codePoint < 0) {
      throw new Error(
        `computeCheckDigit: char '${payloadAfterClass[i]}' not in Crockford alphabet`,
      )
    }
    let addend = codePoint * factor
    while (addend >= RADIX) {
      const hi = Math.floor(addend / RADIX)
      const lo = addend % RADIX
      addend = hi + lo
    }
    sum += addend
    factor = factor === 2 ? 1 : 2
  }
  const remainder = sum % RADIX
  const check = (RADIX - remainder) % RADIX
  return ALPHABET[check]!
}

/**
 * Maps a user's role array to its INITIAL population class. PATIENT class
 * if PATIENT appears anywhere in roles; STAFF otherwise. (For first-time
 * issuance — the ledger is then immutable.)
 */
export function classFromRoles(
  roles: ReadonlyArray<string>,
): DisplayIdClass {
  return roles.includes('PATIENT') ? DisplayIdClass.PATIENT : DisplayIdClass.STAFF
}

// ─── Internal ────────────────────────────────────────────────────────────────

function generateCanonical(cls: DisplayIdClass): string {
  let body = ''
  for (let i = 0; i < BODY_LEN; i++) {
    body += ALPHABET[randomInt(0, RADIX)]
  }
  const check = computeCheckDigit(body)
  return `${BRAND}${CLASS_PREFIX[cls]}${body}${check}`
}

/**
 * True iff the error is a Prisma P2002 unique-violation specifically on
 * one of the displayId-bearing columns. Lets the retry loop distinguish
 * "regenerate and try again" (collision on value/display/User.displayId)
 * from "give up immediately" (e.g. duplicate User.email).
 */
function isDisplayIdCollision(err: unknown): boolean {
  if (
    typeof err !== 'object' ||
    err === null ||
    !('code' in err) ||
    (err as { code: unknown }).code !== 'P2002'
  ) {
    return false
  }
  const meta = (err as { meta?: { target?: unknown } }).meta
  const target = meta?.target
  const isMatch = (s: string): boolean =>
    s === 'displayId' || s === 'value' || s === 'display'
  if (Array.isArray(target)) {
    return target.some((t) => typeof t === 'string' && isMatch(t))
  }
  if (typeof target === 'string') {
    return isMatch(target)
  }
  // No meta.target — conservatively assume it's a displayId collision.
  // Worse case: a few wasted retries. Better than masking a real error.
  return true
}
