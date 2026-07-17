// System-principal registry (audit, 2026-07-03; HIPAA §164.312(b),
// Humaira Audit-Controls Activity 1 item 3).
//
// One disabled User row per automated writer (7 crons + 1 engine handler) so
// every cron/engine PHI write attributes to a real, joinable User id instead of
// null. These rows can NEVER sign in — auth.service hard-refuses accountStatus
// SYSTEM on every path. They carry roles: [] (NOT a new UserRole value) so they
// stay inert in every role predicate / authz surface, and are filtered out of
// staff-list queries. displayId is minted through the normal ledger path with a
// dedicated SYSTEM class (CP-SYS-XXXXXXX-C).
//
// The list below is DERIVED from SYSTEM_PRINCIPAL_LABELS in
// src/common/cls/system-principals.ts — it is deliberately not a second copy.
// A seed row is load-bearing: without it `resolveCronActorId` returns null and
// the writer silently reverts to senderPrincipal='system-principal-unknown'
// (the N-2 bug) with every test still passing. Deriving means a new principal
// cannot be added to the runtime allowlist without also being seeded here.
//
// Note the sets are the same by construction, including the exclusions: the
// N3 (2026-07-13) gap-alert principal is absent from the allowlist, so it is
// not re-seeded — its existing DB row stays put (the upsert never deletes), and
// historical AccessLog rows joined against that principal id remain resolvable.
import { AccountStatus, DisplayIdClass } from '../../src/generated/prisma/enums.js'
import {
  SYSTEM_PRINCIPAL_LABELS,
  SYSTEM_PRINCIPAL_DISPLAY_NAMES,
} from '../../src/common/cls/system-principals.js'
import {
  getOrGenerateDisplayIdForEmail,
  formatForDisplay,
} from './display-ids.js'
import { prisma } from './helpers.js'

const SYSTEM_PRINCIPALS = SYSTEM_PRINCIPAL_LABELS.map((label) => ({
  label,
  displayName: SYSTEM_PRINCIPAL_DISPLAY_NAMES[label],
}))

export function systemPrincipalEmail(label: string): string {
  return `system-${label}@internal.cardioplace.test`
}

/**
 * Idempotent. Runs unconditionally (every environment) — crons need these rows
 * to resolve their actor at runtime, so they are NOT gated behind
 * SEED_TEST_FIXTURES. Re-running never rotates a displayId (upsert update: {}).
 */
export async function seedSystemPrincipals() {
  for (const p of SYSTEM_PRINCIPALS) {
    const email = systemPrincipalEmail(p.label)
    const displayId = await getOrGenerateDisplayIdForEmail(
      prisma,
      email,
      DisplayIdClass.SYSTEM,
    )

    const user = await prisma.user.upsert({
      where: { email },
      // No update on re-seed — never rotate the displayId or flip status.
      update: {},
      create: {
        email,
        name: `System · ${p.displayName}`,
        // roles: [] — deliberately NOT a new UserRole. accountStatus SYSTEM is
        // the only marker; empty roles keep the principal inert in every gate.
        roles: [],
        accountStatus: AccountStatus.SYSTEM,
        pwdhash: null,
        isVerified: true,
        onboardingStatus: 'COMPLETED',
        displayId,
      },
      select: { id: true, displayId: true },
    })

    // Write the ledger row ourselves with the SYSTEM class. seedDisplayIds()
    // classifies by role (PATIENT vs STAFF) and would mislabel a roles:[] row,
    // so we own the ledger entry here; seedDisplayIds then skips it (it already
    // has a ledger row).
    await prisma.displayId.upsert({
      where: { value: user.displayId },
      update: {},
      create: {
        value: user.displayId,
        display: formatForDisplay(user.displayId),
        class: DisplayIdClass.SYSTEM,
        userId: user.id,
        issuedVia: 'system',
      },
    })
  }
  console.log(`  system principals: ${SYSTEM_PRINCIPALS.length} seeded`)
}
