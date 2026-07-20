/**
 * V-06 audit-log scrub — remove historical plaintext PHI from
 * ProfileVerificationLog.previousValue / newValue.
 *
 * WHY THIS EXISTS (and why phase 3 must not ship without it).
 * V-06 encrypts high-sensitivity free-text into `*Encrypted` sibling columns.
 * But the audit serializers were ALSO writing those exact bytes, verbatim and
 * in plaintext, into the UNENCRYPTED `Json` columns of ProfileVerificationLog:
 *
 *   • intake.service.ts serializeMedication  → notes / rawInputText /
 *     plainLanguageDescription (and, once the siblings existed, their
 *     ciphertext right next to the plaintext — a known-plaintext pair per row)
 *   • intake.service.ts per-field audit rows → the bare free-text string as the
 *     whole Json value (fieldPath 'medication:<id>.notes')
 *   • daily_journal.service.ts serializeForAudit → notes + freeform otherSymptoms
 *   • practice/threshold.service.ts thresholdSnapshot → notes
 *
 * The 2026-07-17 code change stops the bleed, but it is WRITE-PATH ONLY. Every
 * row already written keeps its plaintext — and would survive V-06 phase 3
 * dropping the plaintext source columns, at which point the audit log becomes
 * the last plaintext copy standing and the whole control nets to zero. This
 * script closes that.
 *
 * INTEGRITY (§164.312(c)). Rows are not merely truncated: before stripping, the
 * full pre-scrub object is hashed and stored as `_snapshotHash`, matching what
 * the live serializers now emit. So a scrubbed historical row still corroborates
 * what it was — the same guarantee EmailDisclosureLog.bodyHash provides "without
 * duplicating PHI at rest". Rows scrubbed here also get `_scrubbedAt` so the
 * remediation itself is auditable.
 *
 * WHAT IS DELIBERATELY NOT TOUCHED.
 *   • SCALAR-valued rows. `practice/enrollment-helpers.ts` matches
 *     `{ newValue: { equals: 'ENROLLED' } }` and `provider/threshold-need.ts`
 *     compares against `'HFREF'` — Prisma Json EQUALITY filters. Reshaping those
 *     would silently make every enrolled patient read as never-enrolled and
 *     break escalation dispatch. We only ever rewrite `object`-typed values.
 *   • `rationale` / `rationaleEncrypted`. Already a V-06 dual-write pair; the
 *     plaintext column is dropped by phase 3 like any other.
 *   • Structured clinical fields (BP, drugClass, enums). Not free-text, and the
 *     admin Timeline reads them.
 *
 * Usage:
 *   Dry-run:  DRY_RUN=1 npm exec tsx scripts/v06-scrub-audit-snapshots.ts
 *             (counts affected rows, writes nothing)
 *   Live:     npm exec tsx scripts/v06-scrub-audit-snapshots.ts
 *
 * Idempotent: a scrubbed row no longer contains any free-text key, so it stops
 * matching the candidate filter. Safe to re-run.
 */
// dotenv MUST be loaded before the pg.Pool is constructed below: without it
// DATABASE_URL is undefined and node-postgres silently falls back to
// localhost:5432, so the script dies with ECONNREFUSED against a DB that was
// never the target. Matches v06-backfill-encryption.ts, which does the same.
// (Omitted on the first cut — this script had never been run.)
import dotenv from 'dotenv'
import { PrismaClient } from '../src/generated/prisma/client.js'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { createHash } from 'node:crypto'

dotenv.config()

const DRY_RUN = process.env.DRY_RUN === '1'
const BATCH_SIZE = Number(process.env.V06_SCRUB_BATCH_SIZE ?? 500)

/**
 * Free-text keys to remove from object-valued snapshots — the V-06-encrypted
 * columns, plus their ciphertext siblings (the old `...med` spread emitted
 * both, which is strictly worse than plaintext alone) and the freeform
 * `otherSymptoms` array from the journal serializer.
 *
 * Kept in sync with FREE_TEXT_MED_FIELDS (intake.service.ts) and the V-06 spec
 * set (v06-backfill-encryption.ts).
 */
const FREE_TEXT_KEYS = [
  'notes',
  'notesEncrypted',
  'rawInputText',
  'rawInputTextEncrypted',
  'plainLanguageDescription',
  'plainLanguageDescriptionEncrypted',
  'otherSymptoms',
  'teachBackAnswer',
  'teachBackAnswerEncrypted',
  'pillImageUrl',
] as const

/** fieldPath suffixes whose Json value is a BARE free-text string. */
const FREE_TEXT_FIELD_SUFFIXES = ['.notes', '.rawInputText', '.plainLanguageDescription']

