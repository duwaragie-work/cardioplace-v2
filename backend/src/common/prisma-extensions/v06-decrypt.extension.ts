import { Prisma } from '../../generated/prisma/client.js'

/**
 * V-06 phase 2 — READ path for the field-level encryption at rest
 * (HIPAA §164.312(a)(2)(iv), Ruhaim addendum 2026-07-16).
 *
 * Phase 1 shipped dual-write only: ~60 call sites write `<field>Encrypted`
 * alongside the plaintext `<field>`. Nothing ever decrypted, so the control
 * delivered ZERO protection — a DB dump still yielded every clinical free-text
 * field in plaintext, and the ciphertext was decorative. This extension makes
 * the ciphertext the source of truth on the way out, which is the prerequisite
 * for phase 3 dropping the plaintext columns.
 *
 * WHY AN EXTENSION AND NOT ~165 CALL SITES.
 * Same argument the soft-delete extension already makes for JournalEntry: one
 * missed site is a silent clinical defect. Here a missed site would keep
 * serving the plaintext column, so phase 3's DROP would turn it into `null` —
 * a `notes` field silently emptying to null can hide "chest pain since
 * Tuesday". One interception point, or none.
 *
 * WHY KEYED ON THE SIBLING NAME, NOT THE MODEL.
 * Prisma `query` extensions do NOT intercept nested relation loads (the
 * soft-delete extension documents this: `DeviationAlert.include.journalEntry`
 * never reaches a `query.journalEntry` hook). A per-model hook would therefore
 * decrypt a top-level `journalEntry.findMany` but silently miss the same row
 * loaded through an include. So we walk the returned tree structurally: ANY
 * object carrying a known `<field>Encrypted` key gets `<field>` resolved from
 * it, at any depth, under any parent. `notesEncrypted` means the same thing on
 * JournalEntry, PatientMedication and PatientThreshold, so one rule covers all
 * three.
 *
 * The allowlist is what keeps this safe: `TotpCredential.secretEncrypted` is
 * NOT a V-06 dual-write pair (there is no `secret` plaintext column), so it is
 * deliberately absent below — synthesising a `secret` key onto that model would
 * invent a field the schema does not have.
 *
 * DECRYPT-FAILURE POLICY (clinical safety, not just correctness).
 *   • plaintext still present (the bake window) → keep plaintext, warn loudly.
 *     The value is identical anyway, so a bad key degrades to "no worse than
 *     phase 1" rather than taking reads down.
 *   • plaintext absent (post phase-3) → RETHROW. Silently returning null would
 *     hide clinical free-text from a clinician, which is strictly worse than a
 *     loud failure.
 */

/**
 * PHASE 3 NOTE (read before dropping the plaintext columns).
 * This extension keeps phase 3's READ side working unchanged — once `notes` is
 * gone from the table, the walk below simply synthesises it from
 * `notesEncrypted` instead of overwriting it, and the ~156 read sites never
 * notice. But it does NOT carry the TYPE: dropping the column removes `notes`
 * from the generated Prisma types, so every read site stops compiling. Phase 3
 * therefore also needs a `result` component (`needs: { notesEncrypted: true }`,
 * `compute(...)`) to re-add each field as a computed one. The `query` hook here
 * supplies the value; only `result` can supply the type.
 *
 * Writes are the opposite problem and have no such escape: `data: { notes }`
 * targets a column that no longer exists, so all ~60 dual-write sites must drop
 * the plaintext key in the SAME deploy as the migration. For
 * `Conversation.userMessage`/`aiSummary` that is not merely advisable but
 * forced — they are NOT NULL, so "stop writing plaintext" and "drop the column"
 * cannot be separated into two deploys.
 *
 * Full gate order lives in docs/V06_PHASE3_RUNBOOK.md.
 */

/** How a sibling's ciphertext decodes back into its plaintext column. */
export type V06Kind = 'text' | 'json'

export interface V06Sibling {
  /** The plaintext column this ciphertext resolves into. */
  readonly plaintext: string
  readonly kind: V06Kind
}

