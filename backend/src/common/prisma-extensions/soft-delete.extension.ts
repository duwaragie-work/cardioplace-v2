import { Prisma } from '../../generated/prisma/client.js'

/**
 * Soft-delete read filter for `JournalEntry` (HIPAA L5, Duwaragie sign-off
 * 2026-07-06). A deleted BP reading is stamped with `deletedAt` instead of being
 * hard-deleted, so its fired `DeviationAlert` + escalations + notifications
 * survive (the FK `onDelete: Cascade` never fires) — the clinically-conservative
 * "amend, don't destroy" approach.
 *
 * This ONE extension injects `deletedAt: null` into every top-level JournalEntry
 * READ so deleted rows silently drop out of every list / session average /
 * report — instead of hand-editing the ~210 query sites (a single missed site
 * would resurface a "deleted" reading in a clinical window/average). One place.
 *
 * NOT filtered — deliberately:
 *   • writes (create/update/upsert) + deletes — the soft-delete `update` itself,
 *     and any future restore / hard-purge path, must still target deleted rows.
 *   • findUnique / findUniqueOrThrow — Prisma only allows unique fields in their
 *     `where`, so a `deletedAt` filter would be invalid. The sole caller
 *     (SessionAveragerService anchor lookup) uses the row for METADATA only
 *     (sessionId, delayBand, window bounds); the averaged vitals come from the
 *     findMany sibling load, which IS filtered here.
 *   • nested relation loads (e.g. `DeviationAlert.include.journalEntry`) —
 *     Prisma extensions don't intercept these, and that is intended: a surviving
 *     alert's `journalEntry` join must still resolve to its (now soft-deleted)
 *     reading so the alert still renders. Clinical aggregates never read
 *     JournalEntry via a nested include — reports + rule engine + session
 *     averager all use top-level `journalEntry.findMany/count/aggregate`.
 *
 * A caller that must SEE deleted rows (restore / purge) passes an explicit
 * `deletedAt` in `where` — it wins via spread order.
 */
export const SOFT_DELETE_FILTERED_OPS: ReadonlySet<string> = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
])

/**
 * Pure arg transform — injects `deletedAt: null` into the `where` of a filtered
 * read op, leaving all other ops (and any caller-supplied `deletedAt`)
 * untouched. Exported so the filter semantics are unit-testable without a live
 * Prisma client.
 */
export function withNotDeleted(operation: string, args: unknown): unknown {
  if (!SOFT_DELETE_FILTERED_OPS.has(operation)) return args
  const a = (args ?? {}) as { where?: Record<string, unknown> }
  // Default `deletedAt: null` first so an explicit caller value (restore/purge)
  // wins. Top-level `where` fields AND together, so this composes with any
  // existing userId / measuredAt / OR filter.
  return { ...a, where: { deletedAt: null, ...(a.where ?? {}) } }
}

export function softDeleteJournalEntryExtension() {
  return Prisma.defineExtension({
    name: 'soft-delete-journal-entry',
    query: {
      journalEntry: {
        $allOperations({ operation, args, query }) {
          return query(withNotDeleted(operation, args) as never)
        },
      },
    },
  })
}
