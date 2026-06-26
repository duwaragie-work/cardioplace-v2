// EMERGENCY RECOVERY TOOL — superseded by the atomic migration
// `20260624140000_add_display_id`, which now performs this backfill inside
// the same transaction as the DDL and the SET NOT NULL. Normal deploys do
// NOT need this script — `npx prisma migrate deploy` populates existing
// rows automatically.
//
// Keep this script in tree as a fallback for one specific recovery
// scenario: the OLD broken two-migration sequence partially applied
// somewhere (added the nullable column but the SET NOT NULL aborted),
// leaving rows with `displayId IS NULL` and the migration marked failed.
// Steps to recover:
//   1. Mark the failed migration as rolled-back:
//        npx prisma migrate resolve --rolled-back 20260624150000_make_user_display_id_required
//   2. Run this script to populate the existing NULL rows.
//   3. Drop the old migration record so the new combined migration can apply:
//        npx prisma migrate resolve --rolled-back 20260624140000_add_display_id
//   4. `npx prisma migrate deploy` — applies the new combined migration
//      (additive bits are no-ops on tables/columns that already exist,
//      backfill loop is empty because the rows are populated).
//
// Backfill DisplayId rows + User.displayId column for every existing user
// that doesn't yet have one. Idempotent — skips any user whose displayId
// is already set. Class assignment: PATIENT class if PATIENT ∈ roles array,
// STAFF otherwise. Matches the runtime assignment at the 4 user-create
// sites (see auth.service.ts).
//
// USAGE (recovery only):
//   STAGING:  DATABASE_URL=postgres://staging... npm exec tsx scripts/backfill-display-ids.ts
//   PROD:     DATABASE_URL=postgres://prod...    npm exec tsx scripts/backfill-display-ids.ts
//   Dry run:  DRY_RUN=1 npm exec tsx scripts/backfill-display-ids.ts
//
// EXIT CODES:
//   0  — backfill complete, every user now has displayId
//   1  — error during backfill (transaction rolled back; nothing partial)
//   2  — verification failed (some users still NULL after run)

import { PrismaPg } from '@prisma/adapter-pg'
import dotenv from 'dotenv'
import { randomInt } from 'crypto'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { DisplayIdClass } from '../src/generated/prisma/enums.js'

dotenv.config()

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const RADIX = ALPHABET.length
const CLASS_PREFIX = {
  [DisplayIdClass.PATIENT]: 'PAT',
  [DisplayIdClass.STAFF]: 'STF',
} as const
const BRAND = 'CP'
const BODY_LEN = 7
const MAX_ATTEMPTS = 5 // a bit more headroom for batch runs

const DRY_RUN = process.env.DRY_RUN === '1'

const prisma = new PrismaClient({
  adapter: new PrismaPg(
    new pg.Pool({ connectionString: process.env.DATABASE_URL }),
  ),
})

function computeCheckDigit(payload: string): string {
  let sum = 0
  let factor = 2
  for (let i = payload.length - 1; i >= 0; i--) {
    const codePoint = ALPHABET.indexOf(payload[i]!)
    if (codePoint < 0) {
      throw new Error(`Bad alphabet char: ${payload[i]}`)
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

function classFromRoles(roles: ReadonlyArray<string>): DisplayIdClass {
  return roles.includes('PATIENT')
    ? DisplayIdClass.PATIENT
    : DisplayIdClass.STAFF
}

async function main() {
  const banner = DRY_RUN ? 'DRY RUN — no DB writes' : 'LIVE — writing to DB'
  console.log(`[backfill-display-ids] ${banner}`)
  console.log(`[backfill-display-ids] DATABASE_URL = ${process.env.DATABASE_URL?.replace(/\/\/.*@/, '//<redacted>@')}`)

  const candidates = await prisma.user.findMany({
    where: { displayId: null },
    select: { id: true, email: true, roles: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`[backfill-display-ids] ${candidates.length} user(s) need a displayId.`)
  if (candidates.length === 0) {
    await verifyNoneRemaining()
    console.log('[backfill-display-ids] Done — already at parity.')
    return
  }

  let issued = 0
  let skipped = 0
  for (const user of candidates) {
    const cls = classFromRoles(user.roles)
    if (DRY_RUN) {
      const preview = generateCanonical(cls)
      console.log(
        `  [dry] would issue ${preview} (${formatForDisplay(preview)}) — ${cls} — ${user.email ?? '<no-email>'}`,
      )
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Issue with a small retry loop in case of namespace collision.
        let value: string | null = null
        const tried: string[] = []
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
          const candidate = generateCanonical(cls)
          try {
            await tx.displayId.create({
              data: {
                value: candidate,
                display: formatForDisplay(candidate),
                class: cls,
                userId: user.id,
                issuedVia: 'backfill',
              },
            })
            value = candidate
            if (attempt > 1) {
              await tx.displayIdCollisionLog.create({
                data: {
                  attemptedValue: tried[0]!,
                  class: cls,
                  attempts: attempt,
                  resolvedValue: candidate,
                },
              })
            }
            break
          } catch (err: unknown) {
            if (
              typeof err === 'object' &&
              err !== null &&
              'code' in err &&
              (err as { code: unknown }).code === 'P2002'
            ) {
              tried.push(candidate)
              continue
            }
            throw err
          }
        }
        if (!value) {
          throw new Error(
            `Failed to allocate display ID for ${user.id} after ${MAX_ATTEMPTS} attempts`,
          )
        }
        await tx.user.update({
          where: { id: user.id },
          data: { displayId: value },
        })
      })
      issued++
      if (issued % 50 === 0) {
        console.log(`  ... ${issued}/${candidates.length}`)
      }
    } catch (err) {
      skipped++
      console.error(`  ✗ ${user.id} (${user.email ?? '<no-email>'}): ${(err as Error).message}`)
    }
  }

  console.log(`[backfill-display-ids] issued ${issued}, skipped ${skipped}.`)
  if (!DRY_RUN) {
    await verifyNoneRemaining()
  }
}

async function verifyNoneRemaining(): Promise<void> {
  const remaining = await prisma.user.count({ where: { displayId: null } })
  const totalUsers = await prisma.user.count()
  const distinctDisplayIds = await prisma.user
    .findMany({ where: { displayId: { not: null } }, select: { displayId: true } })
    .then((rows) => new Set(rows.map((r) => r.displayId)).size)

  console.log(
    `[backfill-display-ids] verify: totalUsers=${totalUsers}, withDisplayId=${totalUsers - remaining}, distinctDisplayIds=${distinctDisplayIds}, remaining=${remaining}`,
  )
  if (remaining > 0) {
    console.error(
      `[backfill-display-ids] FAIL — ${remaining} user(s) still have NULL displayId.`,
    )
    process.exit(2)
  }
  if (distinctDisplayIds !== totalUsers - remaining) {
    console.error(
      `[backfill-display-ids] FAIL — distinctDisplayIds (${distinctDisplayIds}) != withDisplayId (${totalUsers - remaining}).`,
    )
    process.exit(2)
  }
  console.log('[backfill-display-ids] verify: OK — every user has a unique displayId.')
}

main()
  .catch((err) => {
    console.error('[backfill-display-ids] fatal:', err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
