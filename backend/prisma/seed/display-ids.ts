// Post-seed step: assign permanent DisplayId to every seeded User that
// doesn't already have one. Mirrors the runtime issuance at the 4
// user-create sites in auth.service.ts (which the seed bypasses by going
// straight to prisma.user.upsert). See
// docs/UNIQUE_IDENTIFIER_PROPOSAL_2026_06_24.md.

import { randomInt } from 'crypto'
import type { PrismaClient } from '../../src/generated/prisma/client.js'
import { DisplayIdClass } from '../../src/generated/prisma/enums.js'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RADIX = ALPHABET.length
const BRAND = 'CP'
const CLASS_PREFIX = {
  [DisplayIdClass.PATIENT]: 'PAT',
  [DisplayIdClass.STAFF]: 'STF',
  // System-principal registry (audit, 2026-07-03). CP-SYS-XXXXXXX-C.
  [DisplayIdClass.SYSTEM]: 'SYS',
} as const
const BODY_LEN = 7

function computeCheckDigit(payload: string): string {
  let sum = 0
  let factor = 2
  for (let i = payload.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(payload[i]!)
    let addend = codePoint * factor
    while (addend >= RADIX) {
      const hi = Math.floor(addend / RADIX)
      const lo = addend % RADIX
      addend = hi + lo
    }
    sum += addend
    factor = factor === 2 ? 1 : 2
  }
  return ALPHABET[(RADIX - (sum % RADIX)) % RADIX]!
}

export function generateCanonical(cls: DisplayIdClass): string {
  let body = ''
  for (let i = 0; i < BODY_LEN; i++) {
    body += ALPHABET[randomInt(0, RADIX)]
  }
  return `${BRAND}${CLASS_PREFIX[cls]}${body}${computeCheckDigit(body)}`
}

export function formatForDisplay(canonical: string): string {
  return `${canonical.slice(0, 2)}-${canonical.slice(2, 5)}-${canonical.slice(5, 12)}-${canonical.slice(12)}`
}

/**
 * Idempotent: returns the existing displayId for the given email if any,
 * otherwise generates a fresh value (without writing to DB). The caller
 * passes the returned value into their `prisma.user.upsert({ create })`
 * clause; the ledger row is written by `seedDisplayIds()` afterward.
 *
 * Required because User.displayId is NOT NULL — every upsert that may
 * take the create branch must supply the column.
 */
export async function getOrGenerateDisplayIdForEmail(
  prisma: PrismaClient,
  email: string,
  cls: DisplayIdClass,
): Promise<string> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { displayId: true },
  })
  if (existing?.displayId) return existing.displayId
  return generateCanonical(cls)
}

/** Post-step: writes a DisplayId ledger row for every User who has a
 *  displayId set but no matching ledger entry. Runs after every seed
 *  upsert because the runtime auth path always pairs the two; the seed
 *  takes a shortcut and lets this catch-up step handle it.
 */
export async function seedDisplayIds(prisma: PrismaClient): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: {
      // displayId is NOT NULL (see user.prisma); a `{ not: null }` filter on a
      // non-nullable column is rejected by Prisma 7+, so the only meaningful
      // filter is the missing ledger row.
      displayIdLedger: null,
    },
    select: { id: true, roles: true, displayId: true },
    orderBy: { createdAt: 'asc' },
  })
  if (candidates.length === 0) return

  console.log(`  ↳ writing displayId ledger rows for ${candidates.length} seeded user(s)…`)
  let written = 0
  for (const user of candidates) {
    const cls = user.roles.includes('PATIENT')
      ? DisplayIdClass.PATIENT
      : DisplayIdClass.STAFF
    // Idempotent: a prior seed run may already hold this value in the ledger.
    // upsert (no-op on the existing row) makes re-seeding a non-fresh DB safe
    // instead of throwing a P2002 unique violation on `value`.
    await prisma.displayId.upsert({
      where: { value: user.displayId! },
      update: {},
      create: {
        value: user.displayId!,
        display: formatForDisplay(user.displayId!),
        class: cls,
        userId: user.id,
        issuedVia: 'backfill',
      },
    })
    written++
  }
  console.log(`  ↳ ${written}/${candidates.length} ledger rows written.`)
}
