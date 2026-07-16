// V-06 field encryption backfill (Ruhaim 2026-07-16 addendum).
//
// Populates the *Encrypted sibling columns for existing rows whose plaintext
// was written before V-06 landed. Idempotent: only rows with
// (plaintext IS NOT NULL AND *Encrypted IS NULL) are touched, so a re-run on
// an already-migrated DB is a no-op.
//
// PREREQUISITES (in this exact order):
//   1. Apply migration 20260716120000_v06_add_encrypted_columns (adds the
//      nullable *Encrypted columns; no data mutation).
//   2. Deploy the app code with dual-write wired in (every new row already
//      has *Encrypted populated).
//   3. Run this script — populates *Encrypted on the historical rows the
//      dual-write code never touched.
//
// USAGE:
//   STAGING:  DATABASE_URL=postgres://staging… MFA_ENCRYPTION_KEY=<64hex> \
//             npm exec tsx scripts/v06-backfill-encryption.ts
//   PROD:     DATABASE_URL=postgres://prod…    MFA_ENCRYPTION_KEY=<64hex> \
//             npm exec tsx scripts/v06-backfill-encryption.ts
//   Dry-run:  DRY_RUN=1 npm exec tsx scripts/v06-backfill-encryption.ts
//     (fetches candidate counts + encrypts a sample; no writes.)
//
// AUDIT ROW: every encrypted row writes a `ProfileVerificationLog` entry with
// `changeType: SYSTEM_MIGRATION` and `fieldPath: "<Model>:<id>:<field>:encrypted"`
// so a JCAHO auditor can distinguish this backfill sweep from later human
// edits — matches the audit-then-mutate convention from #85's
// med-canonical backfill migration.
//
// EXIT CODES:
//   0 — backfill complete, no candidate rows remain
//   1 — error during backfill (a batch failed; earlier commits stay)
//   2 — verification failed (rows still have plaintext-but-no-encrypted after run)

import dotenv from 'dotenv'
import { PrismaPg } from '@prisma/adapter-pg'
import pg from 'pg'
import { PrismaClient } from '../src/generated/prisma/client.js'
import {
  createCipheriv,
  randomBytes,
} from 'crypto'

dotenv.config()

// ── Envelope encryption (inlined to avoid pulling the full Nest DI graph
//    into a CLI script). Byte-identical to EncryptionService.encrypt(). ──
const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12
const KEY_PATTERN = /^[0-9a-fA-F]{64}$/