/**
 * `<field>Encrypted` → the plaintext column it feeds. Twelve unique sibling
 * names covering the fourteen V-06 columns (`notesEncrypted` appears on three
 * models and means the same thing on each).
 *
 * Kept in sync with the spec list in `scripts/v06-backfill-encryption.ts` and
 * FREE_TEXT_KEYS in `scripts/v06-scrub-audit-snapshots.ts`.
 */
export const V06_SIBLINGS: Readonly<Record<string, V06Sibling>> = {
  userMessageEncrypted: { plaintext: 'userMessage', kind: 'text' },
  aiSummaryEncrypted: { plaintext: 'aiSummary', kind: 'text' },
  titleEncrypted: { plaintext: 'title', kind: 'text' },
  summaryEncrypted: { plaintext: 'summary', kind: 'text' },
  otherSymptomsEncrypted: { plaintext: 'otherSymptoms', kind: 'json' },
  teachBackAnswerEncrypted: { plaintext: 'teachBackAnswer', kind: 'text' },
  notesEncrypted: { plaintext: 'notes', kind: 'text' },
  reasonEncrypted: { plaintext: 'reason', kind: 'text' },
  rawInputTextEncrypted: { plaintext: 'rawInputText', kind: 'text' },
  plainLanguageDescriptionEncrypted: {
    plaintext: 'plainLanguageDescription',
    kind: 'text',
  },
  aceContraindicationReasonEncrypted: {
    plaintext: 'aceContraindicationReason',
    kind: 'text',
  },
  rationaleEncrypted: { plaintext: 'rationale', kind: 'text' },
}

/**
 * Per-model plaintext → sibling, used ONLY for `select` injection. This one has
 * to be model-aware: a bare `select: { summary: true }` gives us no sibling to
 * decrypt from, but blindly injecting `summaryEncrypted` on a model that has no
 * such column makes Prisma throw. So injection is restricted to the eight
 * models that actually carry the pairs.
 *
 * Keys are the Prisma client accessors (camelCase model names).
 */
export const V06_SELECTABLE: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  conversation: {
    userMessage: 'userMessageEncrypted',
    aiSummary: 'aiSummaryEncrypted',
  },
  session: { title: 'titleEncrypted', summary: 'summaryEncrypted' },
  journalEntry: {
    otherSymptoms: 'otherSymptomsEncrypted',
    teachBackAnswer: 'teachBackAnswerEncrypted',
    notes: 'notesEncrypted',
  },
  escalationEvent: { reason: 'reasonEncrypted' },
  patientMedication: {
    rawInputText: 'rawInputTextEncrypted',
    notes: 'notesEncrypted',
    plainLanguageDescription: 'plainLanguageDescriptionEncrypted',
  },
  patientProfile: {
    aceContraindicationReason: 'aceContraindicationReasonEncrypted',
  },
  patientThreshold: { notes: 'notesEncrypted' },
  profileVerificationLog: { rationale: 'rationaleEncrypted' },
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * Inject the encrypted sibling into an explicit `select` so the decrypt walk
 * has something to work with.
 *
 * Without this, `session.findMany({ select: { summary: true } })` (five such
 * sites today, all Session.title/summary) would return the plaintext column
 * untouched — fine during the bake window, but phase 3 drops that column and
 * the read would break. Returns the sibling keys that were added, so the caller
 * can strip them back out: the caller asked for `{ summary }` and its TS type
 * says `{ summary }`, so returning ciphertext it never selected would both
 * violate the type and push ciphertext into response payloads.
 *
 * Pure — exported for unit tests, mirroring `withNotDeleted`.
 */
export function injectSiblingSelect(
  model: string,
  args: unknown,
): { args: unknown; injected: string[] } {
  const map = V06_SELECTABLE[model]
  if (!map || !isPlainObject(args)) return { args, injected: [] }

  const select = args.select
  // No `select` → Prisma returns all scalars, siblings included. Nothing to do.
  // (`include` doesn't restrict scalars either, so it needs no injection.)
  if (!isPlainObject(select)) return { args, injected: [] }

  const injected: string[] = []
  const nextSelect: Record<string, unknown> = { ...select }
  for (const [plaintext, sibling] of Object.entries(map)) {
    if (select[plaintext] === true && !(sibling in select)) {
      nextSelect[sibling] = true
      injected.push(sibling)
    }
  }
  if (injected.length === 0) return { args, injected: [] }
  return { args: { ...args, select: nextSelect }, injected }
}

