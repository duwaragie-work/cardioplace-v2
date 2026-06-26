// Test-only displayId generator. Produces a canonical CP-form ID that
// validates against the production isValidCheckDigit (same alphabet, same
// Luhn-mod-32 algorithm, same class derivation). Used by e2e specs that
// call `prisma.user.create({ data: { ... } })` directly — those calls
// would otherwise hit a NOT NULL violation on User.displayId now that
// migration 20260624140000_add_display_id tightens the constraint.
//
// Does NOT insert into the DisplayId ledger — tests don't need that
// (User.displayId isn't an FK to DisplayId; the unique constraint on
// User is just an index). Each call returns a fresh canonical ID.
//
// Production user-create paths still go through DisplayIdService.issueForCreate
// at backend/src/users/display-id.service.ts — that's the source of truth
// for runtime issuance + ledger writes + collision retries + audit logging.

import { randomBytes } from 'node:crypto'
import { computeCheckDigit } from '../../src/users/display-id.service.js'

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function generateTestDisplayId(roles: ReadonlyArray<string>): string {
  const prefix = roles.includes('PATIENT') ? 'PAT' : 'STF'
  const bytes = randomBytes(7)
  let body = ''
  for (let i = 0; i < 7; i++) body += ALPHABET[bytes[i]! % 32]
  return 'CP' + prefix + body + computeCheckDigit(body)
}