function loadKey(): Buffer {
  const hex = process.env.MFA_ENCRYPTION_KEY
  if (!hex || !KEY_PATTERN.test(hex)) {
    console.error(
      'MFA_ENCRYPTION_KEY must be set to 64 hex characters (32 bytes). ' +
        'Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    )
    process.exit(1)
  }
  return Buffer.from(hex, 'hex')
}

function encrypt(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

// ── Config ────────────────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN === '1'
const BATCH_SIZE = Number(process.env.V06_BATCH_SIZE ?? 500)
// SYSTEM actor id for the audit trail. Kept a literal string so the row is
// obviously a backfill (not a human), matching the SYSTEM sentinel used by
// test-control.setAceContraindicated.
const SYSTEM_ACTOR_ID = 'SYSTEM_V06_BACKFILL'

interface FieldSpec {
  /** Prisma delegate name (e.g. `conversation`, `session`). */
  model: string
  /** Plaintext column name. */
  field: string
  /** Encrypted sibling column name. */
  siblingField: string
  /** Fetch id + plaintext for candidate rows. */
  loadBatch: (prisma: PrismaClient) => Promise<Array<{ id: string; userId: string | null; plaintext: string | string[] | null }>>
  /** Persist encrypted envelope on a single row. */
  update: (prisma: PrismaClient, id: string, encrypted: string) => Promise<void>
  /** Encode plaintext (string arrays go via JSON before encryption). */
  encodeToPlaintext: (value: string | string[]) => string
  /** Optional target for the ProfileVerificationLog user link. Falls back to
   *  the row's userId; null skips the audit row (no anchor available). */
  userIdFromRow?: (row: any) => string | null
}

// The 7 model × 14 field spec set. Kept alphabetical inside each model so the
// PR diff is easy to eyeball against the DDL migration.
const SPECS: FieldSpec[] = [
  // ── Conversation ─────────────────────────────────────────────────────────
  // Session.userId anchors the audit row — Conversation has no direct userId.
  {
    model: 'Conversation',
    field: 'userMessage',
    siblingField: 'userMessageEncrypted',
    loadBatch: async (p) => {
      const rows = await (p as any).$queryRawUnsafe(
        `SELECT c.id, s."userId", c."userMessage" AS plaintext
         FROM "Conversation" c
         JOIN "Session" s ON s.id = c."sessionId"
         WHERE c."userMessage" IS NOT NULL
           AND c."userMessageEncrypted" IS NULL
         LIMIT $1`,
        BATCH_SIZE,
      )
      return rows.map((r: any) => ({ id: r.id, userId: r.userId, plaintext: r.plaintext }))
    },
    update: async (p, id, enc) => {
      await (p as any).$executeRawUnsafe(
        `UPDATE "Conversation" SET "userMessageEncrypted" = $1 WHERE id = $2`,
        enc,
        id,
      )
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    model: 'Conversation',
    field: 'aiSummary',
    siblingField: 'aiSummaryEncrypted',
    loadBatch: async (p) => {
      const rows = await (p as any).$queryRawUnsafe(
        `SELECT c.id, s."userId", c."aiSummary" AS plaintext
         FROM "Conversation" c
         JOIN "Session" s ON s.id = c."sessionId"
         WHERE c."aiSummary" IS NOT NULL
           AND c."aiSummaryEncrypted" IS NULL
         LIMIT $1`,
        BATCH_SIZE,
      )
      return rows.map((r: any) => ({ id: r.id, userId: r.userId, plaintext: r.plaintext }))
    },
    update: async (p, id, enc) => {
      await (p as any).$executeRawUnsafe(
        `UPDATE "Conversation" SET "aiSummaryEncrypted" = $1 WHERE id = $2`,
        enc,
        id,
      )
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── Session ──────────────────────────────────────────────────────────────
  {
    model: 'Session',
    field: 'title',
    siblingField: 'titleEncrypted',
    loadBatch: (p) =>
      p.session.findMany({
        where: { title: { not: null }, titleEncrypted: null },
        select: { id: true, userId: true, title: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.title }))),
    update: async (p, id, enc) => {
      await p.session.update({ where: { id }, data: { titleEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    model: 'Session',
    field: 'summary',
    siblingField: 'summaryEncrypted',
    loadBatch: (p) =>
      p.session.findMany({
        where: { summary: { not: null }, summaryEncrypted: null },
        select: { id: true, userId: true, summary: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.summary }))),
    update: async (p, id, enc) => {
      await p.session.update({ where: { id }, data: { summaryEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── JournalEntry ─────────────────────────────────────────────────────────
  {
    model: 'JournalEntry',
    field: 'notes',
    siblingField: 'notesEncrypted',
    loadBatch: (p) =>
      p.journalEntry.findMany({
        where: { notes: { not: null }, notesEncrypted: null },
        select: { id: true, userId: true, notes: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.notes }))),
    update: async (p, id, enc) => {
      await p.journalEntry.update({ where: { id }, data: { notesEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    model: 'JournalEntry',
    field: 'teachBackAnswer',
    siblingField: 'teachBackAnswerEncrypted',
    loadBatch: (p) =>
      p.journalEntry.findMany({
        where: { teachBackAnswer: { not: null }, teachBackAnswerEncrypted: null },
        select: { id: true, userId: true, teachBackAnswer: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.teachBackAnswer }))),
    update: async (p, id, enc) => {
      await p.journalEntry.update({ where: { id }, data: { teachBackAnswerEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    // otherSymptoms is String[] — a non-empty array is treated as a candidate,
    // an empty array is not (matches the app-level encryptJson pass-through:
    // empty arrays still encrypt at write time, but there's no historical
    // signal on empty-array rows worth backfilling).
    model: 'JournalEntry',
    field: 'otherSymptoms',
    siblingField: 'otherSymptomsEncrypted',
    loadBatch: async (p) => {
      const rows = await (p as any).$queryRawUnsafe(
        `SELECT id, "userId", "otherSymptoms" AS plaintext
         FROM "JournalEntry"
         WHERE array_length("otherSymptoms", 1) > 0
           AND "otherSymptomsEncrypted" IS NULL
         LIMIT $1`,
        BATCH_SIZE,
      )
      return rows.map((r: any) => ({ id: r.id, userId: r.userId, plaintext: r.plaintext }))
    },
    update: async (p, id, enc) => {
      await p.journalEntry.update({ where: { id }, data: { otherSymptomsEncrypted: enc } })
    },
    // Array → JSON string → encrypt. Matches app-level encryptJson.
    encodeToPlaintext: (v) => JSON.stringify(v),
  },
  // ── PatientThreshold ─────────────────────────────────────────────────────
  {
    model: 'PatientThreshold',
    field: 'notes',
    siblingField: 'notesEncrypted',
    loadBatch: (p) =>
      p.patientThreshold.findMany({
        where: { notes: { not: null }, notesEncrypted: null },
        select: { id: true, userId: true, notes: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.notes }))),
    update: async (p, id, enc) => {
      await p.patientThreshold.update({ where: { id }, data: { notesEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── EscalationEvent ──────────────────────────────────────────────────────
  {
    model: 'EscalationEvent',
    field: 'reason',
    siblingField: 'reasonEncrypted',
    loadBatch: (p) =>
      p.escalationEvent.findMany({
        where: { reason: { not: null }, reasonEncrypted: null },
        select: { id: true, userId: true, reason: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.reason }))),
    update: async (p, id, enc) => {
      await p.escalationEvent.update({ where: { id }, data: { reasonEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── ProfileVerificationLog ───────────────────────────────────────────────
  {
    model: 'ProfileVerificationLog',
    field: 'rationale',
    siblingField: 'rationaleEncrypted',
    loadBatch: (p) =>
      p.profileVerificationLog.findMany({
        where: { rationale: { not: null }, rationaleEncrypted: null },
        select: { id: true, userId: true, rationale: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.rationale }))),
    update: async (p, id, enc) => {
      await p.profileVerificationLog.update({ where: { id }, data: { rationaleEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── PatientMedication ────────────────────────────────────────────────────
  {
    model: 'PatientMedication',
    field: 'notes',
    siblingField: 'notesEncrypted',
    loadBatch: (p) =>
      p.patientMedication.findMany({
        where: { notes: { not: null }, notesEncrypted: null },
        select: { id: true, userId: true, notes: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.notes }))),
    update: async (p, id, enc) => {
      await p.patientMedication.update({ where: { id }, data: { notesEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    model: 'PatientMedication',
    field: 'rawInputText',
    siblingField: 'rawInputTextEncrypted',
    loadBatch: (p) =>
      p.patientMedication.findMany({
        where: { rawInputText: { not: null }, rawInputTextEncrypted: null },
        select: { id: true, userId: true, rawInputText: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.rawInputText }))),
    update: async (p, id, enc) => {
      await p.patientMedication.update({ where: { id }, data: { rawInputTextEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  {
    model: 'PatientMedication',
    field: 'plainLanguageDescription',
    siblingField: 'plainLanguageDescriptionEncrypted',
    loadBatch: (p) =>
      p.patientMedication.findMany({
        where: { plainLanguageDescription: { not: null }, plainLanguageDescriptionEncrypted: null },
        select: { id: true, userId: true, plainLanguageDescription: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.plainLanguageDescription }))),
    update: async (p, id, enc) => {
      await p.patientMedication.update({ where: { id }, data: { plainLanguageDescriptionEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
  // ── PatientProfile ───────────────────────────────────────────────────────
  {
    model: 'PatientProfile',
    field: 'aceContraindicationReason',
    siblingField: 'aceContraindicationReasonEncrypted',
    loadBatch: (p) =>
      p.patientProfile.findMany({
        where: {
          aceContraindicationReason: { not: null },
          aceContraindicationReasonEncrypted: null,
        },
        select: { id: true, userId: true, aceContraindicationReason: true },
        take: BATCH_SIZE,
      }).then((rows) => rows.map((r) => ({ id: r.id, userId: r.userId, plaintext: r.aceContraindicationReason }))),
    update: async (p, id, enc) => {
      await p.patientProfile.update({ where: { id }, data: { aceContraindicationReasonEncrypted: enc } })
    },
    encodeToPlaintext: (v) => (typeof v === 'string' ? v : JSON.stringify(v)),
  },
]

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  const key = loadKey()
  // Prisma 7.8 requires an explicit driver adapter for the CLI-side client
  // (the Nest side gets it wired in PrismaModule). Matches backfill-display-ids.ts.
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new pg.Pool({ connectionString: process.env.DATABASE_URL }),
    ),
  })

  let totalEncrypted = 0
  let totalAuditRows = 0
  const perFieldCounts: Record<string, number> = {}

  try {
    for (const spec of SPECS) {
      const label = `${spec.model}.${spec.field}`
      let fieldCount = 0
      let batchIdx = 0

      while (true) {
        const batch = await spec.loadBatch(prisma)
        if (batch.length === 0) break
        batchIdx += 1

        for (const row of batch) {
          if (row.plaintext == null) continue
          const encoded = spec.encodeToPlaintext(row.plaintext)
          const envelope = encrypt(key, encoded)

          if (DRY_RUN) {
            fieldCount += 1
            continue
          }

          await prisma.$transaction(async (tx) => {
            // Cast — the interactive-tx PrismaClient shape is a superset; the
            // spec.update was typed against the top-level client for clarity.
            await spec.update(tx as unknown as PrismaClient, row.id, envelope)
            if (row.userId) {
              await tx.profileVerificationLog.create({
                data: {
                  userId: row.userId,
                  fieldPath: `${spec.model}:${row.id}:${spec.field}:encrypted`,
                  previousValue: null,
                  newValue: null,
                  changedBy: SYSTEM_ACTOR_ID,
                  changedByRole: 'SYSTEM_ACTOR',
                  changeType: 'SYSTEM_MIGRATION',
                  rationale: `V-06 backfill (encrypted ${spec.model}.${spec.field})`,
                  rationaleEncrypted: encrypt(
                    key,
                    `V-06 backfill (encrypted ${spec.model}.${spec.field})`,
                  ),
                },
              })
              totalAuditRows += 1
            }
          })
          fieldCount += 1
        }

        console.log(
          `[${label}] batch ${batchIdx}: ${batch.length} rows encrypted ` +
            `(cumulative for this field: ${fieldCount})`,
        )

        // Short-circuit if the batch was smaller than requested — nothing left.
        if (batch.length < BATCH_SIZE) break
      }

      perFieldCounts[label] = fieldCount
      totalEncrypted += fieldCount
      console.log(`[${label}] complete — ${fieldCount} rows encrypted`)
    }

    console.log('\n─── Summary ───')
    for (const [label, count] of Object.entries(perFieldCounts)) {
      console.log(`  ${label.padEnd(52)} ${count.toString().padStart(6)}`)
    }
    console.log(`  ${'TOTAL rows encrypted'.padEnd(52)} ${totalEncrypted.toString().padStart(6)}`)
    console.log(`  ${'TOTAL SYSTEM_MIGRATION audit rows'.padEnd(52)} ${totalAuditRows.toString().padStart(6)}`)
    if (DRY_RUN) {
      console.log('\n(DRY_RUN=1 — no writes were made)')
    }

    // Verification: re-count candidates. Anything > 0 means a batch failed
    // silently mid-run (should not happen; the tx would have thrown).
    if (!DRY_RUN) {
      let leftover = 0
      for (const spec of SPECS) {
        const remaining = await spec.loadBatch(prisma)
        leftover += remaining.length
        if (remaining.length > 0) {
          console.error(
            `[verify] ${spec.model}.${spec.field}: ${remaining.length} candidate rows still remain`,
          )
        }
      }
      if (leftover > 0) {
        console.error(`\n${leftover} candidate rows still remain — verification FAILED.`)
        process.exit(2)
      }
      console.log('\nVerification: no candidate rows remain. Backfill complete.')
    }
  } catch (err) {
    console.error('Backfill failed:', err)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

main()