// ── hashing — must match src/common/audit/snapshot-hash.ts byte for byte ──────
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`
}
function snapshotHash(v: unknown): string {
  return createHash('sha256').update(stableStringify(v)).digest('hex')
}

type Json = unknown

function isPlainObject(v: Json): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function hasFreeText(v: Json): boolean {
  return isPlainObject(v) && FREE_TEXT_KEYS.some((k) => k in v)
}

/**
 * Scrub one Json value. Returns the new value, or `undefined` when nothing
 * needed changing (so we can skip the write).
 */
function scrubValue(value: Json, fieldPath: string): Json | undefined {
  // Bare free-text string under a per-field row → replace with the same marker
  // shape the live code now writes (redactedFieldValue).
  const isFreeTextField = FREE_TEXT_FIELD_SUFFIXES.some((s) => fieldPath.endsWith(s))
  if (isFreeTextField && typeof value === 'string') {
    return { _redacted: 'free-text', _snapshotHash: snapshotHash(value), _scrubbedAt: new Date().toISOString() }
  }

  // Object snapshot → drop the free-text keys, attest the original.
  if (hasFreeText(value)) {
    const original = value as Record<string, unknown>
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(original)) {
      if ((FREE_TEXT_KEYS as readonly string[]).includes(k)) continue
      cleaned[k] = v
    }
    // Preserve the "did they report an off-catalog symptom?" signal the live
    // journal serializer now emits, so scrubbed and new rows read alike.
    if ('otherSymptoms' in original) {
      cleaned.otherSymptomsCount = Array.isArray(original.otherSymptoms)
        ? original.otherSymptoms.length
        : 0
    }
    cleaned._snapshotHash = snapshotHash(original)
    cleaned._scrubbedAt = new Date().toISOString()
    return cleaned
  }

  // Scalars ('ENROLLED', 'HFREF'), arrays, nulls, and already-clean objects.
  return undefined
}

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(new pg.Pool({ connectionString: process.env.DATABASE_URL })),
  })

  console.log(
    `V-06 audit scrub — ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}, batch=${BATCH_SIZE}`,
  )

  let scanned = 0
  let scrubbed = 0
  // Advance the offset in BOTH modes — this is a single ordered pass over every
  // row, not a drain of a shrinking candidate set.
  //
  // The first cut only advanced under DRY_RUN, reasoning that "a scrubbed row
  // no longer contains a free-text key and drops out of the scan naturally".
  // That is true of the v06 BACKFILL, whose loadBatch filters
  // `plaintext IS NOT NULL AND <sibling> IS NULL` — so a written row really
  // does leave the result set. It is false HERE: the findMany below has no
  // WHERE clause at all, it selects every ProfileVerificationLog row. With skip
  // pinned at 0 the same first BATCH_SIZE rows came back forever, `length` never
  // fell below BATCH_SIZE, neither break could fire, and the live run spun until
  // it was killed (observed 2026-07-17). The reasoning was borrowed from the
  // backfill without its precondition.
  let skip = 0

  for (;;) {
    const batch = await prisma.profileVerificationLog.findMany({
      select: { id: true, fieldPath: true, previousValue: true, newValue: true },
      orderBy: { createdAt: 'asc' },
      take: BATCH_SIZE,
      skip,
    })
    if (batch.length === 0) break
    scanned += batch.length

    for (const row of batch) {
      const nextPrev = scrubValue(row.previousValue as Json, row.fieldPath)
      const nextNew = scrubValue(row.newValue as Json, row.fieldPath)
      if (nextPrev === undefined && nextNew === undefined) continue

      scrubbed += 1
      if (DRY_RUN) continue

      await prisma.profileVerificationLog.update({
        where: { id: row.id },
        data: {
          ...(nextPrev !== undefined
            ? { previousValue: nextPrev as never }
            : {}),
          ...(nextNew !== undefined ? { newValue: nextNew as never } : {}),
        },
      })
    }

    skip += batch.length
    if (batch.length < BATCH_SIZE) break

    console.log(`  … scanned=${scanned} scrubbed=${scrubbed}`)
  }

  console.log(`\nScanned ${scanned} rows; ${scrubbed} ${DRY_RUN ? 'would be' : ''} scrubbed.`)

  if (!DRY_RUN) {
    // Verification pass — nothing may remain that carries free text.
    const remaining = await prisma.profileVerificationLog.findMany({
      select: { id: true, fieldPath: true, previousValue: true, newValue: true },
    })
    const leaks = remaining.filter(
      (r) =>
        hasFreeText(r.previousValue as Json) ||
        hasFreeText(r.newValue as Json) ||
        (FREE_TEXT_FIELD_SUFFIXES.some((s) => r.fieldPath.endsWith(s)) &&
          (typeof r.previousValue === 'string' || typeof r.newValue === 'string')),
    )
    if (leaks.length > 0) {
      console.error(
        `\n✗ VERIFICATION FAILED — ${leaks.length} row(s) still carry free text, e.g. ${leaks
          .slice(0, 5)
          .map((l) => l.id)
          .join(', ')}`,
      )
      await prisma.$disconnect()
      process.exit(2)
    }
    console.log('✓ Verification passed — no plaintext free-text remains in the audit Json.')
  }

  await prisma.$disconnect()
}

main().catch(async (err) => {
  console.error('V-06 audit scrub failed:', err)
  process.exit(1)
})
