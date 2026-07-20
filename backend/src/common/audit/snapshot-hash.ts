import { createHash } from 'node:crypto'

/**
 * V-06 audit-log leak (2026-07-17) — §164.312(c) integrity for narrowed audit
 * snapshots.
 *
 * THE PROBLEM. `ProfileVerificationLog.previousValue` / `newValue` are
 * UNENCRYPTED `Json` columns that were receiving whole-row snapshots — which
 * meant the free-text V-06 encrypts (`PatientMedication.notes`,
 * `rawInputText`, `plainLanguageDescription`; `JournalEntry.notes` /
 * `otherSymptoms`; `PatientThreshold.notes`) was ALSO written to the audit log
 * verbatim in plaintext, alongside its own ciphertext sibling. Once V-06 phase
 * 3 drops the plaintext columns, the audit log becomes the last plaintext copy
 * standing and the control nets to zero.
 *
 * THE FIX + WHY A HASH. The snapshots are narrowed to the structured fields
 * their readers actually use. That walks back N5's 2026-07-09 widening, whose
 * stated rationale was §164.312(c) reconstructability — so the integrity
 * guarantee is preserved by a digest instead of by retained plaintext:
 *
 *   • §164.312(c)(1) requires protecting ePHI from improper alteration, and its
 *     implementation spec is "electronic mechanisms to CORROBORATE that ePHI has
 *     not been altered" — NIST SP 800-66r2 §5.3.3 lists digital signatures as
 *     the mechanism. A hash corroborates; retained plaintext does not (an
 *     attacker who can edit the row can edit the copy too).
 *   • This is the codebase's own established pattern: `EmailDisclosureLog`
 *     carries a SHA-256 `bodyHash` precisely to "prove what content went out
 *     WITHOUT duplicating PHI at rest" (email_disclosure_log.prisma:54-56), and
 *     `AuditException.evidence` is contractually "NEVER patient names / DOBs /
 *     narrative".
 *
 * So the hash is a strictly better §164.312(c) control than the plaintext it
 * replaces, and the content stays reconstructable from the source row's
 * encrypted columns.
 *
 * Stored as `_snapshotHash` INSIDE the snapshot object rather than as a new
 * column, deliberately: it needs no migration, it travels with the value it
 * attests, and — critically — it only ever touches OBJECT-valued rows. The
 * scalar-valued rows (`newValue: 'ENROLLED'`, `'HFREF'`) that
 * `practice/enrollment-helpers.ts` and `provider/threshold-need.ts` match with
 * Prisma Json EQUALITY filters are left completely untouched. Reshaping those
 * would silently make every enrolled patient read as never-enrolled and break
 * escalation dispatch.
 */

/**
 * Deterministic JSON: keys sorted at every level, so the digest is stable
 * across runs and across V8 property-insertion order. Without this the hash
 * would be unverifiable — the same record could produce two different digests.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

  return `{${entries
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    .join(',')}}`
}

/**
 * SHA-256 (hex) over the FULL pre-narrow record. Feed this the complete row,
 * not the narrowed snapshot — the point is to attest what the record actually
 * was at the moment of the change.
 */
export function snapshotHash(fullRecord: unknown): string {
  return createHash('sha256').update(stableStringify(fullRecord)).digest('hex')
}

/** Key under which the digest is stored inside an audit snapshot object. */
export const SNAPSHOT_HASH_KEY = '_snapshotHash'

/**
 * Audit-safe stand-in for a single free-text field value.
 *
 * Used by the per-field audit path (`fieldPath: 'medication:<id>.notes'`),
 * where the raw string was previously written straight into the unencrypted
 * `Json` column. The row still records THAT the field changed and WHEN and BY
 * WHOM — `fieldPath` already names the field — and the digest proves what it
 * changed to without storing it. The content itself remains on the source
 * row's `*Encrypted` sibling.
 *
 * Returns `null` for null/undefined so "was set" vs "was cleared" stays
 * distinguishable in the timeline.
 */
export function redactedFieldValue(value: unknown): Record<string, string> | null {
  if (value == null) return null
  return { _redacted: 'free-text', [SNAPSHOT_HASH_KEY]: snapshotHash(value) }
}
