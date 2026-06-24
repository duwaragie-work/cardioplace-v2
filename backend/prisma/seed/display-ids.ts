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

function generateCanonical(cls: DisplayIdClass): string {
  let body = ''
  for (let i = 0; i < BODY_LEN; i++) {
    body += ALPHABET[randomInt(0, RADIX)]
  }
  return `${BRAND}${CLASS_PREFIX[cls]}${body}${computeCheckDigit(body)}`
}

function formatForDisplay(canonical: string): string {
  return `${canonical.slice(0, 2)}-${canonical.slice(2, 5)}-${canonical.slice(5, 12)}-${canonical.slice(12)}`
}

export async function seedDisplayIds(prisma: PrismaClient): Promise<void> {
  const candidates = await prisma.user.findMany({
    where: { displayId: null },
    select: { id: true, roles: true },
    orderBy: { createdAt: 'asc' },
  })
  if (candidates.length === 0) return

  console.log(`  ↳ assigning displayId to ${candidates.length} seeded user(s)…`)
  let issued = 0
  for (const user of candidates) {
    const cls = user.roles.includes('PATIENT')
      ? DisplayIdClass.PATIENT
      : DisplayIdClass.STAFF
    // 5 retries — same defensive cap as the runtime service.
    for (let attempt = 1; attempt <= 5; attempt++) {
      const value = generateCanonical(cls)
      try {
        await prisma.$transaction(async (tx) => {
          await tx.displayId.create({
            data: {
              value,
              display: formatForDisplay(value),
              class: cls,
              userId: user.id,
              issuedVia: 'backfill',
            },
          })
          await tx.user.update({
            where: { id: user.id },
            data: { displayId: value },
          })
        })
        issued++
        break
      } catch (err: unknown) {
        if (
          typeof err === 'object' &&
          err !== null &&
          'code' in err &&
          (err as { code: unknown }).code === 'P2002' &&
          attempt < 5
        ) {
          continue
        }
        throw err
      }
    }
  }
  console.log(`  ↳ ${issued}/${candidates.length} displayIds issued.`)
}