/**
 * Walk a Prisma result and resolve every known ciphertext sibling into its
 * plaintext field, in place of whatever the plaintext column held.
 *
 * Handles the whole shape surface: `null` (findFirst miss), numbers (`count`),
 * arrays (`findMany`, `groupBy`), nested relations (`include`), and aggregate
 * objects (which carry none of these keys and pass straight through).
 *
 * `Date`/`Buffer`/`Decimal` instances are left alone — recursing into them
 * would be pointless and could mangle class internals.
 *
 * Pure apart from the injected `decrypt`/`onWarn` — exported for unit tests.
 */
export function decryptTree(
  value: unknown,
  decrypt: (envelope: string) => string,
  opts: { strip?: readonly string[]; onWarn?: (sibling: string, err: unknown) => void } = {},
): unknown {
  const { strip = [], onWarn } = opts

  if (Array.isArray(value)) {
    return value.map((v) => decryptTree(v, decrypt, opts))
  }
  if (!isPlainObject(value)) return value
  // Prisma hands back class instances for some scalars; don't walk into them.
  if (value.constructor !== Object) return value

  const out: Record<string, unknown> = { ...value }

  for (const [key, spec] of Object.entries(V06_SIBLINGS)) {
    if (!(key in out)) continue
    const envelope = out[key]

    if (typeof envelope === 'string') {
      try {
        const plain = decrypt(envelope)
        out[spec.plaintext] =
          spec.kind === 'json' ? (JSON.parse(plain) as unknown) : plain
      } catch (err) {
        // Bake window: plaintext is still there and holds the same bytes, so
        // degrade to it rather than take the read down.
        if (spec.plaintext in out) {
          onWarn?.(key, err)
        } else {
          // Post phase-3: no fallback exists. Failing loudly beats silently
          // serving `undefined` for a clinical note.
          throw err
        }
      }
    } else if (envelope === null && spec.kind === 'json' && !(spec.plaintext in out)) {
      // Backfill skips empty arrays (v06-backfill-encryption.ts:216-219) so an
      // always-empty `otherSymptoms` row has a NULL sibling forever, while new
      // rows get an `encryptJson([])` envelope that decrypts to "[]". Both must
      // read as []. Only synthesise once the plaintext column is gone; while it
      // exists it is already the right answer.
      out[spec.plaintext] = []
    }

    if (strip.includes(key)) delete out[key]
  }

  // Recurse into relations (include / nested select).
  for (const [key, child] of Object.entries(out)) {
    if (child !== null && typeof child === 'object') {
      out[key] = decryptTree(child, decrypt, { onWarn })
    }
  }

  return out
}

/**
 * Operations whose result is a scalar or a write-count and can never carry a
 * decryptable record. Skipping them keeps the walk off the hot path.
 */
const NON_RECORD_OPS: ReadonlySet<string> = new Set([
  'count',
  'aggregate',
  'groupBy',
  'executeRaw',
  'queryRaw',
  'createMany',
  'updateMany',
  'deleteMany',
])

export function v06DecryptExtension(
  decrypt: (envelope: string) => string,
  onWarn?: (sibling: string, err: unknown) => void,
) {
  return Prisma.defineExtension({
    name: 'v06-decrypt',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (NON_RECORD_OPS.has(operation)) return query(args)

          // Prisma passes the model as its PascalCase name; the maps above are
          // keyed by the client accessor (camelCase), matching how call sites
          // spell it.
          const accessor = model ? model[0].toLowerCase() + model.slice(1) : ''
          const { args: nextArgs, injected } = injectSiblingSelect(accessor, args)
          const result = await query(nextArgs as never)
          return decryptTree(result, decrypt, { strip: injected, onWarn })
        },
      },
    },
  })
}
